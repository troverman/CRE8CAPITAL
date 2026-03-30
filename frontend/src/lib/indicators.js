const toFinite = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const clampValue = (value, min, max) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
};

const calcPctDelta = (from, to) => {
  const base = Number(from);
  const next = Number(to);
  if (!Number.isFinite(base) || !Number.isFinite(next) || Math.abs(base) < 1e-12) return null;
  return ((next - base) / Math.abs(base)) * 100;
};

export const normalizeSeries = (values = []) => {
  if (!Array.isArray(values)) return [];
  return values.map(toFinite);
};

export const getLastFinite = (values = [], offset = 0) => {
  if (!Array.isArray(values)) return null;
  const skip = Math.max(0, Number(offset) || 0);
  let skipped = 0;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = toFinite(values[index]);
    if (value === null) continue;
    if (skipped < skip) {
      skipped += 1;
      continue;
    }
    return value;
  }
  return null;
};

export const computeSMA = (values = [], period = 20) => {
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

export const computeEMA = (values = [], period = 21) => {
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

export const computeBollingerBands = (values = [], { period = 20, multiplier = 2 } = {}) => {
  const series = normalizeSeries(values);
  const window = Math.max(1, Math.round(Number(period) || 20));
  const spread = Math.max(0, Number(multiplier) || 2);

  const middle = computeSMA(series, window);
  const upper = new Array(series.length).fill(null);
  const lower = new Array(series.length).fill(null);

  const queue = [];
  let rollingSum = 0;
  let rollingSqSum = 0;
  let rollingCount = 0;

  for (let index = 0; index < series.length; index += 1) {
    const value = series[index];
    queue.push(value);
    if (value !== null) {
      rollingSum += value;
      rollingSqSum += value * value;
      rollingCount += 1;
    }

    if (queue.length > window) {
      const removed = queue.shift();
      if (removed !== null) {
        rollingSum -= removed;
        rollingSqSum -= removed * removed;
        rollingCount -= 1;
      }
    }

    if (queue.length !== window || rollingCount !== window) continue;

    const mean = rollingSum / window;
    const variance = Math.max(rollingSqSum / window - mean * mean, 0);
    const stdDev = Math.sqrt(variance);
    upper[index] = mean + stdDev * spread;
    lower[index] = mean - stdDev * spread;
  }

  return { upper, middle, lower };
};

export const getSeriesDeltaPct = (values = [], lookback = 5) => {
  const latest = getLastFinite(values, 0);
  const prior = getLastFinite(values, Math.max(1, Math.round(Number(lookback) || 5)));
  return calcPctDelta(prior, latest);
};

export const buildClassicAnalysis = (values = [], config = {}) => {
  const normalized = normalizeSeries(values);
  const sampleSize = normalized.filter((value) => value !== null).length;

  const fastPeriod = Math.max(2, Math.round(Number(config.fastPeriod) || 20));
  const slowPeriod = Math.max(fastPeriod + 1, Math.round(Number(config.slowPeriod) || 50));
  const emaPeriod = Math.max(2, Math.round(Number(config.emaPeriod) || 21));
  const bbPeriod = Math.max(2, Math.round(Number(config.bbPeriod) || 20));
  const bbMultiplier = Math.max(0.1, Number(config.bbMultiplier) || 2);

  const smaFast = computeSMA(normalized, fastPeriod);
  const smaSlow = computeSMA(normalized, slowPeriod);
  const ema = computeEMA(normalized, emaPeriod);
  const bollinger = computeBollingerBands(normalized, {
    period: bbPeriod,
    multiplier: bbMultiplier
  });

  const latestPrice = getLastFinite(normalized);
  const latestFast = getLastFinite(smaFast);
  const latestSlow = getLastFinite(smaSlow);
  const latestEma = getLastFinite(ema);
  const latestUpper = getLastFinite(bollinger.upper);
  const latestLower = getLastFinite(bollinger.lower);
  const latestMiddle = getLastFinite(bollinger.middle);

  const previousFast = getLastFinite(smaFast, 1);
  const previousEma = getLastFinite(ema, 1);

  const priceVsFastPct = calcPctDelta(latestFast, latestPrice);
  const fastVsSlowPct = calcPctDelta(latestSlow, latestFast);
  const emaSlopePct = getSeriesDeltaPct(ema, 5);

  const bbWidthPct =
    latestUpper !== null && latestLower !== null && latestMiddle !== null
      ? ((latestUpper - latestLower) / Math.max(Math.abs(latestMiddle), 1e-12)) * 100
      : null;

  const rawBbPosition =
    latestPrice !== null && latestUpper !== null && latestLower !== null && latestUpper > latestLower
      ? ((latestPrice - latestLower) / (latestUpper - latestLower)) * 100
      : null;
  const bbPositionPct = rawBbPosition === null ? null : clampValue(rawBbPosition, 0, 100);

  let trend = 'flat';
  if (latestPrice !== null && latestSlow !== null) {
    trend = latestPrice >= latestSlow ? 'bullish' : 'bearish';
  }

  let bandState = 'inside';
  if (latestPrice !== null && latestUpper !== null && latestLower !== null) {
    if (latestPrice > latestUpper) bandState = 'upper-break';
    else if (latestPrice < latestLower) bandState = 'lower-break';
  }

  let crossover = 'none';
  if (latestFast !== null && latestEma !== null && previousFast !== null && previousEma !== null) {
    const wasBelow = previousEma < previousFast;
    const wasAbove = previousEma > previousFast;
    const nowBelow = latestEma < latestFast;
    const nowAbove = latestEma > latestFast;
    if (wasBelow && nowAbove) crossover = 'bull-cross';
    if (wasAbove && nowBelow) crossover = 'bear-cross';
  }

  return {
    sampleSize,
    ready: sampleSize >= bbPeriod,
    periods: {
      fastPeriod,
      slowPeriod,
      emaPeriod,
      bbPeriod,
      bbMultiplier
    },
    series: {
      smaFast,
      smaSlow,
      ema,
      bbUpper: bollinger.upper,
      bbMiddle: bollinger.middle,
      bbLower: bollinger.lower
    },
    latest: {
      price: latestPrice,
      smaFast: latestFast,
      smaSlow: latestSlow,
      ema: latestEma,
      bbUpper: latestUpper,
      bbMiddle: latestMiddle,
      bbLower: latestLower
    },
    metrics: {
      priceVsFastPct,
      fastVsSlowPct,
      emaSlopePct,
      bbWidthPct,
      bbPositionPct
    },
    states: {
      trend,
      bandState,
      crossover
    }
  };
};
