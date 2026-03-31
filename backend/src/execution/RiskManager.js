/**
 * RiskManager -- pre-trade risk checks and position management.
 *
 * Features:
 * - Stop loss / take profit per position
 * - Max position size limit
 * - Max daily loss limit (drawdown protection)
 * - Max open positions
 * - Concentration limits (max % in single asset)
 */

const log = require('../shared/logger');

class RiskManager {
	constructor(opts = {}) {
		this.maxPositionPct = opts.maxPositionPct || 0.1; // 10% max per position
		this.maxDailyLossPct = opts.maxDailyLossPct || 0.05; // 5% max daily loss
		this.maxOpenPositions = opts.maxOpenPositions || 10;
		this.stopLossPct = opts.stopLossPct || 0.02; // 2% stop loss
		this.takeProfitPct = opts.takeProfitPct || 0.05; // 5% take profit
		this.dailyLoss = 0;
		this.dailyStartEquity = 0;
		this.lastResetDate = null;
	}

	/**
	 * Check if a trade is allowed.
	 * @param {Object} trade - {symbol, side, quantity, price}
	 * @param {Object} wallet - {cash, equity}
	 * @param {Array} positions - [{symbol, quantity, avgEntryPrice}]
	 * @returns {{allowed: boolean, reason: string}}
	 */
	checkTrade(trade, wallet, positions) {
		// Reset daily loss at midnight
		const today = new Date().toDateString();
		if (this.lastResetDate !== today) {
			this.dailyLoss = 0;
			this.dailyStartEquity = wallet.equity;
			this.lastResetDate = today;
		}

		// Max open positions
		const openPositions = positions.filter((p) => p.quantity > 0);
		if (trade.side === 'buy' && openPositions.length >= this.maxOpenPositions) {
			return { allowed: false, reason: `Max open positions (${this.maxOpenPositions}) reached` };
		}

		// Max position size
		const notional = trade.quantity * trade.price;
		if (wallet.equity > 0 && notional / wallet.equity > this.maxPositionPct) {
			return {
				allowed: false,
				reason: `Position size ${(notional / wallet.equity * 100).toFixed(1)}% exceeds max ${this.maxPositionPct * 100}%`
			};
		}

		// Daily loss limit
		if (this.dailyStartEquity > 0) {
			const currentLoss = (this.dailyStartEquity - wallet.equity) / this.dailyStartEquity;
			if (currentLoss >= this.maxDailyLossPct) {
				return {
					allowed: false,
					reason: `Daily loss limit ${(this.maxDailyLossPct * 100)}% reached (current: ${(currentLoss * 100).toFixed(2)}%)`
				};
			}
		}

		// Concentration check
		const existingPosition = positions.find((p) => p.symbol === trade.symbol);
		if (existingPosition && trade.side === 'buy') {
			const totalNotional = (existingPosition.quantity + trade.quantity) * trade.price;
			if (wallet.equity > 0 && totalNotional / wallet.equity > this.maxPositionPct * 2) {
				return {
					allowed: false,
					reason: `Concentration limit: ${trade.symbol} would be ${(totalNotional / wallet.equity * 100).toFixed(1)}% of portfolio`
				};
			}
		}

		return { allowed: true, reason: 'ok' };
	}

	/**
	 * Check positions for stop loss / take profit triggers.
	 * @param {Array} positions - [{symbol, quantity, avgEntryPrice}]
	 * @param {Object} currentPrices - {symbol: price}
	 * @returns {Array} [{symbol, action, reason, pnlPct}]
	 */
	checkStopsTakeProfits(positions, currentPrices) {
		const actions = [];
		for (const pos of positions) {
			if (pos.quantity <= 0) continue;
			const currentPrice = currentPrices[pos.symbol];
			if (!currentPrice) continue;

			const pnlPct = (currentPrice - pos.avgEntryPrice) / pos.avgEntryPrice;

			if (pnlPct <= -this.stopLossPct) {
				actions.push({
					symbol: pos.symbol,
					action: 'stop_loss',
					reason: `Stop loss triggered: ${(pnlPct * 100).toFixed(2)}% loss`,
					pnlPct
				});
			} else if (pnlPct >= this.takeProfitPct) {
				actions.push({
					symbol: pos.symbol,
					action: 'take_profit',
					reason: `Take profit triggered: ${(pnlPct * 100).toFixed(2)}% gain`,
					pnlPct
				});
			}
		}
		return actions;
	}

	recordDailyLoss(amount) {
		this.dailyLoss += amount;
	}

	updateParams(params) {
		if (typeof params.stopLossPct === 'number' && Number.isFinite(params.stopLossPct)) {
			this.stopLossPct = Math.max(0.001, Math.min(0.5, params.stopLossPct));
		}
		if (typeof params.takeProfitPct === 'number' && Number.isFinite(params.takeProfitPct)) {
			this.takeProfitPct = Math.max(0.001, Math.min(1, params.takeProfitPct));
		}
		if (typeof params.maxPositionPct === 'number' && Number.isFinite(params.maxPositionPct)) {
			this.maxPositionPct = Math.max(0.01, Math.min(1, params.maxPositionPct));
		}
		if (typeof params.maxDailyLossPct === 'number' && Number.isFinite(params.maxDailyLossPct)) {
			this.maxDailyLossPct = Math.max(0.005, Math.min(0.5, params.maxDailyLossPct));
		}
		if (typeof params.maxOpenPositions === 'number' && Number.isFinite(params.maxOpenPositions)) {
			this.maxOpenPositions = Math.max(1, Math.min(100, Math.round(params.maxOpenPositions)));
		}
		log.info('RiskManager', 'parameters updated', JSON.stringify(this.getStatus()));
	}

	getStatus() {
		return {
			maxPositionPct: this.maxPositionPct,
			maxDailyLossPct: this.maxDailyLossPct,
			maxOpenPositions: this.maxOpenPositions,
			stopLossPct: this.stopLossPct,
			takeProfitPct: this.takeProfitPct,
			dailyLoss: this.dailyLoss,
			dailyStartEquity: this.dailyStartEquity
		};
	}
}

module.exports = RiskManager;
