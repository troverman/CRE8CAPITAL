const toText = (value, fallback = '-') => {
  const text = String(value || '').trim();
  return text || fallback;
};

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toAction = (value) => String(value || 'hold').toLowerCase();

export const normalizeSnapshotDecisions = (rows = []) => {
  return (Array.isArray(rows) ? rows : [])
    .map((decision, index) => ({
      id: toText(decision?.id, `decision:${index}`),
      strategyName: toText(decision?.strategyName || decision?.strategy, 'unknown'),
      action: toAction(decision?.action),
      reason: toText(decision?.reason, 'No reason provided'),
      trigger: toText(decision?.trigger),
      score: toNum(decision?.score, 0),
      symbol: toText(decision?.symbol),
      assetClass: toText(decision?.assetClass, 'unknown'),
      timestamp: toNum(decision?.timestamp, 0),
      accountId: toText(decision?.accountId || decision?.walletAccountId || decision?.walletId || decision?.account?.id || ''),
      accountName: toText(decision?.accountName || decision?.walletName || decision?.account?.name || ''),
      source: 'snapshot'
    }))
    .filter((decision) => Boolean(decision.id));
};

export const normalizeRuntimeDecisionEvents = (rows = []) => {
  return (Array.isArray(rows) ? rows : [])
    .map((event, index) => ({
      id: toText(event?.id, `runtime:${index}`),
      strategyName: toText(event?.strategyId || event?.strategyName, 'unknown'),
      action: toAction(event?.action),
      reason: toText(event?.reason, 'No reason provided'),
      trigger: toText(event?.triggerKind || event?.trigger || 'runtime'),
      score: toNum(event?.score, 0),
      symbol: toText(event?.symbol || ''),
      assetClass: toText(event?.assetClass || 'unknown'),
      timestamp: toNum(event?.timestamp, 0),
      accountId: toText(event?.accountId || (Array.isArray(event?.tradedAccountIds) ? event.tradedAccountIds[0] : '') || ''),
      accountName: toText(event?.accountName || (Array.isArray(event?.tradedAccounts) ? event.tradedAccounts[0] : '') || ''),
      source: 'runtime'
    }))
    .filter((decision) => Boolean(decision.id));
};

export const buildDecisionRows = ({ snapshotDecisions = [], runtimeEvents = [] } = {}) => {
  const merged = [];
  const seen = new Set();

  for (const row of normalizeSnapshotDecisions(snapshotDecisions)) {
    const key = `snapshot:${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }

  for (const row of normalizeRuntimeDecisionEvents(runtimeEvents)) {
    const key = `runtime:${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      ...row,
      id: row.id.startsWith('runtime:') ? row.id : `runtime:${row.id}`
    });
  }

  return merged.sort((a, b) => b.timestamp - a.timestamp);
};
