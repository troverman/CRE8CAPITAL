/**
 * BacktestEngine -- runs strategies against historical data.
 *
 * Input: {strategy, symbols, startDate, endDate, initialCash, feeRate}
 * Output: {trades, equityCurve, metrics (Sharpe, Sortino, max drawdown, win rate)}
 */

const SignalEngine = require('../signal/SignalEngine');
const log = require('../shared/logger');

class BacktestEngine {
	constructor(opts = {}) {
		this.feeRate = opts.feeRate || 0.001;
		this.slippageBps = opts.slippageBps || 5;
		this.initialCash = opts.initialCash || 10000;
	}

	/**
	 * Run a backtest.
	 * @param {Object} strategy - strategy config with protocol field
	 * @param {Array} history - array of {symbol, open, high, low, close, volume, timestamp} candles
	 * @param {Object} opts - options (initialCash override, etc.)
	 * @returns {{trades, equityCurve, metrics, finalCash, finalPositions}}
	 */
	run(strategy, history, opts = {}) {
		const cash = { value: opts.initialCash || this.initialCash };
		const positions = {}; // symbol -> {quantity, avgEntry}
		const trades = [];
		const equityCurve = [];

		// Sort history by timestamp
		const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);

		// Group by timestamp (for multi-symbol backtests)
		const timeGroups = new Map();
		for (const candle of sorted) {
			const key = candle.timestamp;
			if (!timeGroups.has(key)) timeGroups.set(key, []);
			timeGroups.get(key).push(candle);
		}

		const prevPrices = {};

		for (const [timestamp, candles] of timeGroups) {
			for (const candle of candles) {
				const prevPrice = prevPrices[candle.symbol];
				const signals = [];

				if (prevPrice) {
					const pctChange = (candle.close - prevPrice) / prevPrice;

					// Momentum signal
					if (Math.abs(pctChange) > 0.01) {
						signals.push({
							id: `bt_${timestamp}_mom_${candle.symbol}`,
							type: 'momentum-shift',
							symbol: candle.symbol,
							severity: Math.abs(pctChange) > 0.03 ? 'high' : 'medium',
							score: Math.min(100, Math.abs(pctChange) * 1000),
							meta: {
								pctChange,
								price: candle.close,
								direction: pctChange > 0 ? 'up' : 'down'
							},
							timestamp
						});
					}

					// Volatility signal (using high-low range)
					const range = (candle.high - candle.low) / candle.close;
					if (range > 0.02) {
						signals.push({
							id: `bt_${timestamp}_vol_${candle.symbol}`,
							type: 'volatility-spike',
							symbol: candle.symbol,
							severity: range > 0.05 ? 'high' : 'medium',
							score: Math.min(100, range * 1000),
							meta: { range, price: candle.close },
							timestamp
						});
					}
				}

				prevPrices[candle.symbol] = candle.close;

				// Apply strategy logic to signals
				for (const signal of signals) {
					const action = this._resolveAction(strategy, signal);
					if (!action || action === 'hold') continue;

					const side = (action === 'accumulate' || action === 'buy') ? 'buy' : 'sell';
					const price = candle.close;
					const equity = cash.value + this._positionValue(positions, prevPrices);
					const maxNotional = equity * 0.1; // 10% per trade
					const quantity = maxNotional / price;

					if (side === 'buy' && cash.value < quantity * price) continue;
					if (side === 'sell' && (!positions[candle.symbol] || positions[candle.symbol].quantity <= 0)) continue;

					const slippage = price * this.slippageBps / 10000;
					const execPrice = side === 'buy' ? price + slippage : price - slippage;
					const fee = quantity * execPrice * this.feeRate;
					const notional = quantity * execPrice;

					if (side === 'buy') {
						cash.value -= (notional + fee);
						if (!positions[candle.symbol]) positions[candle.symbol] = { quantity: 0, avgEntry: 0 };
						const pos = positions[candle.symbol];
						const newQty = pos.quantity + quantity;
						pos.avgEntry = ((pos.quantity * pos.avgEntry) + (quantity * execPrice)) / newQty;
						pos.quantity = newQty;
					} else {
						const pos = positions[candle.symbol];
						const sellQty = Math.min(quantity, pos.quantity);
						cash.value += (sellQty * execPrice - fee);
						pos.quantity -= sellQty;
					}

					trades.push({
						side,
						symbol: candle.symbol,
						quantity,
						price: execPrice,
						fee,
						timestamp,
						action,
						signalType: signal.type
					});
				}
			}

			// Record equity point
			const posValue = this._positionValue(positions, prevPrices);
			equityCurve.push({
				timestamp,
				equity: cash.value + posValue,
				cash: cash.value,
				positionValue: posValue
			});
		}

		const metrics = this._computeMetrics(equityCurve, trades, opts.initialCash || this.initialCash);

		return {
			trades,
			equityCurve,
			metrics,
			finalCash: cash.value,
			finalPositions: positions
		};
	}

	_resolveAction(strategy, signal) {
		const protocol = strategy.protocol || 'trend-follow';
		const direction = signal.meta?.direction || (signal.meta?.pctChange > 0 ? 'up' : 'down');

		if (protocol === 'trend-follow') {
			return direction === 'up' ? 'buy' : 'sell';
		} else if (protocol === 'mean-revert') {
			return direction === 'up' ? 'sell' : 'buy';
		}
		return 'hold';
	}

	_positionValue(positions, prices) {
		let total = 0;
		for (const [symbol, pos] of Object.entries(positions)) {
			total += pos.quantity * (prices[symbol] || pos.avgEntry);
		}
		return total;
	}

	_computeMetrics(equityCurve, trades, initialCash) {
		if (equityCurve.length < 2) {
			return {
				sharpe: 0, sortino: 0, maxDrawdown: 0, winRate: 0,
				totalReturn: 0, totalTrades: trades.length, avgReturn: 0,
				volatility: 0, finalEquity: initialCash, profitFactor: 0
			};
		}

		const returns = [];
		for (let i = 1; i < equityCurve.length; i++) {
			const prev = equityCurve[i - 1].equity;
			if (prev > 0) {
				returns.push((equityCurve[i].equity - prev) / prev);
			}
		}

		if (returns.length === 0) {
			return {
				sharpe: 0, sortino: 0, maxDrawdown: 0, winRate: 0,
				totalReturn: 0, totalTrades: trades.length, avgReturn: 0,
				volatility: 0, finalEquity: initialCash, profitFactor: 0
			};
		}

		const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
		const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / returns.length);
		const downsideReturns = returns.filter(r => r < 0);
		const downside = downsideReturns.length > 0
			? Math.sqrt(downsideReturns.reduce((sum, r) => sum + r ** 2, 0) / downsideReturns.length)
			: 0;

		// Max drawdown
		let peak = initialCash;
		let maxDrawdown = 0;
		for (const point of equityCurve) {
			if (point.equity > peak) peak = point.equity;
			const dd = (peak - point.equity) / peak;
			if (dd > maxDrawdown) maxDrawdown = dd;
		}

		// Win rate from closing trades
		const closingTrades = trades.filter(t => t.side === 'sell');
		const wins = closingTrades.filter(t => {
			const buyTrades = trades.filter(bt => bt.side === 'buy' && bt.symbol === t.symbol && bt.timestamp < t.timestamp);
			const lastBuy = buyTrades[buyTrades.length - 1];
			return lastBuy && t.price > lastBuy.price;
		});

		// Profit factor
		let grossProfit = 0;
		let grossLoss = 0;
		for (const t of closingTrades) {
			const buyTrades = trades.filter(bt => bt.side === 'buy' && bt.symbol === t.symbol && bt.timestamp < t.timestamp);
			const lastBuy = buyTrades[buyTrades.length - 1];
			if (lastBuy) {
				const pnl = (t.price - lastBuy.price) * t.quantity - t.fee;
				if (pnl > 0) grossProfit += pnl;
				else grossLoss += Math.abs(pnl);
			}
		}

		const finalEquity = equityCurve[equityCurve.length - 1]?.equity || initialCash;
		const totalReturn = (finalEquity - initialCash) / initialCash;
		const annualizationFactor = Math.sqrt(252); // daily -> annual

		return {
			totalReturn: +(totalReturn * 100).toFixed(2),
			sharpe: stdDev > 0 ? +((avgReturn / stdDev) * annualizationFactor).toFixed(3) : 0,
			sortino: downside > 0 ? +((avgReturn / downside) * annualizationFactor).toFixed(3) : 0,
			maxDrawdown: +(maxDrawdown * 100).toFixed(2),
			winRate: closingTrades.length > 0 ? +((wins.length / closingTrades.length) * 100).toFixed(1) : 0,
			totalTrades: trades.length,
			avgReturn: +(avgReturn * 100).toFixed(4),
			volatility: +(stdDev * 100).toFixed(4),
			finalEquity: +finalEquity.toFixed(2),
			profitFactor: grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(3) : (grossProfit > 0 ? Infinity : 0)
		};
	}
}

module.exports = BacktestEngine;
