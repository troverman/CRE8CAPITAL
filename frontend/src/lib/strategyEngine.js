const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const toNum = (value, fallback = 0) => {
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

const sma = (values, length) => {
  if (!Array.isArray(values) || values.length === 0) return null;
  const n = Math.max(1, Math.min(length, values.length));
  let sum = 0;
  for (let i = values.length - n; i < values.length; i += 1) {
    sum += values[i];
  }
  return sum / n;
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
  { id: 'tensor-lite', label: 'Tensor Lite' },
  { id: 'momentum', label: 'Momentum' },
  { id: 'mean-reversion', label: 'Mean Reversion' },
  { id: 'breakout', label: 'Breakout' },
  { id: 'signal-single', label: 'Signal Single' },
  { id: 'signal-consensus', label: 'Signal Consensus' },
  { id: 'signal-cluster', label: 'Signal Cluster' }
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

const evaluatePriceStrategy = ({ strategyId, series = [] }) => {
  if (!Array.isArray(series) || series.length < 2) {
    return {
      action: 'hold',
      score: 0,
      stance: 'neutral',
      reason: 'Waiting for enough data',
      signalCount: 0,
      triggerKind: 'price'
    };
  }

  const prices = series.map((point) => Math.max(toNum(point.price, 0), 1e-9));
  const latest = prices[prices.length - 1];
  const latestSpread = Math.max(0, toNum(series[series.length - 1]?.spread, 0));
  const prev = prices[prices.length - 2];
  const short = sma(prices, 8);
  const long = sma(prices, 21);
  const lookback = prices[Math.max(0, prices.length - 12)];
  const momentumPct = ((latest - lookback) / Math.max(lookback, 1e-9)) * 100;
  const trendBps = short !== null && long !== null ? ((short - long) / Math.max(latest, 1e-9)) * 10000 : 0;
  const spreadPenalty = clamp((latestSpread - 10) / 8, 0, 6);

  if (strategyId === 'mean-reversion') {
    const window = prices.slice(-20);
    const mean = sma(prices, 20) || latest;
    const sigma = Math.max(stddev(window), mean * 0.0001);
    const z = (latest - mean) / sigma;
    const score = -z * 8 - spreadPenalty;
    const action = z <= -1.1 && latestSpread < 48 ? 'accumulate' : z >= 1.1 && latestSpread < 48 ? 'reduce' : 'hold';
    return {
      action,
      score,
      stance: score > 1.2 ? 'bullish' : score < -1.2 ? 'bearish' : 'neutral',
      reason: `z-score ${z.toFixed(2)} around 20-bar mean, spread ${latestSpread.toFixed(2)} bps`,
      signalCount: 0,
      triggerKind: 'price'
    };
  }

  if (strategyId === 'breakout') {
    const high = rollingHigh(prices.slice(0, prices.length - 1), 20) || latest;
    const low = rollingLow(prices.slice(0, prices.length - 1), 20) || latest;
    const breakUp = latest > high * 1.0008;
    const breakDown = latest < low * 0.9992;
    const score = ((latest - prev) / Math.max(latest, 1e-9)) * 10000 + trendBps * 0.3 - spreadPenalty * 1.2;
    const action = breakUp && latestSpread < 44 ? 'accumulate' : breakDown && latestSpread < 44 ? 'reduce' : 'hold';
    return {
      action,
      score,
      stance: action === 'accumulate' ? 'bullish' : action === 'reduce' ? 'bearish' : 'neutral',
      reason: `breakout window hi ${high.toFixed(4)} / lo ${low.toFixed(4)}, spread ${latestSpread.toFixed(2)} bps`,
      signalCount: 0,
      triggerKind: 'price'
    };
  }

  if (strategyId === 'momentum') {
    const score = trendBps * 0.56 + momentumPct * 9.3 - spreadPenalty * 1.35;
    const action = score >= 5.8 && latestSpread < 42 ? 'accumulate' : score <= -5.8 && latestSpread < 42 ? 'reduce' : 'hold';
    return {
      action,
      score,
      stance: score > 2 ? 'bullish' : score < -2 ? 'bearish' : 'neutral',
      reason: `momentum ${momentumPct.toFixed(2)}%, trend ${trendBps.toFixed(2)} bps, spread ${latestSpread.toFixed(2)} bps`,
      signalCount: 0,
      triggerKind: 'price'
    };
  }

  const confidenceBoost = clamp(Math.abs(trendBps) / 22, 0, 3.4);
  const score = trendBps * 0.62 + momentumPct * 8.6 + confidenceBoost - spreadPenalty * 1.45;
  const action = score >= 5.2 && latestSpread < 40 ? 'accumulate' : score <= -5.2 && latestSpread < 40 ? 'reduce' : 'hold';
  return {
    action,
    score,
    stance: score > 2 ? 'bullish' : score < -2 ? 'bearish' : 'neutral',
    reason: `tensor-lite drift ${trendBps.toFixed(2)} bps, momentum ${momentumPct.toFixed(2)}%, spread ${latestSpread.toFixed(2)} bps`,
    signalCount: 0,
    triggerKind: 'price'
  };
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
  return evaluatePriceStrategy({ strategyId, series });
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
  if (Math.abs(unitsBefore + direction) > Math.max(1, toNum(maxAbsUnits, 10))) {
    return { wallet: markWallet({ ...wallet, lastActionAt: now }, point.price), trade: null };
  }

  const markPrice = Math.max(toNum(point.price, 0), 1e-9);
  const spreadBps = Math.max(0, toNum(point.spread, 0));
  const impactBps = spreadBps / 2 + Math.max(0, toNum(slippageBps, 0));
  const fillPrice = markPrice * (1 + direction * (impactBps / 10000));
  const unitsAfter = unitsBefore + direction;
  const cashAfter = toNum(wallet.cash, 0) - direction * fillPrice;

  let avgEntryAfter = wallet.avgEntry === null ? null : toNum(wallet.avgEntry, null);
  let realizedDelta = 0;
  let closedQty = 0;

  if (unitsBefore > 0 && direction < 0 && avgEntryAfter !== null) {
    closedQty = Math.min(Math.abs(direction), Math.abs(unitsBefore));
    realizedDelta += (fillPrice - avgEntryAfter) * closedQty;
  }
  if (unitsBefore < 0 && direction > 0 && avgEntryAfter !== null) {
    closedQty = Math.min(Math.abs(direction), Math.abs(unitsBefore));
    realizedDelta += (avgEntryAfter - fillPrice) * closedQty;
  }

  if (unitsAfter === 0) {
    avgEntryAfter = null;
  } else if (unitsBefore === 0) {
    avgEntryAfter = fillPrice;
  } else if (Math.sign(unitsBefore) === Math.sign(direction)) {
    const previousUnits = Math.abs(unitsBefore);
    const nextUnits = Math.abs(unitsAfter);
    avgEntryAfter = (previousUnits * (avgEntryAfter || fillPrice) + Math.abs(direction) * fillPrice) / Math.max(nextUnits, 1);
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
      id: `trade:${now}:${Math.round(fillPrice * 1000)}`,
      timestamp: now,
      action,
      unitsDelta: direction,
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
