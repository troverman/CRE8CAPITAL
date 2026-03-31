import Provider from './Provider';
import { toBinanceSymbol } from './symbolUtils';

const HISTORY_WINDOWS = {
  '5m': { interval: '1m', limit: 5 },
  '1h': { interval: '1m', limit: 60 },
  '24h': { interval: '5m', limit: 288 }
};

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

  async fetchHistory({ market, window = '1h', signal } = {}) {
    const symbol = toBinanceSymbol(market?.symbol);
    if (!symbol || typeof fetch !== 'function') return [];

    const config = HISTORY_WINDOWS[window] || HISTORY_WINDOWS['1h'];
    const params = new URLSearchParams({
      symbol,
      interval: config.interval,
      limit: String(config.limit)
    });

    const response = await fetch(`https://api.binance.com/api/v3/klines?${params.toString()}`, {
      method: 'GET',
      signal
    });
    if (!response.ok) {
      throw new Error(`Binance history request failed (${response.status})`);
    }

    const rows = await response.json();
    if (!Array.isArray(rows)) return [];

    return rows
      .map((row) => {
        const t = Number(row?.[0]);
        const price = Number(row?.[4]);
        const high = Number(row?.[2]);
        const low = Number(row?.[3]);
        const volume = Number(row?.[5]);
        if (!Number.isFinite(t) || !Number.isFinite(price) || price <= 0) return null;
        const spread = Number.isFinite(high) && Number.isFinite(low) && high >= low ? ((high - low) / Math.max(price, 1e-9)) * 10000 : 0;
        return {
          t,
          price,
          spread,
          volume: Number.isFinite(volume) ? volume : 0,
          providerId: this.id,
          providerName: this.name,
          source: 'provider-history'
        };
      })
      .filter((row) => Boolean(row));
  }

  connect({ market, onTick, onDepth, onStatus }) {
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

    const pair = symbol.toLowerCase();
    const tickerSocket = new WebSocket(`wss://stream.binance.com:9443/ws/${pair}@bookTicker`);
    const depthSocket = new WebSocket(`wss://stream.binance.com:9443/ws/${pair}@depth20@100ms`);

    let tickerOpen = false;
    let depthOpen = false;

    const updateStatus = (error = '') => {
      onStatus?.({
        id: this.id,
        name: this.name,
        connected: tickerOpen || depthOpen,
        error
      });
    };

    tickerSocket.onopen = () => {
      tickerOpen = true;
      updateStatus('');
    };

    depthSocket.onopen = () => {
      depthOpen = true;
      updateStatus('');
    };

    tickerSocket.onerror = () => {
      updateStatus('Ticker socket error');
    };

    depthSocket.onerror = () => {
      updateStatus('Depth socket error');
    };

    tickerSocket.onclose = () => {
      tickerOpen = false;
      updateStatus('');
    };

    depthSocket.onclose = () => {
      depthOpen = false;
      updateStatus('');
    };

    tickerSocket.onmessage = (event) => {
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
          connected: tickerOpen || depthOpen,
          error: 'Invalid socket payload'
        });
      }
    };

    depthSocket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const bids = Array.isArray(payload?.bids) ? payload.bids : Array.isArray(payload?.b) ? payload.b : [];
        const asks = Array.isArray(payload?.asks) ? payload.asks : Array.isArray(payload?.a) ? payload.a : [];

        onDepth?.({
          providerId: this.id,
          providerName: this.name,
          kind: this.kind,
          symbol: payload?.s || market.symbol,
          assetClass: 'crypto',
          venue: 'BINANCE',
          bids,
          asks,
          timestamp: Number(payload?.E) || Date.now(),
          raw: payload
        });
      } catch (error) {
        onStatus?.({
          id: this.id,
          name: this.name,
          connected: tickerOpen || depthOpen,
          error: 'Invalid depth payload'
        });
      }
    };

    return {
      disconnect: () => {
        tickerSocket.close();
        depthSocket.close();
      }
    };
  }
}
