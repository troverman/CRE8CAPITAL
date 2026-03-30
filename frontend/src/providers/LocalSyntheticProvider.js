import Provider from './Provider';

const toNum = (value, fallback) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const randomBetween = (min, max) => {
  return min + Math.random() * (max - min);
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

  connect({ market, onTick, onStatus }) {
    const symbol = String(market?.symbol || 'SIM');
    const assetClass = String(market?.assetClass || 'unknown');
    const venue = 'LOCAL';

    let anchorPrice = Math.max(toNum(market?.referencePrice, 100), 0.00001);
    let anchorSpreadBps = Math.max(toNum(market?.spreadBps, 8), 0.5);

    onStatus?.({
      id: this.id,
      name: this.name,
      connected: true,
      error: ''
    });

    const tickInterval = setInterval(() => {
      const drift = randomBetween(-0.0035, 0.0035);
      anchorPrice = Math.max(anchorPrice * (1 + drift), 0.00001);

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

