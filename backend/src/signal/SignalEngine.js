class SignalEngine {
	constructor({ maxSignals = 1200 } = {}) {
		this.maxSignals = maxSignals;
		this.signals = [];
		this.previousPriceByMarket = new Map();
		this.signalCounter = 0;
	}

	_nextSignalId() {
		this.signalCounter += 1;
		return `signal_${Date.now()}_${this.signalCounter}`;
	}

	_createSignal({
		type,
		direction,
		severity,
		score,
		symbol,
		assetClass,
		providerId,
		marketKey,
		message,
		meta,
		timestamp
	}) {
		return {
			id: this._nextSignalId(),
			type,
			direction,
			severity,
			score,
			symbol,
			assetClass,
			providerId,
			marketKey,
			message,
			meta: meta || {},
			timestamp: timestamp || Date.now()
		};
	}

	evaluateTick(tick, marketStore) {
		if (!tick || !tick.symbol || !tick.assetClass || !Number.isFinite(tick.price)) {
			return [];
		}

		const signals = [];
		const marketKey = `${tick.assetClass}:${tick.symbol}`;
		const previousPrice = this.previousPriceByMarket.get(marketKey);
		const momentumThresholdBps = tick.assetClass === 'equity' ? 18 : 35;
		const volatilityThresholdBps = tick.assetClass === 'equity' ? 45 : 90;

		if (Number.isFinite(previousPrice) && previousPrice > 0) {
			const changeBps = ((tick.price - previousPrice) / previousPrice) * 10000;
			if (Math.abs(changeBps) >= momentumThresholdBps) {
				signals.push(this._createSignal({
					type: 'momentum-shift',
					direction: changeBps > 0 ? 'up' : 'down',
					severity: Math.abs(changeBps) >= volatilityThresholdBps ? 'high' : 'medium',
					score: Math.min(100, Math.round(Math.abs(changeBps))),
					symbol: tick.symbol,
					assetClass: tick.assetClass,
					providerId: tick.providerId,
					marketKey,
					message: `${tick.symbol} moved ${changeBps.toFixed(1)} bps from the previous sample`,
					meta: {
						changeBps,
						previousPrice,
						currentPrice: tick.price,
						thresholdBps: momentumThresholdBps
					},
					timestamp: tick.timestamp
				}));
			}

			if (Math.abs(changeBps) >= volatilityThresholdBps) {
				signals.push(this._createSignal({
					type: 'volatility-spike',
					direction: changeBps > 0 ? 'up' : 'down',
					severity: 'high',
					score: Math.min(100, 40 + Math.round(Math.abs(changeBps) * 0.8)),
					symbol: tick.symbol,
					assetClass: tick.assetClass,
					providerId: tick.providerId,
					marketKey,
					message: `${tick.symbol} hit a volatility spike (${changeBps.toFixed(1)} bps)`,
					meta: {
						changeBps,
						thresholdBps: volatilityThresholdBps,
						previousPrice,
						currentPrice: tick.price
					},
					timestamp: tick.timestamp
				}));
			}
		}

		this.previousPriceByMarket.set(marketKey, tick.price);

		const market = marketStore.getMarket({ symbol: tick.symbol, assetClass: tick.assetClass });
		if (market) {
			const spreadThresholdBps = tick.assetClass === 'equity' ? 12 : 25;
			if (Number.isFinite(market.spreadBps) && market.spreadBps >= spreadThresholdBps) {
				signals.push(this._createSignal({
					type: 'wide-spread',
					direction: 'neutral',
					severity: market.spreadBps >= spreadThresholdBps * 2 ? 'high' : 'medium',
					score: Math.min(100, Math.round(market.spreadBps)),
					symbol: tick.symbol,
					assetClass: tick.assetClass,
					providerId: tick.providerId,
					marketKey,
					message: `${tick.symbol} spread is ${market.spreadBps.toFixed(1)} bps`,
					meta: {
						spreadBps: market.spreadBps,
						bestBid: market.bestBid,
						bestAsk: market.bestAsk,
						thresholdBps: spreadThresholdBps
					},
					timestamp: tick.timestamp
				}));
			}

			if (Array.isArray(market.venues) && market.venues.length >= 2) {
				const prices = market.venues
					.map((venue) => Number(venue.price))
					.filter((value) => Number.isFinite(value));
				if (prices.length >= 2) {
					const maxPrice = Math.max(...prices);
					const minPrice = Math.min(...prices);
					const midpoint = (maxPrice + minPrice) / 2;
					const gapBps = midpoint > 0 ? ((maxPrice - minPrice) / midpoint) * 10000 : 0;
					const gapThresholdBps = tick.assetClass === 'equity' ? 8 : 20;
					if (gapBps >= gapThresholdBps) {
						signals.push(this._createSignal({
							type: 'cross-venue-gap',
							direction: 'neutral',
							severity: gapBps >= gapThresholdBps * 1.7 ? 'high' : 'medium',
							score: Math.min(100, Math.round(gapBps * 1.1)),
							symbol: tick.symbol,
							assetClass: tick.assetClass,
							providerId: tick.providerId,
							marketKey,
							message: `${tick.symbol} has a ${gapBps.toFixed(1)} bps cross-venue gap`,
							meta: {
								gapBps,
								maxPrice,
								minPrice,
								venueCount: market.venueCount,
								thresholdBps: gapThresholdBps
							},
							timestamp: tick.timestamp
						}));
					}
				}
			}
		}

		if (signals.length > 0) {
			this.signals.push(...signals);
			if (this.signals.length > this.maxSignals) {
				this.signals = this.signals.slice(this.signals.length - this.maxSignals);
			}
		}

		return signals;
	}

	listSignals({ limit = 120, type, symbol, severity } = {}) {
		let items = [...this.signals];
		if (type) {
			items = items.filter((signal) => signal.type === type);
		}
		if (symbol) {
			const normalizedSymbol = String(symbol).toUpperCase();
			items = items.filter((signal) => signal.symbol === normalizedSymbol);
		}
		if (severity) {
			items = items.filter((signal) => signal.severity === severity);
		}
		items.sort((a, b) => b.timestamp - a.timestamp);
		return items.slice(0, limit);
	}

	getLatestSignals(limit = 30) {
		return this.listSignals({ limit });
	}

	getSummary() {
		const now = Date.now();
		const oneMinuteAgo = now - 60 * 1000;
		const fiveMinutesAgo = now - 5 * 60 * 1000;
		const byType = {};
		const bySeverity = {};
		this.signals.forEach((signal) => {
			byType[signal.type] = (byType[signal.type] || 0) + 1;
			bySeverity[signal.severity] = (bySeverity[signal.severity] || 0) + 1;
		});

		return {
			total: this.signals.length,
			lastMinute: this.signals.filter((signal) => signal.timestamp >= oneMinuteAgo).length,
			lastFiveMinutes: this.signals.filter((signal) => signal.timestamp >= fiveMinutesAgo).length,
			byType,
			bySeverity
		};
	}
}

module.exports = SignalEngine;
