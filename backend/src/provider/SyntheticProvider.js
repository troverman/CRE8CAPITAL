const Provider = require('./Provider');

class SyntheticProvider extends Provider {
	constructor({
		id,
		name,
		assetClass,
		venue = 'SIM',
		symbols = [],
		intervalMs = 3000,
		startingPrices = {},
		volatility = 0.006
	}) {
		super({
			id: id || `synthetic.${assetClass || 'market'}`,
			name: name || 'Synthetic Feed',
			assetClass: assetClass || 'unknown',
			kind: 'synthetic'
		});
		this.venue = venue;
		this.symbols = symbols;
		this.intervalMs = intervalMs;
		this.volatility = volatility;
		this._timer = null;
		this._prices = new Map();
		for (const symbol of symbols) {
			this._prices.set(symbol, Number(startingPrices[symbol] || 100));
		}
	}

	_nextPrice(last) {
		const drift = (Math.random() - 0.5) * this.volatility * 2;
		return Math.max(0.000001, last * (1 + drift));
	}

	_emitSymbol(symbol) {
		const last = this._prices.get(symbol) || 100;
		const price = this._nextPrice(last);
		this._prices.set(symbol, price);
		const spreadBps = 4 + Math.random() * 6;
		const spreadRatio = spreadBps / 10000;
		const bid = price * (1 - spreadRatio / 2);
		const ask = price * (1 + spreadRatio / 2);
		const volume = Math.max(1, Math.random() * 1000);

		this.emitTick({
			symbol,
			venue: this.venue,
			price,
			bid,
			ask,
			volume,
			timestamp: Date.now()
		});
	}

	async connect() {
		if (this._timer) return;
		this.setError(null);
		for (const symbol of this.symbols) {
			this._emitSymbol(symbol);
		}
		this._timer = setInterval(() => {
			for (const symbol of this.symbols) {
				this._emitSymbol(symbol);
			}
		}, this.intervalMs);
		this.setConnected(true);
	}

	async disconnect() {
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
		await super.disconnect();
	}
}

module.exports = SyntheticProvider;
