import { create } from 'zustand';

const MAX_MARKET_TICKS = 2400;
const MAX_MARKET_DEPTH = 420;
const MAX_MARKET_TENSOR = 960;
const MAX_MARKET_IMAGE = 720;
const MAX_WALLET_TX = 1200;
const MAX_WALLET_POSITIONS = 1200;
const MAX_LINK_IDS = 1200;

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toFiniteOrNull = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toTs = (value) => Math.max(0, Math.round(toNum(value, Date.now())));

const trimTail = (list, maxLength) => {
  if (list.length <= maxLength) return list;
  return list.slice(list.length - maxLength);
};

const trimHead = (list, maxLength) => {
  if (list.length <= maxLength) return list;
  return list.slice(0, maxLength);
};

const normalizeMarketId = (market) => {
  const key = String(market?.key || '').trim();
  if (key) return key;
  const assetClass = String(market?.assetClass || '').toLowerCase();
  const symbol = String(market?.symbol || '').toUpperCase();
  if (assetClass && symbol) return `${assetClass}:${symbol}`;
  return '';
};

const normalizeProviderId = (provider) => String(provider?.id || provider?.providerId || '').trim();
const normalizeWalletId = (wallet) => String(wallet?.id || wallet?.accountId || '').trim();

const appendLinkId = (map, key, id) => {
  if (!key || !id) return map;
  const prev = Array.isArray(map[key]) ? map[key] : [];
  if (prev[0] === id) return map;
  if (prev.includes(id)) {
    return {
      ...map,
      [key]: trimHead([id, ...prev.filter((item) => item !== id)], MAX_LINK_IDS)
    };
  }
  return {
    ...map,
    [key]: trimHead([id, ...prev], MAX_LINK_IDS)
  };
};

const appendSeriesPoint = ({ seriesMap, key, point, maxLength, equals }) => {
  if (!key || !point) return seriesMap;
  const prev = Array.isArray(seriesMap[key]) ? seriesMap[key] : [];
  const tail = prev[prev.length - 1];
  if (tail && typeof equals === 'function' && equals(tail, point)) return seriesMap;
  return {
    ...seriesMap,
    [key]: trimTail([...prev, point], maxLength)
  };
};

const withinRange = (rowTs, from, to) => {
  if (rowTs < from) return false;
  if (rowTs > to) return false;
  return true;
};

const stateTemplate = {
  schemaVersion: 1,
  meta: {
    activeMarketId: '',
    activeWalletId: '',
    updatedAt: 0
  },
  entities: {
    marketsById: {},
    providersById: {},
    walletsById: {}
  },
  links: {
    marketProviderIds: {},
    walletTxIds: {},
    walletPositionIds: {}
  },
  series: {
    marketTicksById: {},
    marketDepthById: {},
    marketTensorById: {},
    marketImageById: {},
    walletTxById: {},
    walletPositionById: {}
  }
};

export const useCapitalStore = create((set, get) => ({
  ...stateTemplate,

  hardResetCapitalState: () => set(() => ({ ...stateTemplate })),

  clearSocketSeries: () => set((state) => ({
    ...state,
    series: {
      ...state.series,
      marketTicksById: {},
      marketDepthById: {},
    }
  })),

  seedLocalHistory: (markets) => set((state) => {
    const nextTicks = { ...state.series.marketTicksById };
    for (const market of Array.isArray(markets) ? markets : []) {
      if (!market.key) continue;
      const base = Math.max(toNum(market.referencePrice, toNum(market.price, 100)), 0.00001);
      const ticks = [];
      const now = Date.now();
      for (let i = 30; i >= 0; i--) {
        const drift = (Math.random() - 0.5) * 0.008;
        const p = base * (1 + drift * (30 - i) / 10);
        ticks.push({
          id: `seed:${market.key}:${now - i * 3000}`,
          t: now - i * 3000,
          price: p,
          bid: p * 0.999,
          ask: p * 1.001,
          spread: toNum(market.spreadBps, 0),
          volume: Math.random() * 1000,
          providerId: 'synthetic.seed',
          providerName: 'Synthetic Seed',
          source: 'synthetic-seed'
        });
      }
      nextTicks[market.key] = ticks;
    }
    return { ...state, series: { ...state.series, marketTicksById: nextTicks } };
  }),

  setActiveRefs: ({ marketId, walletId } = {}) =>
    set((state) => ({
      ...state,
      meta: {
        ...state.meta,
        activeMarketId: typeof marketId === 'string' ? marketId : state.meta.activeMarketId,
        activeWalletId: typeof walletId === 'string' ? walletId : state.meta.activeWalletId,
        updatedAt: Date.now()
      }
    })),

  upsertMarkets: (markets = [], { appendSnapshotTick = true } = {}) =>
    set((state) => {
      let marketsById = state.entities.marketsById;
      let marketTicksById = state.series.marketTicksById;
      let touched = false;

      for (const market of Array.isArray(markets) ? markets : []) {
        const marketId = normalizeMarketId(market);
        if (!marketId) continue;
        const previous = marketsById[marketId] || {};
        const updatedAt = toTs(market?.updatedAt || market?.timestamp || Date.now());
        const next = {
          ...previous,
          id: marketId,
          key: market?.key || marketId,
          symbol: String(market?.symbol || previous.symbol || ''),
          assetClass: String(market?.assetClass || previous.assetClass || '').toLowerCase(),
          referencePrice: toFiniteOrNull(market?.referencePrice) ?? previous.referencePrice ?? null,
          bestBid: toFiniteOrNull(market?.bestBid) ?? previous.bestBid ?? null,
          bestAsk: toFiniteOrNull(market?.bestAsk) ?? previous.bestAsk ?? null,
          spreadBps: toFiniteOrNull(market?.spreadBps) ?? previous.spreadBps ?? null,
          totalVolume: toNum(market?.totalVolume, previous.totalVolume || 0),
          venueCount: toNum(market?.venueCount, previous.venueCount || 0),
          providerCount: toNum(market?.providerCount, previous.providerCount || 0),
          changePct: toNum(market?.changePct, previous.changePct || 0),
          updatedAt
        };
        if (next !== previous) {
          marketsById = {
            ...marketsById,
            [marketId]: next
          };
          touched = true;
        }

        if (appendSnapshotTick && Number.isFinite(next.referencePrice) && next.referencePrice > 0) {
          const snapshotPoint = {
            id: `runtime:${marketId}:${updatedAt}:${Math.round(next.referencePrice * 10000)}`,
            t: updatedAt,
            price: next.referencePrice,
            spread: toNum(next.spreadBps, 0),
            volume: toNum(next.totalVolume, 0),
            bid: toFiniteOrNull(next.bestBid),
            ask: toFiniteOrNull(next.bestAsk),
            providerId: 'runtime.snapshot',
            providerName: 'Runtime Snapshot',
            source: 'snapshot'
          };
          marketTicksById = appendSeriesPoint({
            seriesMap: marketTicksById,
            key: marketId,
            point: snapshotPoint,
            maxLength: MAX_MARKET_TICKS,
            equals: (a, b) => a.t === b.t && a.price === b.price && a.providerId === b.providerId
          });
          touched = true;
        }
      }

      if (!touched) return state;
      return {
        ...state,
        entities: {
          ...state.entities,
          marketsById
        },
        series: {
          ...state.series,
          marketTicksById
        },
        meta: {
          ...state.meta,
          updatedAt: Date.now()
        }
      };
    }),

  upsertProviders: (providers = []) =>
    set((state) => {
      let providersById = state.entities.providersById;
      let touched = false;
      for (const provider of Array.isArray(providers) ? providers : []) {
        const providerId = normalizeProviderId(provider);
        if (!providerId) continue;
        const previous = providersById[providerId] || {};
        const next = {
          ...previous,
          id: providerId,
          name: String(provider?.name || previous.name || providerId),
          kind: String(provider?.kind || previous.kind || ''),
          assetClass: String(provider?.assetClass || previous.assetClass || '').toLowerCase(),
          connected: Boolean(provider?.connected ?? previous.connected),
          error: String(provider?.error || previous.error || ''),
          price: toFiniteOrNull(provider?.price) ?? previous.price ?? null,
          bid: toFiniteOrNull(provider?.bid) ?? previous.bid ?? null,
          ask: toFiniteOrNull(provider?.ask) ?? previous.ask ?? null,
          volume: toFiniteOrNull(provider?.volume) ?? previous.volume ?? null,
          updatedAt: toTs(provider?.lastTickAt || provider?.timestamp || Date.now())
        };
        providersById = {
          ...providersById,
          [providerId]: next
        };
        touched = true;
      }
      if (!touched) return state;
      return {
        ...state,
        entities: {
          ...state.entities,
          providersById
        },
        meta: {
          ...state.meta,
          updatedAt: Date.now()
        }
      };
    }),

  ingestSocketSnapshot: (payload) =>
    set((state) => {
      const marketId = String(payload?.marketKey || '').trim();
      if (!marketId) return state;
      const providerStateById = payload?.providerStateById && typeof payload.providerStateById === 'object' ? payload.providerStateById : {};
      const seriesByProvider = payload?.seriesByProvider && typeof payload.seriesByProvider === 'object' ? payload.seriesByProvider : {};
      const depthByProvider = payload?.depthByProvider && typeof payload.depthByProvider === 'object' ? payload.depthByProvider : {};

      let providersById = state.entities.providersById;
      let marketProviderIds = state.links.marketProviderIds;
      let marketTicksById = state.series.marketTicksById;
      let marketDepthById = state.series.marketDepthById;
      let touched = false;

      for (const [providerIdRaw, providerState] of Object.entries(providerStateById)) {
        const providerId = String(providerIdRaw || '').trim();
        if (!providerId) continue;
        const previous = providersById[providerId] || {};
        providersById = {
          ...providersById,
          [providerId]: {
            ...previous,
            id: providerId,
            name: String(providerState?.name || previous.name || providerId),
            connected: Boolean(providerState?.connected),
            error: String(providerState?.error || ''),
            price: toFiniteOrNull(providerState?.price),
            bid: toFiniteOrNull(providerState?.bid),
            ask: toFiniteOrNull(providerState?.ask),
            volume: toFiniteOrNull(providerState?.volume),
            updatedAt: toTs(providerState?.lastTickAt || Date.now())
          }
        };
        marketProviderIds = appendLinkId(marketProviderIds, marketId, providerId);
        touched = true;
      }

      for (const [providerIdRaw, points] of Object.entries(seriesByProvider)) {
        const providerId = String(providerIdRaw || '').trim();
        if (!providerId) continue;
        let nextSeries = Array.isArray(marketTicksById[marketId]) ? [...marketTicksById[marketId]] : [];
        const safePoints = Array.isArray(points) ? points : [];
        for (const row of safePoints) {
          const t = toTs(row?.t || Date.now());
          const price = toFiniteOrNull(row?.price);
          if (price === null || price <= 0) continue;
          const point = {
            id: `socket:${marketId}:${providerId}:${t}:${Math.round(price * 10000)}`,
            t,
            price,
            spread: toNum(row?.spread, 0),
            volume: toNum(row?.volume, 0),
            bid: toFiniteOrNull(row?.bid),
            ask: toFiniteOrNull(row?.ask),
            providerId,
            providerName: providersById[providerId]?.name || providerId,
            source: 'socket'
          };
          const tail = nextSeries[nextSeries.length - 1];
          if (tail && tail.t === point.t && tail.price === point.price && tail.providerId === point.providerId) continue;
          nextSeries.push(point);
        }
        if (nextSeries.length > 0) {
          marketTicksById = {
            ...marketTicksById,
            [marketId]: trimTail(nextSeries, MAX_MARKET_TICKS)
          };
          marketProviderIds = appendLinkId(marketProviderIds, marketId, providerId);
          touched = true;
        }
      }

      for (const [providerIdRaw, depth] of Object.entries(depthByProvider)) {
        const providerId = String(providerIdRaw || '').trim();
        if (!providerId) continue;
        const bids = Array.isArray(depth?.bids) ? depth.bids : [];
        const asks = Array.isArray(depth?.asks) ? depth.asks : [];
        if (bids.length === 0 && asks.length === 0) continue;
        const t = toTs(depth?.timestamp || Date.now());
        const point = {
          id: `depth:${marketId}:${providerId}:${t}`,
          t,
          providerId,
          providerName: String(depth?.providerName || providersById[providerId]?.name || providerId),
          bids,
          asks,
          source: 'socket-depth'
        };
        marketDepthById = appendSeriesPoint({
          seriesMap: marketDepthById,
          key: marketId,
          point,
          maxLength: MAX_MARKET_DEPTH,
          equals: (a, b) => a.id === b.id
        });
        marketProviderIds = appendLinkId(marketProviderIds, marketId, providerId);
        touched = true;
      }

      if (!touched) return state;
      return {
        ...state,
        entities: {
          ...state.entities,
          providersById
        },
        links: {
          ...state.links,
          marketProviderIds
        },
        series: {
          ...state.series,
          marketTicksById,
          marketDepthById
        },
        meta: {
          ...state.meta,
          activeMarketId: marketId,
          updatedAt: Date.now()
        }
      };
    }),

  appendTensorSlice: ({ marketId, slice }) =>
    set((state) => {
      const key = String(marketId || '').trim();
      if (!key || !slice || typeof slice !== 'object') return state;
      const t = toTs(slice?.t || slice?.timestamp || Date.now());
      const point = {
        id: `tensor:${key}:${t}`,
        t,
        ...slice
      };
      const marketTensorById = appendSeriesPoint({
        seriesMap: state.series.marketTensorById,
        key,
        point,
        maxLength: MAX_MARKET_TENSOR,
        equals: (a, b) => a.id === b.id
      });
      return {
        ...state,
        series: {
          ...state.series,
          marketTensorById
        },
        meta: {
          ...state.meta,
          activeMarketId: key,
          updatedAt: Date.now()
        }
      };
    }),

  appendMarketImageSlice: ({ marketId, slice }) =>
    set((state) => {
      const key = String(marketId || '').trim();
      if (!key || !slice || typeof slice !== 'object') return state;
      const t = toTs(slice?.t || slice?.timestamp || Date.now());
      const point = {
        id: `image:${key}:${t}`,
        t,
        ...slice
      };
      const marketImageById = appendSeriesPoint({
        seriesMap: state.series.marketImageById,
        key,
        point,
        maxLength: MAX_MARKET_IMAGE,
        equals: (a, b) => a.id === b.id
      });
      return {
        ...state,
        series: {
          ...state.series,
          marketImageById
        },
        meta: {
          ...state.meta,
          activeMarketId: key,
          updatedAt: Date.now()
        }
      };
    }),

  upsertWalletAccounts: ({ walletAccounts = [], activeWalletId = '' } = {}) =>
    set((state) => {
      const rows = Array.isArray(walletAccounts) ? walletAccounts : [];
      if (rows.length === 0 && !activeWalletId) return state;
      let walletsById = state.entities.walletsById;
      let touched = false;

      for (const row of rows) {
        const id = normalizeWalletId(row);
        if (!id) continue;
        const wallet = row?.wallet || {};
        walletsById = {
          ...walletsById,
          [id]: {
            ...(walletsById[id] || {}),
            id,
            name: String(row?.name || walletsById[id]?.name || id),
            enabled: Boolean(row?.enabled ?? walletsById[id]?.enabled),
            startCash: toNum(row?.startCash, walletsById[id]?.startCash || 0),
            maxAbsUnits: toNum(row?.maxAbsUnits, walletsById[id]?.maxAbsUnits || 0),
            slippageBps: toNum(row?.slippageBps, walletsById[id]?.slippageBps || 0),
            cash: toNum(wallet?.cash, walletsById[id]?.cash || 0),
            units: toNum(wallet?.units, walletsById[id]?.units || 0),
            avgEntry: wallet?.avgEntry === null ? null : toFiniteOrNull(wallet?.avgEntry),
            realizedPnl: toNum(wallet?.realizedPnl, walletsById[id]?.realizedPnl || 0),
            unrealizedPnl: toNum(wallet?.unrealizedPnl, walletsById[id]?.unrealizedPnl || 0),
            equity: toNum(wallet?.equity, walletsById[id]?.equity || 0),
            updatedAt: Date.now()
          }
        };
        touched = true;
      }

      if (!touched && !activeWalletId) return state;
      return {
        ...state,
        entities: {
          ...state.entities,
          walletsById
        },
        meta: {
          ...state.meta,
          activeWalletId: activeWalletId ? String(activeWalletId) : state.meta.activeWalletId,
          updatedAt: Date.now()
        }
      };
    }),

  appendWalletTx: (tx) =>
    set((state) => {
      const walletId = normalizeWalletId(tx);
      if (!walletId) return state;
      const t = toTs(tx?.timestamp || Date.now());
      const eventId = String(tx?.id || `tx:${walletId}:${t}:${Math.round(toNum(tx?.fillPrice, 0) * 1000)}`);
      const point = {
        ...tx,
        id: eventId,
        timestamp: t
      };

      const walletTxById = appendSeriesPoint({
        seriesMap: state.series.walletTxById,
        key: walletId,
        point,
        maxLength: MAX_WALLET_TX,
        equals: (a, b) => a.id === b.id
      });
      const walletTxIds = appendLinkId(state.links.walletTxIds, walletId, eventId);

      return {
        ...state,
        links: {
          ...state.links,
          walletTxIds
        },
        series: {
          ...state.series,
          walletTxById
        },
        meta: {
          ...state.meta,
          activeWalletId: walletId,
          updatedAt: Date.now()
        }
      };
    }),

  appendWalletPosition: (position) =>
    set((state) => {
      const walletId = normalizeWalletId(position);
      if (!walletId) return state;
      const t = toTs(position?.timestamp || Date.now());
      const eventId = String(position?.id || `pos:${walletId}:${t}:${position?.strategyId || 'strategy'}`);
      const point = {
        ...position,
        id: eventId,
        timestamp: t
      };

      const walletPositionById = appendSeriesPoint({
        seriesMap: state.series.walletPositionById,
        key: walletId,
        point,
        maxLength: MAX_WALLET_POSITIONS,
        equals: (a, b) => a.id === b.id
      });
      const walletPositionIds = appendLinkId(state.links.walletPositionIds, walletId, eventId);

      return {
        ...state,
        links: {
          ...state.links,
          walletPositionIds
        },
        series: {
          ...state.series,
          walletPositionById
        },
        meta: {
          ...state.meta,
          activeWalletId: walletId,
          updatedAt: Date.now()
        }
      };
    }),

  getMarketSeriesRange: ({ marketId, from = 0, to = Number.MAX_SAFE_INTEGER, limit = 2400, providerId = '' } = {}) => {
    const key = String(marketId || '').trim();
    if (!key) return [];
    const rows = get().series.marketTicksById[key] || [];
    const fromTs = toTs(from);
    const toTsValue = toNum(to, Number.MAX_SAFE_INTEGER);
    const normalizedProviderId = String(providerId || '').trim();
    const filtered = rows.filter((row) => {
      const ts = toTs(row?.t || row?.timestamp || 0);
      if (!withinRange(ts, fromTs, toTsValue)) return false;
      if (normalizedProviderId && String(row?.providerId || '') !== normalizedProviderId) return false;
      return true;
    });
    return trimTail(filtered, Math.max(1, Math.round(toNum(limit, 2400))));
  },

  getMarketDepthRange: ({ marketId, from = 0, to = Number.MAX_SAFE_INTEGER, limit = 420 } = {}) => {
    const key = String(marketId || '').trim();
    if (!key) return [];
    const rows = get().series.marketDepthById[key] || [];
    const fromTs = toTs(from);
    const toTsValue = toNum(to, Number.MAX_SAFE_INTEGER);
    const filtered = rows.filter((row) => withinRange(toTs(row?.t || row?.timestamp || 0), fromTs, toTsValue));
    return trimTail(filtered, Math.max(1, Math.round(toNum(limit, 420))));
  },

  getTensorRange: ({ marketId, from = 0, to = Number.MAX_SAFE_INTEGER, limit = 960 } = {}) => {
    const key = String(marketId || '').trim();
    if (!key) return [];
    const rows = get().series.marketTensorById[key] || [];
    const fromTs = toTs(from);
    const toTsValue = toNum(to, Number.MAX_SAFE_INTEGER);
    const filtered = rows.filter((row) => withinRange(toTs(row?.t || row?.timestamp || 0), fromTs, toTsValue));
    return trimTail(filtered, Math.max(1, Math.round(toNum(limit, 960))));
  },

  getMarketImageRange: ({ marketId, from = 0, to = Number.MAX_SAFE_INTEGER, limit = 720 } = {}) => {
    const key = String(marketId || '').trim();
    if (!key) return [];
    const rows = get().series.marketImageById[key] || [];
    const fromTs = toTs(from);
    const toTsValue = toNum(to, Number.MAX_SAFE_INTEGER);
    const filtered = rows.filter((row) => withinRange(toTs(row?.t || row?.timestamp || 0), fromTs, toTsValue));
    return trimTail(filtered, Math.max(1, Math.round(toNum(limit, 720))));
  },

  getWalletTxRange: ({ walletId, from = 0, to = Number.MAX_SAFE_INTEGER, limit = 1200 } = {}) => {
    const key = String(walletId || '').trim();
    if (!key) return [];
    const rows = get().series.walletTxById[key] || [];
    const fromTs = toTs(from);
    const toTsValue = toNum(to, Number.MAX_SAFE_INTEGER);
    const filtered = rows.filter((row) => withinRange(toTs(row?.timestamp || 0), fromTs, toTsValue));
    return trimHead(filtered.sort((a, b) => toTs(b?.timestamp || 0) - toTs(a?.timestamp || 0)), Math.max(1, Math.round(toNum(limit, 1200))));
  },

  getWalletPositionRange: ({ walletId, from = 0, to = Number.MAX_SAFE_INTEGER, limit = 1200 } = {}) => {
    const key = String(walletId || '').trim();
    if (!key) return [];
    const rows = get().series.walletPositionById[key] || [];
    const fromTs = toTs(from);
    const toTsValue = toNum(to, Number.MAX_SAFE_INTEGER);
    const filtered = rows.filter((row) => withinRange(toTs(row?.timestamp || 0), fromTs, toTsValue));
    return trimHead(filtered.sort((a, b) => toTs(b?.timestamp || 0) - toTs(a?.timestamp || 0)), Math.max(1, Math.round(toNum(limit, 1200))));
  }
}));

