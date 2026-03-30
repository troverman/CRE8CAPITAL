import { create } from 'zustand';

const MAX_POINTS = 240;
const MAX_RECENT_TICKS = 320;
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

export const useSocketFeedStore = create((set) => ({
  ...baseState,
  resetForMarket: (marketKey) =>
    set({
      ...baseState,
      marketKey: marketKey || null
    }),
  applyWorkerSnapshot: (payload) => {
    if (!payload || typeof payload !== 'object') return;
    set((state) => ({
      marketKey: payload.marketKey ?? state.marketKey,
      providerStateById: payload.providerStateById || state.providerStateById,
      seriesByProvider: payload.seriesByProvider || state.seriesByProvider,
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
  }
}));
