const Provider = require('./Provider');

class BinanceProvider extends Provider {
	constructor({ symbols = ['BTCUSDT', 'ETHUSDT'] } = {}) {
		super({
			id: 'binance.ws',
			name: 'Binance Websocket',
			assetClass: 'crypto',
			kind: 'external'
		});
		this.symbols = symbols.map((symbol) => String(symbol).toUpperCase());
		this._binance = null;
	}

	_normalizeSymbol(symbol) {
		const cleaned = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '');
		if (cleaned.endsWith('USDT') && cleaned.length > 4) {
			return `${cleaned.slice(0, -4)}-USDT`;
		}
		if (cleaned.endsWith('USD') && cleaned.length > 3) {
			return `${cleaned.slice(0, -3)}-USD`;
		}
		return cleaned;
	}

	_extractLevel(depthMap, direction) {
		const prices = Object.keys(depthMap || {})
			.map((price) => Number(price))
			.filter((price) => Number.isFinite(price));
		if (prices.length === 0) {
			return null;
		}
		const price = direction === 'bid' ? Math.max(...prices) : Math.min(...prices);
		const rawSize = depthMap[String(price)] ?? depthMap[price];
		const size = Number(rawSize);
		return {
			price,
			size: Number.isFinite(size) ? size : null
		};
	}

	async connect() {
		if (this._binance) {
			return;
		}

		this.setError(null);
		let BinanceLib;
		try {
			BinanceLib = require('node-binance-api');
		} catch (error) {
			this.setError(new Error(`node-binance-api unavailable: ${error.message}`));
			return;
		}

		try {
			this._binance = new BinanceLib().options({
				reconnect: true,
				verbose: false
			});

			this._binance.websockets.depthCache(this.symbols, (symbol, depth) => {
				const bidLevel = this._extractLevel(depth?.bids, 'bid');
				const askLevel = this._extractLevel(depth?.asks, 'ask');
				if (!bidLevel && !askLevel) {
					return;
				}

				const bid = bidLevel ? bidLevel.price : null;
				const ask = askLevel ? askLevel.price : null;
				const price = Number.isFinite(bid) && Number.isFinite(ask)
					? (bid + ask) / 2
					: (bid || ask);
				if (!Number.isFinite(price)) {
					return;
				}

				this.emitTick({
					symbol: this._normalizeSymbol(symbol),
					venue: 'BINANCE',
					price,
					bid,
					ask,
					volume: (bidLevel?.size || 0) + (askLevel?.size || 0),
					timestamp: Date.now(),
					raw: {
						bidSize: bidLevel?.size || null,
						askSize: askLevel?.size || null
					}
				});
			});

			this.setConnected(true);
		} catch (error) {
			this.setError(error);
			if (this._binance?.websockets?.terminate) {
				this._binance.websockets.terminate();
			}
			this._binance = null;
		}
	}

	async disconnect() {
		try {
			if (this._binance?.websockets?.terminate) {
				this._binance.websockets.terminate();
			}
		} catch (error) {
			this.setError(error);
		} finally {
			this._binance = null;
			await super.disconnect();
		}
	}
}

module.exports = BinanceProvider;
