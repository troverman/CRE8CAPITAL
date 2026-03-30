class MultiMarketStore {
	constructor({ maxTickHistory = 2000, maxSymbolHistory = 200 } = {}) {
		this.maxTickHistory = maxTickHistory;
		this.maxSymbolHistory = maxSymbolHistory;
		this.markets = new Map();
		this.tickFeed = [];
	}

	_marketKey(assetClass, symbol) {
		return `${assetClass}:${symbol}`;
	}

	_normalizeTick(input) {
		const symbol = String(input.symbol || '').toUpperCase();
		const assetClass = String(input.assetClass || 'unknown').toLowerCase();
		const venue = String(input.venue || input.providerName || input.providerId || 'UNKNOWN').toUpperCase();
		const timestamp = Number(input.timestamp) || Date.now();
		const price = Number(input.price);
		const bid = Number(input.bid);
		const ask = Number(input.ask);
		const volumeValue = Number(input.volume);
		const volume = Number.isFinite(volumeValue) ? volumeValue : null;

		return {
			providerId: input.providerId || 'provider.unknown',
			providerName: input.providerName || input.providerId || 'Unknown Provider',
			kind: input.kind || 'external',
			symbol,
			assetClass,
			venue,
			price: Number.isFinite(price) ? price : null,
			bid: Number.isFinite(bid) ? bid : null,
			ask: Number.isFinite(ask) ? ask : null,
			volume,
			timestamp,
			raw: input.raw || null
		};
	}

	ingestTick(inputTick) {
		const tick = this._normalizeTick(inputTick);
		if (!tick.symbol || !tick.assetClass || !Number.isFinite(tick.price)) {
			return null;
		}

		const key = this._marketKey(tick.assetClass, tick.symbol);
		let market = this.markets.get(key);
		if (!market) {
			market = {
				key,
				symbol: tick.symbol,
				assetClass: tick.assetClass,
				createdAt: Date.now(),
				updatedAt: tick.timestamp,
				venues: {},
				providers: {},
				history: []
			};
			this.markets.set(key, market);
		}

		market.updatedAt = tick.timestamp;
		market.venues[tick.venue] = {
			venue: tick.venue,
			providerId: tick.providerId,
			price: tick.price,
			bid: tick.bid,
			ask: tick.ask,
			volume: tick.volume,
			timestamp: tick.timestamp
		};
		market.providers[tick.providerId] = {
			id: tick.providerId,
			name: tick.providerName,
			kind: tick.kind,
			venue: tick.venue,
			price: tick.price,
			bid: tick.bid,
			ask: tick.ask,
			volume: tick.volume,
			timestamp: tick.timestamp
		};
		market.history.push({
			price: tick.price,
			bid: tick.bid,
			ask: tick.ask,
			volume: tick.volume,
			providerId: tick.providerId,
			venue: tick.venue,
			timestamp: tick.timestamp
		});
		if (market.history.length > this.maxSymbolHistory) {
			market.history.shift();
		}

		this.tickFeed.push(tick);
		if (this.tickFeed.length > this.maxTickHistory) {
			this.tickFeed.shift();
		}

		return {
			tick,
			market: this._serializeMarket(market)
		};
	}

	_serializeMarket(market) {
		const venues = Object.values(market.venues);
		const bids = venues
			.map((venue) => Number(venue.bid))
			.filter((value) => Number.isFinite(value));
		const asks = venues
			.map((venue) => Number(venue.ask))
			.filter((value) => Number.isFinite(value));
		const prices = venues
			.map((venue) => Number(venue.price))
			.filter((value) => Number.isFinite(value));

		const bestBid = bids.length > 0 ? Math.max(...bids) : null;
		const bestAsk = asks.length > 0 ? Math.min(...asks) : null;
		const lastPrice = prices.length > 0 ? prices[prices.length - 1] : null;
		const referencePrice = Number.isFinite(lastPrice)
			? lastPrice
			: (Number.isFinite(bestBid) && Number.isFinite(bestAsk)
				? (bestBid + bestAsk) / 2
				: null);

		const spreadBps = Number.isFinite(bestBid) && Number.isFinite(bestAsk) && Number.isFinite(referencePrice) && referencePrice > 0
			? ((bestAsk - bestBid) / referencePrice) * 10000
			: null;

		const firstPrice = market.history.length > 1 ? market.history[0].price : null;
		const changePct = Number.isFinite(firstPrice) && Number.isFinite(referencePrice) && firstPrice > 0
			? ((referencePrice - firstPrice) / firstPrice) * 100
			: 0;

		const totalVolume = venues.reduce((sum, venue) => {
			return sum + (Number.isFinite(venue.volume) ? venue.volume : 0);
		}, 0);

		return {
			key: market.key,
			symbol: market.symbol,
			assetClass: market.assetClass,
			createdAt: market.createdAt,
			updatedAt: market.updatedAt,
			referencePrice,
			bestBid,
			bestAsk,
			spreadBps,
			changePct,
			totalVolume,
			venueCount: venues.length,
			providerCount: Object.keys(market.providers).length,
			venues,
			providers: Object.values(market.providers)
		};
	}

	getMarket({ symbol, assetClass }) {
		const key = this._marketKey(String(assetClass || '').toLowerCase(), String(symbol || '').toUpperCase());
		const market = this.markets.get(key);
		return market ? this._serializeMarket(market) : null;
	}

	listMarkets({ limit = 200, assetClass } = {}) {
		const normalizedAssetClass = assetClass ? String(assetClass).toLowerCase() : null;
		let items = Array.from(this.markets.values()).map((market) => this._serializeMarket(market));
		if (normalizedAssetClass) {
			items = items.filter((market) => market.assetClass === normalizedAssetClass);
		}
		items.sort((a, b) => b.updatedAt - a.updatedAt);
		return items.slice(0, limit);
	}

	getTickFeed({ limit = 120 } = {}) {
		return this.tickFeed.slice(-limit).reverse();
	}

	getSummary() {
		const markets = this.listMarkets({ limit: Number.MAX_SAFE_INTEGER });
		const byAssetClass = {};
		markets.forEach((market) => {
			byAssetClass[market.assetClass] = (byAssetClass[market.assetClass] || 0) + 1;
		});

		return {
			marketCount: markets.length,
			assetClasses: byAssetClass,
			tickCount: this.tickFeed.length,
			lastTickAt: this.tickFeed.length > 0 ? this.tickFeed[this.tickFeed.length - 1].timestamp : null
		};
	}
}

module.exports = MultiMarketStore;
