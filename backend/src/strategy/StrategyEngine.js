const { computeRSI, computeMACD } = require('../shared/indicators');

const DEFAULT_STRATEGIES = [
	{
		id: 'crypto-trend-rider',
		name: 'Crypto Trend Rider',
		description: 'Follows directional momentum and throttles exposure on sharp volatility.',
		assetClasses: ['crypto'],
		signalTypes: ['momentum-shift', 'volatility-spike'],
		protocol: 'trend-follow',
		minScore: 35
	},
	{
		id: 'equity-mean-revert',
		name: 'Equity Mean Revert',
		description: 'Buys dislocations in large-cap equities and trims extended rallies.',
		assetClasses: ['equity'],
		signalTypes: ['momentum-shift', 'wide-spread'],
		protocol: 'mean-revert',
		minScore: 20
	},
	{
		id: 'cross-venue-arb-scout',
		name: 'Cross Venue Arb Scout',
		description: 'Looks for pricing gaps across providers and flags pair-trade opportunities.',
		assetClasses: ['crypto', 'equity'],
		signalTypes: ['cross-venue-gap', 'wide-spread'],
		protocol: 'arb',
		minScore: 18
	},
	{
		id: 'dca-bot',
		name: 'DCA Bot',
		description: 'Dollar-cost averaging: buys a fixed amount at regular intervals.',
		assetClasses: ['crypto', 'equity'],
		signalTypes: ['momentum-shift'],
		protocol: 'dca',
		minScore: 0,
		config: { intervalMs: 3600000, amount: 100 }
	},
	{
		id: 'scalper',
		name: 'Scalper',
		description: 'Captures small price movements with tight entries and exits.',
		assetClasses: ['crypto'],
		signalTypes: ['momentum-shift'],
		protocol: 'scalp',
		minScore: 0,
		config: { entryThreshold: 0.001, takeProfitPct: 0.003, stopLossPct: 0.001 }
	},
	{
		id: 'grid-bot',
		name: 'Grid Bot',
		description: 'Places layered orders across a price grid to profit from oscillations.',
		assetClasses: ['crypto'],
		signalTypes: ['momentum-shift', 'volatility-spike'],
		protocol: 'grid',
		minScore: 0,
		config: { gridLevels: 10, gridSpacingPct: 0.005 }
	},
	{
		id: 'rsi-revert',
		name: 'RSI Mean Revert',
		description: 'Buys oversold and sells overbought based on RSI indicator.',
		assetClasses: ['crypto', 'equity'],
		signalTypes: ['momentum-shift'],
		protocol: 'rsi-revert',
		minScore: 0,
		config: { rsiPeriod: 14, oversold: 30, overbought: 70 }
	},
	{
		id: 'macd-cross',
		name: 'MACD Crossover',
		description: 'Enters on bullish MACD crossover and exits on bearish crossover.',
		assetClasses: ['crypto', 'equity'],
		signalTypes: ['momentum-shift'],
		protocol: 'macd-cross',
		minScore: 0,
		config: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }
	},
	{
		id: 'pairs-trade',
		name: 'Pairs Trading',
		description: 'Exploits cross-venue pricing gaps using z-score reversion.',
		assetClasses: ['crypto'],
		signalTypes: ['cross-venue-gap'],
		protocol: 'pairs',
		minScore: 0,
		config: { lookback: 50, entryZScore: 2 }
	}
];

class StrategyEngine {
	constructor({ strategies = DEFAULT_STRATEGIES, maxDecisions = 1500 } = {}) {
		this.maxDecisions = maxDecisions;
		this.decisionCounter = 0;
		this.decisions = [];
		this.lastSignalsByMarket = new Map();
		this.positions = new Map();
		this.strategyMap = new Map();
		this.priceHistory = new Map(); // symbol -> [price, price, ...] last 100
		this.lastBuyTime = new Map(); // strategyId:symbol -> timestamp

		strategies.forEach((strategy) => {
			this.strategyMap.set(strategy.id, {
				...strategy,
				enabled: strategy.enabled !== false,
				metrics: {
					decisionCount: 0,
					lastDecisionAt: null
				}
			});
		});
	}

	_nextDecisionId() {
		this.decisionCounter += 1;
		return `decision_${Date.now()}_${this.decisionCounter}`;
	}

	_isStrategyEligible(strategy, signal) {
		if (!strategy.enabled) {
			return false;
		}
		if (!strategy.assetClasses.includes(signal.assetClass)) {
			return false;
		}
		if (!strategy.signalTypes.includes(signal.type)) {
			return false;
		}
		if (Number(signal.score) < Number(strategy.minScore || 0)) {
			return false;
		}
		return true;
	}

	_resolveAction(strategy, signal) {
		if (strategy.protocol === 'trend-follow') {
			if (signal.type === 'volatility-spike') {
				return {
					action: 'de-risk',
					intent: signal.direction === 'up' ? 'lock-gains' : 'cap-drawdown',
					reason: 'Volatility exceeded trend rider threshold'
				};
			}
			if (signal.direction === 'up') {
				return {
					action: 'add-long',
					intent: 'follow-uptrend',
					reason: 'Momentum remains positive'
				};
			}
			return {
				action: 'reduce-long',
				intent: 'protect-capital',
				reason: 'Momentum shifted lower'
			};
		}

		if (strategy.protocol === 'mean-revert') {
			if (signal.type === 'wide-spread') {
				return {
					action: 'wait-liquidity',
					intent: 'avoid-slippage',
					reason: 'Spread expanded above fair execution band'
				};
			}
			if (signal.direction === 'down') {
				return {
					action: 'accumulate',
					intent: 'buy-dislocation',
					reason: 'Mean reversion entry zone detected'
				};
			}
			return {
				action: 'trim',
				intent: 'harvest-recovery',
				reason: 'Recovery leg likely over-extended'
			};
		}

		if (strategy.protocol === 'arb') {
			if (signal.type === 'cross-venue-gap') {
				return {
					action: 'pair-trade',
					intent: 'capture-gap',
					reason: 'Cross-venue mismatch exceeded arb threshold'
				};
			}
			return {
				action: 'maker-quote',
				intent: 'supply-liquidity',
				reason: 'Spread regime supports passive quoting'
			};
		}

		if (strategy.protocol === 'dca') {
			const cfg = strategy.config || {};
			const intervalMs = cfg.intervalMs || 3600000;
			const key = `${strategy.id}:${signal.symbol}`;
			const lastBuy = this.lastBuyTime.get(key) || 0;
			const now = signal.timestamp || Date.now();
			if (now - lastBuy >= intervalMs) {
				this.lastBuyTime.set(key, now);
				return {
					action: 'accumulate',
					intent: 'dca-buy',
					reason: `DCA interval elapsed (${Math.round(intervalMs / 60000)}m). Accumulating $${cfg.amount || 100}.`
				};
			}
			return null;
		}

		if (strategy.protocol === 'scalp') {
			const cfg = strategy.config || {};
			const entryThreshold = cfg.entryThreshold || 0.001;
			const changeBps = Math.abs(signal.meta?.changeBps || 0) / 10000;
			if (signal.direction === 'up' && changeBps >= entryThreshold) {
				return {
					action: 'accumulate',
					intent: 'scalp-entry',
					reason: `Scalp entry: ${(changeBps * 100).toFixed(3)}% move exceeds ${(entryThreshold * 100).toFixed(3)}% threshold`
				};
			}
			if (signal.direction === 'down' && changeBps >= entryThreshold) {
				return {
					action: 'reduce',
					intent: 'scalp-exit',
					reason: `Scalp exit: ${(changeBps * 100).toFixed(3)}% adverse move`
				};
			}
			return null;
		}

		if (strategy.protocol === 'grid') {
			const cfg = strategy.config || {};
			const gridLevels = cfg.gridLevels || 10;
			const gridSpacingPct = cfg.gridSpacingPct || 0.005;
			const currentPrice = signal.meta?.currentPrice || 0;
			const previousPrice = signal.meta?.previousPrice || 0;
			if (!currentPrice || !previousPrice) return null;
			const midPrice = (currentPrice + previousPrice) / 2;
			const priceOffset = (currentPrice - midPrice) / midPrice;
			const gridLevel = Math.round(priceOffset / gridSpacingPct);
			if (gridLevel <= -(gridLevels / 4)) {
				return {
					action: 'accumulate',
					intent: 'grid-buy',
					reason: `Grid buy level ${gridLevel}: price ${(priceOffset * 100).toFixed(3)}% below mid`
				};
			}
			if (gridLevel >= (gridLevels / 4)) {
				return {
					action: 'reduce',
					intent: 'grid-sell',
					reason: `Grid sell level ${gridLevel}: price ${(priceOffset * 100).toFixed(3)}% above mid`
				};
			}
			return null;
		}

		if (strategy.protocol === 'rsi-revert') {
			const cfg = strategy.config || {};
			const rsiPeriod = cfg.rsiPeriod || 14;
			const oversold = cfg.oversold || 30;
			const overbought = cfg.overbought || 70;
			const prices = this.priceHistory.get(signal.symbol) || [];
			if (prices.length < rsiPeriod + 1) return null;
			const rsi = computeRSI(prices, rsiPeriod);
			if (rsi === null) return null;
			if (rsi < oversold) {
				return {
					action: 'accumulate',
					intent: 'rsi-oversold',
					reason: `RSI ${rsi.toFixed(1)} below oversold threshold ${oversold}`
				};
			}
			if (rsi > overbought) {
				return {
					action: 'reduce',
					intent: 'rsi-overbought',
					reason: `RSI ${rsi.toFixed(1)} above overbought threshold ${overbought}`
				};
			}
			return null;
		}

		if (strategy.protocol === 'macd-cross') {
			const cfg = strategy.config || {};
			const fastPeriod = cfg.fastPeriod || 12;
			const slowPeriod = cfg.slowPeriod || 26;
			const signalPeriod = cfg.signalPeriod || 9;
			const prices = this.priceHistory.get(signal.symbol) || [];
			if (prices.length < slowPeriod + signalPeriod) return null;
			const macd = computeMACD(prices, fastPeriod, slowPeriod, signalPeriod);
			if (macd.macd === null || macd.signal === null || macd.prevMacd === null || macd.prevSignal === null) return null;
			const bullishCross = macd.prevMacd <= macd.prevSignal && macd.macd > macd.signal;
			const bearishCross = macd.prevMacd >= macd.prevSignal && macd.macd < macd.signal;
			if (bullishCross) {
				return {
					action: 'accumulate',
					intent: 'macd-bullish-cross',
					reason: `MACD bullish crossover: MACD ${macd.macd.toFixed(4)} > Signal ${macd.signal.toFixed(4)}`
				};
			}
			if (bearishCross) {
				return {
					action: 'reduce',
					intent: 'macd-bearish-cross',
					reason: `MACD bearish crossover: MACD ${macd.macd.toFixed(4)} < Signal ${macd.signal.toFixed(4)}`
				};
			}
			return null;
		}

		if (strategy.protocol === 'pairs') {
			const cfg = strategy.config || {};
			const entryZScore = cfg.entryZScore || 2;
			if (signal.type !== 'cross-venue-gap') return null;
			const gapBps = signal.meta?.gapBps || 0;
			// Use gap size relative to typical gap as a z-score proxy
			const thresholdBps = signal.meta?.thresholdBps || 20;
			const zProxy = thresholdBps > 0 ? gapBps / thresholdBps : 0;
			if (zProxy >= entryZScore) {
				return {
					action: 'pair-trade',
					intent: 'pairs-arb',
					reason: `Pairs trade: gap ${gapBps.toFixed(1)} bps, z-proxy ${zProxy.toFixed(2)} >= ${entryZScore}`
				};
			}
			return null;
		}

		return null;
	}

	_recordDecision(strategy, signal, actionModel, trigger, overrideReason) {
		const decision = {
			id: this._nextDecisionId(),
			strategyId: strategy.id,
			strategyName: strategy.name,
			symbol: signal.symbol,
			assetClass: signal.assetClass,
			signalId: signal.id,
			signalType: signal.type,
			signalDirection: signal.direction,
			action: actionModel.action,
			intent: actionModel.intent,
			reason: overrideReason || actionModel.reason,
			score: signal.score,
			severity: signal.severity,
			trigger,
			timestamp: signal.timestamp || Date.now()
		};

		this.decisions.push(decision);
		if (this.decisions.length > this.maxDecisions) {
			this.decisions = this.decisions.slice(this.decisions.length - this.maxDecisions);
		}

		const positionKey = `${strategy.id}:${signal.symbol}`;
		this.positions.set(positionKey, {
			strategyId: strategy.id,
			strategyName: strategy.name,
			symbol: signal.symbol,
			assetClass: signal.assetClass,
			state: actionModel.action,
			intent: actionModel.intent,
			lastSignalType: signal.type,
			lastSignalDirection: signal.direction,
			confidence: signal.score,
			updatedAt: decision.timestamp
		});

		strategy.metrics.decisionCount += 1;
		strategy.metrics.lastDecisionAt = decision.timestamp;

		return decision;
	}

	evaluateSignals(signals, { trigger = 'signal' } = {}) {
		if (!Array.isArray(signals) || signals.length === 0) {
			return [];
		}

		const decisions = [];
		for (const signal of signals) {
			this.lastSignalsByMarket.set(signal.marketKey || `${signal.assetClass}:${signal.symbol}`, signal);

			// Track price history per symbol (from signal meta)
			if (signal.symbol && signal.meta?.currentPrice) {
				const prices = this.priceHistory.get(signal.symbol) || [];
				prices.push(signal.meta.currentPrice);
				if (prices.length > 100) prices.shift();
				this.priceHistory.set(signal.symbol, prices);
			}

			for (const strategy of this.strategyMap.values()) {
				if (!this._isStrategyEligible(strategy, signal)) {
					continue;
				}
				const actionModel = this._resolveAction(strategy, signal);
				if (!actionModel) {
					continue;
				}
				decisions.push(this._recordDecision(strategy, signal, actionModel, trigger));
			}
		}

		return decisions;
	}

	restrategy({ reason = 'manual-restrategy', source = 'api', signals } = {}) {
		const signalSet = Array.isArray(signals) && signals.length > 0
			? signals
			: Array.from(this.lastSignalsByMarket.values());
		if (signalSet.length === 0) {
			return [];
		}

		const latestSignalBySymbol = new Map();
		signalSet.forEach((signal) => {
			const key = `${signal.assetClass}:${signal.symbol}`;
			const current = latestSignalBySymbol.get(key);
			if (!current || signal.timestamp > current.timestamp) {
				latestSignalBySymbol.set(key, signal);
			}
		});

		const decisions = [];
		for (const strategy of this.strategyMap.values()) {
			if (!strategy.enabled) {
				continue;
			}

			for (const signal of latestSignalBySymbol.values()) {
				if (!strategy.assetClasses.includes(signal.assetClass)) {
					continue;
				}
				if (!strategy.signalTypes.includes(signal.type)) {
					continue;
				}

				const baseAction = this._resolveAction(strategy, signal);
				if (!baseAction) {
					continue;
				}
				const restrategyReason = `${reason} (${source})`;
				decisions.push(this._recordDecision(
					strategy,
					signal,
					{ ...baseAction, action: `restrategy:${baseAction.action}` },
					'restrategy',
					restrategyReason
				));
			}
		}

		return decisions;
	}

	loadCustomStrategies(customStrategies) {
		if (!Array.isArray(customStrategies)) return;
		for (const cs of customStrategies) {
			if (!cs.id) continue;
			// Don't overwrite built-in strategies
			if (this.strategyMap.has(cs.id)) continue;
			this.strategyMap.set(cs.id, {
				id: cs.id,
				name: cs.name || cs.id,
				description: cs.description || '',
				assetClasses: Array.isArray(cs.assetClasses) ? cs.assetClasses : (cs.assetClasses || 'crypto').split(','),
				signalTypes: Array.isArray(cs.signals) ? cs.signals : (cs.signals || 'momentum-shift').split(','),
				protocol: cs.protocol || 'trend-follow',
				minScore: Number(cs.minScore) || 0,
				config: typeof cs.config === 'string' ? JSON.parse(cs.config || '{}') : (cs.config || {}),
				enabled: cs.enabled !== 0 && cs.enabled !== false,
				custom: true,
				metrics: {
					decisionCount: 0,
					lastDecisionAt: null
				}
			});
		}
	}

	getStrategies() {
		return Array.from(this.strategyMap.values()).map((strategy) => ({
			id: strategy.id,
			name: strategy.name,
			description: strategy.description,
			assetClasses: strategy.assetClasses,
			signalTypes: strategy.signalTypes,
			protocol: strategy.protocol,
			minScore: strategy.minScore,
			config: strategy.config,
			enabled: strategy.enabled,
			custom: strategy.custom || false,
			metrics: { ...strategy.metrics }
		}));
	}

	listDecisions({ limit = 120, strategyId, symbol } = {}) {
		let items = [...this.decisions];
		if (strategyId) {
			items = items.filter((decision) => decision.strategyId === strategyId);
		}
		if (symbol) {
			const normalized = String(symbol).toUpperCase();
			items = items.filter((decision) => decision.symbol === normalized);
		}
		items.sort((a, b) => b.timestamp - a.timestamp);
		return items.slice(0, limit);
	}

	getPositions() {
		return Array.from(this.positions.values()).sort((a, b) => b.updatedAt - a.updatedAt);
	}

	getSummary() {
		const now = Date.now();
		const fiveMinutesAgo = now - 5 * 60 * 1000;
		return {
			totalDecisions: this.decisions.length,
			lastFiveMinutes: this.decisions.filter((decision) => decision.timestamp >= fiveMinutesAgo).length,
			activePositions: this.positions.size,
			strategyCount: this.strategyMap.size
		};
	}
}

module.exports = StrategyEngine;
