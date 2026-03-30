import Provider from './Provider';
import { toBinanceSymbol } from './symbolUtils';

const toNum = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export default class BinanceBookTickerProvider extends Provider {
  constructor() {
    super({
      id: 'socket.binance.bookTicker',
      name: 'Binance Socket',
      kind: 'external-socket'
    });
  }

  supportsMarket(market) {
    if (!market) return false;
    if (String(market.assetClass).toLowerCase() !== 'crypto') return false;
    const symbol = toBinanceSymbol(market.symbol);
    return Boolean(symbol);
  }

  connect({ market, onTick, onStatus }) {
    const symbol = toBinanceSymbol(market?.symbol);
    if (!symbol || typeof WebSocket === 'undefined') {
      onStatus?.({
        id: this.id,
        name: this.name,
        connected: false,
        error: 'WebSocket unavailable or symbol unsupported'
      });
      return { disconnect: () => {} };
    }

    const url = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@bookTicker`;
    const socket = new WebSocket(url);

    socket.onopen = () => {
      onStatus?.({ id: this.id, name: this.name, connected: true, error: '' });
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
        const bid = toNum(payload.b);
        const ask = toNum(payload.a);
        const price = toNum(payload.c) || (bid !== null && ask !== null ? (bid + ask) / 2 : null);

        if (price === null) return;
        const volume = (toNum(payload.B) || 0) + (toNum(payload.A) || 0);
        const tick = {
          providerId: this.id,
          providerName: this.name,
          kind: this.kind,
          symbol: payload.s || market.symbol,
          assetClass: 'crypto',
          venue: 'BINANCE',
          price,
          bid,
          ask,
          volume,
          timestamp: Date.now(),
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

