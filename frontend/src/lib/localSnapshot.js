const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const randomBetween = (min, max) => min + Math.random() * (max - min);

const cryptoProviders = [
  { id: 'binance', name: 'Binance Socket', venue: 'BINANCE' },
  { id: 'coinbase', name: 'Coinbase Socket', venue: 'COINBASE' }
];
const equityProviders = [{ id: 'paper-equity', name: 'Paper Equity Feed', venue: 'SIM' }];
const fxProviders = [{ id: 'paper-fx', name: 'Paper FX Feed', venue: 'SIM' }];

const toSeed = (assetClass, row, providers) => {
  return {
    key: `${assetClass}:${String(row.symbol).toLowerCase()}`,
    symbol: row.symbol,
    assetClass,
    referencePrice: row.referencePrice,
    spreadBps: row.spreadBps,
    totalVolume: row.totalVolume,
    volatility: row.volatility,
    providers
  };
};

const marketSeeds = [
  ...[
    { symbol: 'BTCUSDT', referencePrice: 68950, spreadBps: 7.5, totalVolume: 2850000000, volatility: 0.0045 },
    { symbol: 'ETHUSDT', referencePrice: 3475, spreadBps: 8.2, totalVolume: 1740000000, volatility: 0.0052 },
    { symbol: 'SOLUSDT', referencePrice: 182.4, spreadBps: 11.1, totalVolume: 562000000, volatility: 0.0085 },
    { symbol: 'BNBUSDT', referencePrice: 612.8, spreadBps: 9.8, totalVolume: 482000000, volatility: 0.0065 },
    { symbol: 'XRPUSDT', referencePrice: 0.692, spreadBps: 13.6, totalVolume: 435000000, volatility: 0.0108 },
    { symbol: 'ADAUSDT', referencePrice: 0.824, spreadBps: 14.1, totalVolume: 354000000, volatility: 0.0112 },
    { symbol: 'DOGEUSDT', referencePrice: 0.198, spreadBps: 16.8, totalVolume: 321000000, volatility: 0.0138 },
    { symbol: 'AVAXUSDT', referencePrice: 51.7, spreadBps: 13.2, totalVolume: 286000000, volatility: 0.0103 },
    { symbol: 'LINKUSDT', referencePrice: 21.9, spreadBps: 12.1, totalVolume: 264000000, volatility: 0.0098 },
    { symbol: 'DOTUSDT', referencePrice: 9.42, spreadBps: 14.8, totalVolume: 231000000, volatility: 0.0109 },
    { symbol: 'MATICUSDT', referencePrice: 1.12, spreadBps: 15.4, totalVolume: 206000000, volatility: 0.0117 },
    { symbol: 'LTCUSDT', referencePrice: 92.1, spreadBps: 10.4, totalVolume: 174000000, volatility: 0.0081 }
  ].map((row) => toSeed('crypto', row, cryptoProviders)),
  ...[
    { symbol: 'AAPL', referencePrice: 208.9, spreadBps: 2.3, totalVolume: 382000000, volatility: 0.0017 },
    { symbol: 'MSFT', referencePrice: 432.2, spreadBps: 1.9, totalVolume: 309000000, volatility: 0.0015 },
    { symbol: 'NVDA', referencePrice: 1011.4, spreadBps: 2.8, totalVolume: 406000000, volatility: 0.0022 },
    { symbol: 'AMZN', referencePrice: 191.6, spreadBps: 2.2, totalVolume: 248000000, volatility: 0.0019 },
    { symbol: 'GOOGL', referencePrice: 178.3, spreadBps: 2.1, totalVolume: 223000000, volatility: 0.0018 },
    { symbol: 'TSLA', referencePrice: 236.4, spreadBps: 3.4, totalVolume: 331000000, volatility: 0.0029 },
    { symbol: 'META', referencePrice: 519.1, spreadBps: 2.4, totalVolume: 214000000, volatility: 0.0019 },
    { symbol: 'AMD', referencePrice: 187.7, spreadBps: 2.7, totalVolume: 182000000, volatility: 0.0024 }
  ].map((row) => toSeed('equity', row, equityProviders)),
  ...[
    { symbol: 'EURUSD', referencePrice: 1.0842, spreadBps: 1.2, totalVolume: 608000000, volatility: 0.0009 },
    { symbol: 'USDJPY', referencePrice: 149.31, spreadBps: 1.5, totalVolume: 574000000, volatility: 0.0011 },
    { symbol: 'GBPUSD', referencePrice: 1.2746, spreadBps: 1.6, totalVolume: 452000000, volatility: 0.0011 },
    { symbol: 'AUDUSD', referencePrice: 0.6665, spreadBps: 1.8, totalVolume: 317000000, volatility: 0.0012 },
    { symbol: 'USDCAD', referencePrice: 1.3514, spreadBps: 1.7, totalVolume: 296000000, volatility: 0.001 },
    { symbol: 'USDCHF', referencePrice: 0.8931, spreadBps: 1.5, totalVolume: 241000000, volatility: 0.001 },
    { symbol: 'NZDUSD', referencePrice: 0.6128, spreadBps: 1.9, totalVolume: 198000000, volatility: 0.0013 }
  ].map((row) => toSeed('fx', row, fxProviders))
];

const buildProviderQuote = ({ provider, referencePrice, spreadBps, now }) => {
  const skew = randomBetween(-0.16, 0.16);
  const providerPrice = Math.max(referencePrice * (1 + skew * 0.001), 0.0000001);
  const providerSpread = Math.max(spreadBps + randomBetween(-0.9, 0.9), 0.2);
  const spreadAbs = (providerPrice * providerSpread) / 10000;
  const bid = providerPrice - spreadAbs / 2;
  const ask = providerPrice + spreadAbs / 2;
  const volume = Math.max(referencePrice * randomBetween(150, 1400), 1);

  return {
    id: provider.id,
    name: provider.name,
    venue: provider.venue,
    price: providerPrice,
    bid,
    ask,
    volume,
    timestamp: now
  };
};

export const buildLocalFallbackSnapshot = (previousSnapshot) => {
  const now = Date.now();
  const previousMarketsByKey = new Map((previousSnapshot?.markets || []).map((market) => [market.key, market]));

  const markets = marketSeeds.map((seed) => {
    const previous = previousMarketsByKey.get(seed.key);
    const previousPrice = Math.max(toNum(previous?.referencePrice, seed.referencePrice), 0.0000001);
    const drift = randomBetween(-seed.volatility, seed.volatility);
    const referencePrice = Math.max(previousPrice * (1 + drift), 0.0000001);
    const spreadBps = clamp(toNum(previous?.spreadBps, seed.spreadBps) + randomBetween(-0.6, 0.6), 0.2, 220);
    const totalVolume = Math.max(
      toNum(previous?.totalVolume, seed.totalVolume) + toNum(previous?.totalVolume, seed.totalVolume) * randomBetween(0.0002, 0.0014),
      1
    );

    const providers = seed.providers.map((provider) => buildProviderQuote({ provider, referencePrice, spreadBps, now }));
    const prevAnchor = toNum(previous?.referencePrice, seed.referencePrice);
    const changePct = ((referencePrice - prevAnchor) / Math.max(prevAnchor, 0.0000001)) * 100;

    return {
      key: seed.key,
      symbol: seed.symbol,
      assetClass: seed.assetClass,
      referencePrice,
      changePct,
      spreadBps,
      totalVolume,
      providerCount: providers.length,
      venueCount: new Set(providers.map((provider) => provider.venue)).size,
      providers,
      updatedAt: now
    };
  });

  const providers = [
    { id: 'socket.binance.bookTicker', name: 'Binance Socket', connected: true, mode: 'local-fallback' },
    { id: 'socket.coinbase.ticker', name: 'Coinbase Socket', connected: true, mode: 'local-fallback' },
    { id: 'runtime.paper', name: 'Paper Runtime Feed', connected: true, mode: 'local-fallback' }
  ];

  const signalMarkets = [...markets].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 12);
  const signals = signalMarkets.map((market, index) => {
    const direction = market.changePct >= 0 ? 'long' : 'short';
    const severity = Math.abs(market.changePct) > 0.9 ? 'high' : Math.abs(market.changePct) > 0.35 ? 'medium' : 'low';
    return {
      id: `local-signal:${market.key}:${now}:${index}`,
      symbol: market.symbol,
      assetClass: market.assetClass,
      type: 'momentum',
      direction,
      severity,
      score: Math.round(clamp(Math.abs(market.changePct) * 95, 10, 99)),
      message: `Local feed momentum drift detected for ${market.symbol}.`,
      timestamp: now - index * 15000
    };
  });

  const decisions = signalMarkets.slice(0, 10).map((market, index) => {
    return {
      id: `local-decision:${market.key}:${now}:${index}`,
      strategyName: 'fallback-momentum',
      action: market.changePct >= 0 ? 'accumulate' : 'reduce',
      reason: `Local fallback signal ${market.changePct >= 0 ? 'upside' : 'downside'} drift on ${market.symbol}.`,
      trigger: 'local-snapshot',
      score: Math.round(clamp(Math.abs(market.changePct) * 90, 15, 98)),
      symbol: market.symbol,
      assetClass: market.assetClass,
      timestamp: now - index * 20000
    };
  });

  const previousUptime = toNum(previousSnapshot?.telemetry?.uptimeMs, 0);

  return {
    running: true,
    now,
    telemetry: {
      uptimeMs: previousUptime + 3000,
      localFallback: true
    },
    controller: {
      mode: 'local-fallback'
    },
    providers,
    markets,
    marketSummary: {
      marketCount: markets.length,
      providerCount: providers.length
    },
    signals,
    signalSummary: {
      lastFiveMinutes: signals.length
    },
    strategies: [
      {
        id: 'fallback-momentum',
        name: 'fallback-momentum',
        enabled: true
      }
    ],
    strategySummary: {
      totalDecisions: toNum(previousSnapshot?.strategySummary?.totalDecisions, 0) + decisions.length
    },
    positions: [],
    decisions,
    feed: [
      {
        id: `local-feed:${now}`,
        type: 'info',
        message: 'Runtime unreachable. Serving local fallback snapshot.',
        timestamp: now
      }
    ]
  };
};
