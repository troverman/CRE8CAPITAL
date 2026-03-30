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

	getStrategies() {
		return Array.from(this.strategyMap.values()).map((strategy) => ({
			id: strategy.id,
			name: strategy.name,
			description: strategy.description,
			assetClasses: strategy.assetClasses,
			signalTypes: strategy.signalTypes,
			protocol: strategy.protocol,
			minScore: strategy.minScore,
			enabled: strategy.enabled,
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
