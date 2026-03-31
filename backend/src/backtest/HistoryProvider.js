/**
 * HistoryProvider -- fetches historical OHLCV data for backtesting.
 *
 * Sources (tried in order):
 * 1. Binance klines API (crypto)
 * 2. Stooq CSV (equities)
 * 3. Synthetic random-walk fallback
 *
 * Results are cached in memory for repeated backtest runs.
 */

const log = require('../shared/logger');

const BINANCE_KLINES_URL = 'https://api.binance.com/api/v3/klines';
const MS_PER_DAY = 86400000;

class HistoryProvider {
	constructor() {
		this._cache = new Map(); // "symbol:days" -> {data, fetchedAt}
		this._cacheTtlMs = 10 * 60 * 1000; // 10 minute cache
	}

	/**
	 * Get historical candles for one or more symbols.
	 * @param {string[]} symbols - e.g. ['BTC-USDT', 'AAPL.US']
	 * @param {number} days - lookback period in days
	 * @returns {Array} - unified OHLCV candle array
	 */
	async getHistory(symbols, days = 30) {
		const allCandles = [];
		for (const symbol of symbols) {
			const cacheKey = `${symbol}:${days}`;
			const cached = this._cache.get(cacheKey);
			if (cached && Date.now() - cached.fetchedAt < this._cacheTtlMs) {
				allCandles.push(...cached.data);
				continue;
			}

			let candles = [];

			// Try Binance for crypto-looking symbols
			if (this._isCryptoSymbol(symbol)) {
				try {
					candles = await this._fetchBinance(symbol, days);
				} catch (err) {
					log.warn('HistoryProvider', `Binance fetch failed for ${symbol}: ${err.message}`);
				}
			}

			// Try Stooq for equity-looking symbols
			if (candles.length === 0 && this._isEquitySymbol(symbol)) {
				try {
					candles = await this._fetchStooq(symbol, days);
				} catch (err) {
					log.warn('HistoryProvider', `Stooq fetch failed for ${symbol}: ${err.message}`);
				}
			}

			// Fallback to synthetic data
			if (candles.length === 0) {
				log.info('HistoryProvider', `Using synthetic history for ${symbol} (${days} days)`);
				candles = this._generateSynthetic(symbol, days);
			}

			this._cache.set(cacheKey, { data: candles, fetchedAt: Date.now() });
			allCandles.push(...candles);
		}

		return allCandles;
	}

	_isCryptoSymbol(symbol) {
		const s = symbol.toUpperCase();
		return s.includes('USDT') || s.includes('BTC') || s.includes('ETH') || s.includes('SOL')
			|| s.includes('-USD') || s.includes('/USD');
	}

	_isEquitySymbol(symbol) {
		const s = symbol.toUpperCase();
		return s.includes('.US') || s.includes('.UK') || s.includes('SPY') || s.includes('AAPL')
			|| s.includes('MSFT') || s.includes('NVDA');
	}

	/**
	 * Fetch candles from Binance klines endpoint.
	 */
	async _fetchBinance(symbol, days) {
		// Normalize symbol: "BTC-USDT" -> "BTCUSDT"
		const binanceSymbol = symbol.replace(/[-/]/g, '').toUpperCase();
		const interval = days <= 7 ? '1h' : '1d';
		const limit = Math.min(1000, days <= 7 ? days * 24 : days);
		const endTime = Date.now();
		const startTime = endTime - days * MS_PER_DAY;

		const url = `${BINANCE_KLINES_URL}?symbol=${binanceSymbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`;
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
		const data = await res.json();

		if (!Array.isArray(data) || data.length === 0) {
			throw new Error(`No klines returned for ${binanceSymbol}`);
		}

		return data.map(k => ({
			symbol: symbol.toUpperCase(),
			timestamp: Number(k[0]),
			open: Number(k[1]),
			high: Number(k[2]),
			low: Number(k[3]),
			close: Number(k[4]),
			volume: Number(k[5])
		}));
	}

	/**
	 * Fetch daily CSV from Stooq.
	 */
	async _fetchStooq(symbol, days) {
		// Stooq expects lowercase with dots: "aapl.us"
		const stooqSymbol = symbol.toLowerCase().replace(/-/g, '.');
		const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&i=d`;
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);
		const csv = await res.text();
		const lines = csv.trim().split('\n');
		if (lines.length < 2) throw new Error('Empty Stooq response');

		const header = lines[0].toLowerCase();
		const hasDate = header.includes('date');
		if (!hasDate) throw new Error('Unexpected Stooq CSV format');

		const candles = [];
		const cutoff = Date.now() - days * MS_PER_DAY;

		for (let i = 1; i < lines.length; i++) {
			const cols = lines[i].split(',');
			if (cols.length < 6) continue;

			const dateStr = cols[0]; // YYYY-MM-DD
			const timestamp = new Date(dateStr + 'T00:00:00Z').getTime();
			if (!Number.isFinite(timestamp) || timestamp < cutoff) continue;

			const open = Number(cols[1]);
			const high = Number(cols[2]);
			const low = Number(cols[3]);
			const close = Number(cols[4]);
			const volume = Number(cols[5]);

			if (!Number.isFinite(close) || close <= 0) continue;

			candles.push({
				symbol: symbol.toUpperCase(),
				timestamp,
				open: Number.isFinite(open) ? open : close,
				high: Number.isFinite(high) ? high : close,
				low: Number.isFinite(low) ? low : close,
				close,
				volume: Number.isFinite(volume) ? volume : 0
			});
		}

		return candles.sort((a, b) => a.timestamp - b.timestamp);
	}

	/**
	 * Generate synthetic OHLCV data using a random walk.
	 */
	_generateSynthetic(symbol, days) {
		const candles = [];
		const s = symbol.toUpperCase();

		// Infer a reasonable starting price
		let price;
		if (s.includes('BTC')) price = 68000;
		else if (s.includes('ETH')) price = 3500;
		else if (s.includes('SOL')) price = 168;
		else if (s.includes('NVDA')) price = 975;
		else if (s.includes('MSFT')) price = 430;
		else if (s.includes('AAPL')) price = 210;
		else if (s.includes('SPY')) price = 530;
		else price = 100;

		const volatility = s.includes('BTC') || s.includes('ETH') || s.includes('SOL') ? 0.025 : 0.012;
		const now = Date.now();
		const startTs = now - days * MS_PER_DAY;
		const interval = days <= 7 ? 3600000 : MS_PER_DAY; // hourly for short, daily for long
		const steps = Math.floor((now - startTs) / interval);

		for (let i = 0; i < steps; i++) {
			const drift = (Math.random() - 0.48) * volatility * 2; // slight upward bias
			const open = price;
			price = Math.max(0.01, price * (1 + drift));
			const high = Math.max(open, price) * (1 + Math.random() * volatility * 0.5);
			const low = Math.min(open, price) * (1 - Math.random() * volatility * 0.5);
			const volume = 1000 + Math.random() * 50000;

			candles.push({
				symbol: s,
				timestamp: startTs + i * interval,
				open,
				high,
				low,
				close: price,
				volume
			});
		}

		return candles;
	}

	clearCache() {
		this._cache.clear();
	}
}

module.exports = HistoryProvider;
