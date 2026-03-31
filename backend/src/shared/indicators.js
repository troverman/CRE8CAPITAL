/**
 * Technical indicators for backend strategy evaluation.
 * Ported from frontend/src/lib/indicators.js for server-side use.
 */

const toFinite = (value) => {
	const num = Number(value);
	return Number.isFinite(num) ? num : null;
};

const normalizeSeries = (values = []) => {
	if (!Array.isArray(values)) return [];
	return values.map(toFinite);
};

const computeSMA = (values = [], period = 20) => {
	const series = normalizeSeries(values);
	const window = Math.max(1, Math.round(Number(period) || 20));
	const result = new Array(series.length).fill(null);
	if (!series.length) return result;

	let rollingSum = 0;
	let rollingCount = 0;
	const queue = [];

	for (let index = 0; index < series.length; index += 1) {
		const value = series[index];
		queue.push(value);
		if (value !== null) {
			rollingSum += value;
			rollingCount += 1;
		}

		if (queue.length > window) {
			const removed = queue.shift();
			if (removed !== null) {
				rollingSum -= removed;
				rollingCount -= 1;
			}
		}

		if (queue.length === window && rollingCount === window) {
			result[index] = rollingSum / window;
		}
	}

	return result;
};

const computeEMA = (values = [], period = 21) => {
	const series = normalizeSeries(values);
	const window = Math.max(1, Math.round(Number(period) || 21));
	const result = new Array(series.length).fill(null);
	if (!series.length) return result;

	const smoothing = 2 / (window + 1);
	let ema = null;
	let seedCount = 0;
	let seedSum = 0;

	for (let index = 0; index < series.length; index += 1) {
		const value = series[index];
		if (value === null) continue;

		if (ema === null) {
			seedCount += 1;
			seedSum += value;
			if (seedCount < window) continue;
			ema = seedSum / window;
			result[index] = ema;
			continue;
		}

		ema = value * smoothing + ema * (1 - smoothing);
		result[index] = ema;
	}

	return result;
};

/**
 * Compute RSI (Relative Strength Index).
 * @param {number[]} prices - Array of prices (oldest to newest).
 * @param {number} period - RSI lookback period (default 14).
 * @returns {number|null} - Current RSI value or null if insufficient data.
 */
const computeRSI = (prices = [], period = 14) => {
	const series = normalizeSeries(prices);
	const valid = series.filter((v) => v !== null);
	if (valid.length < period + 1) return null;

	let avgGain = 0;
	let avgLoss = 0;

	// Initial average gain/loss over first period
	for (let i = 1; i <= period; i++) {
		const change = valid[i] - valid[i - 1];
		if (change > 0) avgGain += change;
		else avgLoss += Math.abs(change);
	}
	avgGain /= period;
	avgLoss /= period;

	// Smooth through remaining data
	for (let i = period + 1; i < valid.length; i++) {
		const change = valid[i] - valid[i - 1];
		const gain = change > 0 ? change : 0;
		const loss = change < 0 ? Math.abs(change) : 0;
		avgGain = (avgGain * (period - 1) + gain) / period;
		avgLoss = (avgLoss * (period - 1) + loss) / period;
	}

	if (avgLoss === 0) return 100;
	const rs = avgGain / avgLoss;
	return 100 - 100 / (1 + rs);
};

/**
 * Compute MACD (Moving Average Convergence Divergence).
 * @param {number[]} prices - Array of prices (oldest to newest).
 * @param {number} fastPeriod - Fast EMA period (default 12).
 * @param {number} slowPeriod - Slow EMA period (default 26).
 * @param {number} signalPeriod - Signal EMA period (default 9).
 * @returns {{macd: number|null, signal: number|null, histogram: number|null}}
 */
const computeMACD = (prices = [], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) => {
	const fastEma = computeEMA(prices, fastPeriod);
	const slowEma = computeEMA(prices, slowPeriod);

	// Compute MACD line = fast EMA - slow EMA
	const macdLine = [];
	for (let i = 0; i < prices.length; i++) {
		if (fastEma[i] !== null && slowEma[i] !== null) {
			macdLine.push(fastEma[i] - slowEma[i]);
		} else {
			macdLine.push(null);
		}
	}

	// Signal line = EMA of MACD line
	const signalLine = computeEMA(macdLine, signalPeriod);

	// Get latest values
	let latestMacd = null;
	let latestSignal = null;
	let prevMacd = null;
	let prevSignal = null;

	for (let i = macdLine.length - 1; i >= 0; i--) {
		if (macdLine[i] !== null && latestMacd === null) {
			latestMacd = macdLine[i];
			// Find previous non-null
			for (let j = i - 1; j >= 0; j--) {
				if (macdLine[j] !== null) {
					prevMacd = macdLine[j];
					break;
				}
			}
		}
		if (signalLine[i] !== null && latestSignal === null) {
			latestSignal = signalLine[i];
			for (let j = i - 1; j >= 0; j--) {
				if (signalLine[j] !== null) {
					prevSignal = signalLine[j];
					break;
				}
			}
		}
		if (latestMacd !== null && latestSignal !== null) break;
	}

	const histogram = latestMacd !== null && latestSignal !== null ? latestMacd - latestSignal : null;

	return {
		macd: latestMacd,
		signal: latestSignal,
		histogram,
		prevMacd,
		prevSignal
	};
};

module.exports = {
	normalizeSeries,
	computeSMA,
	computeEMA,
	computeRSI,
	computeMACD
};
