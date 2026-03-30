const MAX_POINTS = 240;
const MAX_RECENT_TICKS = 320;
const MAX_DRIFT_RATIO = 0.25;
const MAX_DRIFT_WINDOW_MS = 3500;
const FLUSH_INTERVAL_MS = 140;

let marketKey = null;
let providerStateById = {};
let seriesByProvider = {};
let recentTicks = [];
let flushTimer = null;
let sequence = 0;

const toFiniteOrNull = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toFinite = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const queueFlush = () => {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    self.postMessage({
      type: 'snapshot',
      payload: {
        marketKey,
        providerStateById,
        seriesByProvider,
        recentTicks
      }
    });
  }, FLUSH_INTERVAL_MS);
};

const clearState = (nextMarketKey = null) => {
  marketKey = nextMarketKey || null;
  providerStateById = {};
  seriesByProvider = {};
  recentTicks = [];
  sequence = 0;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
};

const updateStatus = (status) => {
  const id = String(status?.id || '');
  if (!id) return;

  const current = providerStateById[id] || {};
  providerStateById[id] = {
    id,
    name: status.name || current.name || id,
    connected: Boolean(status.connected),
    error: typeof status.error === 'string' ? status.error : current.error || '',
    lastTickAt: current.lastTickAt ?? null,
    price: current.price ?? null,
    bid: current.bid ?? null,
    ask: current.ask ?? null,
    volume: current.volume ?? null,
    guardDrops: toFinite(current.guardDrops, 0)
  };
  queueFlush();
};

const ingestTick = (tick) => {
  const providerId = String(tick?.providerId || '');
  if (!providerId) return;

  const providerName = String(tick?.providerName || providerId);
  const timestamp = toFinite(tick?.timestamp, Date.now());
  const price = toFiniteOrNull(tick?.price);
  if (price === null || price <= 0) return;

  const current = providerStateById[providerId] || {};
  const lastPrice = toFiniteOrNull(current.price);
  const lastTickAt = toFiniteOrNull(current.lastTickAt);
  if (lastPrice !== null && lastTickAt !== null) {
    const elapsedMs = Math.max(0, timestamp - lastTickAt);
    const drift = Math.abs(price - lastPrice) / Math.max(lastPrice, 1e-9);
    if (elapsedMs < MAX_DRIFT_WINDOW_MS && drift > MAX_DRIFT_RATIO) {
      providerStateById[providerId] = {
        ...current,
        id: providerId,
        name: providerName,
        guardDrops: toFinite(current.guardDrops, 0) + 1,
        error: `guard dropped outlier ${(drift * 100).toFixed(1)}%`
      };
      queueFlush();
      return;
    }
  }

  const bid = toFiniteOrNull(tick?.bid);
  const ask = toFiniteOrNull(tick?.ask);
  const volume = Math.max(toFinite(tick?.volume, 0), 0);
  const spread = bid !== null && ask !== null ? ((ask - bid) / Math.max(price, 1e-9)) * 10000 : 0;

  providerStateById[providerId] = {
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
  };

  const point = {
    t: timestamp,
    price,
    spread,
    volume
  };

  const series = seriesByProvider[providerId] ? [...seriesByProvider[providerId]] : [];
  const tail = series[series.length - 1];
  if (!tail || tail.t !== point.t || tail.price !== point.price) {
    series.push(point);
    if (series.length > MAX_POINTS) {
      series.splice(0, series.length - MAX_POINTS);
    }
    seriesByProvider[providerId] = series;
  }

  sequence += 1;
  recentTicks.unshift({
    id: `${providerId}:${timestamp}:${sequence}`,
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
  });
  if (recentTicks.length > MAX_RECENT_TICKS) {
    recentTicks.length = MAX_RECENT_TICKS;
  }

  queueFlush();
};

self.onmessage = (event) => {
  const message = event.data || {};

  if (message.type === 'reset') {
    clearState(message.marketKey);
    self.postMessage({
      type: 'snapshot',
      payload: {
        marketKey,
        providerStateById,
        seriesByProvider,
        recentTicks
      }
    });
    return;
  }

  if (message.type === 'status') {
    updateStatus(message.status);
    return;
  }

  if (message.type === 'tick') {
    ingestTick(message.tick);
    return;
  }
};
