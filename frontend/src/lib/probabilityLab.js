const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const hashSeed = (text) => {
  const value = String(text || 'seed');
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createRng = (seedText) => {
  let seed = hashSeed(seedText);
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
};

const randBetween = (rng, min, max) => min + rng() * (max - min);

const normalizeColumn = (values = []) => {
  if (!Array.isArray(values) || values.length === 0) return [];
  const safe = values.map((value) => Math.max(0, toNum(value, 0)));
  const sum = safe.reduce((acc, value) => acc + value, 0);
  if (sum <= 1e-12) {
    return safe.map(() => 1 / safe.length);
  }
  return safe.map((value) => value / sum);
};

const buildGaussianColumn = ({ buckets = [], centerPct = 0, sigmaPct = 0.4 }) => {
  const sigma = Math.max(toNum(sigmaPct, 0.4), 0.05);
  const values = buckets.map((bucket) => {
    const center = toNum(bucket?.center, 0);
    const z = (center - centerPct) / sigma;
    return Math.exp(-(z * z) / 2);
  });
  return normalizeColumn(values);
};

const sanitizeSeries = (series = []) => {
  if (!Array.isArray(series)) return [];
  return series
    .map((point) => ({
      t: toNum(point?.t, Date.now()),
      price: toNum(point?.price, NaN),
      spread: toNum(point?.spread, 0),
      volume: toNum(point?.volume, 0)
    }))
    .filter((point) => Number.isFinite(point.price) && point.price > 0)
    .sort((a, b) => a.t - b.t);
};

const pickBucketIndex = (returnPct, buckets = []) => {
  if (!buckets.length) return -1;
  const min = toNum(buckets[0]?.start, -5);
  const step = Math.max(toNum(buckets[0]?.end, 0) - toNum(buckets[0]?.start, 0), 0.001);
  const maxIndex = buckets.length - 1;
  const raw = Math.floor((returnPct - min) / step);
  return clamp(raw, 0, maxIndex);
};

const rankedMarkets = (markets = [], limit = 140) => {
  return [...(Array.isArray(markets) ? markets : [])]
    .filter((market) => Boolean(market?.key))
    .sort((a, b) => {
      const aScore = toNum(a.totalVolume, 0) + Math.abs(toNum(a.changePct, 0)) * 1000000;
      const bScore = toNum(b.totalVolume, 0) + Math.abs(toNum(b.changePct, 0)) * 1000000;
      return bScore - aScore;
    })
    .slice(0, limit);
};

const createSyntheticSeries = ({ market, now = Date.now(), length = 220 }) => {
  const safeLength = Math.max(36, Math.min(420, Math.round(toNum(length, 220))));
  const basePrice = Math.max(toNum(market?.referencePrice, 100), 0.0001);
  const baseVolatility = clamp(toNum(market?.volatility, 0.0032), 0.0003, 0.03);
  const spreadCenter = Math.max(toNum(market?.spreadBps, 9), 0.2);
  const volumeCenter = Math.max(toNum(market?.totalVolume, 400000), 10);
  const changeDrift = clamp(toNum(market?.changePct, 0) / 1000, -0.0028, 0.0028);
  const stepMs = 1000;
  const startAt = now - safeLength * stepMs;
  const rng = createRng(`${market?.key || 'market'}:${basePrice.toFixed(6)}:${safeLength}`);

  const points = [];
  let price = basePrice;
  for (let index = 0; index < safeLength; index += 1) {
    const wave = Math.sin(index / 9) * baseVolatility * 0.55 + Math.cos(index / 17) * baseVolatility * 0.42;
    const noise = randBetween(rng, -baseVolatility, baseVolatility);
    const drift = changeDrift * 0.18;
    price = Math.max(price * (1 + drift + wave + noise), basePrice * 0.05);

    points.push({
      t: startAt + index * stepMs,
      price,
      spread: Math.max(0.2, spreadCenter + randBetween(rng, -2.2, 2.2)),
      volume: Math.max(volumeCenter * randBetween(rng, 0.00016, 0.0012), 1)
    });
  }
  return points;
};

const getLastFinite = (values = [], offset = 0) => {
  if (!Array.isArray(values) || values.length === 0) return null;
  const skip = Math.max(0, Math.round(toNum(offset, 0)));
  let skipped = 0;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = toNum(values[index], NaN);
    if (!Number.isFinite(value)) continue;
    if (skipped < skip) {
      skipped += 1;
      continue;
    }
    return value;
  }
  return null;
};

const computeEMA = (values = [], period = 12) => {
  const safePeriod = Math.max(2, Math.round(toNum(period, 12)));
  const alpha = 2 / (safePeriod + 1);
  const out = new Array(values.length).fill(null);
  let ema = null;
  let seed = 0;
  let seedCount = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = toNum(values[index], NaN);
    if (!Number.isFinite(value)) continue;
    if (ema === null) {
      seed += value;
      seedCount += 1;
      if (seedCount < safePeriod) continue;
      ema = seed / safePeriod;
      out[index] = ema;
      continue;
    }
    ema = value * alpha + ema * (1 - alpha);
    out[index] = ema;
  }
  return out;
};

const computeSMA = (values = [], period = 20) => {
  const safePeriod = Math.max(2, Math.round(toNum(period, 20)));
  const out = new Array(values.length).fill(null);
  let sum = 0;
  let count = 0;
  const queue = [];

  for (let index = 0; index < values.length; index += 1) {
    const value = toNum(values[index], NaN);
    queue.push(value);
    if (Number.isFinite(value)) {
      sum += value;
      count += 1;
    }

    if (queue.length > safePeriod) {
      const removed = queue.shift();
      if (Number.isFinite(removed)) {
        sum -= removed;
        count -= 1;
      }
    }

    if (queue.length === safePeriod && count === safePeriod) {
      out[index] = sum / safePeriod;
    }
  }
  return out;
};

const computeStdDevWindow = (values = [], period = 20) => {
  const safePeriod = Math.max(2, Math.round(toNum(period, 20)));
  const out = new Array(values.length).fill(null);
  const queue = [];
  let sum = 0;
  let sqSum = 0;
  let count = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = toNum(values[index], NaN);
    queue.push(value);
    if (Number.isFinite(value)) {
      sum += value;
      sqSum += value * value;
      count += 1;
    }

    if (queue.length > safePeriod) {
      const removed = queue.shift();
      if (Number.isFinite(removed)) {
        sum -= removed;
        sqSum -= removed * removed;
        count -= 1;
      }
    }

    if (queue.length === safePeriod && count === safePeriod) {
      const mean = sum / safePeriod;
      const variance = Math.max(sqSum / safePeriod - mean * mean, 0);
      out[index] = Math.sqrt(variance);
    }
  }
  return out;
};

const computeRSI = (values = [], period = 14) => {
  const safePeriod = Math.max(2, Math.round(toNum(period, 14)));
  if (values.length <= safePeriod + 1) return 50;
  let gains = 0;
  let losses = 0;
  let used = 0;
  for (let index = values.length - safePeriod; index < values.length; index += 1) {
    const now = toNum(values[index], NaN);
    const prev = toNum(values[index - 1], NaN);
    if (!Number.isFinite(now) || !Number.isFinite(prev)) continue;
    const change = now - prev;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
    used += 1;
  }
  if (used === 0) return 50;
  const avgGain = gains / used;
  const avgLoss = losses / used;
  if (avgLoss <= 1e-12 && avgGain <= 1e-12) return 50;
  if (avgLoss <= 1e-12) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

const deriveIndicatorSignals = (series = []) => {
  const prices = series.map((point) => toNum(point?.price, NaN)).filter((price) => Number.isFinite(price) && price > 0);
  if (prices.length < 30) {
    return {
      emaBias: 0,
      macdBias: 0,
      rsiBias: 0,
      bbandBias: 0,
      rsi: 50,
      bbPosition: 0.5,
      bbWidthPct: 0.8
    };
  }

  const emaFastSeries = computeEMA(prices, 12);
  const emaSlowSeries = computeEMA(prices, 26);
  const emaFast = getLastFinite(emaFastSeries);
  const emaSlow = getLastFinite(emaSlowSeries);
  const latestPrice = Math.max(toNum(prices[prices.length - 1], 0), 1e-9);
  const emaSpreadPct = ((toNum(emaFast, latestPrice) - toNum(emaSlow, latestPrice)) / latestPrice) * 100;
  const emaBias = clamp(emaSpreadPct * 1.9, -1.8, 1.8);

  const macdLine = emaFastSeries.map((value, index) => {
    const fast = toNum(value, NaN);
    const slow = toNum(emaSlowSeries[index], NaN);
    if (!Number.isFinite(fast) || !Number.isFinite(slow)) return null;
    return fast - slow;
  });
  const macdSignal = computeEMA(macdLine, 9);
  const macdNow = getLastFinite(macdLine);
  const macdPrev = getLastFinite(macdLine, 1);
  const macdSignalNow = getLastFinite(macdSignal);
  const macdGapPct = ((toNum(macdNow, 0) - toNum(macdSignalNow, 0)) / latestPrice) * 100;
  const macdSlopePct = ((toNum(macdNow, 0) - toNum(macdPrev, 0)) / latestPrice) * 100;
  const macdBias = clamp(macdGapPct * 12 + macdSlopePct * 8, -1.8, 1.8);

  const rsi = computeRSI(prices, 14);
  const rsiBias = clamp(((50 - rsi) / 50) * 1.6, -1.8, 1.8);

  const bbMiddleSeries = computeSMA(prices, 20);
  const bbStdSeries = computeStdDevWindow(prices, 20);
  const bbMiddle = getLastFinite(bbMiddleSeries);
  const bbStd = Math.max(toNum(getLastFinite(bbStdSeries), 0), latestPrice * 0.0001);
  const bbUpper = toNum(bbMiddle, latestPrice) + bbStd * 2;
  const bbLower = toNum(bbMiddle, latestPrice) - bbStd * 2;
  const bbRange = Math.max(bbUpper - bbLower, latestPrice * 0.0001);
  const bbPosition = clamp((latestPrice - bbLower) / bbRange, 0, 1);
  const bbandBias = clamp((0.5 - bbPosition) * 2.2, -1.8, 1.8);
  const bbWidthPct = (bbRange / latestPrice) * 100;

  return {
    emaBias,
    macdBias,
    rsiBias,
    bbandBias,
    rsi,
    bbPosition,
    bbWidthPct
  };
};

export const PDF_HORIZONS = [1, 2, 3, 5, 8, 13];
export const DEFAULT_PDF_LAYER_WEIGHTS = {
  bband: 0.9,
  ema: 0.85,
  rsi: 0.72,
  macd: 0.8
};

export const buildPdfBuckets = ({ minPct = -5, maxPct = 5, stepPct = 0.25 } = {}) => {
  const safeStep = clamp(Math.abs(toNum(stepPct, 0.25)), 0.05, 5);
  const min = toNum(minPct, -5);
  const max = toNum(maxPct, 5);
  const safeMin = Math.min(min, max - safeStep);
  const safeMax = Math.max(max, safeMin + safeStep);
  const roughCount = Math.floor((safeMax - safeMin) / safeStep);
  const count = clamp(roughCount, 8, 140);

  const buckets = [];
  for (let index = 0; index < count; index += 1) {
    const start = safeMin + index * safeStep;
    const end = start + safeStep;
    const center = (start + end) / 2;
    buckets.push({
      index,
      start,
      end,
      center
    });
  }
  return buckets;
};

export const chooseSeriesForMarket = ({ market, historyByMarket = {}, now = Date.now(), minPoints = 72, maxPoints = 300 }) => {
  const history = sanitizeSeries(historyByMarket?.[market?.key] || []);
  if (history.length >= Math.max(20, toNum(minPoints, 72))) {
    return {
      source: 'history',
      series: history.slice(-Math.max(24, Math.min(420, Math.round(toNum(maxPoints, 300))))),
      sampleCount: history.length
    };
  }
  return {
    source: 'synthetic',
    series: createSyntheticSeries({
      market,
      now,
      length: Math.max(120, Math.min(340, Math.round(toNum(maxPoints, 240))))
    }),
    sampleCount: history.length
  };
};

export const buildProbabilityColumns = ({ series = [], horizons = PDF_HORIZONS, buckets = [], halfLife = 90 }) => {
  const safeBuckets = Array.isArray(buckets) ? buckets : [];
  const safeSeries = sanitizeSeries(series);
  const safeHorizons = [...(Array.isArray(horizons) ? horizons : [])]
    .map((horizon) => Math.max(1, Math.round(toNum(horizon, 1))))
    .filter((horizon, index, list) => list.indexOf(horizon) === index)
    .sort((a, b) => a - b);

  if (!safeBuckets.length || !safeHorizons.length) {
    return {
      horizons: [],
      buckets: safeBuckets,
      columns: [],
      sampleCounts: []
    };
  }

  const safeHalfLife = Math.max(8, toNum(halfLife, 90));
  const columns = [];
  const sampleCounts = [];

  for (const horizon of safeHorizons) {
    const values = new Array(safeBuckets.length).fill(0);
    let samples = 0;

    for (let index = 0; index + horizon < safeSeries.length; index += 1) {
      const startPrice = toNum(safeSeries[index]?.price, NaN);
      const endPrice = toNum(safeSeries[index + horizon]?.price, NaN);
      if (!Number.isFinite(startPrice) || !Number.isFinite(endPrice) || startPrice <= 0) continue;

      const returnPct = ((endPrice - startPrice) / startPrice) * 100;
      const bucketIndex = pickBucketIndex(returnPct, safeBuckets);
      if (bucketIndex < 0) continue;

      const age = safeSeries.length - 1 - (index + horizon);
      const weight = Math.pow(0.5, age / safeHalfLife);
      values[bucketIndex] += weight;
      samples += 1;
    }

    if (samples < 3) {
      columns.push(
        buildGaussianColumn({
          buckets: safeBuckets,
          centerPct: 0,
          sigmaPct: Math.max(0.3, toNum(safeBuckets[0]?.end, 0.25) - toNum(safeBuckets[0]?.start, 0))
        })
      );
    } else {
      columns.push(normalizeColumn(values));
    }
    sampleCounts.push(samples);
  }

  return {
    horizons: safeHorizons,
    buckets: safeBuckets,
    columns,
    sampleCounts
  };
};

export const buildIndicatorLayerColumns = ({
  series = [],
  horizons = PDF_HORIZONS,
  buckets = [],
  layerWeights = DEFAULT_PDF_LAYER_WEIGHTS
}) => {
  const safeSeries = sanitizeSeries(series);
  const safeBuckets = Array.isArray(buckets) ? buckets : [];
  const safeHorizons = [...(Array.isArray(horizons) ? horizons : [])]
    .map((horizon) => Math.max(1, Math.round(toNum(horizon, 1))))
    .filter((horizon, index, list) => list.indexOf(horizon) === index)
    .sort((a, b) => a - b);

  if (!safeBuckets.length || !safeHorizons.length) {
    return {
      horizons: [],
      buckets: safeBuckets,
      columns: [],
      layerCenters: [],
      signals: {
        emaBias: 0,
        macdBias: 0,
        rsiBias: 0,
        bbandBias: 0,
        rsi: 50,
        bbPosition: 0.5,
        bbWidthPct: 0.8
      }
    };
  }

  const safeWeights = {
    ...DEFAULT_PDF_LAYER_WEIGHTS,
    ...(layerWeights || {})
  };
  const signals = deriveIndicatorSignals(safeSeries);
  const columns = [];
  const layerCenters = [];

  for (const horizon of safeHorizons) {
    const horizonScale = 0.34 + Math.sqrt(horizon) * 0.19;
    const components = {
      bband: toNum(signals.bbandBias, 0) * horizonScale * toNum(safeWeights.bband, 0),
      ema: toNum(signals.emaBias, 0) * horizonScale * toNum(safeWeights.ema, 0),
      rsi: toNum(signals.rsiBias, 0) * horizonScale * toNum(safeWeights.rsi, 0),
      macd: toNum(signals.macdBias, 0) * horizonScale * toNum(safeWeights.macd, 0)
    };

    const absWeight =
      Math.abs(toNum(safeWeights.bband, 0)) + Math.abs(toNum(safeWeights.ema, 0)) + Math.abs(toNum(safeWeights.rsi, 0)) + Math.abs(toNum(safeWeights.macd, 0));
    const centerPct = clamp((components.bband + components.ema + components.rsi + components.macd) / Math.max(absWeight, 1e-9), -3.4, 3.4);
    const sigmaPct = clamp(0.46 + horizon * 0.085 + Math.max(0, toNum(signals.bbWidthPct, 0)) * 0.03, 0.24, 3.2);

    columns.push(
      buildGaussianColumn({
        buckets: safeBuckets,
        centerPct,
        sigmaPct
      })
    );
    layerCenters.push({
      horizon,
      centerPct,
      sigmaPct,
      components
    });
  }

  return {
    horizons: safeHorizons,
    buckets: safeBuckets,
    columns,
    layerCenters,
    signals
  };
};

export const blendColumns = ({ baseColumns = [], overlayColumns = [], overlayStrength = 0.35 }) => {
  const alpha = clamp(toNum(overlayStrength, 0.35), 0, 0.95);
  if (!Array.isArray(baseColumns) || baseColumns.length === 0) return [];

  return baseColumns.map((baseColumn, columnIndex) => {
    const safeBase = normalizeColumn(baseColumn || []);
    const overlayRaw = overlayColumns?.[columnIndex] || [];
    const safeOverlay = normalizeColumn(overlayRaw);
    if (!safeOverlay.length) return safeBase;
    return normalizeColumn(safeBase.map((value, index) => value * (1 - alpha) + toNum(safeOverlay[index], 0) * alpha));
  });
};

export const blendPaintIntoColumns = ({ baseColumns = [], horizons = [], paintByHorizon = {}, paintStrength = 0.45 }) => {
  const alpha = clamp(toNum(paintStrength, 0.45), 0, 0.95);
  if (!Array.isArray(baseColumns) || baseColumns.length === 0) return [];

  return baseColumns.map((baseColumn, columnIndex) => {
    const safeBase = normalizeColumn(baseColumn || []);
    const horizonKey = String(horizons[columnIndex] ?? columnIndex);
    const paintRaw = paintByHorizon?.[horizonKey] || paintByHorizon?.[horizons[columnIndex]] || [];
    const paintColumn = normalizeColumn(paintRaw);
    const paintMass = paintColumn.reduce((sum, value) => sum + value, 0);
    if (!paintColumn.length || paintMass <= 1e-9) return safeBase;
    return normalizeColumn(safeBase.map((value, index) => value * (1 - alpha) + toNum(paintColumn[index], 0) * alpha));
  });
};

export const summarizeProbabilityColumn = ({ column = [], buckets = [] }) => {
  if (!Array.isArray(column) || !Array.isArray(buckets) || column.length === 0 || buckets.length === 0) {
    return {
      upProb: 0,
      downProb: 0,
      flatProb: 1,
      expectedMovePct: 0,
      volatilityPct: 0,
      skew: 0,
      confidencePct: 0
    };
  }

  const safeColumn = normalizeColumn(column);
  const step = Math.max(toNum(buckets[0]?.end, 0.25) - toNum(buckets[0]?.start, 0), 0.01);
  let upProb = 0;
  let downProb = 0;
  let flatProb = 0;
  let expectedMovePct = 0;

  for (let index = 0; index < safeColumn.length; index += 1) {
    const center = toNum(buckets[index]?.center, 0);
    const probability = toNum(safeColumn[index], 0);
    expectedMovePct += center * probability;
    if (center > step * 0.25) upProb += probability;
    else if (center < -step * 0.25) downProb += probability;
    else flatProb += probability;
  }

  let variance = 0;
  for (let index = 0; index < safeColumn.length; index += 1) {
    const center = toNum(buckets[index]?.center, 0);
    const probability = toNum(safeColumn[index], 0);
    variance += (center - expectedMovePct) ** 2 * probability;
  }

  const volatilityPct = Math.sqrt(Math.max(variance, 0));
  const skew = upProb - downProb;
  const confidencePct = clamp(Math.abs(skew) * 88 + Math.abs(expectedMovePct) * 18, 0, 99);

  return {
    upProb,
    downProb,
    flatProb,
    expectedMovePct,
    volatilityPct,
    skew,
    confidencePct
  };
};

export const recommendPdfAction = ({
  summary,
  upThreshold = 0.56,
  downThreshold = 0.56,
  minExpectedMovePct = 0.035,
  minSkew = 0.08
}) => {
  const upProb = toNum(summary?.upProb, 0);
  const downProb = toNum(summary?.downProb, 0);
  const expectedMovePct = toNum(summary?.expectedMovePct, 0);
  const skew = toNum(summary?.skew, 0);
  const confidencePct = toNum(summary?.confidencePct, 0);

  let action = 'hold';
  if (upProb >= upThreshold && expectedMovePct >= minExpectedMovePct && skew >= minSkew) {
    action = 'accumulate';
  } else if (downProb >= downThreshold && expectedMovePct <= -minExpectedMovePct && skew <= -minSkew) {
    action = 'reduce';
  }

  const stance = action === 'accumulate' ? 'bullish' : action === 'reduce' ? 'bearish' : 'neutral';
  const score = skew * 120 + expectedMovePct * 22;
  const reason = `up ${(upProb * 100).toFixed(1)}% | down ${(downProb * 100).toFixed(1)}% | E[r] ${expectedMovePct.toFixed(3)}% | conf ${confidencePct.toFixed(
    1
  )}%`;

  return {
    action,
    stance,
    score,
    reason
  };
};

export const findNearestHorizonIndex = (horizons = [], target = 1) => {
  if (!Array.isArray(horizons) || horizons.length === 0) return -1;
  const safeTarget = Math.max(1, Math.round(toNum(target, horizons[0])));
  let bestIndex = 0;
  let bestDistance = Math.abs(horizons[0] - safeTarget);
  for (let index = 1; index < horizons.length; index += 1) {
    const distance = Math.abs(horizons[index] - safeTarget);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
};

const buildPriceMapByKey = (markets = []) => {
  const map = new Map();
  for (const market of markets || []) {
    if (!market?.key) continue;
    const price = Math.max(toNum(market.referencePrice, NaN), 1e-9);
    if (!Number.isFinite(price)) continue;
    map.set(market.key, {
      key: market.key,
      symbol: market.symbol,
      assetClass: market.assetClass,
      price
    });
  }
  return map;
};

export const createPdfPortfolioState = ({ startCash = 100000 } = {}) => {
  const cash = Math.max(100, toNum(startCash, 100000));
  return {
    cash,
    holdings: {},
    equity: cash,
    investedNotional: 0,
    cycle: 0,
    updatedAt: null
  };
};

export const markPdfPortfolio = ({ portfolio = null, markets = [] }) => {
  const state = portfolio || createPdfPortfolioState({});
  const cash = Math.max(0, toNum(state.cash, 0));
  const holdings = typeof state.holdings === 'object' && state.holdings !== null ? state.holdings : {};
  const priceMap = buildPriceMapByKey(markets);

  let investedNotional = 0;
  const markedHoldings = [];
  for (const key of Object.keys(holdings)) {
    const units = Math.max(0, toNum(holdings[key], 0));
    if (units <= 1e-12) continue;
    const market = priceMap.get(key);
    if (!market) continue;
    const notional = units * market.price;
    investedNotional += notional;
    markedHoldings.push({
      key,
      symbol: market.symbol,
      assetClass: market.assetClass,
      price: market.price,
      units,
      notional
    });
  }

  const equity = cash + investedNotional;
  return {
    ...state,
    cash,
    equity,
    investedNotional,
    holdings: markedHoldings.reduce((acc, row) => {
      acc[row.key] = row.units;
      return acc;
    }, {}),
    markedHoldings: markedHoldings.sort((a, b) => b.notional - a.notional)
  };
};

export const simulatePdfPortfolioCycle = ({
  portfolio = null,
  rankings = [],
  markets = [],
  topN = 4,
  minConfidencePct = 44,
  feeBps = 8,
  timestamp = Date.now()
}) => {
  const priceMap = buildPriceMapByKey(markets);
  const base = markPdfPortfolio({
    portfolio: portfolio || createPdfPortfolioState({}),
    markets
  });
  const nextHoldings = { ...(base.holdings || {}) };
  let cash = Math.max(0, toNum(base.cash, 0));
  const feeRate = Math.max(0, toNum(feeBps, 8)) / 10000;
  const equityStart = Math.max(0, toNum(base.equity, 0));
  const safeTopN = Math.max(1, Math.min(16, Math.round(toNum(topN, 4))));
  const safeMinConfidence = clamp(toNum(minConfidencePct, 44), 0, 100);

  const longCandidates = [...(Array.isArray(rankings) ? rankings : [])]
    .filter((row) => {
      if (!row?.key) return false;
      if (!priceMap.get(row.key)) return false;
      if (toNum(row.confidencePct, 0) < safeMinConfidence) return false;
      if (toNum(row.upProb, 0) <= toNum(row.downProb, 0)) return false;
      if (toNum(row.expectedMovePct, 0) <= 0) return false;
      return row.recommendation?.action === 'accumulate';
    })
    .slice(0, 48)
    .sort((a, b) => b.upScore - a.upScore)
    .slice(0, safeTopN);

  const picked = longCandidates;
  const scoreBase = picked.map((row) => ({
    ...row,
    weightScore: Math.max(0.001, toNum(row.upScore, 0) * (0.6 + toNum(row.confidencePct, 0) / 100))
  }));
  const scoreSum = scoreBase.reduce((sum, row) => sum + row.weightScore, 0);
  const allocations = scoreBase.map((row) => {
    const weight = row.weightScore / Math.max(scoreSum, 1e-9);
    return {
      key: row.key,
      symbol: row.symbol,
      assetClass: row.assetClass,
      weight,
      targetNotional: equityStart * weight,
      upProb: row.upProb,
      downProb: row.downProb,
      expectedMovePct: row.expectedMovePct,
      confidencePct: row.confidencePct
    };
  });
  const allocationByKey = new Map(allocations.map((row) => [row.key, row]));

  const keysToBalance = new Set([...Object.keys(nextHoldings), ...allocations.map((row) => row.key)]);
  const orders = [];

  for (const key of keysToBalance) {
    const market = priceMap.get(key);
    if (!market) continue;
    const price = market.price;
    const currentUnits = Math.max(0, toNum(nextHoldings[key], 0));
    const currentNotional = currentUnits * price;
    const targetNotional = toNum(allocationByKey.get(key)?.targetNotional, 0);
    const deltaNotional = targetNotional - currentNotional;
    const deadband = Math.max(25, equityStart * 0.0025);
    if (Math.abs(deltaNotional) <= deadband) continue;

    if (deltaNotional > 0) {
      const maxSpend = cash / Math.max(1 + feeRate, 1e-9);
      const spend = Math.min(deltaNotional, maxSpend);
      if (spend <= 0) continue;
      const units = spend / price;
      cash -= spend * (1 + feeRate);
      nextHoldings[key] = currentUnits + units;
      orders.push({
        id: `pdf-order:${timestamp}:${key}:buy:${orders.length}`,
        timestamp,
        action: 'buy',
        key,
        symbol: market.symbol,
        assetClass: market.assetClass,
        price,
        units,
        notional: spend,
        fee: spend * feeRate
      });
    } else {
      const desiredUnits = Math.abs(deltaNotional) / price;
      const units = Math.min(currentUnits, desiredUnits);
      if (units <= 1e-12) continue;
      const gross = units * price;
      const fee = gross * feeRate;
      cash += gross - fee;
      const remain = currentUnits - units;
      if (remain <= 1e-9) delete nextHoldings[key];
      else nextHoldings[key] = remain;
      orders.push({
        id: `pdf-order:${timestamp}:${key}:sell:${orders.length}`,
        timestamp,
        action: 'sell',
        key,
        symbol: market.symbol,
        assetClass: market.assetClass,
        price,
        units,
        notional: gross,
        fee
      });
    }
  }

  const nextPortfolio = markPdfPortfolio({
    portfolio: {
      cash: Math.max(0, cash),
      holdings: nextHoldings,
      cycle: Math.max(0, toNum(base.cycle, 0)) + 1,
      updatedAt: timestamp
    },
    markets
  });

  return {
    portfolio: nextPortfolio,
    equityStart,
    equityEnd: nextPortfolio.equity,
    picked,
    allocations,
    orders
  };
};

export const rankMarketsByPdf = ({
  markets = [],
  historyByMarket = {},
  buckets = [],
  horizons = PDF_HORIZONS,
  horizon = 3,
  indicatorBlend = 0.34,
  layerWeights = DEFAULT_PDF_LAYER_WEIGHTS,
  now = Date.now()
}) => {
  const watchedMarkets = rankedMarkets(markets, 120);
  const safeBuckets = Array.isArray(buckets) ? buckets : [];
  if (!watchedMarkets.length || !safeBuckets.length) return [];

  const rows = [];
  for (const market of watchedMarkets) {
    const selected = chooseSeriesForMarket({
      market,
      historyByMarket,
      now,
      minPoints: 70,
      maxPoints: 280
    });
    const probability = buildProbabilityColumns({
      series: selected.series,
      horizons,
      buckets: safeBuckets,
      halfLife: 100
    });
    const indicator = buildIndicatorLayerColumns({
      series: selected.series,
      horizons: probability.horizons,
      buckets: safeBuckets,
      layerWeights
    });
    const composedColumns = blendColumns({
      baseColumns: probability.columns,
      overlayColumns: indicator.columns,
      overlayStrength: indicatorBlend
    });
    const horizonIndex = findNearestHorizonIndex(probability.horizons, horizon);
    if (horizonIndex < 0) continue;
    const summary = summarizeProbabilityColumn({
      column: composedColumns[horizonIndex],
      buckets: probability.buckets
    });
    const recommendation = recommendPdfAction({ summary });
    const upScore = summary.upProb * 100 + summary.expectedMovePct * 12 + summary.skew * 22;

    rows.push({
      key: market.key,
      symbol: market.symbol,
      assetClass: market.assetClass,
      source: selected.source,
      historySamples: selected.sampleCount,
      modelSamples: probability.sampleCounts[horizonIndex] || 0,
      referencePrice: toNum(selected.series[selected.series.length - 1]?.price, market.referencePrice),
      upProb: summary.upProb,
      downProb: summary.downProb,
      expectedMovePct: summary.expectedMovePct,
      volatilityPct: summary.volatilityPct,
      skew: summary.skew,
      confidencePct: summary.confidencePct,
      indicatorCenterPct: toNum(indicator.layerCenters[horizonIndex]?.centerPct, 0),
      recommendation,
      upScore
    });
  }

  return rows.sort((a, b) => b.upScore - a.upScore);
};
