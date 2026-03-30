import Provider from './Provider';
import { toCoinbaseProduct } from './symbolUtils';

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
