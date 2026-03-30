import { STRATEGY_OPTIONS } from './strategyEngine';

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

export const toStrategyKey = (value) => String(value || '').trim().toLowerCase();

const ensureRow = (map, { key, id, name, description = '', enabled = null }) => {
  const existing = map.get(key) || {
    key,
    id: id || name || key,
    name: name || id || key,
    description: description || '',
    enabled,
    decisionCount: 0,
    scoreTotal: 0,
    lastDecisionAt: 0,
    lastAction: '-',
    triggerSet: new Set(),
    marketSet: new Set(),
    actions: {
      accumulate: 0,
      reduce: 0,
      hold: 0,
      other: 0
    }
  };
  if (enabled !== null) {
    existing.enabled = enabled;
  }
  if (description && !existing.description) {
    existing.description = description;
  }
  map.set(key, existing);
  return existing;
};

export const buildStrategyRows = (snapshot) => {
  const map = new Map();
  const strategies = Array.isArray(snapshot?.strategies) ? snapshot.strategies : [];
  const decisions = Array.isArray(snapshot?.decisions) ? snapshot.decisions : [];

  for (const strategy of STRATEGY_OPTIONS) {
    const id = strategy?.id || '';
    const key = toStrategyKey(id);
    if (!key) continue;
    ensureRow(map, {
      key,
      id,
      name: strategy?.label || id,
      description: strategy?.description || '',
      enabled: true
    });
  }

  for (const strategy of strategies) {
    const id = strategy?.id || strategy?.name || '';
    const key = toStrategyKey(id);
    if (!key) continue;
    ensureRow(map, {
      key,
      id,
      name: strategy?.name || strategy?.id || key,
      description: strategy?.description || '',
      enabled: typeof strategy?.enabled === 'boolean' ? strategy.enabled : null
    });
  }

  for (const decision of decisions) {
    const rawName = decision?.strategyName || decision?.strategy || '';
    const key = toStrategyKey(rawName);
    if (!key) continue;
    const row = ensureRow(map, {
      key,
      id: rawName || key,
      name: rawName || key
    });
    row.decisionCount += 1;
    row.scoreTotal += toNum(decision?.score, 0);
    const ts = toNum(decision?.timestamp, 0);
    if (ts >= row.lastDecisionAt) {
      row.lastDecisionAt = ts;
      row.lastAction = decision?.action || '-';
    }
    row.triggerSet.add(String(decision?.trigger || '-'));
    row.marketSet.add(`${String(decision?.symbol || '-').toUpperCase()}|${String(decision?.assetClass || 'unknown').toLowerCase()}`);

    const action = String(decision?.action || '').toLowerCase();
    if (action === 'accumulate') row.actions.accumulate += 1;
    else if (action === 'reduce') row.actions.reduce += 1;
    else if (action === 'hold') row.actions.hold += 1;
    else row.actions.other += 1;
  }

  return [...map.values()]
    .map((row) => ({
      ...row,
      avgScore: row.decisionCount > 0 ? row.scoreTotal / row.decisionCount : 0,
      triggerCount: row.triggerSet.size,
      marketCount: row.marketSet.size
    }))
    .sort((a, b) => {
      if (b.decisionCount !== a.decisionCount) return b.decisionCount - a.decisionCount;
      if (b.lastDecisionAt !== a.lastDecisionAt) return b.lastDecisionAt - a.lastDecisionAt;
      return b.avgScore - a.avgScore;
    });
};

export const findStrategyRow = (snapshot, strategyId) => {
  const key = toStrategyKey(strategyId);
  if (!key) return null;
  return buildStrategyRows(snapshot).find((row) => row.key === key) || null;
};

export const getStrategyDecisions = (snapshot, strategyId) => {
  const key = toStrategyKey(strategyId);
  const decisions = Array.isArray(snapshot?.decisions) ? snapshot.decisions : [];
  return decisions
    .filter((decision) => toStrategyKey(decision?.strategyName || decision?.strategy) === key)
    .sort((a, b) => toNum(b.timestamp, 0) - toNum(a.timestamp, 0));
};
