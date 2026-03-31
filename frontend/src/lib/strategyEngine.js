const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toFiniteOrNull = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const sanitizeDepthSide = (levels, side) => {
  const list = Array.isArray(levels) ? levels : [];
  const mapped = list
    .map((level) => {
      if (Array.isArray(level)) {
        const price = toFiniteOrNull(level[0]);
        const size = toFiniteOrNull(level[1]);
        if (price === null || size === null || price <= 0 || size <= 0) return null;
        return { price, size };
      }
      const price = toFiniteOrNull(level?.price);
      const size = toFiniteOrNull(level?.size);
      if (price === null || size === null || price <= 0 || size <= 0) return null;
      return { price, size };
    })
    .filter((level) => Boolean(level))
    .sort((a, b) => (side === 'bid' ? b.price - a.price : a.price - b.price));

  if (mapped.length > 40) {
    mapped.length = 40;
  }
  return mapped;
};

const resolveFillPriceFromBook = ({ side, quantity, markPrice, bid, ask, depth, slippageBps }) => {
  const qty = Math.max(Number(quantity) || 0, 1e-9);
  const bids = sanitizeDepthSide(depth?.bids, 'bid');
  const asks = sanitizeDepthSide(depth?.asks, 'ask');
  const topBid = toFiniteOrNull(bid) ?? bids[0]?.price ?? null;
  const topAsk = toFiniteOrNull(ask) ?? asks[0]?.price ?? null;

  const spreadMidRaw =
    topBid !== null && topAsk !== null && topBid > 0 && topAsk > 0 ? (topBid + topAsk) / 2 : Math.max(toNum(markPrice, 0), 1e-9);
  const markAnchor = Math.max(toNum(markPrice, 0), 1e-9);
  const spreadMidRatio = spreadMidRaw / Math.max(markAnchor, 1e-9);
  const spreadMid =
    Number.isFinite(spreadMidRatio) && spreadMidRatio >= 0.5 && spreadMidRatio <= 2 ? spreadMidRaw : markAnchor;
  const spreadBps = topBid !== null && topAsk !== null && spreadMid > 0 ? ((topAsk - topBid) / spreadMid) * 10000 : 0;

  const levels = side === 'buy' ? asks : bids;
  let remaining = qty;
  let notional = 0;
  for (const level of levels) {
    if (remaining <= 1e-9) break;
    const take = Math.min(remaining, level.size);
    notional += take * level.price;
    remaining -= take;
  }

  if (remaining > 1e-9) {
    const topPrice = side === 'buy' ? topAsk ?? spreadMid : topBid ?? spreadMid;
    const overflowImpactBps = Math.max(0, toNum(slippageBps, 0)) + Math.max(0, spreadBps) * 0.35;
    const overflowFill = topPrice * (1 + (side === 'buy' ? 1 : -1) * (overflowImpactBps / 10000));
    notional += remaining * Math.max(overflowFill, 1e-9);
  }

  let fillPrice = notional / qty;
  if (!Number.isFinite(fillPrice) || fillPrice <= 0) {
    const impactBps = Math.max(0, toNum(slippageBps, 0)) + Math.max(0, spreadBps) / 2;
    fillPrice = Math.max(spreadMid * (1 + (side === 'buy' ? 1 : -1) * (impactBps / 10000)), 1e-9);
  } else {
    const residualImpact = (Math.max(0, toNum(slippageBps, 0)) / 10000) * 0.18;
    fillPrice *= 1 + (side === 'buy' ? 1 : -1) * residualImpact;
  }

  // Guard against stale/cross-symbol book prices causing free fills and inflated equity.
  const minReasonableFill = spreadMid * 0.2;
  const maxReasonableFill = spreadMid * 5;
  if (!Number.isFinite(fillPrice) || fillPrice <= 0 || fillPrice < minReasonableFill || fillPrice > maxReasonableFill) {
    const impactBps = Math.max(0, toNum(slippageBps, 0)) + Math.max(0, spreadBps) / 2;
    fillPrice = Math.max(spreadMid * (1 + (side === 'buy' ? 1 : -1) * (impactBps / 10000)), 1e-9);
  }

  return {
    fillPrice,
    spreadBps
  };
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

const sma = (values, length) => {
  if (!Array.isArray(values) || values.length === 0) return null;
  const n = Math.max(1, Math.min(length, values.length));
  let sum = 0;
  for (let i = values.length - n; i < values.length; i += 1) {
    sum += values[i];
  }
  return sum / n;
};

const ema = (values, length) => {
  if (!Array.isArray(values) || values.length === 0) return null;
  const n = Math.max(1, Math.min(length, values.length));
  const k = 2 / (n + 1);
  let emaValue = null;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (emaValue === null) {
      emaValue = value;
    } else {
      emaValue = value * k + emaValue * (1 - k);
    }
  }
  return emaValue;
};

const rsi = (values, length = 14) => {
  if (!Array.isArray(values) || values.length < 2) return null;
  const n = Math.max(2, Math.min(length, values.length - 1));
  const start = values.length - (n + 1);
  let gains = 0;
  let losses = 0;
  for (let i = Math.max(start, 0) + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    if (change > 0) gains += change;
    if (change < 0) losses += Math.abs(change);
  }
  const avgGain = gains / n;
  const avgLoss = losses / n;
  if (avgLoss <= 1e-12 && avgGain <= 1e-12) return 50;
  if (avgLoss <= 1e-12) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

const stddev = (values) => {
  if (!Array.isArray(values) || values.length <= 1) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
};

const maxDrawdownPct = (equitySeries = []) => {
  if (!Array.isArray(equitySeries) || equitySeries.length === 0) return 0;
  let peak = equitySeries[0];
  let drawdown = 0;
  for (const equity of equitySeries) {
    peak = Math.max(peak, equity);
    const current = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    drawdown = Math.max(drawdown, current);
  }
  return drawdown;
};

export const STRATEGY_OPTIONS = [
  {
    id: 'tensor-lite',
    label: 'Tensor Lite',
    description: 'Balanced baseline that blends trend, momentum, spread, and volatility into a single runtime score.'
  },
  {
    id: 'momentum',
    label: 'Momentum',
    description: 'Chases short-term directional continuation when drift and acceleration align.'
  },
  {
    id: 'mean-reversion',
    label: 'Mean Reversion',
    description: 'Fades stretched moves and looks for snapback toward the rolling mean.'
  },
  {
    id: 'breakout',
    label: 'Breakout',
    description: 'Acts when price escapes recent range highs/lows with confirmation.'
  },
  {
    id: 'trend-follow',
    label: 'Trend Follow',
    description: 'Leans into multi-window trend alignment and stays with persistent direction.'
  },
  {
    id: 'ema-cross',
    label: 'EMA Cross',
    description: 'Uses fast/slow EMA crossovers and gap slope to flip stance.'
  },
  {
    id: 'rsi-reversion',
    label: 'RSI Reversion',
    description: 'Responds to RSI extremes by fading overbought and buying oversold conditions.'
  },
  {
    id: 'volatility-breakout',
    label: 'Volatility Breakout',
    description: 'Targets expansion phases after compression when volatility regime shifts.'
  },
  {
    id: 'range-fade',
    label: 'Range Fade',
    description: 'Trades against edges of a bounded channel and exits toward the center.'
  },
  {
    id: 'micro-scalp',
    label: 'Micro Scalp',
    description: 'High-frequency micro impulses with tighter thresholds and faster reaction.'
  },
  {
    id: 'donchian-breakout',
    label: 'Donchian Breakout',
    description: 'Classic channel breakout using Donchian highs/lows as trigger rails.'
  },
  {
    id: 'compression-breakout',
    label: 'Compression Breakout',
    description: 'Waits for narrow-range compression, then trades directional release.'
  },
  {
    id: 'momentum-pullback',
    label: 'Momentum Pullback',
    description: 'Buys pullbacks inside strong trends and sells rallies inside downtrends.'
  },
  {
    id: 'drift-guard',
    label: 'Drift Guard',
    description: 'Conservative drift-aware posture that avoids noise and spread-heavy conditions.'
  },
  {
    id: 'funding-carry',
    label: 'Funding Carry',
    description: 'Derivative strategy that leans into favorable perp funding dislocations with open-interest confirmation.'
  },
  {
    id: 'basis-arb',
    label: 'Basis Arb',
    description: 'Trades futures basis mean reversion against underlying drift when carry disconnects from spot.'
  },
  {
    id: 'iv-reversion',
    label: 'IV Reversion',
    description: 'Options-vol strategy that reacts to implied-vs-realized volatility dislocations.'
  },
  {
    id: 'gamma-squeeze',
    label: 'Gamma Squeeze',
    description: 'Options-flow strategy keyed to open-interest acceleration, skew, and put/call pressure.'
  },
  {
    id: 'signal-single',
    label: 'Signal Single',
    description: 'Acts off the strongest active signal with minimal aggregation.'
  },
  {
    id: 'signal-consensus',
    label: 'Signal Consensus',
    description: 'Requires agreement across multiple signal inputs before execution.'
  },
  {
    id: 'signal-cluster',
    label: 'Signal Cluster',
    description: 'Weights clustered signal intensity and direction to size conviction.'
  }
];

export const SCENARIO_OPTIONS = [
  { id: 'trend-rally', label: 'Trend Rally' },
  { id: 'mean-revert', label: 'Mean Revert' },
  { id: 'shock-recovery', label: 'Shock Recovery' },
  { id: 'chop', label: 'Chop Range' }
];

export const SOURCE_OPTIONS = [
  { id: 'local-scenario', label: 'Local Scenario' },
  { id: 'market-feed', label: 'Live Market Feed' }
];

const SIGNAL_STRATEGIES = new Set(['signal-single', 'signal-consensus', 'signal-cluster']);
const DERIVATIVE_STRATEGIES = new Set(['funding-carry', 'basis-arb', 'iv-reversion', 'gamma-squeeze']);

const PRICE_INPUTS_BASE = [
  'price series (latest, prev, lookback)',
  'SMA windows: 8 / 13 / 21 / 34',
  'EMA windows: 9 / 21',
  'range and breakout rails: high/low 20 and 55',
  'spread penalty and volatility regime'
];

const SIGNAL_INPUTS_BASE = [
  'market-aligned signal rows (or synthetic fallback)',
  'direction inference from signal direction/message',
  'severity weight and normalized score',
  'age decay weight exp(-ageSec / 240)',
  'spread guard and consensus weighting'
];

const STRATEGY_DETAIL_LIBRARY = {
  'tensor-lite': {
    summary: 'Default blended runtime scorer for directional drift + momentum with spread friction.',
    scoreModel: 'score = trendBps*0.62 + momentumPct*8.6 + confidenceBoost - spreadPenalty*1.45',
    actionRules: ['accumulate if score >= 5.2 and spread < 40 bps', 'reduce if score <= -5.2 and spread < 40 bps', 'otherwise hold'],
    pseudoCode:
      "if score >= 5.2 && spread < 40 -> accumulate\nelse if score <= -5.2 && spread < 40 -> reduce\nelse -> hold"
  },
  momentum: {
    summary: 'Pure continuation model favoring fast drift/momentum alignment.',
    scoreModel: 'score = trendBps*0.56 + momentumPct*9.3 - spreadPenalty*1.35',
    actionRules: ['accumulate if score >= 5.8 and spread < 42 bps', 'reduce if score <= -5.8 and spread < 42 bps', 'otherwise hold'],
    pseudoCode:
      "score <- trend*0.56 + momentum*9.3 - spreadPenalty*1.35\nif score >= 5.8 -> accumulate\nif score <= -5.8 -> reduce"
  },
  'mean-reversion': {
    summary: 'Uses 20-bar z-score to fade statistically stretched moves.',
    scoreModel: 'score = -z*8 - spreadPenalty where z = (price - mean20)/std20',
    actionRules: ['accumulate if z <= -1.1 and spread < 48 bps', 'reduce if z >= 1.1 and spread < 48 bps', 'otherwise hold'],
    pseudoCode:
      "z <- (latest - mean20)/sigma20\nif z <= -1.1 -> accumulate\nif z >= 1.1 -> reduce"
  },
  breakout: {
    summary: '20-window breakout with directional confirmation and spread gating.',
    scoreModel: 'score = accelBps + trendBps*0.3 - spreadPenalty*1.2',
    actionRules: ['accumulate when latest > high20*1.0008 and spread < 44 bps', 'reduce when latest < low20*0.9992 and spread < 44 bps', 'otherwise hold'],
    pseudoCode:
      "breakUp <- latest > high20*1.0008\nbreakDown <- latest < low20*0.9992\nif breakUp -> accumulate\nif breakDown -> reduce"
  },
  'trend-follow': {
    summary: 'Multi-horizon trend stack using short and long trend rails.',
    scoreModel: 'score = trendBps*0.72 + longTrendBps*0.46 + momentumPct*6.1 - spreadPenalty*1.2',
    actionRules: ['accumulate if score >= 6.4 and spread < 45 bps', 'reduce if score <= -6.4 and spread < 45 bps', 'otherwise hold'],
    pseudoCode:
      "score <- shortTrend*0.72 + longTrend*0.46 + momentum*6.1 - spreadPenalty*1.2\napply +/-6.4 thresholds"
  },
  'ema-cross': {
    summary: 'EMA crossover + gap slope with acceleration confirmation.',
    scoreModel: 'score = emaGapBps*0.88 + accelBps*0.34 + momentumPct*2.2 - spreadPenalty',
    actionRules: [
      'accumulate on crossUp OR (emaFast > emaSlow and score > 4.4), spread < 44 bps',
      'reduce on crossDown OR (emaFast < emaSlow and score < -4.4), spread < 44 bps',
      'otherwise hold'
    ],
    pseudoCode:
      "crossUp <- emaFastPrev<=emaSlowPrev && emaFast>emaSlow\ncrossDown <- emaFastPrev>=emaSlowPrev && emaFast<emaSlow\nif crossUp || score>4.4 -> accumulate\nif crossDown || score<-4.4 -> reduce"
  },
  'rsi-reversion': {
    summary: 'Contrarian RSI model around 14-period oscillation extremes.',
    scoreModel: 'score = (50-rsi14)*0.72 - trendBps*0.16 - spreadPenalty*1.1',
    actionRules: ['accumulate if RSI <= 32 and spread < 48 bps', 'reduce if RSI >= 68 and spread < 48 bps', 'otherwise hold'],
    pseudoCode:
      "if rsi14 <= 32 -> accumulate\nelse if rsi14 >= 68 -> reduce\nelse hold"
  },
  'volatility-breakout': {
    summary: 'Breakout sensitivity adapts to volatility expansion.',
    scoreModel: 'score = accelBps*0.75 + trendBps*0.45 + volatilityPct*14 - spreadPenalty*1.1',
    actionRules: [
      'accumulate if latest > high20*(1 + volatilityPct/900) and spread < 46 bps',
      'reduce if latest < low20*(1 - volatilityPct/900) and spread < 46 bps',
      'otherwise hold'
    ],
    pseudoCode:
      "upBreak <- latest > high20*(1+volPct/900)\ndownBreak <- latest < low20*(1-volPct/900)\nif upBreak -> accumulate\nif downBreak -> reduce"
  },
  'range-fade': {
    summary: 'Fades channel extremes based on 20-bar position.',
    scoreModel: 'score = (50-channelPosition)*0.23 - trendBps*0.18 - spreadPenalty',
    actionRules: ['accumulate if channelPosition <= 18 and spread < 42 bps', 'reduce if channelPosition >= 82 and spread < 42 bps', 'otherwise hold'],
    pseudoCode:
      "channelPosition <- (latest-low20)/(high20-low20)\nif channelPosition <= 18 -> accumulate\nif channelPosition >= 82 -> reduce"
  },
  'micro-scalp': {
    summary: 'Fast micro-impulse model with strict spread constraints.',
    scoreModel: 'score = accelBps*0.95 + momentumPct*2.6 - spreadPenalty*2.35',
    actionRules: ['accumulate if score >= 3.1 and spread < 18 bps', 'reduce if score <= -3.1 and spread < 18 bps', 'otherwise hold'],
    pseudoCode:
      "if spread >= 18 -> hold\nelse apply score thresholds +/-3.1"
  },
  'donchian-breakout': {
    summary: '55-window Donchian breakout rails.',
    scoreModel: 'score = accelBps*0.44 + momentumPct*4.4 + donchianRangeBps*0.0022 - spreadPenalty*1.3',
    actionRules: ['accumulate if latest > high55*1.0005 and spread < 46 bps', 'reduce if latest < low55*0.9995 and spread < 46 bps', 'otherwise hold'],
    pseudoCode:
      "if latest > high55*1.0005 -> accumulate\nelse if latest < low55*0.9995 -> reduce"
  },
  'compression-breakout': {
    summary: 'Only trades breakouts after volatility compression.',
    scoreModel: 'score = (1-compressionRatio)*18 + accelBps*0.42 + trendBps*0.25 - spreadPenalty',
    actionRules: [
      'compressed := compressionRatio < 0.84',
      'accumulate if compressed and latest > high20*1.0004 and spread < 44 bps',
      'reduce if compressed and latest < low20*0.9996 and spread < 44 bps',
      'otherwise hold'
    ],
    pseudoCode:
      "compressed <- compressionRatio < 0.84\nif compressed && burstUp -> accumulate\nif compressed && burstDown -> reduce"
  },
  'momentum-pullback': {
    summary: 'Trend-following pullback entries using long trend bias.',
    scoreModel: 'score = longTrendBps*0.62 - pullbackBps*0.38 + momentumPct*3.1 - spreadPenalty',
    actionRules: [
      'accumulate if longTrendBps > 6 and pullbackBps < -8 and spread < 46 bps',
      'reduce if longTrendBps < -6 and pullbackBps > 8 and spread < 46 bps',
      'otherwise hold'
    ],
    pseudoCode:
      "if longTrend > 6 and pullback < -8 -> accumulate\nif longTrend < -6 and pullback > 8 -> reduce"
  },
  'drift-guard': {
    summary: 'Conservative risk-aware drift model with volatility/spread penalties.',
    scoreModel: 'driftScore = trendBps*0.34 + longTrendBps*0.29 + momentumPct*2.8; score = driftScore - riskPenalty',
    actionRules: ['accumulate if score >= 4.2 and spread < 36 bps', 'reduce if score <= -4.2 and spread < 36 bps', 'otherwise hold'],
    pseudoCode:
      "riskPenalty <- spreadPenalty*1.65 + max(0, volatilityPct-1.4)*3.4\nscore <- driftScore - riskPenalty"
  },
  'funding-carry': {
    summary: 'Derivative carry logic from funding, OI change, and trend.',
    scoreModel: 'score = -fundingRateBps*2.6 + trendBps*0.22 + openInterestChangePct*0.95 - spreadPenalty*1.1',
    actionRules: [
      'market must be derivative (futures/options)',
      'accumulate if funding <= -0.9 bps AND score > 1.8 AND spread < 52 bps',
      'reduce if funding >= 0.9 bps AND score < -1.8 AND spread < 52 bps',
      'otherwise hold'
    ],
    pseudoCode:
      "if !isDerivative -> hold\nif funding <= -0.9 && score > 1.8 -> accumulate\nif funding >= 0.9 && score < -1.8 -> reduce"
  },
  'basis-arb': {
    summary: 'Basis dislocation mean-reversion with momentum assist.',
    scoreModel: 'score = -basisBps*0.34 + momentumPct*3.4 + openInterestChangePct*0.32 - spreadPenalty*0.9',
    actionRules: ['market must be derivative', 'accumulate if basis <= -10 bps and spread < 54 bps', 'reduce if basis >= 10 bps and spread < 54 bps', 'otherwise hold'],
    pseudoCode:
      "if !isDerivative -> hold\nif basis <= -10 -> accumulate\nif basis >= 10 -> reduce"
  },
  'iv-reversion': {
    summary: 'Options-only volatility premium reversion model.',
    scoreModel: 'volPremium = impliedVolPct - realizedProxy; score = -volPremium*0.11 + momentumPct*1.55 + optionSkewPct*0.26 - spreadPenalty*0.85',
    actionRules: [
      'requires options contract market',
      'accumulate if volPremium <= -5, momentum > -0.45, spread < 68 bps',
      'reduce if volPremium >= 8, momentum < 0.45, spread < 68 bps',
      'otherwise hold'
    ],
    pseudoCode:
      "if !isOption -> hold\nvolPremium <- impliedVol - realizedProxy\nif volPremium <= -5 -> accumulate\nif volPremium >= 8 -> reduce"
  },
  'gamma-squeeze': {
    summary: 'Options-flow pressure model from OI acceleration, skew, and put/call ratio.',
    scoreModel: 'squeezePressure = openInterestChangePct*2.2 + (1.02-putCallRatio)*5 + momentumPct*1.35 + optionSkewPct*0.18; score = squeezePressure - spreadPenalty',
    actionRules: [
      'requires options contract market',
      'accumulate if OI change > 1.1, putCallRatio < 0.95, momentum > 0, spread < 72 bps',
      'reduce if OI change > 1.1, putCallRatio > 1.08, momentum < 0, spread < 72 bps',
      'otherwise hold'
    ],
    pseudoCode:
      "if !isOption -> hold\nif oiChange>1.1 && pcr<0.95 && momentum>0 -> accumulate\nif oiChange>1.1 && pcr>1.08 && momentum<0 -> reduce"
  },
  'signal-single': {
    summary: 'Trades the strongest directional signal only.',
    scoreModel: 'score = top.dir*abs(top.signedWeight)*9 + consensus*3.6 - spreadPenalty',
    actionRules: ['hold if spread > 48 bps', 'hold if no top signal or topStrength < 0.28', 'else follow top direction'],
    pseudoCode:
      "rows <- weightedDirectionalSignals\nif spreadGuard -> hold\nif !top || abs(top.signedWeight)<0.28 -> hold\nelse action <- top.dir>0 ? accumulate : reduce"
  },
  'signal-consensus': {
    summary: 'Consensus-weighted signal strategy (default signal path).',
    scoreModel: 'score = consensus*11.4 + (directionalRows>=3 ? 1.1 : 0) - spreadPenalty*1.1',
    actionRules: ['hold if spread > 48 bps', 'accumulate if consensus > 0.24', 'reduce if consensus < -0.24', 'otherwise hold'],
    pseudoCode:
      "consensus <- netSignedWeight / totalAbsWeight\nif consensus > 0.24 -> accumulate\nif consensus < -0.24 -> reduce"
  },
  'signal-cluster': {
    summary: 'Requires clustered high/medium-confidence agreement before acting.',
    scoreModel: 'clusterDelta = bullishWeight - bearishWeight; score = clusterDelta*8.2 + (highConfidenceBull-highConfidenceBear)*1.5 - spreadPenalty',
    actionRules: [
      'hold if spread > 48 bps',
      'accumulate if highConfidenceBull >= 2 and clusterDelta > 0.35',
      'reduce if highConfidenceBear >= 2 and clusterDelta < -0.35',
      'otherwise hold'
    ],
    pseudoCode:
      "bull <- count(high|med bullish)\nbear <- count(high|med bearish)\nclusterDelta <- bullishWeight - bearishWeight\napply +/-0.35 gates"
  }
};

export const getStrategyImplementationDetail = (strategyId = '') => {
  const key = String(strategyId || '').trim().toLowerCase();
  const selectedKey = STRATEGY_DETAIL_LIBRARY[key] ? key : 'tensor-lite';
  const option = STRATEGY_OPTIONS.find((item) => item.id === selectedKey) || STRATEGY_OPTIONS.find((item) => item.id === 'tensor-lite') || null;
  const detail = STRATEGY_DETAIL_LIBRARY[selectedKey] || STRATEGY_DETAIL_LIBRARY['tensor-lite'];
  const signalDriven = SIGNAL_STRATEGIES.has(selectedKey);
  const derivativeGuarded = DERIVATIVE_STRATEGIES.has(selectedKey);

  return {
    id: selectedKey,
    label: option?.label || selectedKey,
    description: option?.description || '',
    triggerKind: signalDriven ? 'signal' : 'price',
    runtimePath: signalDriven ? 'evaluateStrategy -> evaluateSignalStrategy' : 'evaluateStrategy -> evaluatePriceStrategy',
    sourceFile: 'frontend/src/lib/strategyEngine.js',
    summary: detail.summary,
    scoreModel: detail.scoreModel,
    actionRules: detail.actionRules || [],
    prerequisites: [
      signalDriven ? 'requires signal rows (live or synthetic fallback)' : 'requires price stream with >=2 points',
      derivativeGuarded ? 'market must be derivatives-capable (and options-only for IV/Gamma)' : 'works on standard market stream',
      'spread guard blocks execution in high-friction conditions'
    ],
    inputs: signalDriven ? SIGNAL_INPUTS_BASE : PRICE_INPUTS_BASE,
    pseudoCode: detail.pseudoCode
  };
};

const severityWeight = (severity) => {
  const value = String(severity || '').toLowerCase();
  if (value === 'high') return 1.5;
  if (value === 'medium') return 1;
  return 0.62;
};

const directionScore = (signal) => {
  const direction = String(signal?.direction || signal?.action || '').toLowerCase();
  if (direction.includes('long') || direction.includes('bull') || direction.includes('accumulate') || direction.includes('buy')) return 1;
  if (direction.includes('short') || direction.includes('bear') || direction.includes('reduce') || direction.includes('sell')) return -1;

  const text = `${String(signal?.type || '')} ${String(signal?.message || '')}`.toLowerCase();
  if (text.includes('upside') || text.includes('breakout') || text.includes('momentum up') || text.includes('bull')) return 1;
  if (text.includes('downside') || text.includes('breakdown') || text.includes('momentum down') || text.includes('bear')) return -1;
  return 0;
};

const normalizeSignalRows = (signalRows = []) => {
  if (!Array.isArray(signalRows)) return [];
  return signalRows
    .map((signal, index) => ({
      id: signal?.id || `signal:${index}`,
      symbol: String(signal?.symbol || '').toUpperCase(),
      assetClass: String(signal?.assetClass || '').toLowerCase(),
      type: String(signal?.type || 'signal'),
      direction: String(signal?.direction || ''),
      severity: String(signal?.severity || 'low').toLowerCase(),
      score: clamp(toNum(signal?.score, 0), 0, 100),
      timestamp: toNum(signal?.timestamp, Date.now()),
      message: String(signal?.message || '')
    }))
    .filter((signal) => signal.symbol || signal.message);
};

const alignSignalsToMarket = ({ signalRows = [], selectedMarket }) => {
  const normalized = normalizeSignalRows(signalRows);
  if (!selectedMarket) return normalized.slice(0, 12);
  const symbol = String(selectedMarket.symbol || '').toUpperCase();
  const assetClass = String(selectedMarket.assetClass || '').toLowerCase();
  const scoped = normalized.filter((signal) => {
    return signal.symbol === symbol && signal.assetClass === assetClass;
  });
  if (scoped.length > 0) return scoped.slice(0, 12);
  return normalized.slice(0, 12);
};

const inferSeverity = (value) => {
  if (value >= 70) return 'high';
  if (value >= 38) return 'medium';
  return 'low';
};

export const buildSyntheticSignalRows = ({ series = [], selectedMarket = null, now = Date.now() }) => {
  if (!Array.isArray(series) || series.length < 3) return [];
  const prices = series.map((point) => Math.max(toNum(point.price, 0), 1e-9));
  const latest = prices[prices.length - 1];
  const prev = prices[prices.length - 2];
  const short = sma(prices, 8) || latest;
  const long = sma(prices, 21) || latest;
  const momentumPct = ((latest - prev) / Math.max(prev, 1e-9)) * 100;
  const trendBps = ((short - long) / Math.max(latest, 1e-9)) * 10000;
  const spread = Math.max(0, toNum(series[series.length - 1]?.spread, 0));
  const absMomentum = Math.abs(momentumPct);
  const absTrend = Math.abs(trendBps);

  const symbol = String(selectedMarket?.symbol || 'SIM').toUpperCase();
  const assetClass = String(selectedMarket?.assetClass || 'synthetic').toLowerCase();

  const momentumScore = clamp(absMomentum * 120 + absTrend * 0.42, 10, 98);
  const momentumDirection = momentumPct >= 0 ? 'long' : 'short';
  const trendScore = clamp(absTrend * 0.78 + absMomentum * 28, 10, 98);
  const trendDirection = trendBps >= 0 ? 'long' : 'short';
  const spreadScore = clamp((spread - 8) * 3.5, 8, 96);

  return [
    {
      id: `synthetic:momentum:${now}`,
      symbol,
      assetClass,
      type: 'synthetic-momentum',
      direction: momentumDirection,
      severity: inferSeverity(momentumScore),
      score: Math.round(momentumScore),
      timestamp: now,
      message: `synthetic momentum ${momentumPct.toFixed(2)}%`
    },
    {
      id: `synthetic:trend:${now}`,
      symbol,
      assetClass,
      type: 'synthetic-trend',
      direction: trendDirection,
      severity: inferSeverity(trendScore),
      score: Math.round(trendScore),
      timestamp: now,
      message: `synthetic trend ${trendBps.toFixed(2)} bps`
    },
    {
      id: `synthetic:spread:${now}`,
      symbol,
      assetClass,
      type: 'synthetic-spread-risk',
      direction: spread > 28 ? 'short' : 'long',
      severity: inferSeverity(spreadScore),
      score: Math.round(spreadScore),
      timestamp: now,
      message: `synthetic spread ${spread.toFixed(2)} bps`
    }
  ];
};

export const selectSignalRowsForMarket = ({
  snapshotSignals = [],
  selectedMarket = null,
  fallbackSeries = [],
  now = Date.now(),
  maxRows = 12
}) => {
  const scoped = alignSignalsToMarket({
    signalRows: snapshotSignals,
    selectedMarket
  })
    .sort((a, b) => {
      const aWeight = toNum(a.score, 0) + toNum(a.timestamp, 0) / 1000000000000;
      const bWeight = toNum(b.score, 0) + toNum(b.timestamp, 0) / 1000000000000;
      return bWeight - aWeight;
    })
    .slice(0, maxRows);

  if (scoped.length > 0) return scoped;
  return buildSyntheticSignalRows({
    series: fallbackSeries,
    selectedMarket,
    now
  }).slice(0, maxRows);
};

export const DEFAULT_WALLET_CASH = 100000;

export const createWalletState = (cash = DEFAULT_WALLET_CASH) => {
  const baseCash = toNum(cash, DEFAULT_WALLET_CASH);
  return {
    cash: baseCash,
    units: 0,
    avgEntry: null,
    realizedPnl: 0,
    unrealizedPnl: 0,
    equity: baseCash,
    tradeCount: 0,
    winCount: 0,
    lossCount: 0,
    lastActionAt: 0
  };
};

export const markWallet = (wallet, price) => {
  const markPrice = Math.max(toNum(price, 0), 1e-9);
  const units = toNum(wallet.units, 0);
  const avgEntry = wallet.avgEntry === null ? null : toNum(wallet.avgEntry, null);
  const unrealizedPnl =
    avgEntry === null || units === 0 ? 0 : units > 0 ? (markPrice - avgEntry) * Math.abs(units) : (avgEntry - markPrice) * Math.abs(units);
  const equity = toNum(wallet.cash, 0) + units * markPrice;
  return {
    ...wallet,
    unrealizedPnl,
    equity
  };
};

const rollingHigh = (values, length) => {
  if (!values.length) return null;
  const n = Math.max(1, Math.min(length, values.length));
  const slice = values.slice(values.length - n);
  return Math.max(...slice);
};

const rollingLow = (values, length) => {
  if (!values.length) return null;
  const n = Math.max(1, Math.min(length, values.length));
  const slice = values.slice(values.length - n);
  return Math.min(...slice);
};

const toStance = (score) => {
  if (score > 2) return 'bullish';
  if (score < -2) return 'bearish';
  return 'neutral';
};

const priceResult = ({ action = 'hold', score = 0, reason = '', triggerKind = 'price' }) => {
  return {
    action,
    score,
    stance: toStance(score),
    reason,
    signalCount: 0,
    triggerKind
  };
};

const evaluatePriceStrategy = ({ strategyId, series = [], selectedMarket = null }) => {
  if (!Array.isArray(series) || series.length < 2) {
    return priceResult({
      action: 'hold',
      score: 0,
      reason: 'Waiting for enough data'
    });
  }

  const prices = series.map((point) => Math.max(toNum(point.price, 0), 1e-9));
  const latest = prices[prices.length - 1];
  const latestSpread = Math.max(0, toNum(series[series.length - 1]?.spread, 0));
  const prev = prices[prices.length - 2];
  const short = sma(prices, 8) || latest;
  const medium = sma(prices, 13) || latest;
  const long = sma(prices, 21) || latest;
  const slow = sma(prices, 34) || latest;
  const lookback = prices[Math.max(0, prices.length - 12)];
  const momentumPct = ((latest - lookback) / Math.max(lookback, 1e-9)) * 100;
  const trendBps = ((short - long) / Math.max(latest, 1e-9)) * 10000;
  const longTrendBps = ((medium - slow) / Math.max(latest, 1e-9)) * 10000;
  const spreadPenalty = clamp((latestSpread - 10) / 8, 0, 6);
  const volatility20 = Math.max(stddev(prices.slice(-20)), latest * 0.00001);
  const volatility34 = Math.max(stddev(prices.slice(-34)), latest * 0.00001);
  const volatilityPct = (volatility20 / Math.max(latest, 1e-9)) * 100;
  const compressionRatio = volatility20 / Math.max(volatility34, 1e-9);
  const high20 = rollingHigh(prices.slice(0, prices.length - 1), 20) || latest;
  const low20 = rollingLow(prices.slice(0, prices.length - 1), 20) || latest;
  const high55 = rollingHigh(prices.slice(0, prices.length - 1), 55) || high20;
  const low55 = rollingLow(prices.slice(0, prices.length - 1), 55) || low20;
  const range20 = Math.max(high20 - low20, latest * 0.00001);
  const rangePct20 = (range20 / Math.max(latest, 1e-9)) * 100;
  const channelPosition = ((latest - low20) / Math.max(range20, 1e-9)) * 100;
  const emaFast = ema(prices, 9) || latest;
  const emaSlow = ema(prices, 21) || latest;
  const emaFastPrev = ema(prices.slice(0, prices.length - 1), 9) || emaFast;
  const emaSlowPrev = ema(prices.slice(0, prices.length - 1), 21) || emaSlow;
  const rsi14 = rsi(prices, 14);
  const accelBps = ((latest - prev) / Math.max(latest, 1e-9)) * 10000;
  const marketAssetClass = String(selectedMarket?.assetClass || '').toLowerCase();
  const marketSymbol = String(selectedMarket?.symbol || '').toUpperCase();
  const instrumentType = String(selectedMarket?.instrumentType || '').toLowerCase();
  const isOption =
    instrumentType === 'option' || marketSymbol.includes('-C') || marketSymbol.includes('-P') || marketSymbol.includes('CALL') || marketSymbol.includes('PUT');
  const isFuture = instrumentType === 'future' || marketSymbol.includes('PERP') || marketSymbol.includes('FUT');
  const isDerivativeMarket = marketAssetClass === 'derivative' || isOption || isFuture;
  const basisBps = toNum(selectedMarket?.basisBps, ((latest - medium) / Math.max(latest, 1e-9)) * 10000);
  const fundingRateBps = toNum(selectedMarket?.fundingRateBps, 0);
  const openInterestChangePct = toNum(selectedMarket?.openInterestChangePct, 0);
  const impliedVolPct = toNum(selectedMarket?.impliedVolPct, clamp(volatilityPct * 60, 4, 250));
  const optionSkewPct = toNum(selectedMarket?.optionSkewPct, 0);
  const putCallRatio = clamp(toNum(selectedMarket?.putCallRatio, 1), 0.05, 6);

  if (DERIVATIVE_STRATEGIES.has(strategyId) && !isDerivativeMarket) {
    return priceResult({
      action: 'hold',
      score: 0,
      reason: 'Derivative strategy requires a futures/options market'
    });
  }

  if (strategyId === 'mean-reversion') {
    const window = prices.slice(-20);
    const mean = sma(prices, 20) || latest;
    const sigma = Math.max(stddev(window), mean * 0.0001);
    const z = (latest - mean) / sigma;
    const score = -z * 8 - spreadPenalty;
    const action = z <= -1.1 && latestSpread < 48 ? 'accumulate' : z >= 1.1 && latestSpread < 48 ? 'reduce' : 'hold';
    return priceResult({
      action,
      score,
      reason: `z-score ${z.toFixed(2)} around 20-bar mean, spread ${latestSpread.toFixed(2)} bps`
    });
  }

  if (strategyId === 'breakout') {
    const high = high20;
    const low = low20;
    const breakUp = latest > high * 1.0008;
    const breakDown = latest < low * 0.9992;
    const score = ((latest - prev) / Math.max(latest, 1e-9)) * 10000 + trendBps * 0.3 - spreadPenalty * 1.2;
    const action = breakUp && latestSpread < 44 ? 'accumulate' : breakDown && latestSpread < 44 ? 'reduce' : 'hold';
    return priceResult({
      action,
      score,
      reason: `breakout window hi ${high.toFixed(4)} / lo ${low.toFixed(4)}, spread ${latestSpread.toFixed(2)} bps`
    });
  }

  if (strategyId === 'momentum') {
    const score = trendBps * 0.56 + momentumPct * 9.3 - spreadPenalty * 1.35;
    const action = score >= 5.8 && latestSpread < 42 ? 'accumulate' : score <= -5.8 && latestSpread < 42 ? 'reduce' : 'hold';
    return priceResult({
      action,
      score,
      reason: `momentum ${momentumPct.toFixed(2)}%, trend ${trendBps.toFixed(2)} bps, spread ${latestSpread.toFixed(2)} bps`
    });
  }

  if (strategyId === 'trend-follow') {
    const score = trendBps * 0.72 + longTrendBps * 0.46 + momentumPct * 6.1 - spreadPenalty * 1.2;
    const action = score >= 6.4 && latestSpread < 45 ? 'accumulate' : score <= -6.4 && latestSpread < 45 ? 'reduce' : 'hold';
    return priceResult({
      action,
      score,
      reason: `trend follow short ${trendBps.toFixed(2)} bps, long ${longTrendBps.toFixed(2)} bps, spread ${latestSpread.toFixed(2)} bps`
    });
  }

  if (strategyId === 'ema-cross') {
    const crossUp = emaFastPrev <= emaSlowPrev && emaFast > emaSlow;
    const crossDown = emaFastPrev >= emaSlowPrev && emaFast < emaSlow;
    const emaGapBps = ((emaFast - emaSlow) / Math.max(latest, 1e-9)) * 10000;
    const score = emaGapBps * 0.88 + accelBps * 0.34 + momentumPct * 2.2 - spreadPenalty;
    const action =
      (crossUp || (emaFast > emaSlow && score > 4.4)) && latestSpread < 44
        ? 'accumulate'
        : (crossDown || (emaFast < emaSlow && score < -4.4)) && latestSpread < 44
          ? 'reduce'
          : 'hold';
    return priceResult({
      action,
      score,
      reason: `ema cross fast ${emaFast.toFixed(4)} slow ${emaSlow.toFixed(4)}, gap ${emaGapBps.toFixed(2)} bps`
    });
  }

  if (strategyId === 'rsi-reversion') {
    const safeRsi = Number.isFinite(rsi14) ? rsi14 : 50;
    const score = (50 - safeRsi) * 0.72 - trendBps * 0.16 - spreadPenalty * 1.1;
    const action = safeRsi <= 32 && latestSpread < 48 ? 'accumulate' : safeRsi >= 68 && latestSpread < 48 ? 'reduce' : 'hold';
    return priceResult({
      action,
      score,
      reason: `rsi ${safeRsi.toFixed(2)}, trend ${trendBps.toFixed(2)} bps, spread ${latestSpread.toFixed(2)} bps`
    });
  }

  if (strategyId === 'volatility-breakout') {
    const upBreak = latest > high20 * (1 + volatilityPct / 900);
    const downBreak = latest < low20 * (1 - volatilityPct / 900);
    const score = accelBps * 0.75 + trendBps * 0.45 + volatilityPct * 14 - spreadPenalty * 1.1;
    const action = upBreak && latestSpread < 46 ? 'accumulate' : downBreak && latestSpread < 46 ? 'reduce' : 'hold';
    return priceResult({
      action,
      score,
      reason: `vol breakout vol ${volatilityPct.toFixed(3)}%, range ${rangePct20.toFixed(3)}%, spread ${latestSpread.toFixed(2)} bps`
    });
  }

  if (strategyId === 'range-fade') {
    const score = (50 - channelPosition) * 0.23 - trendBps * 0.18 - spreadPenalty;
    const action = channelPosition <= 18 && latestSpread < 42 ? 'accumulate' : channelPosition >= 82 && latestSpread < 42 ? 'reduce' : 'hold';
    return priceResult({
      action,
      score,
      reason: `range fade pos ${channelPosition.toFixed(2)}%, range ${rangePct20.toFixed(3)}%, spread ${latestSpread.toFixed(2)} bps`
    });
  }

  if (strategyId === 'micro-scalp') {
    const score = accelBps * 0.95 + momentumPct * 2.6 - spreadPenalty * 2.35;
    const action = score >= 3.1 && latestSpread < 18 ? 'accumulate' : score <= -3.1 && latestSpread < 18 ? 'reduce' : 'hold';
    return priceResult({
      action,
      score,
      reason: `micro scalp accel ${accelBps.toFixed(2)} bps, spread ${latestSpread.toFixed(2)} bps`
    });
  }

  if (strategyId === 'donchian-breakout') {
    const breakUp = latest > high55 * 1.0005;
    const breakDown = latest < low55 * 0.9995;
    const donchianRangeBps = ((high55 - low55) / Math.max(latest, 1e-9)) * 10000;
    const score = accelBps * 0.44 + momentumPct * 4.4 + donchianRangeBps * 0.0022 - spreadPenalty * 1.3;
    const action = breakUp && latestSpread < 46 ? 'accumulate' : breakDown && latestSpread < 46 ? 'reduce' : 'hold';
    return priceResult({
      action,
      score,
      reason: `donchian hi ${high55.toFixed(4)} lo ${low55.toFixed(4)}, range ${donchianRangeBps.toFixed(2)} bps`
    });
  }

  if (strategyId === 'compression-breakout') {
    const compressed = compressionRatio < 0.84;
    const burstUp = compressed && latest > high20 * 1.0004;
    const burstDown = compressed && latest < low20 * 0.9996;
    const score = (1 - compressionRatio) * 18 + accelBps * 0.42 + trendBps * 0.25 - spreadPenalty;
    const action = burstUp && latestSpread < 44 ? 'accumulate' : burstDown && latestSpread < 44 ? 'reduce' : 'hold';
    return priceResult({
      action,
      score,
      reason: `compression ${compressionRatio.toFixed(3)}, burst range ${rangePct20.toFixed(3)}%, spread ${latestSpread.toFixed(2)} bps`
    });
  }

  if (strategyId === 'momentum-pullback') {
    const pullbackBps = ((latest - short) / Math.max(latest, 1e-9)) * 10000;
    const longBiasUp = longTrendBps > 6;
    const longBiasDown = longTrendBps < -6;
    const score = longTrendBps * 0.62 - pullbackBps * 0.38 + momentumPct * 3.1 - spreadPenalty;
    const action =
      longBiasUp && pullbackBps < -8 && latestSpread < 46
        ? 'accumulate'
        : longBiasDown && pullbackBps > 8 && latestSpread < 46
          ? 'reduce'
          : 'hold';
    return priceResult({
      action,
      score,
      reason: `pullback ${pullbackBps.toFixed(2)} bps within long trend ${longTrendBps.toFixed(2)} bps`
    });
  }

  if (strategyId === 'drift-guard') {
    const driftScore = trendBps * 0.34 + longTrendBps * 0.29 + momentumPct * 2.8;
    const riskPenalty = spreadPenalty * 1.65 + Math.max(0, volatilityPct - 1.4) * 3.4;
    const score = driftScore - riskPenalty;
    const action = score >= 4.2 && latestSpread < 36 ? 'accumulate' : score <= -4.2 && latestSpread < 36 ? 'reduce' : 'hold';
    return priceResult({
      action,
      score,
      reason: `drift guard score ${driftScore.toFixed(2)} risk ${riskPenalty.toFixed(2)} spread ${latestSpread.toFixed(2)} bps`
    });
  }

  if (strategyId === 'funding-carry') {
    const score = -fundingRateBps * 2.6 + trendBps * 0.22 + openInterestChangePct * 0.95 - spreadPenalty * 1.1;
    const action =
      fundingRateBps <= -0.9 && score > 1.8 && latestSpread < 52
        ? 'accumulate'
        : fundingRateBps >= 0.9 && score < -1.8 && latestSpread < 52
          ? 'reduce'
          : 'hold';
    return priceResult({
      action,
      score,
      reason: `funding ${fundingRateBps.toFixed(2)} bps, oi ${openInterestChangePct.toFixed(2)}%, trend ${trendBps.toFixed(2)} bps`
    });
  }

  if (strategyId === 'basis-arb') {
    const score = -basisBps * 0.34 + momentumPct * 3.4 + openInterestChangePct * 0.32 - spreadPenalty * 0.9;
    const action = basisBps <= -10 && latestSpread < 54 ? 'accumulate' : basisBps >= 10 && latestSpread < 54 ? 'reduce' : 'hold';
    return priceResult({
      action,
      score,
      reason: `basis ${basisBps.toFixed(2)} bps, momentum ${momentumPct.toFixed(2)}%, oi ${openInterestChangePct.toFixed(2)}%`
    });
  }

  if (strategyId === 'iv-reversion') {
    if (!isOption) {
      return priceResult({
        action: 'hold',
        score: 0,
        reason: 'IV Reversion requires an options contract market'
      });
    }
    const realizedProxy = clamp(volatilityPct * 100, 1, 220);
    const volPremium = impliedVolPct - realizedProxy;
    const score = -volPremium * 0.11 + momentumPct * 1.55 + optionSkewPct * 0.26 - spreadPenalty * 0.85;
    const action =
      volPremium <= -5 && momentumPct > -0.45 && latestSpread < 68
        ? 'accumulate'
        : volPremium >= 8 && momentumPct < 0.45 && latestSpread < 68
          ? 'reduce'
          : 'hold';
    return priceResult({
      action,
      score,
      reason: `iv ${impliedVolPct.toFixed(2)}% vs rv ${realizedProxy.toFixed(2)}%, skew ${optionSkewPct.toFixed(2)}`
    });
  }

  if (strategyId === 'gamma-squeeze') {
    if (!isOption) {
      return priceResult({
        action: 'hold',
        score: 0,
        reason: 'Gamma Squeeze requires an options contract market'
      });
    }
    const squeezePressure = openInterestChangePct * 2.2 + (1.02 - putCallRatio) * 5 + momentumPct * 1.35 + optionSkewPct * 0.18;
    const score = squeezePressure - spreadPenalty;
    const action =
      openInterestChangePct > 1.1 && putCallRatio < 0.95 && momentumPct > 0 && latestSpread < 72
        ? 'accumulate'
        : openInterestChangePct > 1.1 && putCallRatio > 1.08 && momentumPct < 0 && latestSpread < 72
          ? 'reduce'
          : 'hold';
    return priceResult({
      action,
      score,
      reason: `gamma pressure oi ${openInterestChangePct.toFixed(2)}%, p/c ${putCallRatio.toFixed(2)}, skew ${optionSkewPct.toFixed(2)}`
    });
  }

  const confidenceBoost = clamp(Math.abs(trendBps) / 22, 0, 3.4);
  const score = trendBps * 0.62 + momentumPct * 8.6 + confidenceBoost - spreadPenalty * 1.45;
  const action = score >= 5.2 && latestSpread < 40 ? 'accumulate' : score <= -5.2 && latestSpread < 40 ? 'reduce' : 'hold';
  return priceResult({
    action,
    score,
    reason: `tensor-lite drift ${trendBps.toFixed(2)} bps, momentum ${momentumPct.toFixed(2)}%, spread ${latestSpread.toFixed(2)} bps`
  });
};

const evaluateSignalStrategy = ({ strategyId, series = [], signalRows = [], selectedMarket = null }) => {
  if (!Array.isArray(series) || series.length === 0) {
    return {
      action: 'hold',
      score: 0,
      stance: 'neutral',
      reason: 'Signal strategy waiting for price stream',
      signalCount: 0,
      triggerKind: 'signal'
    };
  }

  const latestSpread = Math.max(0, toNum(series[series.length - 1]?.spread, 0));
  const now = toNum(series[series.length - 1]?.t, Date.now());
  const syntheticRows = buildSyntheticSignalRows({
    series,
    selectedMarket,
    now
  });

  const rows = alignSignalsToMarket({
    signalRows: signalRows?.length ? signalRows : syntheticRows,
    selectedMarket
  });

  if (rows.length === 0) {
    return {
      action: 'hold',
      score: 0,
      stance: 'neutral',
      reason: 'Signal strategy waiting for signal rows',
      signalCount: 0,
      triggerKind: 'signal'
    };
  }

  const weighted = rows.map((row) => {
    const dir = directionScore(row);
    const baseWeight = severityWeight(row.severity) * clamp(toNum(row.score, 0) / 100, 0.1, 1.6);
    const ageSec = Math.max(0, (now - toNum(row.timestamp, now)) / 1000);
    const ageWeight = Math.exp(-ageSec / 240);
    const weight = baseWeight * ageWeight;
    return {
      ...row,
      dir,
      weight,
      signedWeight: dir * weight
    };
  });

  const directionalRows = weighted.filter((row) => row.dir !== 0);
  const totalAbs = directionalRows.reduce((sum, row) => sum + Math.abs(row.weight), 0);
  const net = directionalRows.reduce((sum, row) => sum + row.signedWeight, 0);
  const consensus = totalAbs > 0 ? net / totalAbs : 0;
  const bullishWeight = directionalRows.filter((row) => row.dir > 0).reduce((sum, row) => sum + row.weight, 0);
  const bearishWeight = directionalRows.filter((row) => row.dir < 0).reduce((sum, row) => sum + row.weight, 0);
  const top = [...directionalRows].sort((a, b) => Math.abs(b.signedWeight) - Math.abs(a.signedWeight))[0] || null;
  const spreadPenalty = clamp((latestSpread - 15) / 7, 0, 7);
  const spreadGuard = latestSpread > 48;

  if (spreadGuard) {
    return {
      action: 'hold',
      score: consensus * 8 - spreadPenalty * 1.5,
      stance: 'neutral',
      reason: `signal guard blocked by spread ${latestSpread.toFixed(2)} bps`,
      signalCount: directionalRows.length,
      triggerKind: 'signal'
    };
  }

  if (strategyId === 'signal-single') {
    const topStrength = top ? Math.abs(top.signedWeight) : 0;
    const action = !top || topStrength < 0.28 ? 'hold' : top.dir > 0 ? 'accumulate' : 'reduce';
    const score = (top ? top.dir * topStrength * 9 : 0) + consensus * 3.6 - spreadPenalty;
    return {
      action,
      score,
      stance: score > 1.4 ? 'bullish' : score < -1.4 ? 'bearish' : 'neutral',
      reason: top
        ? `top signal ${top.type} ${top.severity} ${top.dir > 0 ? 'bullish' : 'bearish'} on ${top.symbol}`
        : 'No directional signal available',
      signalCount: directionalRows.length,
      triggerKind: 'signal'
    };
  }

  if (strategyId === 'signal-cluster') {
    const highConfidenceBull = directionalRows.filter((row) => row.dir > 0 && (row.severity === 'high' || row.severity === 'medium')).length;
    const highConfidenceBear = directionalRows.filter((row) => row.dir < 0 && (row.severity === 'high' || row.severity === 'medium')).length;
    const clusterDelta = bullishWeight - bearishWeight;
    const action =
      highConfidenceBull >= 2 && clusterDelta > 0.35
        ? 'accumulate'
        : highConfidenceBear >= 2 && clusterDelta < -0.35
          ? 'reduce'
          : 'hold';
    const score = clusterDelta * 8.2 + (highConfidenceBull - highConfidenceBear) * 1.5 - spreadPenalty;
    return {
      action,
      score,
      stance: score > 1.8 ? 'bullish' : score < -1.8 ? 'bearish' : 'neutral',
      reason: `cluster bull ${highConfidenceBull} / bear ${highConfidenceBear}, weighted delta ${clusterDelta.toFixed(2)}`,
      signalCount: directionalRows.length,
      triggerKind: 'signal'
    };
  }

  const action = consensus > 0.24 ? 'accumulate' : consensus < -0.24 ? 'reduce' : 'hold';
  const score = consensus * 11.4 + (directionalRows.length >= 3 ? 1.1 : 0) - spreadPenalty * 1.1;
  return {
    action,
    score,
    stance: score > 1.4 ? 'bullish' : score < -1.4 ? 'bearish' : 'neutral',
    reason: `consensus ${consensus.toFixed(2)} from ${directionalRows.length} directional signals`,
    signalCount: directionalRows.length,
    triggerKind: 'signal'
  };
};

export const evaluateStrategy = ({ strategyId, series = [], signalRows = [], selectedMarket = null }) => {
  if (SIGNAL_STRATEGIES.has(strategyId)) {
    return evaluateSignalStrategy({
      strategyId,
      series,
      signalRows,
      selectedMarket
    });
  }
  return evaluatePriceStrategy({ strategyId, series, selectedMarket });
};

export const executeWalletAction = ({
  wallet,
  action,
  point,
  timestamp,
  reason,
  score,
  maxAbsUnits = 10,
  cooldownMs = 0,
  slippageBps = 1.2
}) => {
  if (!wallet || !point) return { wallet, trade: null };

  const now = Math.max(0, toNum(timestamp, Date.now()));
  if (action === 'hold') {
    return { wallet: markWallet(wallet, point.price), trade: null };
  }

  if (cooldownMs > 0 && now - toNum(wallet.lastActionAt, 0) < cooldownMs) {
    return { wallet: markWallet(wallet, point.price), trade: null };
  }

  const direction = action === 'accumulate' ? 1 : -1;
  const unitsBefore = toNum(wallet.units, 0);
  const markPrice = Math.max(toNum(point.price, 0), 1e-9);
  const side = direction > 0 ? 'buy' : 'sell';
  const initialQuote = resolveFillPriceFromBook({
    side,
    quantity: 1,
    markPrice,
    bid: point?.bid,
    ask: point?.ask,
    depth: point?.depth || null,
    slippageBps
  });
  let fillPrice = Math.max(toNum(initialQuote.fillPrice, markPrice), 1e-9);
  let spreadBps = Math.max(0, toNum(initialQuote.spreadBps, point?.spread));
  const cashBefore = toNum(wallet.cash, 0);
  const maxUnits = Math.max(1e-6, toNum(maxAbsUnits, 10));
  const minTradableUnits = Math.max(1e-6, Math.min(1, 1 / Math.max(markPrice, 1)));

  let unitsStep = 1;

  if (direction > 0) {
    const affordableUnits = cashBefore / Math.max(fillPrice, 1e-9);
    unitsStep = Math.min(unitsStep, affordableUnits);
    if (unitsBefore >= 0) {
      unitsStep = Math.min(unitsStep, Math.max(0, maxUnits - unitsBefore));
    } else {
      // If a legacy short exists, close first before allowing a new long.
      unitsStep = Math.min(unitsStep, Math.abs(unitsBefore));
    }
  } else {
    // No naked shorting in paper wallet: only reduce existing long units.
    if (unitsBefore <= minTradableUnits) {
      return { wallet: markWallet({ ...wallet, lastActionAt: now }, point.price), trade: null };
    }
    unitsStep = Math.min(unitsStep, Math.abs(unitsBefore));
  }

  if (!Number.isFinite(unitsStep) || unitsStep < minTradableUnits) {
    return { wallet: markWallet({ ...wallet, lastActionAt: now }, point.price), trade: null };
  }

  let unitsDelta = direction * unitsStep;
  let tradeQuote = resolveFillPriceFromBook({
    side,
    quantity: Math.abs(unitsDelta),
    markPrice,
    bid: point?.bid,
    ask: point?.ask,
    depth: point?.depth || null,
    slippageBps
  });
  fillPrice = Math.max(toNum(tradeQuote.fillPrice, fillPrice), 1e-9);
  spreadBps = Math.max(0, toNum(tradeQuote.spreadBps, spreadBps));

  if (direction > 0 && cashBefore + 1e-9 < Math.abs(unitsDelta) * fillPrice) {
    unitsStep = cashBefore / Math.max(fillPrice, 1e-9);
    if (!Number.isFinite(unitsStep) || unitsStep < minTradableUnits) {
      return { wallet: markWallet({ ...wallet, lastActionAt: now }, point.price), trade: null };
    }
    unitsDelta = direction * unitsStep;
    tradeQuote = resolveFillPriceFromBook({
      side,
      quantity: Math.abs(unitsDelta),
      markPrice,
      bid: point?.bid,
      ask: point?.ask,
      depth: point?.depth || null,
      slippageBps
    });
    fillPrice = Math.max(toNum(tradeQuote.fillPrice, fillPrice), 1e-9);
    spreadBps = Math.max(0, toNum(tradeQuote.spreadBps, spreadBps));
  }

  const unitsAfter = unitsBefore + unitsDelta;
  const rawCashAfter = cashBefore - unitsDelta * fillPrice;
  const cashAfter = Math.abs(rawCashAfter) <= 1e-9 ? 0 : rawCashAfter;

  let avgEntryAfter = wallet.avgEntry === null ? null : toNum(wallet.avgEntry, null);
  let realizedDelta = 0;
  let closedQty = 0;

  if (unitsBefore > 0 && unitsDelta < 0 && avgEntryAfter !== null) {
    closedQty = Math.min(Math.abs(unitsDelta), Math.abs(unitsBefore));
    realizedDelta += (fillPrice - avgEntryAfter) * closedQty;
  }
  if (unitsBefore < 0 && unitsDelta > 0 && avgEntryAfter !== null) {
    closedQty = Math.min(Math.abs(unitsDelta), Math.abs(unitsBefore));
    realizedDelta += (avgEntryAfter - fillPrice) * closedQty;
  }

  if (Math.abs(unitsAfter) <= 1e-9) {
    avgEntryAfter = null;
  } else if (unitsBefore === 0) {
    avgEntryAfter = fillPrice;
  } else if (Math.sign(unitsBefore) === Math.sign(unitsDelta)) {
    const previousUnits = Math.abs(unitsBefore);
    const nextUnits = Math.abs(unitsAfter);
    avgEntryAfter = (previousUnits * (avgEntryAfter || fillPrice) + Math.abs(unitsDelta) * fillPrice) / Math.max(nextUnits, 1e-9);
  }

  const tradeCount = toNum(wallet.tradeCount, 0) + (closedQty > 0 ? 1 : 0);
  const winCount = toNum(wallet.winCount, 0) + (closedQty > 0 && realizedDelta > 0 ? 1 : 0);
  const lossCount = toNum(wallet.lossCount, 0) + (closedQty > 0 && realizedDelta <= 0 ? 1 : 0);

  const nextWallet = markWallet(
    {
      ...wallet,
      cash: cashAfter,
      units: unitsAfter,
      avgEntry: avgEntryAfter,
      realizedPnl: toNum(wallet.realizedPnl, 0) + realizedDelta,
      tradeCount,
      winCount,
      lossCount,
      lastActionAt: now
    },
    markPrice
  );

  return {
    wallet: nextWallet,
    trade: {
      id: `trade:${now}:${Math.round(fillPrice * 1000)}:${Math.round(Math.abs(unitsDelta) * 1000000)}`,
      timestamp: now,
      action,
      unitsDelta,
      unitsAfter,
      fillPrice,
      markPrice,
      spreadBps,
      realizedDelta,
      score: toNum(score, 0),
      reason: reason || ''
    }
  };
};

export const runBacktest = ({
  series = [],
  strategyId = 'tensor-lite',
  signalRows = [],
  selectedMarket = null,
  startCash = DEFAULT_WALLET_CASH,
  maxAbsUnits = 10,
  slippageBps = 1.2
}) => {
  if (!Array.isArray(series) || series.length < 3) {
    return {
      stats: {
        startCash,
        endEquity: startCash,
        pnl: 0,
        returnPct: 0,
        maxDrawdownPct: 0,
        tradeCount: 0,
        winRatePct: 0
      },
      equitySeries: [],
      tradeLog: [],
      signalLog: []
    };
  }

  let wallet = createWalletState(startCash);
  const equitySeries = [];
  const tradeLog = [];
  const signalLog = [];

  for (let index = 1; index < series.length; index += 1) {
    const point = series[index];
    const subset = series.slice(0, index + 1);
    const syntheticRows = buildSyntheticSignalRows({
      series: subset,
      selectedMarket,
      now: toNum(point.t, Date.now())
    });
    const activeSignalRows = SIGNAL_STRATEGIES.has(strategyId) ? [...alignSignalsToMarket({ signalRows, selectedMarket }), ...syntheticRows] : [];
    const signal = evaluateStrategy({
      strategyId,
      series: subset,
      signalRows: activeSignalRows,
      selectedMarket
    });
    signalLog.push({
      id: `signal:${toNum(point.t, index)}:${index}`,
      timestamp: toNum(point.t, Date.now()),
      action: signal.action,
      stance: signal.stance,
      score: signal.score,
      reason: signal.reason,
      price: toNum(point.price, 0),
      signalCount: toNum(signal.signalCount, 0),
      triggerKind: signal.triggerKind || 'price'
    });

    const execution = executeWalletAction({
      wallet,
      action: signal.action,
      point,
      timestamp: point.t,
      reason: signal.reason,
      score: signal.score,
      maxAbsUnits,
      cooldownMs: 0,
      slippageBps
    });
    wallet = execution.wallet;
    if (execution.trade) {
      tradeLog.push(execution.trade);
    }
    equitySeries.push(wallet.equity);
  }

  const endEquity = equitySeries[equitySeries.length - 1] || startCash;
  const pnl = endEquity - startCash;
  const returnPct = (pnl / Math.max(startCash, 1e-9)) * 100;
  const tradeCount = wallet.tradeCount;
  const winRatePct = tradeCount > 0 ? (wallet.winCount / tradeCount) * 100 : 0;

  return {
    stats: {
      startCash,
      endEquity,
      pnl,
      returnPct,
      maxDrawdownPct: maxDrawdownPct(equitySeries),
      tradeCount,
      winRatePct
    },
    equitySeries,
    tradeLog: tradeLog.slice(-240).reverse(),
    signalLog: signalLog.slice(-240).reverse()
  };
};

export const buildScenarioSeries = ({
  scenarioId = 'trend-rally',
  basePrice = 100,
  length = 300,
  now = Date.now(),
  symbol = 'SIM'
}) => {
  const safeLength = Math.max(32, Math.min(720, toNum(length, 300)));
  const base = Math.max(toNum(basePrice, 100), 0.0001);
  const rng = createRng(`${scenarioId}:${symbol}:${base.toFixed(4)}:${safeLength}`);
  const startAt = now - safeLength * 1000;
  const points = [];
  let price = base;

  for (let index = 0; index < safeLength; index += 1) {
    const t = startAt + index * 1000;
    const phase = index / Math.max(safeLength - 1, 1);
    const wave = Math.sin(index / 8) * 0.0017 + Math.cos(index / 14) * 0.0011;
    const noise = randBetween(rng, -0.0013, 0.0013);

    if (scenarioId === 'trend-rally') {
      const drift = 0.0007 + phase * 0.0006;
      price *= 1 + drift + wave + noise;
    } else if (scenarioId === 'mean-revert') {
      const anchor = base * (1 + Math.sin(index / 10) * 0.009);
      const pull = (anchor - price) / Math.max(anchor, 1e-9);
      price *= 1 + pull * 0.35 + wave * 0.55 + noise;
    } else if (scenarioId === 'shock-recovery') {
      const shock = phase > 0.24 && phase < 0.31 ? -0.014 : phase > 0.31 && phase < 0.65 ? 0.0018 : 0.00025;
      price *= 1 + shock + wave * 0.42 + noise * 0.9;
    } else {
      price *= 1 + wave * 0.82 + noise * 1.1;
    }

    price = Math.max(price, base * 0.08);
    const spreadBps = clamp(8 + Math.abs(Math.sin(index / 9)) * 10 + randBetween(rng, -1.7, 1.9), 0.6, 120);
    const volume = Math.max(base * randBetween(rng, 240, 1100), 1);
    points.push({
      t,
      price,
      spread: spreadBps,
      volume
    });
  }

  return points;
};
