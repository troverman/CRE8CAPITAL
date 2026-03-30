import { toStrategyKey } from './strategyView';

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toPct = (value) => {
  const num = toNum(value, 0);
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
};

const normalizeSeverity = (value) => {
  const raw = String(value || '').toLowerCase();
  if (raw === 'high' || raw === 'medium') return raw;
  return 'low';
};

const SIGNAL_DECISION_MATCH_WINDOW_MS = 15 * 60 * 1000;
const SIGNAL_DECISION_MATCH_OUTER_MS = 45 * 60 * 1000;

const toIdentity = (symbol, assetClass) => `${String(symbol || '').toUpperCase()}|${String(assetClass || '').toLowerCase()}`;

const normalizeText = (value) => String(value || '').toLowerCase();

const buildStrategyMetaMap = (snapshot) => {
  const map = new Map();
  const rows = Array.isArray(snapshot?.strategies) ? snapshot.strategies : [];
  for (const row of rows) {
    const key = toStrategyKey(row?.id || row?.name);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        id: String(row?.id || row?.name || key),
        name: String(row?.name || row?.id || key)
      });
    }
  }
  return map;
};

const buildDecisionIdentityMap = (snapshot) => {
  const map = new Map();
  const decisions = Array.isArray(snapshot?.decisions) ? snapshot.decisions : [];
  for (const decision of decisions) {
    const identity = toIdentity(decision?.symbol, decision?.assetClass);
    if (!map.has(identity)) {
      map.set(identity, []);
    }
    map.get(identity).push(decision);
  }
  for (const value of map.values()) {
    value.sort((a, b) => toNum(b?.timestamp, 0) - toNum(a?.timestamp, 0));
  }
  return map;
};

const scoreDecisionMatch = (signal, decision) => {
  const signalTs = toNum(signal?.timestamp, 0);
  const decisionTs = toNum(decision?.timestamp, 0);
  const delta = Math.abs(signalTs - decisionTs);
  const triggerText = normalizeText(decision?.trigger);
  const reasonText = normalizeText(decision?.reason);
  const signalId = normalizeText(signal?.id);
  const signalType = normalizeText(signal?.type);

  let score = 0;
  if (delta <= SIGNAL_DECISION_MATCH_WINDOW_MS) score += 3;
  else if (delta <= SIGNAL_DECISION_MATCH_OUTER_MS) score += 1;

  if (signalId && (triggerText.includes(signalId) || reasonText.includes(signalId))) score += 5;
  if (signalType && (triggerText.includes(signalType) || reasonText.includes(signalType))) score += 1;

  return {
    score,
    timestamp: decisionTs
  };
};

export const buildFallbackSignals = (markets = [], limit = 80) => {
  return [...(markets || [])]
    .filter((market) => Boolean(market?.key))
    .sort((a, b) => Math.abs(toNum(b.changePct)) - Math.abs(toNum(a.changePct)))
    .slice(0, Math.max(1, limit))
    .map((market, index) => {
      const changePct = toNum(market.changePct, 0);
      const absMove = Math.abs(changePct);
      return {
        id: `fallback-signal:${market.key}:${index}`,
        type: 'fallback-pulse',
        direction: changePct >= 0 ? 'long' : 'short',
        severity: absMove > 0.9 ? 'high' : absMove > 0.35 ? 'medium' : 'low',
        score: Math.max(8, Math.min(99, Math.round(absMove * 90))),
        symbol: market.symbol,
        assetClass: market.assetClass,
        message: `Fallback signal: ${market.symbol} drift ${toPct(changePct)} while waiting for runtime triggers.`,
        timestamp: market.updatedAt || Date.now()
      };
    });
};

export const getDisplaySignals = (snapshot, limit = 80) => {
  const liveSignals = Array.isArray(snapshot?.signals) ? snapshot.signals : [];
  if (liveSignals.length > 0) {
    return [...liveSignals]
      .sort((a, b) => toNum(b?.timestamp, 0) - toNum(a?.timestamp, 0))
      .slice(0, Math.max(1, limit))
      .map((signal, index) => ({
        id: signal?.id || `signal:${index}`,
        type: signal?.type || 'signal',
        direction: signal?.direction || 'neutral',
        severity: normalizeSeverity(signal?.severity),
        score: toNum(signal?.score, 0),
        symbol: signal?.symbol || '-',
        assetClass: signal?.assetClass || 'unknown',
        message: signal?.message || '',
        timestamp: signal?.timestamp || Date.now()
      }));
  }
  return buildFallbackSignals(snapshot?.markets || [], limit);
};

export const findDisplaySignalById = (snapshot, signalId, limit = 220) => {
  const wanted = String(signalId || '');
  return getDisplaySignals(snapshot, limit).find((signal) => String(signal.id) === wanted) || null;
};

const collectSignalLinkedStrategies = ({ signal, decisionMap, strategyMetaMap, limit = 8 }) => {
  const identity = toIdentity(signal.symbol, signal.assetClass);
  const decisions = decisionMap.get(identity) || [];
  const byStrategyKey = new Map();
  for (const decision of decisions) {
    const strategyIdRaw = String(decision?.strategyName || decision?.strategy || '').trim();
    if (!strategyIdRaw) continue;
    const strategyKey = toStrategyKey(strategyIdRaw);
    if (!strategyKey) continue;

    const match = scoreDecisionMatch(signal, decision);
    if (match.score <= 0) continue;

    const existing = byStrategyKey.get(strategyKey) || {
      strategyKey,
      strategyId: strategyMetaMap.get(strategyKey)?.id || strategyIdRaw,
      strategyName: strategyMetaMap.get(strategyKey)?.name || strategyIdRaw,
      decisionCount: 0,
      lastDecisionAt: 0,
      lastAction: 'hold',
      linkScore: 0
    };

    existing.decisionCount += 1;
    existing.linkScore += match.score;
    if (match.timestamp >= existing.lastDecisionAt) {
      existing.lastDecisionAt = match.timestamp;
      existing.lastAction = String(decision?.action || 'hold');
    }
    byStrategyKey.set(strategyKey, existing);
  }

  return [...byStrategyKey.values()]
    .sort((a, b) => {
      if (b.linkScore !== a.linkScore) return b.linkScore - a.linkScore;
      if (b.decisionCount !== a.decisionCount) return b.decisionCount - a.decisionCount;
      return b.lastDecisionAt - a.lastDecisionAt;
    })
    .slice(0, Math.max(1, toNum(limit, 8)));
};

export const getSignalLinkedStrategies = (snapshot, signal, limit = 8) => {
  if (!signal || typeof signal !== 'object') return [];
  return collectSignalLinkedStrategies({
    signal,
    decisionMap: buildDecisionIdentityMap(snapshot),
    strategyMetaMap: buildStrategyMetaMap(snapshot),
    limit
  });
};

export const buildSignalStrategyIndex = (snapshot, signals = [], limit = 4) => {
  const index = new Map();
  const signalRows = Array.isArray(signals) ? signals : [];
  const decisionMap = buildDecisionIdentityMap(snapshot);
  const strategyMetaMap = buildStrategyMetaMap(snapshot);
  for (const signal of signalRows) {
    const key = String(signal?.id || '');
    if (!key) continue;
    index.set(
      key,
      collectSignalLinkedStrategies({
        signal,
        decisionMap,
        strategyMetaMap,
        limit
      })
    );
  }
  return index;
};
