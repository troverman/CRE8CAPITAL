const ccxt = require('ccxt');
const Provider = require('./Provider');

class CCXTProvider extends Provider {
	constructor({ exchangeId = 'binanceus', marketLimit = 10, interval = 60000 }) {
		super({ id: `ccxt.${exchangeId}` });
		this.exchangeId = exchangeId;
		this.marketLimit = marketLimit;
		this.interval = interval;
		this._intervals = [];
	}

	async connect() {
		const exchange = new ccxt[this.exchangeId]();
		console.log(`[CCXTProvider] connecting: ${this.exchangeId}`);

		this.emit('exchange', { string: this.exchangeId });

		let markets;
		try {
			markets = await exchange.loadMarkets();
		} catch (e) {
			console.error(`[CCXTProvider] loadMarkets error: ${this.exchangeId}`, e.message);
			return;
		}

		const marketKeys = Object.keys(markets).slice(0, this.marketLimit);

		for (const key of marketKeys) {
			this.emit('market', { string: key.replace('/', '-'), rank: 2 });
		}

		for (const key of marketKeys) {
			const id = setInterval(() => this._pollMarket(exchange, key), this.interval);
			this._intervals.push(id);
		}

		this._connected = true;
	}

	async _pollMarket(exchange, symbol) {
		try {
			const orderBook = await exchange.fetchOrderBook(symbol);
			const [base, quote] = symbol.split('/');

			for (const [price, amount] of orderBook.asks) {
				this.emit('position', {
					string: `${this.exchangeId}.${symbol}`,
					input:  { '1': { asset: { string: base },  number: amount } },
					output: { '1': { asset: { string: quote }, number: price * amount } }
				});
			}
			for (const [price, amount] of orderBook.bids) {
				this.emit('position', {
					string: `${this.exchangeId}.${symbol}`,
					input:  { '1': { asset: { string: quote }, number: price * amount } },
					output: { '1': { asset: { string: base },  number: amount } }
				});
			}
		} catch (e) {
			console.error(`[CCXTProvider] orderBook error: ${symbol}`, e.message);
		}

		try {
			const trades = await exchange.fetchTrades(symbol);
			for (const trade of trades) {
				const [base, quote] = trade.symbol.split('/');
				this.emit('trade', {
					string: `${trade.symbol.replace('/', ':')}.${this.exchangeId}.${trade.id}`,
					input:  { string: base,  number: trade.amount,             pool: `${trade.symbol}.${this.exchangeId}` },
					output: { string: quote, number: trade.amount * trade.price, pool: `${trade.symbol}.${this.exchangeId}` }
				});
			}
		} catch (e) {
			console.error(`[CCXTProvider] fetchTrades error: ${symbol}`, e.message);
		}
	}

	async disconnect() {
		for (const id of this._intervals) clearInterval(id);
		this._intervals = [];
		await super.disconnect();
	}
}

module.exports = CCXTProvider;
