/**
 * ExecutionEngine -- converts strategy decisions into trades.
 *
 * Modes:
 * - 'paper': simulate trades with real market prices (no real money)
 * - 'live': execute via broker API (Binance, Alpaca, etc.)
 *
 * Flow: decision -> validate -> size position -> execute -> record
 */

const RiskManager = require('./RiskManager');
const alertEngine = require('../shared/alertEngine');
const log = require('../shared/logger');

class ExecutionEngine {
	constructor(opts = {}) {
		this.mode = opts.mode || 'paper'; // 'paper' | 'live'
		this.persistence = opts.persistence; // from shared/persistence.js
		this.marketStore = opts.marketStore; // MultiMarketStore
		this.maxPositionSize = opts.maxPositionSize || 0.1; // 10% of equity per trade
		this.defaultFeeRate = opts.defaultFeeRate || 0.001; // 0.1% taker fee
		this.slippageBps = opts.slippageBps || 5; // 5 basis points slippage
		this.pendingOrders = [];
		this.executedCount = 0;
		this.rejectedCount = 0;

		// Risk manager for pre-trade checks and stop/take-profit
		this.riskManager = new RiskManager(opts.riskManagerOpts || {});

		// Listeners for real-time broadcasting (server will hook into this)
		this._listeners = [];
	}

	/**
	 * Register a listener that gets called on every executed trade.
	 * @param {Function} fn - (trade) => void
	 */
	onTrade(fn) {
		if (typeof fn === 'function') this._listeners.push(fn);
	}

	_notifyTrade(trade) {
		for (const fn of this._listeners) {
			try {
				fn(trade);
			} catch (_) { /* listener errors should not break execution */ }
		}
	}

	/**
	 * Map strategy action verbs to buy/sell sides.
	 * The StrategyEngine produces: accumulate, add-long, reduce-long, de-risk,
	 * trim, pair-trade, maker-quote, restrategy:* variants, and the standard buy/sell.
	 */
	_resolveSide(action) {
		const a = String(action || '').toLowerCase().replace(/^restrategy:/, '');
		if (['accumulate', 'buy', 'add-long', 'pair-trade'].includes(a)) return 'buy';
		if (['reduce', 'sell', 'reduce-long', 'de-risk', 'trim'].includes(a)) return 'sell';
		return null;
	}

	/**
	 * Process a decision from the strategy engine.
	 */
	async execute(decision) {
		if (!decision) return null;

		const action = decision.action;
		const symbol = decision.symbol;

		if (!symbol) {
			log.warn('Execution', 'Decision missing symbol', decision.id);
			this.rejectedCount++;
			return null;
		}

		// Skip non-actionable decisions
		if (['hold', 'skip', 'wait-liquidity', 'maker-quote'].includes(action)) {
			return null;
		}

		// Look up price from market store
		const assetClass = decision.assetClass || 'crypto';
		const market = this.marketStore?.getMarket?.({ symbol, assetClass });
		const price = market?.referencePrice || 0;
		if (!price) {
			log.warn('Execution', `No price for ${symbol}, skipping`);
			this.rejectedCount++;
			return null;
		}

		// Determine side
		const side = this._resolveSide(action);
		if (!side) {
			log.debug('Execution', `Non-executable action: ${action}`);
			return null;
		}

		// Position sizing: use maxPositionSize % of wallet equity
		const wallet = this.persistence?.getWallet?.() || { cash: 10000, equity: 10000 };
		const maxNotional = wallet.equity * this.maxPositionSize;
		const quantity = maxNotional / price;

		// Apply slippage
		const slippageMultiplier = side === 'buy'
			? (1 + this.slippageBps / 10000)
			: (1 - this.slippageBps / 10000);
		const executionPrice = price * slippageMultiplier;
		const fee = quantity * executionPrice * this.defaultFeeRate;
		const notional = quantity * executionPrice;

		// Validate: enough cash for buys?
		if (side === 'buy' && wallet.cash < notional + fee) {
			log.warn('Execution', `Insufficient cash for ${symbol}: need ${(notional + fee).toFixed(2)}, have ${wallet.cash.toFixed(2)}`);
			this.rejectedCount++;
			return null;
		}

		// Validate: have position to sell?
		if (side === 'sell') {
			const positions = this.persistence?.getPositions?.() || [];
			const pos = positions.find(p => p.symbol === symbol);
			if (!pos || pos.quantity <= 0.00001) {
				log.debug('Execution', `No position to sell for ${symbol}`);
				return null;
			}
		}

		// Risk manager pre-trade check
		const positions = this.persistence?.getPositions?.() || [];
		const riskCheck = this.riskManager.checkTrade(
			{ symbol, side, quantity, price: executionPrice },
			wallet,
			positions.map(p => ({ symbol: p.symbol, quantity: p.quantity, avgEntryPrice: p.avgEntryPrice }))
		);
		if (!riskCheck.allowed) {
			log.warn('Execution', `Risk rejected ${side} ${symbol}: ${riskCheck.reason}`);
			this.rejectedCount++;
			// Fire alert on risk rejection
			const isDailyLimit = riskCheck.reason.includes('Daily loss limit');
			alertEngine.fire(
				isDailyLimit ? 'risk.daily_limit' : 'risk.rejected',
				isDailyLimit ? 'critical' : 'warning',
				`Risk rejected: ${side} ${symbol}`,
				riskCheck.reason,
				{ symbol, side, quantity, price: executionPrice, reason: riskCheck.reason }
			);
			return null;
		}

		// Execute based on mode
		let trade;
		if (this.mode === 'paper') {
			trade = this._paperExecute(decision, symbol, side, quantity, executionPrice, fee);
		} else if (this.mode === 'live') {
			trade = await this._liveExecute(decision, symbol, side, quantity, executionPrice, fee);
		}

		if (trade) {
			this.executedCount++;
			this._updateWalletAfterTrade(trade, wallet);
			this._updatePosition(trade);
			if (this.persistence) {
				this.persistence.saveTrade(trade);
			}
			this._notifyTrade(trade);
			log.info('Execution', `${this.mode.toUpperCase()} ${trade.side} ${trade.quantity.toFixed(6)} ${trade.symbol} @ ${trade.price.toFixed(4)} (fee: ${trade.fee.toFixed(4)})`);

			// Fire alert on trade execution
			alertEngine.fire(
				'trade.executed', 'info',
				`Trade executed: ${trade.side} ${trade.symbol}`,
				`${this.mode.toUpperCase()} ${trade.side} ${trade.quantity.toFixed(6)} ${trade.symbol} @ ${trade.price.toFixed(4)} (fee: ${trade.fee.toFixed(4)})`,
				{ tradeId: trade.id, symbol: trade.symbol, side: trade.side, quantity: trade.quantity, price: trade.price, fee: trade.fee, mode: this.mode }
			);
		}

		return trade;
	}

	_paperExecute(decision, symbol, side, quantity, price, fee) {
		return {
			id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			strategyId: decision.strategyId,
			symbol,
			side,
			quantity,
			price,
			fee,
			slippage: this.slippageBps,
			pnl: 0,
			decisionId: decision.id,
			signalId: decision.signalId,
			venue: 'paper',
			status: 'filled',
			timestamp: Date.now()
		};
	}

	async _liveExecute(decision, symbol, side, quantity, price, fee) {
		// TODO: integrate with broker APIs (BinanceBroker, AlpacaBroker, etc.)
		log.warn('Execution', 'Live trading not yet implemented -- falling back to paper');
		return this._paperExecute(decision, symbol, side, quantity, price, fee);
	}

	_updateWalletAfterTrade(trade, wallet) {
		if (!this.persistence) return;
		const notional = trade.quantity * trade.price;
		const cashDelta = trade.side === 'buy' ? -(notional + trade.fee) : (notional - trade.fee);
		const newCash = wallet.cash + cashDelta;

		// Recalculate equity = cash + sum of position values
		const positions = this.persistence.getPositions();
		let positionValue = 0;
		for (const pos of positions) {
			const mkt = this.marketStore?.getMarket?.({ symbol: pos.symbol, assetClass: 'crypto' })
				|| this.marketStore?.getMarket?.({ symbol: pos.symbol, assetClass: 'equity' });
			positionValue += pos.quantity * (mkt?.referencePrice || pos.avgEntryPrice);
		}

		const newEquity = newCash + positionValue;
		const avgEntry = this._getAvgEntry(trade.symbol);
		const pnl = trade.side === 'sell'
			? (trade.price - (avgEntry || trade.price)) * trade.quantity - trade.fee
			: 0;

		this.persistence.updateWallet({
			cash: newCash,
			equity: newEquity,
			totalPnl: (wallet.totalPnl || 0) + pnl,
			tradeCount: (wallet.tradeCount || 0) + 1,
			winCount: (wallet.winCount || 0) + (pnl > 0 ? 1 : 0),
			lossCount: (wallet.lossCount || 0) + (pnl < 0 ? 1 : 0)
		});
	}

	_updatePosition(trade) {
		if (!this.persistence) return;
		const positions = this.persistence.getPositions();
		const existing = positions.find(p => p.symbol === trade.symbol);

		if (trade.side === 'buy') {
			const prevQty = existing?.quantity || 0;
			const prevAvg = existing?.avgEntryPrice || 0;
			const newQty = prevQty + trade.quantity;
			const newAvg = newQty > 0
				? ((prevQty * prevAvg) + (trade.quantity * trade.price)) / newQty
				: trade.price;
			this.persistence.upsertPosition(trade.symbol, 'long', newQty, newAvg, trade.strategyId);
		} else if (trade.side === 'sell') {
			const prevQty = existing?.quantity || 0;
			const newQty = Math.max(0, prevQty - trade.quantity);
			const avgEntry = existing?.avgEntryPrice || trade.price;
			if (newQty <= 0.00001) {
				this.persistence.upsertPosition(trade.symbol, 'flat', 0, 0, trade.strategyId);
			} else {
				this.persistence.upsertPosition(trade.symbol, 'long', newQty, avgEntry, trade.strategyId);
			}
		}
	}

	_getAvgEntry(symbol) {
		if (!this.persistence) return null;
		const positions = this.persistence.getPositions();
		const pos = positions.find(p => p.symbol === symbol);
		return pos?.avgEntryPrice || null;
	}

	/**
	 * Check all open positions for stop-loss / take-profit triggers.
	 * Returns array of auto-close actions taken.
	 */
	checkStopsTakeProfits() {
		if (!this.persistence || !this.marketStore) return [];
		const positions = this.persistence.getPositions();
		const currentPrices = {};
		for (const pos of positions) {
			const mkt = this.marketStore.getMarket?.({ symbol: pos.symbol, assetClass: 'crypto' })
				|| this.marketStore.getMarket?.({ symbol: pos.symbol, assetClass: 'equity' });
			if (mkt?.referencePrice) {
				currentPrices[pos.symbol] = mkt.referencePrice;
			}
		}

		const actions = this.riskManager.checkStopsTakeProfits(
			positions.map(p => ({ symbol: p.symbol, quantity: p.quantity, avgEntryPrice: p.avgEntryPrice })),
			currentPrices
		);

		return actions;
	}

	getStats() {
		return {
			mode: this.mode,
			executed: this.executedCount,
			rejected: this.rejectedCount,
			pending: this.pendingOrders.length,
			risk: this.riskManager.getStatus()
		};
	}
}

module.exports = ExecutionEngine;
