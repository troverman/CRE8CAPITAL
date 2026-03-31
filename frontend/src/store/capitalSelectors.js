const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toTs = (value) => Math.max(0, Math.round(toNum(value, 0)));

const withinRange = (ts, from, to) => ts >= from && ts <= to;

export const selectMarketById = (state, marketId) => {
  const id = String(marketId || '').trim();
  if (!id) return null;
  return state?.entities?.marketsById?.[id] || null;
};

export const selectProviderById = (state, providerId) => {
  const id = String(providerId || '').trim();
  if (!id) return null;
  return state?.entities?.providersById?.[id] || null;
};

export const selectWalletById = (state, walletId) => {
  const id = String(walletId || '').trim();
  if (!id) return null;
  return state?.entities?.walletsById?.[id] || null;
};

export const selectMarketProviders = (state, marketId) => {
  const id = String(marketId || '').trim();
  if (!id) return [];
  const providerIds = state?.links?.marketProviderIds?.[id] || [];
  const providersById = state?.entities?.providersById || {};
  return providerIds.map((providerId) => providersById[providerId]).filter((row) => Boolean(row));
};

export const selectMarketTicks = (state, marketId, { from = 0, to = Number.MAX_SAFE_INTEGER, limit = 480, providerId = '' } = {}) => {
  const id = String(marketId || '').trim();
  if (!id) return [];
  const rows = state?.series?.marketTicksById?.[id] || [];
  const fromTs = toTs(from);
  const toTsValue = toNum(to, Number.MAX_SAFE_INTEGER);
  const provider = String(providerId || '').trim();
  const filtered = rows.filter((row) => {
    const ts = toTs(row?.t || row?.timestamp || 0);
    if (!withinRange(ts, fromTs, toTsValue)) return false;
    if (provider && String(row?.providerId || '') !== provider) return false;
    return true;
  });
  if (filtered.length <= limit) return filtered;
  return filtered.slice(filtered.length - limit);
};

export const selectMarketDepth = (state, marketId, { from = 0, to = Number.MAX_SAFE_INTEGER, limit = 120 } = {}) => {
  const id = String(marketId || '').trim();
  if (!id) return [];
  const rows = state?.series?.marketDepthById?.[id] || [];
  const fromTs = toTs(from);
  const toTsValue = toNum(to, Number.MAX_SAFE_INTEGER);
  const filtered = rows.filter((row) => withinRange(toTs(row?.t || row?.timestamp || 0), fromTs, toTsValue));
  if (filtered.length <= limit) return filtered;
  return filtered.slice(filtered.length - limit);
};

export const selectTensorSlices = (state, marketId, { from = 0, to = Number.MAX_SAFE_INTEGER, limit = 240 } = {}) => {
  const id = String(marketId || '').trim();
  if (!id) return [];
  const rows = state?.series?.marketTensorById?.[id] || [];
  const fromTs = toTs(from);
  const toTsValue = toNum(to, Number.MAX_SAFE_INTEGER);
  const filtered = rows.filter((row) => withinRange(toTs(row?.t || row?.timestamp || 0), fromTs, toTsValue));
  if (filtered.length <= limit) return filtered;
  return filtered.slice(filtered.length - limit);
};

export const selectMarketImageSlices = (state, marketId, { from = 0, to = Number.MAX_SAFE_INTEGER, limit = 180 } = {}) => {
  const id = String(marketId || '').trim();
  if (!id) return [];
  const rows = state?.series?.marketImageById?.[id] || [];
  const fromTs = toTs(from);
  const toTsValue = toNum(to, Number.MAX_SAFE_INTEGER);
  const filtered = rows.filter((row) => withinRange(toTs(row?.t || row?.timestamp || 0), fromTs, toTsValue));
  if (filtered.length <= limit) return filtered;
  return filtered.slice(filtered.length - limit);
};

export const selectWalletTx = (state, walletId, { from = 0, to = Number.MAX_SAFE_INTEGER, limit = 240 } = {}) => {
  const id = String(walletId || '').trim();
  if (!id) return [];
  const rows = state?.series?.walletTxById?.[id] || [];
  const fromTs = toTs(from);
  const toTsValue = toNum(to, Number.MAX_SAFE_INTEGER);
  const filtered = rows.filter((row) => withinRange(toTs(row?.timestamp || 0), fromTs, toTsValue));
  const sorted = [...filtered].sort((a, b) => toTs(b?.timestamp || 0) - toTs(a?.timestamp || 0));
  if (sorted.length <= limit) return sorted;
  return sorted.slice(0, limit);
};

export const selectWalletPositions = (state, walletId, { from = 0, to = Number.MAX_SAFE_INTEGER, limit = 240 } = {}) => {
  const id = String(walletId || '').trim();
  if (!id) return [];
  const rows = state?.series?.walletPositionById?.[id] || [];
  const fromTs = toTs(from);
  const toTsValue = toNum(to, Number.MAX_SAFE_INTEGER);
  const filtered = rows.filter((row) => withinRange(toTs(row?.timestamp || 0), fromTs, toTsValue));
  const sorted = [...filtered].sort((a, b) => toTs(b?.timestamp || 0) - toTs(a?.timestamp || 0));
  if (sorted.length <= limit) return sorted;
  return sorted.slice(0, limit);
};

