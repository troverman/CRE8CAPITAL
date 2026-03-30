const Provider = require('./Provider');

class CCXTProvider extends Provider {
	constructor({
		exchangeId = 'binanceus',
		symbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
		intervalMs = 15000
	} = {}) {
		super({
			id: `ccxt.${exchangeId}`,
			name: `CCXT ${exchangeId}`,
			assetClass: 'crypto',
			kind: 'external'
		});
		this.exchangeId = exchangeId;
		this.symbols = symbols;
		this.intervalMs = intervalMs;
		this._timer = null;
		this._exchange = null;
	}

	async _createExchange() {
		let ccxtLib;
		try {
			// Lazy import so the app can run even when ccxt is unavailable.
			ccxtLib = require('ccxt');
		} catch (error) {
			throw new Error(`ccxt unavailable: ${error.message}`);
		}
		const ExchangeClass = ccxtLib[this.exchangeId];
		if (!ExchangeClass) {
			throw new Error(`ccxt exchange "${this.exchangeId}" not found`);
		}
		return new ExchangeClass();
	}

	async _pollSymbol(symbol) {
		const ticker = await this._exchange.fetchTicker(symbol);
		const normalizedSymbol = String(symbol).replace('/', '-').toUpperCase();
		this.emitTick({
			symbol: normalizedSymbol,
			venue: this.exchangeId.toUpperCase(),
			price: Number(ticker.last),
			bid: Number(ticker.bid),
			ask: Number(ticker.ask),
			volume: Number(ticker.baseVolume || ticker.quoteVolume || 0),
			timestamp: Number(ticker.timestamp) || Date.now(),
			raw: {
				base: ticker.base,
				quote: ticker.quote
			}
		});
	}

	async _poll() {
		for (const symbol of this.symbols) {
			try {
				// eslint-disable-next-line no-await-in-loop
				await this._pollSymbol(symbol);
			} catch (error) {
				this.setError(error);
			}
		}
	}

	async connect() {
		if (this._timer) return;
		this.setError(null);
		try {
			this._exchange = await this._createExchange();
			await this._exchange.loadMarkets();
		} catch (error) {
			this.setError(error);
			return;
		}
		await this._poll();
		this._timer = setInterval(() => {
			this._poll().catch((error) => this.setError(error));
		}, this.intervalMs);
		this.setConnected(true);
	}

	async disconnect() {
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
		this._exchange = null;
		await super.disconnect();
	}
}

module.exports = CCXTProvider;
