import Provider from './Provider';

const PRICE_FLOOR = 0.00001;

const toNum = (value, fallback) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const randomBetween = (min, max) => {
  return min + Math.random() * (max - min);
};

const HISTORY_WINDOWS = {
  '5m': { points: 60, stepMs: 5000 },
  '1h': { points: 120, stepMs: 30000 },
  '24h': { points: 288, stepMs: 300000 },
  '7d': { points: 672, stepMs: 900000 },
  '30d': { points: 720, stepMs: 3600000 }
};

const buildSyntheticDepth = ({ midPrice, spreadBps, levels = 18 }) => {
  const bids = [];
  const asks = [];

  const baseStep = (midPrice * Math.max(spreadBps, 0.5)) / 10000;
  for (let i = 1; i <= levels; i += 1) {
    const step = baseStep * i * randomBetween(0.86, 1.28);
    const size = randomBetween(0.45, 5.2) * Math.max(1, midPrice * 0.002);
    const bidPrice = Math.max(midPrice - step, PRICE_FLOOR);
    const askPrice = Math.max(midPrice + step, PRICE_FLOOR);

    bids.push({ price: bidPrice, size });
    asks.push({ price: askPrice, size: size * randomBetween(0.86, 1.22) });
  }

  return { bids, asks };
};

export default class LocalSyntheticProvider extends Provider {
  constructor() {
    super({
      id: 'socket.local.synthetic',
      name: 'Local Synthetic',
      kind: 'local-sim'
    });
    this.isLocalFallback = true;
  }

  supportsMarket(market) {
    return Boolean(market && market.symbol);
  }

  async fetchHistory({ market, window = '1h' } = {}) {
    const config = HISTORY_WINDOWS[window] || HISTORY_WINDOWS['1h'];
    const now = Date.now();
    const symbol = String(market?.symbol || 'SIM');
    const basePrice = Math.max(toNum(market?.referencePrice, 100), PRICE_FLOOR);
    const baseSpreadBps = Math.max(toNum(market?.spreadBps, 8), 0.5);
    const volumeAnchor = Math.max(toNum(market?.totalVolume, 100000), 1);
    const trendBias = Math.max(Math.min(toNum(market?.changePct, 0) / 100, 0.006), -0.006);

    let cursorPrice = basePrice * (1 - trendBias * 0.3);
    const rows = [];

    for (let index = 0; index < config.points; index += 1) {
      const drift = randomBetween(-0.0018, 0.0018) + trendBias * 0.12;
      cursorPrice = Math.max(cursorPrice * (1 + drift), PRICE_FLOOR);
      const spread = Math.max(baseSpreadBps + randomBetween(-1.2, 1.2), 0.35);
      const t = now - (config.points - 1 - index) * config.stepMs;
      rows.push({
        t,
        price: cursorPrice,
        spread,
        volume: Math.max(volumeAnchor * randomBetween(0.0001, 0.0016), 1),
        providerId: this.id,
        providerName: this.name,
        symbol,
        source: 'local-history'
      });
    }

    return rows;
  }

  connect({ market, onTick, onDepth, onStatus }) {
    const symbol = String(market?.symbol || 'SIM');
    const assetClass = String(market?.assetClass || 'unknown');
    const venue = 'LOCAL';

    const seedReferencePrice = Math.max(toNum(market?.referencePrice, 100), PRICE_FLOOR);
    let anchorPrice = seedReferencePrice;
    let anchorSpreadBps = Math.max(toNum(market?.spreadBps, 8), 0.5);

    onStatus?.({
      id: this.id,
      name: this.name,
      connected: true,
      error: ''
    });

    const tickInterval = setInterval(() => {
      const drift = randomBetween(-0.0035, 0.0035);
      const driftedPrice = anchorPrice * (1 + drift);
      anchorPrice = Math.max(
        Math.min(driftedPrice, seedReferencePrice * 1.5),
        Math.max(seedReferencePrice * 0.5, PRICE_FLOOR)
      );

      const spreadShock = randomBetween(-0.7, 0.7);
      anchorSpreadBps = Math.max(anchorSpreadBps + spreadShock, 0.35);

      const spreadAbsolute = (anchorPrice * anchorSpreadBps) / 10000;
      const bid = anchorPrice - spreadAbsolute / 2;
      const ask = anchorPrice + spreadAbsolute / 2;
      const volume = Math.max(toNum(market?.totalVolume, 100000) * randomBetween(0.0003, 0.003), 1);

      onTick?.({
        providerId: this.id,
        providerName: this.name,
        kind: this.kind,
        symbol,
        assetClass,
        venue,
        price: anchorPrice,
        bid,
        ask,
        volume,
        timestamp: Date.now(),
        raw: { source: 'local-synthetic' }
      });

      const depth = buildSyntheticDepth({
        midPrice: anchorPrice,
        spreadBps: anchorSpreadBps
      });
      onDepth?.({
        providerId: this.id,
        providerName: this.name,
        kind: this.kind,
        symbol,
        assetClass,
        venue,
        bids: depth.bids,
        asks: depth.asks,
        timestamp: Date.now(),
        raw: { source: 'local-synthetic' }
      });
    }, 1100);

    return {
      disconnect: () => {
        clearInterval(tickInterval);
        onStatus?.({
          id: this.id,
          name: this.name,
          connected: false,
          error: ''
        });
      }
    };
  }
}
