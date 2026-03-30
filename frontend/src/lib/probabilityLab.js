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

export const PDF_HORIZONS = [1, 2, 3, 5, 8, 13];

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

export const rankMarketsByPdf = ({
  markets = [],
  historyByMarket = {},
  buckets = [],
  horizons = PDF_HORIZONS,
  horizon = 3,
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
    const horizonIndex = findNearestHorizonIndex(probability.horizons, horizon);
    if (horizonIndex < 0) continue;
    const summary = summarizeProbabilityColumn({
      column: probability.columns[horizonIndex],
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
      upProb: summary.upProb,
      downProb: summary.downProb,
      expectedMovePct: summary.expectedMovePct,
      volatilityPct: summary.volatilityPct,
      skew: summary.skew,
      confidencePct: summary.confidencePct,
      recommendation,
      upScore
    });
  }

  return rows.sort((a, b) => b.upScore - a.upScore);
};
