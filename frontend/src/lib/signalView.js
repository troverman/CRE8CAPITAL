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
    return liveSignals
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
