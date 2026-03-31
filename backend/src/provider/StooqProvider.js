const Provider = require('./Provider');
const log = require('../shared/logger');

const DEFAULT_STOOQ_SYMBOLS = ['aapl.us', 'msft.us', 'nvda.us', 'spy.us'];

class StooqProvider extends Provider {
	constructor({
		id = 'stooq.equities',
		name = 'Stooq Equities',
		symbols = DEFAULT_STOOQ_SYMBOLS,
		intervalMs = 45000
	} = {}) {
		super({
			id,
			name,
			assetClass: 'equity',
			kind: 'external'
		});
		this.symbols = symbols;
		this.intervalMs = intervalMs;
		this._timer = null;
	}

	async _fetchSymbol(symbol) {
		const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`;
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`stooq ${symbol} returned ${response.status}`);
		}
		const csv = await response.text();
		const lines = csv.trim().split('\n');
		if (lines.length < 2) {
			throw new Error(`stooq ${symbol} returned empty payload`);
		}
		const row = lines[1].split(',');
		if (row.length < 8) {
			throw new Error(`stooq ${symbol} malformed row`);
		}
		const [stooqSymbol, date, time, , high, low, close, volume] = row;
		const price = Number(close);
		const highNum = Number(high);
		const lowNum = Number(low);
		const bid = Number.isFinite(lowNum) ? lowNum : price;
		const ask = Number.isFinite(highNum) ? highNum : price;

		if (!Number.isFinite(price) || price <= 0) {
			throw new Error(`stooq ${symbol} invalid close`);
		}

		const safeTime = time && time !== 'N/D' ? time : '00:00:00';
		const isoTime = new Date(`${date}T${safeTime}Z`).getTime();
		this.emitTick({
			symbol: stooqSymbol.toUpperCase(),
			venue: 'STOOQ',
			price,
			bid,
			ask,
			volume: Number.isFinite(Number(volume)) ? Number(volume) : null,
			timestamp: Number.isFinite(isoTime) ? isoTime : Date.now(),
			rawSymbol: symbol
		});
	}

	async _poll() {
		for (const symbol of this.symbols) {
			try {
				// eslint-disable-next-line no-await-in-loop
				await this._fetchSymbol(symbol);
			} catch (error) {
				this.setError(error);
			}
		}
	}

	async connect() {
		if (this._timer) return;
		this.setError(null);
		log.info('Stooq', `connecting for ${this.symbols.length} symbols`);
		try {
			await this._poll();
		} catch (error) {
			this.setError(error);
			return;
		}
		this._timer = setInterval(() => {
			this._poll().catch((error) => this.setError(error));
		}, this.intervalMs);
		this.setConnected(true);
		log.info('Stooq', 'connected');
	}

	async disconnect() {
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
		await super.disconnect();
	}
}

module.exports = StooqProvider;
