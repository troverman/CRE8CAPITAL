const Binance = require('node-binance-api');
const Provider = require('./Provider');

class BinanceProvider extends Provider {
	constructor({ symbols = ['BTCUSDT'] }) {
		super({ id: 'binance.ws' });
		this.symbols = symbols;
		this._binance = new Binance().options({});
	}

	async connect() {
		console.log(`[BinanceProvider] connecting WS: ${this.symbols.join(', ')}`);
		this._binance.websockets.depthCache(this.symbols, (symbol, depth) => {
			this.emit('depth', { symbol, depth });
		});
		this._connected = true;
	}
}

module.exports = BinanceProvider;
