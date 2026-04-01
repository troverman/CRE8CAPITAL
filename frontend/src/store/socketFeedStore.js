import { create } from 'zustand';
import { useCapitalStore } from './capitalStore';

const MAX_POINTS = 240;
const MAX_RECENT_TICKS = 320;
const MAX_DEPTH_LEVELS = 24;
const MAX_DRIFT_RATIO = 0.25;
const MAX_DRIFT_WINDOW_MS = 3500;

const toFinite = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toFiniteOrNull = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const baseState = {
  marketKey: null,
  providerStateById: {},
  seriesByProvider: {},
  depthByProvider: {},
  recentTicks: [],
  sequence: 0
};

const buildStatusState = (current, status) => {
  return {
    id: status.id,
    name: status.name || current.name || status.id,
    connected: Boolean(status.connected),
    error: typeof status.error === 'string' ? status.error : current.error || '',
    lastTickAt: current.lastTickAt ?? null,
    price: current.price ?? null,
    bid: current.bid ?? null,
    ask: current.ask ?? null,
    volume: current.volume ?? null,
    guardDrops: toFinite(current.guardDrops, 0)
  };
};

const buildTickUpdate = (current, tick) => {
  const providerId = String(tick?.providerId || '');
  if (!providerId) return null;

  const providerName = String(tick?.providerName || providerId);
  const timestamp = toFinite(tick?.timestamp, Date.now());
  const price = toFiniteOrNull(tick?.price);
  if (price === null || price <= 0) return null;

  const lastPrice = toFiniteOrNull(current.price);
  const lastTickAt = toFiniteOrNull(current.lastTickAt);
  if (lastPrice !== null && lastTickAt !== null) {
    const elapsedMs = Math.max(0, timestamp - lastTickAt);
    const drift = Math.abs(price - lastPrice) / Math.max(lastPrice, 1e-9);
    if (elapsedMs < MAX_DRIFT_WINDOW_MS && drift > MAX_DRIFT_RATIO) {
      return {
        dropped: true,
        providerState: {
          ...current,
          id: providerId,
          name: providerName,
          guardDrops: toFinite(current.guardDrops, 0) + 1,
          error: `guard dropped outlier ${(drift * 100).toFixed(1)}%`
        }
      };
    }
  }

  const bid = toFiniteOrNull(tick?.bid);
  const ask = toFiniteOrNull(tick?.ask);
  const volume = Math.max(toFinite(tick?.volume, 0), 0);
  const spread = bid !== null && ask !== null ? ((ask - bid) / Math.max(price, 1e-9)) * 10000 : 0;

  return {
    dropped: false,
    providerState: {
      ...current,
      id: providerId,
      name: providerName,
      connected: true,
      error: '',
      lastTickAt: timestamp,
      price,
      bid,
      ask,
      volume,
      guardDrops: toFinite(current.guardDrops, 0)
    },
    point: {
      t: timestamp,
      price,
      spread,
      volume
    },
    recentTick: {
      providerId,
      providerName,
      symbol: tick?.symbol || null,
      assetClass: tick?.assetClass || null,
      venue: tick?.venue || null,
      price,
      bid,
      ask,
      spread,
      volume,
      timestamp
    }
  };
};

const sanitizeDepthLevel = (level) => {
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
};

const sanitizeDepthSide = (levels, side) => {
  const list = Array.isArray(levels) ? levels : [];
  const mapped = list
    .map((level) => sanitizeDepthLevel(level))
    .filter((level) => Boolean(level))
    .sort((a, b) => (side === 'bid' ? b.price - a.price : a.price - b.price));

  if (mapped.length > MAX_DEPTH_LEVELS) {
    mapped.length = MAX_DEPTH_LEVELS;
  }
  return mapped;
};

let lastApplyTime = 0;
const MIN_APPLY_INTERVAL = 100;

export const useSocketFeedStore = create((set) => ({
  ...baseState,
  resetForMarket: (marketKey) => {
    useCapitalStore.getState().setActiveRefs({
      marketId: marketKey || ''
    });
    lastApplyTime = 0;
    set({
      ...baseState,
      marketKey: marketKey || null
    });
  },
  applyWorkerSnapshot: (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const now = Date.now();
    if (now - lastApplyTime < MIN_APPLY_INTERVAL) return;
    lastApplyTime = now;
    useCapitalStore.getState().ingestSocketSnapshot(payload);
    set((state) => ({
      marketKey: payload.marketKey ?? state.marketKey,
      providerStateById: payload.providerStateById || state.providerStateById,
      seriesByProvider: payload.seriesByProvider || state.seriesByProvider,
      depthByProvider: payload.depthByProvider || state.depthByProvider,
      recentTicks: payload.recentTicks || state.recentTicks,
      sequence: state.sequence
    }));
  },
  ingestStatusFallback: (status) => {
    const id = String(status?.id || '');
    if (!id) return;
    set((state) => {
      const current = state.providerStateById[id] || {};
      return {
        ...state,
        providerStateById: {
          ...state.providerStateById,
          [id]: buildStatusState(current, { ...status, id })
        }
      };
    });
  },
  ingestTickFallback: (tick) => {
    set((state) => {
      const providerId = String(tick?.providerId || '');
      if (!providerId) return state;

      const currentProvider = state.providerStateById[providerId] || {};
      const update = buildTickUpdate(currentProvider, tick);
      if (!update) return state;

      const nextProviders = {
        ...state.providerStateById,
        [providerId]: update.providerState
      };

      if (update.dropped) {
        return {
          ...state,
          providerStateById: nextProviders
        };
      }

      const nextSeriesByProvider = { ...state.seriesByProvider };
      const series = nextSeriesByProvider[providerId] ? [...nextSeriesByProvider[providerId]] : [];
      const tail = series[series.length - 1];
      if (!tail || tail.t !== update.point.t || tail.price !== update.point.price) {
        series.push(update.point);
        if (series.length > MAX_POINTS) {
          series.splice(0, series.length - MAX_POINTS);
        }
        nextSeriesByProvider[providerId] = series;
      }

      const sequence = state.sequence + 1;
      const nextRecentTicks = [
        {
          ...update.recentTick,
          id: `${providerId}:${update.point.t}:${sequence}`
        },
        ...state.recentTicks
      ];
      if (nextRecentTicks.length > MAX_RECENT_TICKS) {
        nextRecentTicks.length = MAX_RECENT_TICKS;
      }

      return {
        ...state,
        providerStateById: nextProviders,
        seriesByProvider: nextSeriesByProvider,
        recentTicks: nextRecentTicks,
        sequence
      };
    });
  },
  ingestDepthFallback: (depth) => {
    set((state) => {
      const providerId = String(depth?.providerId || '');
      if (!providerId) return state;

      const bids = sanitizeDepthSide(depth?.bids, 'bid');
      const asks = sanitizeDepthSide(depth?.asks, 'ask');
      if (bids.length === 0 && asks.length === 0) return state;

      const providerName = String(depth?.providerName || providerId);
      const timestamp = toFinite(depth?.timestamp, Date.now());

      const nextDepthByProvider = {
        ...state.depthByProvider,
        [providerId]: {
          providerId,
          providerName,
          symbol: depth?.symbol || null,
          assetClass: depth?.assetClass || null,
          venue: depth?.venue || null,
          timestamp,
          bids,
          asks
        }
      };

      const currentProvider = state.providerStateById[providerId] || {};
      const nextProviderStateById = {
        ...state.providerStateById,
        [providerId]: {
          ...currentProvider,
          id: providerId,
          name: providerName
        }
      };

      return {
        ...state,
        providerStateById: nextProviderStateById,
        depthByProvider: nextDepthByProvider
      };
    });
  }
}));
