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

  connect({ market, onTick, onStatus }) {
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

    socket.onopen = () => {
      onStatus?.({ id: this.id, name: this.name, connected: true, error: '' });
      socket.send(
        JSON.stringify({
          type: 'subscribe',
          product_ids: [productId],
          channels: ['ticker']
        })
      );
    };

    socket.onerror = () => {
      onStatus?.({ id: this.id, name: this.name, connected: false, error: 'Socket error' });
    };

    socket.onclose = () => {
      onStatus?.({ id: this.id, name: this.name, connected: false });
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type !== 'ticker') return;

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
      disconnect: () => socket.close()
    };
  }
}

