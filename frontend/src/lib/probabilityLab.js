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

const QUOTE_HINTS = [
  'USDT',
  'USDC',
  'BUSD',
  'DAI',
  'USDP',
  'TUSD',
  'FDUSD',
  'USD',
  'BTC',
  'ETH',
  'EUR',
  'JPY',
  'GBP',
  'AUD',
  'CAD',
  'CHF',
  'TRY',
  'BRL',
  'MXN',
  'SGD',
  'HKD',
  'KRW',
  'CNH'
];

const STABLE_QUOTE_SET = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'USDP', 'TUSD', 'FDUSD', 'USD']);

const splitSymbolToAssets = (symbol) => {
  const raw = String(symbol || '')
    .trim()
    .toUpperCase();
  if (!raw) return { base: 'UNK', quote: 'USD' };

  const separators = ['/', '-', '_', ':'];
  for (const separator of separators) {
    if (!raw.includes(separator)) continue;
    const parts = raw.split(separator).filter(Boolean);
    if (parts.length >= 2) {
      return {
        base: parts[0],
        quote: parts[1]
      };
    }
  }

  for (const quote of QUOTE_HINTS) {
    if (raw.endsWith(quote) && raw.length > quote.length + 1) {
      return {
        base: raw.slice(0, raw.length - quote.length),
        quote
      };
    }
  }

  return {
    base: raw,
    quote: 'USD'
  };
};

const computeSeriesReturnPct = (series = [], lookback = 16) => {
  if (!Array.isArray(series) || series.length < 2) return 0;
  const safeLookback = clamp(Math.round(toNum(lookback, 16)), 1, series.length - 1);
  const last = toNum(series[series.length - 1]?.price, NaN);
  const anchor = toNum(series[series.length - 1 - safeLookback]?.price, NaN);
  if (!Number.isFinite(last) || !Number.isFinite(anchor) || anchor <= 0) return 0;
  return ((last - anchor) / anchor) * 100;
};

const computeSeriesVolatilityPct = (series = [], lookback = 28) => {
  if (!Array.isArray(series) || series.length < 3) return 0;
  const safeLookback = clamp(Math.round(toNum(lookback, 28)), 2, series.length - 1);
  const start = series.length - 1 - safeLookback;
  const returns = [];
  for (let index = Math.max(start + 1, 1); index < series.length; index += 1) {
    const current = toNum(series[index]?.price, NaN);
    const previous = toNum(series[index - 1]?.price, NaN);
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) continue;
    returns.push(((current - previous) / previous) * 100);
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  return Math.sqrt(Math.max(variance, 0));
};

export const buildMarketTensorSnapshot = ({ markets = [], historyByMarket = {}, now = Date.now(), limit = 160 } = {}) => {
  const watchedMarkets = rankedMarkets(markets, Math.max(12, Math.min(220, Math.round(toNum(limit, 160)))));
  if (!watchedMarkets.length) {
    return {
      timestamp: now,
      markets: [],
      nodes: [],
      edges: [],
      metrics: {
        marketCount: 0,
        nodeCount: 0,
        edgeCount: 0,
        totalVolume: 0,
        averageSpreadBps: 0,
        tensorDriftPct: 0,
        breadth: 0,
        stress: 0,
        positiveCount: 0,
        negativeCount: 0,
        centralAsset: '-',
        centrality: 0
      }
    };
  }

  const nodeMap = new Map();
  const edgeRows = [];
  const marketRows = [];

  const ensureNode = (asset) => {
    const safeAsset = String(asset || 'UNK').toUpperCase();
    if (!nodeMap.has(safeAsset)) {
      nodeMap.set(safeAsset, {
        asset: safeAsset,
        degree: 0,
        edgeWeight: 0,
        volume: 0,
        tensor: 0
      });
    }
    return nodeMap.get(safeAsset);
  };

  let totalVolume = 0;
  let spreadWeighted = 0;
  let driftWeighted = 0;
  let weightSum = 0;
  let positiveCount = 0;
  let negativeCount = 0;

  for (const market of watchedMarkets) {
    const selected = chooseSeriesForMarket({
      market,
      historyByMarket,
      now,
      minPoints: 36,
      maxPoints: 220
    });
    const series = selected.series || [];

    const changePct = toNum(market?.changePct, 0);
    const trendFastPct = computeSeriesReturnPct(series, 6);
    const trendSlowPct = computeSeriesReturnPct(series, 24);
    const momentumPct = changePct * 0.48 + trendFastPct * 0.22 + trendSlowPct * 0.3;
    const seriesVolatilityPct = computeSeriesVolatilityPct(series, 28);
    const spreadBps = clamp(toNum(market?.spreadBps, 8), 0.1, 260);
    const totalVolumeMarket = Math.max(toNum(market?.totalVolume, 1), 1);
    const liquidityLog = Math.log1p(totalVolumeMarket);
    const confidence = clamp((liquidityLog / 22) * 0.62 + (1 / (1 + spreadBps / 18)) * 0.38, 0, 1);
    const frictionPenalty = 1 + spreadBps / 28;
    const baseTensor = (momentumPct / frictionPenalty) * (0.1 + liquidityLog / 26);
    const volatilityPenalty = 1 / (1 + seriesVolatilityPct / 4.2);
    const tensorScore = clamp(baseTensor * (0.68 + volatilityPenalty * 0.32), -4.2, 4.2);
    const weight = Math.max(0.001, liquidityLog * (0.35 + confidence * 0.65));

    const { base, quote } = splitSymbolToAssets(market?.symbol);
    const baseNode = ensureNode(base);
    const quoteNode = ensureNode(quote);

    const edgeWeight = Math.sqrt(totalVolumeMarket) * (0.2 + confidence * 0.8);
    baseNode.degree += 1;
    quoteNode.degree += 1;
    baseNode.edgeWeight += edgeWeight;
    quoteNode.edgeWeight += edgeWeight;
    baseNode.volume += totalVolumeMarket;
    quoteNode.volume += totalVolumeMarket * 0.75;
    baseNode.tensor += tensorScore * confidence;
    quoteNode.tensor -= tensorScore * confidence * 0.82;

    edgeRows.push({
      id: `edge:${market.key}:${base}:${quote}`,
      key: market.key,
      symbol: market.symbol,
      assetClass: market.assetClass,
      from: base,
      to: quote,
      weight: edgeWeight,
      confidence,
      tensorScore,
      momentumPct
    });

    marketRows.push({
      key: market.key,
      symbol: market.symbol,
      assetClass: market.assetClass,
      baseAsset: base,
      quoteAsset: quote,
      source: selected.source,
      historySamples: selected.sampleCount,
      referencePrice: toNum(market.referencePrice, toNum(series[series.length - 1]?.price, 0)),
      spreadBps,
      totalVolume: totalVolumeMarket,
      changePct,
      momentumPct,
      volatilityPct: seriesVolatilityPct,
      confidence,
      tensorScore,
      connectionScore: 0,
      weight
    });

    totalVolume += totalVolumeMarket;
    spreadWeighted += spreadBps * weight;
    driftWeighted += momentumPct * weight;
    weightSum += weight;
    if (tensorScore > 0.00001) positiveCount += 1;
    else if (tensorScore < -0.00001) negativeCount += 1;
  }

  const btcNode = ensureNode('BTC');
  if (btcNode && btcNode.degree > 0) {
    for (const row of marketRows) {
      if (String(row.assetClass || '').toLowerCase() !== 'crypto') continue;
      if (row.baseAsset === 'BTC') continue;
      if (!STABLE_QUOTE_SET.has(row.quoteAsset)) continue;
      const syntheticWeight = row.weight * 0.26;
      const syntheticEdgeWeight = Math.sqrt(Math.max(row.totalVolume, 1)) * 0.16;

      const baseNode = ensureNode(row.baseAsset);
      baseNode.degree += 0.34;
      baseNode.edgeWeight += syntheticEdgeWeight;
      baseNode.tensor += row.tensorScore * 0.08;

      btcNode.degree += 0.34;
      btcNode.edgeWeight += syntheticEdgeWeight;
      btcNode.tensor += row.tensorScore * 0.13;

      row.connectionScore += syntheticWeight / 10;

      edgeRows.push({
        id: `edge:anchor-btc:${row.key}:${row.baseAsset}`,
        key: row.key,
        symbol: row.symbol,
        assetClass: row.assetClass,
        from: row.baseAsset,
        to: 'BTC',
        weight: syntheticEdgeWeight,
        confidence: clamp(row.confidence * 0.82, 0, 1),
        tensorScore: row.tensorScore * 0.5,
        momentumPct: row.momentumPct,
        synthetic: true
      });
    }
  }

  const nodes = [...nodeMap.values()]
    .map((node) => {
      const centrality = node.degree * 0.6 + Math.log1p(node.edgeWeight) * 1.7 + Math.sqrt(Math.max(node.volume, 0)) / 8200;
      const pressure = node.tensor / Math.max(node.degree, 1e-9);
      return {
        ...node,
        centrality,
        pressure
      };
    })
    .sort((a, b) => b.centrality - a.centrality);

  const nodeByAsset = new Map(nodes.map((node) => [node.asset, node]));
  for (const row of marketRows) {
    const baseNode = nodeByAsset.get(row.baseAsset);
    const quoteNode = nodeByAsset.get(row.quoteAsset);
    const baseCentrality = toNum(baseNode?.centrality, 0);
    const quoteCentrality = toNum(quoteNode?.centrality, 0);
    row.connectionScore += (baseCentrality + quoteCentrality) / 16;
  }

  const sortedMarkets = marketRows
    .map((row) => ({
      ...row,
      compositeScore: row.tensorScore * 1.1 + row.connectionScore * 0.9 + row.momentumPct * 0.08
    }))
    .sort((a, b) => b.compositeScore - a.compositeScore);

  const tensorDriftPct = driftWeighted / Math.max(weightSum, 1e-9);
  const averageSpreadBps = spreadWeighted / Math.max(weightSum, 1e-9);
  const breadth = (positiveCount - negativeCount) / Math.max(positiveCount + negativeCount, 1);
  const stress = clamp(averageSpreadBps / 24 + Math.abs(breadth) * 0.28 + Math.abs(tensorDriftPct) * 0.08, 0, 3.6);
  const centralNode = nodes[0] || null;

  return {
    timestamp: now,
    markets: sortedMarkets,
    nodes,
    edges: edgeRows.sort((a, b) => b.weight - a.weight),
    metrics: {
      marketCount: sortedMarkets.length,
      nodeCount: nodes.length,
      edgeCount: edgeRows.length,
      totalVolume,
      averageSpreadBps,
      tensorDriftPct,
      breadth,
      stress,
      positiveCount,
      negativeCount,
      centralAsset: centralNode?.asset || '-',
      centrality: toNum(centralNode?.centrality, 0)
    }
  };
};

const buildMarketBookProfile = ({ market = null, tensorRow = null, bandOffsets = [] }) => {
  const spreadBps = clamp(toNum(market?.spreadBps, toNum(tensorRow?.spreadBps, 8)), 0.2, 280);
  const totalVolume = Math.max(toNum(market?.totalVolume, toNum(tensorRow?.totalVolume, 1)), 1);
  const providerRows = Array.isArray(market?.providers) ? market.providers : [];

  let bidLiquidity = 0;
  let askLiquidity = 0;
  let l1SpreadBps = spreadBps;
  let l1Count = 0;
  const referencePrice = Math.max(toNum(market?.referencePrice, toNum(tensorRow?.referencePrice, 1)), 1e-9);

  for (const provider of providerRows) {
    const bid = toNum(provider?.bid, NaN);
    const ask = toNum(provider?.ask, NaN);
    const volume = Math.max(toNum(provider?.volume, 0), 0);
    if (Number.isFinite(bid) && bid > 0) bidLiquidity += volume > 0 ? volume : referencePrice * 10;
    if (Number.isFinite(ask) && ask > 0) askLiquidity += volume > 0 ? volume : referencePrice * 10;
    if (Number.isFinite(bid) && Number.isFinite(ask) && ask > bid && referencePrice > 0) {
      l1SpreadBps += ((ask - bid) / referencePrice) * 10000;
      l1Count += 1;
    }
  }

  if (l1Count > 0) {
    l1SpreadBps /= l1Count + 1;
  }

  let imbalance;
  if (bidLiquidity + askLiquidity > 0.000001) {
    imbalance = (bidLiquidity - askLiquidity) / (bidLiquidity + askLiquidity);
  } else {
    const momentum = toNum(tensorRow?.momentumPct, toNum(market?.changePct, 0));
    imbalance = clamp(momentum / 5.5, -0.86, 0.86);
  }

  const sigma = clamp(1.15 + l1SpreadBps / 12, 0.95, 4.8);
  const depthScale = clamp(Math.log1p(totalVolume) / 20, 0.2, 1.9);
  const cells = [];
  let bidPressure = 0;
  let askPressure = 0;

  for (const offset of bandOffsets) {
    const side = offset <= 0 ? 1 : -1;
    const distance = Math.abs(offset);
    const core = Math.exp(-(distance * distance) / (2 * sigma * sigma));
    const slope = Math.max(0.18, 1 - distance / Math.max(Math.abs(bandOffsets[0] || 1), 1));
    const skew = 1 + side * imbalance * 0.52;
    const signedPressure = core * depthScale * slope * skew * side;
    cells.push(signedPressure);
    if (offset <= 0) bidPressure += Math.max(0, signedPressure);
    if (offset > 0) askPressure += Math.max(0, -signedPressure);
  }

  const microShiftBps = clamp(imbalance * Math.max(1.2, spreadBps * 0.7), -38, 38);

  return {
    cells,
    bidPressure,
    askPressure,
    imbalance,
    microShiftBps,
    spreadBps: l1SpreadBps,
    hasProviderBook: providerRows.length > 0
  };
};

export const buildMarketImageSnapshot = ({ markets = [], tensorSnapshot = null, depthBands = 13 } = {}) => {
  const watched = rankedMarkets(markets, 96);
  const safeBands = clamp(Math.round(toNum(depthBands, 13)), 5, 29);
  const half = Math.floor(safeBands / 2);
  const bandOffsets = [];
  for (let offset = -half; offset <= half; offset += 1) {
    bandOffsets.push(offset);
  }
  if (!bandOffsets.includes(0)) bandOffsets.splice(Math.floor(bandOffsets.length / 2), 0, 0);

  const tensorByKey = new Map((tensorSnapshot?.markets || []).map((row) => [row.key, row]));
  const rows = [];
  const aggregate = new Array(bandOffsets.length).fill(0);
  let aggregateWeight = 0;
  let aggregateBid = 0;
  let aggregateAsk = 0;
  let providerBackedCount = 0;

  for (const market of watched) {
    const tensorRow = tensorByKey.get(market.key) || null;
    const profile = buildMarketBookProfile({
      market,
      tensorRow,
      bandOffsets
    });
    const weight = Math.max(0.001, Math.log1p(Math.max(toNum(market?.totalVolume, 1), 1)));
    aggregateWeight += weight;
    aggregateBid += profile.bidPressure * weight;
    aggregateAsk += profile.askPressure * weight;
    if (profile.hasProviderBook) providerBackedCount += 1;
    for (let index = 0; index < profile.cells.length; index += 1) {
      aggregate[index] += profile.cells[index] * weight;
    }

    rows.push({
      key: market.key,
      symbol: market.symbol,
      assetClass: market.assetClass,
      referencePrice: toNum(market.referencePrice, 0),
      totalVolume: Math.max(toNum(market.totalVolume, 1), 1),
      spreadBps: profile.spreadBps,
      bidPressure: profile.bidPressure,
      askPressure: profile.askPressure,
      imbalance: profile.imbalance,
      microShiftBps: profile.microShiftBps,
      cells: profile.cells
    });
  }

  const aggregateCells = aggregate.map((value) => value / Math.max(aggregateWeight, 1e-9));
  const aggregateImbalance = aggregateBid + aggregateAsk > 1e-9 ? (aggregateBid - aggregateAsk) / (aggregateBid + aggregateAsk) : 0;
  const maxAbsCell = rows.reduce((maxValue, row) => {
    const rowMax = row.cells.reduce((innerMax, value) => Math.max(innerMax, Math.abs(toNum(value, 0))), 0);
    return Math.max(maxValue, rowMax);
  }, aggregateCells.reduce((maxValue, value) => Math.max(maxValue, Math.abs(toNum(value, 0))), 0));

  return {
    timestamp: tensorSnapshot?.timestamp || Date.now(),
    bands: bandOffsets.map((offset) => offset * 5),
    rows: rows.sort((a, b) => Math.abs(b.imbalance) * b.totalVolume - Math.abs(a.imbalance) * a.totalVolume),
    aggregate: {
      cells: aggregateCells,
      bidPressure: aggregateBid / Math.max(aggregateWeight, 1e-9),
      askPressure: aggregateAsk / Math.max(aggregateWeight, 1e-9),
      imbalance: aggregateImbalance
    },
    metrics: {
      rowCount: rows.length,
      bandCount: bandOffsets.length,
      providerCoveragePct: rows.length > 0 ? (providerBackedCount / rows.length) * 100 : 0,
      maxAbsCell,
      bookEnergy: aggregateCells.reduce((sum, value) => sum + Math.abs(toNum(value, 0)), 0)
    }
  };
};

export const buildTensorPdfFromHistory = ({
  tensorHistory = [],
  buckets = [],
  horizons = PDF_HORIZONS,
  horizon = 3,
  marketImage = null,
  tensorSnapshot = null
} = {}) => {
  const safeBuckets = Array.isArray(buckets) ? buckets : [];
  if (!safeBuckets.length) {
    return {
      horizons: [],
      buckets: [],
      horizon: Math.max(1, Math.round(toNum(horizon, 3))),
      column: [],
      summary: summarizeProbabilityColumn({ column: [], buckets: [] }),
      recommendation: recommendPdfAction({ summary: { upProb: 0, downProb: 0, expectedMovePct: 0, skew: 0, confidencePct: 0 } }),
      sampleCount: 0,
      aggregateImbalance: 0,
      driftNow: 0,
      stressNow: 0,
      centerPct: 0,
      sigmaPct: 1
    };
  }

  const safeHistory = [...(Array.isArray(tensorHistory) ? tensorHistory : [])]
    .map((row) => ({
      timestamp: toNum(row?.timestamp, Date.now()),
      tensorDriftPct: toNum(row?.tensorDriftPct, 0),
      breadth: toNum(row?.breadth, 0),
      stress: Math.max(0, toNum(row?.stress, 0)),
      imageImbalance: clamp(toNum(row?.imageImbalance, 0), -1, 1)
    }))
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-820);

  const aggregateImbalance = clamp(toNum(marketImage?.aggregate?.imbalance, 0), -1, 1);
  const driftNow = toNum(tensorSnapshot?.metrics?.tensorDriftPct, safeHistory[safeHistory.length - 1]?.tensorDriftPct);
  const stressNow = Math.max(0, toNum(tensorSnapshot?.metrics?.stress, safeHistory[safeHistory.length - 1]?.stress));
  const centerPct = clamp(driftNow * 0.42 + aggregateImbalance * 0.72, -3.4, 3.4);
  const sigmaPct = clamp(0.58 + stressNow * 0.32, 0.24, 3.6);

  if (safeHistory.length < 10) {
    const gaussian = buildGaussianColumn({
      buckets: safeBuckets,
      centerPct,
      sigmaPct
    });
    const summary = summarizeProbabilityColumn({
      column: gaussian,
      buckets: safeBuckets
    });
    return {
      horizons: [...horizons],
      buckets: safeBuckets,
      horizon: Math.max(1, Math.round(toNum(horizon, 3))),
      column: gaussian,
      summary,
      recommendation: recommendPdfAction({
        summary,
        upThreshold: 0.54,
        downThreshold: 0.54,
        minExpectedMovePct: 0.028,
        minSkew: 0.05
      }),
      sampleCount: safeHistory.length,
      aggregateImbalance,
      driftNow,
      stressNow,
      centerPct,
      sigmaPct
    };
  }

  let level = 100;
  const series = safeHistory.map((row) => {
    const movePct = clamp(row.tensorDriftPct * 0.34 + row.breadth * 0.58 + row.imageImbalance * 0.42, -2.8, 2.8);
    level = Math.max(20, level * (1 + movePct / 100));
    return {
      t: row.timestamp,
      price: level,
      spread: row.stress * 12,
      volume: 1
    };
  });

  const probability = buildProbabilityColumns({
    series,
    horizons,
    buckets: safeBuckets,
    halfLife: Math.max(20, Math.round(series.length * 0.45))
  });
  const horizonIndex = findNearestHorizonIndex(probability.horizons, horizon);
  const baseColumn = horizonIndex >= 0 ? normalizeColumn(probability.columns[horizonIndex]) : [];
  const overlay = buildGaussianColumn({
    buckets: probability.buckets.length ? probability.buckets : safeBuckets,
    centerPct,
    sigmaPct
  });
  const composite = normalizeColumn(
    (baseColumn.length ? baseColumn : overlay).map((value, index) => value * 0.66 + toNum(overlay[index], 0) * 0.34)
  );
  const activeBuckets = probability.buckets.length ? probability.buckets : safeBuckets;
  const summary = summarizeProbabilityColumn({
    column: composite,
    buckets: activeBuckets
  });

  return {
    horizons: probability.horizons,
    buckets: activeBuckets,
    horizon: horizonIndex >= 0 ? probability.horizons[horizonIndex] : Math.max(1, Math.round(toNum(horizon, 3))),
    column: composite,
    summary,
    recommendation: recommendPdfAction({
      summary,
      upThreshold: 0.54,
      downThreshold: 0.54,
      minExpectedMovePct: 0.028,
      minSkew: 0.05
    }),
    sampleCount: series.length,
    aggregateImbalance,
    driftNow,
    stressNow,
    centerPct,
    sigmaPct
  };
};

export const rankMarketsByTensorPdf = ({ baseRankings = [], tensorSnapshot = null, marketImage = null, tensorPdf = null } = {}) => {
  const baseRows = Array.isArray(baseRankings) ? baseRankings : [];
  if (!baseRows.length) return [];

  const tensorByKey = new Map((tensorSnapshot?.markets || []).map((row) => [row.key, row]));
  const imageByKey = new Map((marketImage?.rows || []).map((row) => [row.key, row]));
  const globalSkew = toNum(tensorPdf?.summary?.skew, 0);
  const globalMove = toNum(tensorPdf?.summary?.expectedMovePct, 0);
  const globalConfidence = clamp(toNum(tensorPdf?.summary?.confidencePct, 0) / 100, 0, 1);
  const aggregateImbalance = clamp(toNum(marketImage?.aggregate?.imbalance, 0), -1, 1);
  const regime = clamp(globalSkew * 0.86 + globalMove * 0.24 + aggregateImbalance * 0.52, -2.8, 2.8);

  return baseRows
    .map((row, index) => {
      const tensorRow = tensorByKey.get(row.key);
      const imageRow = imageByKey.get(row.key);

      const tensorScore = toNum(tensorRow?.tensorScore, 0);
      const connectionScore = toNum(tensorRow?.connectionScore, 0);
      const imageImbalance = clamp(toNum(imageRow?.imbalance, 0), -1, 1);
      const microShiftBps = toNum(imageRow?.microShiftBps, 0);

      let upProb =
        toNum(row.upProb, 0.5) +
        Math.max(0, regime) * 0.06 +
        Math.max(0, tensorScore) * 0.04 +
        Math.max(0, imageImbalance) * 0.05 +
        globalConfidence * 0.02;
      let downProb =
        toNum(row.downProb, 0.5) +
        Math.max(0, -regime) * 0.06 +
        Math.max(0, -tensorScore) * 0.04 +
        Math.max(0, -imageImbalance) * 0.05 +
        globalConfidence * 0.02;

      upProb = clamp(upProb, 0.01, 0.98);
      downProb = clamp(downProb, 0.01, 0.98);
      const pairProb = upProb + downProb;
      if (pairProb > 0.97) {
        const scale = 0.97 / pairProb;
        upProb *= scale;
        downProb *= scale;
      }

      const flatProb = Math.max(0.001, 1 - upProb - downProb);
      const skew = upProb - downProb;
      const expectedMovePct =
        toNum(row.expectedMovePct, 0) + globalMove * 0.32 + tensorScore * 0.26 + imageImbalance * 0.92 + microShiftBps / 118;
      const confidencePct = clamp(
        toNum(row.confidencePct, 0) * 0.62 +
          Math.abs(skew) * 34 +
          globalConfidence * 21 +
          Math.abs(tensorScore) * 8 +
          Math.abs(imageImbalance) * 10,
        0,
        99
      );

      const summary = {
        upProb,
        downProb,
        flatProb,
        expectedMovePct,
        volatilityPct: toNum(row.volatilityPct, 0),
        skew,
        confidencePct
      };
      const recommendation = recommendPdfAction({
        summary,
        upThreshold: 0.54,
        downThreshold: 0.54,
        minExpectedMovePct: 0.028,
        minSkew: 0.05
      });

      const upScore =
        toNum(row.upScore, 0) +
        tensorScore * 14 +
        connectionScore * 10 +
        imageImbalance * 18 +
        regime * 10 +
        expectedMovePct * 4 +
        (confidencePct - toNum(row.confidencePct, 0)) * 0.12;

      return {
        ...row,
        rank: index + 1,
        source: `${row.source || 'pdf'}+tensor`,
        tensorScore,
        connectionScore,
        imageImbalance,
        microShiftBps,
        tensorRegime: regime,
        upProb,
        downProb,
        flatProb,
        expectedMovePct,
        skew,
        confidencePct,
        recommendation,
        baseUpScore: toNum(row.upScore, 0),
        upScore
      };
    })
    .sort((a, b) => b.upScore - a.upScore);
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
