import Provider from './Provider';
import { toCoinbaseProduct } from './symbolUtils';

const HISTORY_WINDOWS = {
  '5m': { granularity: 60, spanMs: 5 * 60 * 1000 },
  '1h': { granularity: 60, spanMs: 60 * 60 * 1000 },
  '24h': { granularity: 300, spanMs: 24 * 60 * 60 * 1000 },
  '7d': { granularity: 3600, spanMs: 7 * 24 * 60 * 60 * 1000 },
  '30d': { granularity: 21600, spanMs: 30 * 24 * 60 * 60 * 1000 }
};

const toNum = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export default class CoinbaseTickerProvider extends Provider {
  constructor() {
    super({
      id: 'socket.coinbase.ticker',
      name: 'Coinbase Socket',
      kind: 'external-socket'
    });
  }

  supportsMarket(market) {
    if (!market) return false;
    if (String(market.assetClass).toLowerCase() !== 'crypto') return false;
    return Boolean(toCoinbaseProduct(market.symbol));
  }

  async fetchHistory({ market, window = '1h', signal } = {}) {
    const productId = toCoinbaseProduct(market?.symbol);
    if (!productId || typeof fetch !== 'function') return [];

    const config = HISTORY_WINDOWS[window] || HISTORY_WINDOWS['1h'];
    const endMs = Date.now();
    const startMs = Math.max(0, endMs - config.spanMs);

    const params = new URLSearchParams({
      granularity: String(config.granularity),
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString()
    });

    const response = await fetch(`https://api.exchange.coinbase.com/products/${encodeURIComponent(productId)}/candles?${params.toString()}`, {
      method: 'GET',
      signal,
      headers: {
        Accept: 'application/json'
      }
    });
    if (!response.ok) {
      throw new Error(`Coinbase history request failed (${response.status})`);
    }

    const rows = await response.json();
    if (!Array.isArray(rows)) return [];

    return rows
      .map((row) => {
        const tSec = Number(row?.[0]);
        const low = Number(row?.[1]);
        const high = Number(row?.[2]);
        const close = Number(row?.[4]);
        const volume = Number(row?.[5]);
        if (!Number.isFinite(tSec) || !Number.isFinite(close) || close <= 0) return null;
        const spread = Number.isFinite(high) && Number.isFinite(low) && high >= low ? ((high - low) / Math.max(close, 1e-9)) * 10000 : 0;
        return {
          t: tSec * 1000,
          price: close,
          spread,
          volume: Number.isFinite(volume) ? volume : 0,
          providerId: this.id,
          providerName: this.name,
          source: 'provider-history'
        };
      })
      .filter((row) => Boolean(row))
      .sort((a, b) => a.t - b.t);
  }

  connect({ market, onTick, onDepth, onStatus }) {
    const productId = toCoinbaseProduct(market?.symbol);
    if (!productId || typeof WebSocket === 'undefined') {
      onStatus?.({
        id: this.id,
        name: this.name,
        connected: false,
        error: 'Product unsupported or WebSocket unavailable'
      });
      return { disconnect: () => {} };
    }

    const socket = new WebSocket('wss://ws-feed.exchange.coinbase.com');
    const buyLevels = new Map();
    const sellLevels = new Map();
    let depthFlushTimer = null;
    let lastDepthEmitAt = 0;

    const emitDepth = () => {
      const bids = [...buyLevels.entries()].map(([price, size]) => ({ price, size })).sort((a, b) => b.price - a.price).slice(0, 24);
      const asks = [...sellLevels.entries()].map(([price, size]) => ({ price, size })).sort((a, b) => a.price - b.price).slice(0, 24);
      if (bids.length === 0 && asks.length === 0) return;

      onDepth?.({
        providerId: this.id,
        providerName: this.name,
        kind: this.kind,
        symbol: String(productId).replace('-', ''),
        assetClass: 'crypto',
        venue: 'COINBASE',
        bids,
        asks,
        timestamp: Date.now()
      });
    };

    const queueDepthFlush = () => {
      const now = Date.now();
      const elapsed = now - lastDepthEmitAt;
      if (elapsed >= 120) {
        lastDepthEmitAt = now;
        emitDepth();
        return;
      }
      if (depthFlushTimer) return;

      depthFlushTimer = setTimeout(() => {
        depthFlushTimer = null;
        lastDepthEmitAt = Date.now();
        emitDepth();
      }, 120 - elapsed);
    };

    const upsertDepthLevel = (side, priceValue, sizeValue) => {
      const price = toNum(priceValue);
      const size = toNum(sizeValue);
      if (price === null || price <= 0) return;

      const target = side === 'buy' ? buyLevels : sellLevels;
      if (size === null || size <= 0) {
        target.delete(price);
      } else {
        target.set(price, size);
      }
    };

    socket.onopen = () => {
      onStatus?.({ id: this.id, name: this.name, connected: true, error: '' });
      socket.send(
        JSON.stringify({
          type: 'subscribe',
          product_ids: [productId],
          channels: ['ticker', 'level2']
        })
      );
    };

    socket.onerror = () => {
      onStatus?.({ id: this.id, name: this.name, connected: false, error: 'Socket error' });
    };

    socket.onclose = () => {
      if (depthFlushTimer) {
        clearTimeout(depthFlushTimer);
        depthFlushTimer = null;
      }
      onStatus?.({ id: this.id, name: this.name, connected: false });
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'ticker') {
          const bid = toNum(payload.best_bid);
          const ask = toNum(payload.best_ask);
          const price = toNum(payload.price) || (bid !== null && ask !== null ? (bid + ask) / 2 : null);
          if (price === null) return;

          const tick = {
            providerId: this.id,
            providerName: this.name,
            kind: this.kind,
            symbol: String(payload.product_id || productId).replace('-', ''),
            assetClass: 'crypto',
            venue: 'COINBASE',
            price,
            bid,
            ask,
            volume: toNum(payload.last_size),
            timestamp: payload.time ? new Date(payload.time).getTime() : Date.now(),
            raw: payload
          };
          onTick?.(tick);
          return;
        }

        if (payload.type === 'snapshot' && payload.product_id === productId) {
          buyLevels.clear();
          sellLevels.clear();
          for (const bidLevel of payload.bids || []) {
            upsertDepthLevel('buy', bidLevel[0], bidLevel[1]);
          }
          for (const askLevel of payload.asks || []) {
            upsertDepthLevel('sell', askLevel[0], askLevel[1]);
          }
          queueDepthFlush();
          return;
        }

        if (payload.type === 'l2update' && payload.product_id === productId) {
          for (const change of payload.changes || []) {
            upsertDepthLevel(change[0], change[1], change[2]);
          }
          queueDepthFlush();
        }
      } catch (error) {
        onStatus?.({
          id: this.id,
          name: this.name,
          connected: false,
          error: 'Invalid socket payload'
        });
      }
    };

    return {
      disconnect: () => {
        if (depthFlushTimer) {
          clearTimeout(depthFlushTimer);
          depthFlushTimer = null;
        }
        socket.close();
      }
    };
  }
}
