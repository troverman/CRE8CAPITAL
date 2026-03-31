const Provider = require('./Provider');
const log = require('../shared/logger');

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
		this._reconnectDelay = 5000;
		this._maxReconnectDelay = 60000;
		this._reconnectTimer = null;
		this._intentionalDisconnect = false;
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

	_scheduleReconnect() {
		if (this._intentionalDisconnect || this._reconnectTimer) return;
		log.warn('Binance', `reconnecting in ${this._reconnectDelay}ms`);
		this._reconnectTimer = setTimeout(async () => {
			this._reconnectTimer = null;
			if (this._intentionalDisconnect) return;
			try {
				await this.connect();
				// Reset delay on successful reconnect
				this._reconnectDelay = 5000;
			} catch (err) {
				log.error('Binance', `reconnect failed: ${err.message}`);
				// Exponential backoff
				this._reconnectDelay = Math.min(this._reconnectDelay * 2, this._maxReconnectDelay);
				this._scheduleReconnect();
			}
		}, this._reconnectDelay);
	}

	async connect() {
		if (this._binance) {
			return;
		}

		this._intentionalDisconnect = false;
		this.setError(null);
		let BinanceLib;
		try {
			BinanceLib = require('node-binance-api');
		} catch (error) {
			this.setError(new Error(`node-binance-api unavailable: ${error.message}`));
			return;
		}

		try {
			log.info('Binance', `connecting to ${this.symbols.length} symbols`);
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
			log.info('Binance', 'connected successfully');
		} catch (error) {
			this.setError(error);
			log.error('Binance', `connection failed: ${error.message}`);
			if (this._binance?.websockets?.terminate) {
				this._binance.websockets.terminate();
			}
			this._binance = null;
			this._scheduleReconnect();
		}
	}

	async disconnect() {
		this._intentionalDisconnect = true;
		if (this._reconnectTimer) {
			clearTimeout(this._reconnectTimer);
			this._reconnectTimer = null;
		}
		try {
			if (this._binance?.websockets?.terminate) {
				this._binance.websockets.terminate();
			}
		} catch (error) {
			this.setError(error);
		} finally {
			this._binance = null;
			this._reconnectDelay = 5000;
			await super.disconnect();
		}
	}
}

module.exports = BinanceProvider;
