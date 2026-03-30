import { STRATEGY_OPTIONS } from './strategyEngine';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const randomBetween = (min, max) => min + Math.random() * (max - min);

const deriveFallbackAction = ({ strategyId, changePct, spreadBps, volatility }) => {
  const id = String(strategyId || '').toLowerCase();
  const direction = changePct >= 0 ? 1 : -1;
  let bias = direction;

  if (id.includes('reversion') || id.includes('fade') || id.includes('arb') || id.includes('carry')) {
    bias = -direction;
  }

  const lowImpulse = Math.abs(changePct) < 0.12;
  const mediumImpulse = Math.abs(changePct) < 0.24;
  const spreadHeavy = spreadBps > 19;
  const highVolatility = volatility > 0.012;

  if (id.includes('signal-consensus') || id.includes('signal-cluster')) {
    if (mediumImpulse || spreadHeavy) bias = 0;
  }
  if (id.includes('signal-single')) {
    if (lowImpulse) bias = 0;
  }
  if (id.includes('drift-guard')) {
    if (mediumImpulse || spreadHeavy || highVolatility) bias = 0;
  }
  if (id.includes('breakout')) {
    if (mediumImpulse) bias = 0;
  }
  if (id.includes('micro-scalp')) {
    if (spreadBps > 14) bias = 0;
  }

  if (bias > 0) return 'accumulate';
  if (bias < 0) return 'reduce';
  return 'hold';
};

const buildFallbackReason = ({ strategyLabel, action, market }) => {
  const directionCopy = action === 'accumulate' ? 'upside' : action === 'reduce' ? 'downside' : 'neutral';
  return `Local ${strategyLabel} model found ${directionCopy} setup on ${market.symbol} (${market.assetClass}).`;
};

const cryptoProviders = [
  { id: 'binance', name: 'Binance Socket', venue: 'BINANCE' },
  { id: 'coinbase', name: 'Coinbase Socket', venue: 'COINBASE' },
  { id: 'kraken', name: 'Kraken Socket', venue: 'KRAKEN' },
  { id: 'okx', name: 'OKX Socket', venue: 'OKX' },
  { id: 'bybit', name: 'Bybit Socket', venue: 'BYBIT' }
];
const equityProviders = [
  { id: 'paper-equity', name: 'Paper Equity Feed', venue: 'SIM' },
  { id: 'iex-equity', name: 'IEX Equity Feed', venue: 'IEX' },
  { id: 'polygon-equity', name: 'Polygon Equity Feed', venue: 'POLYGON' },
  { id: 'alpaca-equity', name: 'Alpaca Equity Feed', venue: 'ALPACA' }
];
const fxProviders = [
  { id: 'paper-fx', name: 'Paper FX Feed', venue: 'SIM' },
  { id: 'oanda-fx', name: 'Oanda FX Feed', venue: 'OANDA' },
  { id: 'fxcm-fx', name: 'FXCM FX Feed', venue: 'FXCM' }
];
const commodityProviders = [
  { id: 'paper-commodities', name: 'Paper Commodities Feed', venue: 'SIM' },
  { id: 'cme-commodities', name: 'CME Commodities Feed', venue: 'CME' },
  { id: 'ice-commodities', name: 'ICE Commodities Feed', venue: 'ICE' }
];
const indexProviders = [
  { id: 'paper-index', name: 'Paper Index Feed', venue: 'SIM' },
  { id: 'cboe-index', name: 'CBOE Index Feed', venue: 'CBOE' },
  { id: 'eurex-index', name: 'Eurex Index Feed', venue: 'EUREX' }
];
const ratesProviders = [
  { id: 'paper-rates', name: 'Paper Rates Feed', venue: 'SIM' },
  { id: 'cme-rates', name: 'CME Rates Feed', venue: 'CME' },
  { id: 'ust-rates', name: 'UST Rates Feed', venue: 'UST' }
];
const futuresProviders = [
  { id: 'binance-futures', name: 'Binance Futures', venue: 'BINANCE' },
  { id: 'bybit-futures', name: 'Bybit Futures', venue: 'BYBIT' },
  { id: 'deribit-futures', name: 'Deribit Futures', venue: 'DERIBIT' },
  { id: 'cme-futures', name: 'CME Futures', venue: 'CME' }
];
const optionsProviders = [
  { id: 'deribit-options', name: 'Deribit Options', venue: 'DERIBIT' },
  { id: 'cboe-options', name: 'CBOE Options', venue: 'CBOE' },
  { id: 'cme-options', name: 'CME Options', venue: 'CME' }
];

const toSeed = (assetClass, row, providers) => {
  const { symbol, referencePrice, spreadBps, totalVolume, volatility, ...rest } = row;
  return {
    key: `${assetClass}:${String(symbol).toLowerCase()}`,
    symbol,
    assetClass,
    referencePrice,
    spreadBps,
    totalVolume,
    volatility,
    ...rest,
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
    { symbol: 'LTCUSDT', referencePrice: 92.1, spreadBps: 10.4, totalVolume: 174000000, volatility: 0.0081 },
    { symbol: 'BCHUSDT', referencePrice: 515.2, spreadBps: 10.8, totalVolume: 196000000, volatility: 0.0087 },
    { symbol: 'TRXUSDT', referencePrice: 0.136, spreadBps: 14.2, totalVolume: 188000000, volatility: 0.0101 },
    { symbol: 'NEARUSDT', referencePrice: 7.88, spreadBps: 14.6, totalVolume: 165000000, volatility: 0.0114 },
    { symbol: 'ATOMUSDT', referencePrice: 11.2, spreadBps: 13.5, totalVolume: 152000000, volatility: 0.0102 },
    { symbol: 'UNIUSDT', referencePrice: 12.5, spreadBps: 14.1, totalVolume: 145000000, volatility: 0.0107 },
    { symbol: 'APTUSDT', referencePrice: 13.8, spreadBps: 15.8, totalVolume: 139000000, volatility: 0.0121 },
    { symbol: 'ARBUSDT', referencePrice: 1.52, spreadBps: 16.2, totalVolume: 132000000, volatility: 0.0134 },
    { symbol: 'OPUSDT', referencePrice: 3.21, spreadBps: 16.1, totalVolume: 118000000, volatility: 0.0131 },
    { symbol: 'SUIUSDT', referencePrice: 1.95, spreadBps: 16.7, totalVolume: 114000000, volatility: 0.0142 }
  ].map((row) => toSeed('crypto', row, cryptoProviders)),
  ...[
    { symbol: 'AAPL', referencePrice: 208.9, spreadBps: 2.3, totalVolume: 382000000, volatility: 0.0017 },
    { symbol: 'MSFT', referencePrice: 432.2, spreadBps: 1.9, totalVolume: 309000000, volatility: 0.0015 },
    { symbol: 'NVDA', referencePrice: 1011.4, spreadBps: 2.8, totalVolume: 406000000, volatility: 0.0022 },
    { symbol: 'AMZN', referencePrice: 191.6, spreadBps: 2.2, totalVolume: 248000000, volatility: 0.0019 },
    { symbol: 'GOOGL', referencePrice: 178.3, spreadBps: 2.1, totalVolume: 223000000, volatility: 0.0018 },
    { symbol: 'TSLA', referencePrice: 236.4, spreadBps: 3.4, totalVolume: 331000000, volatility: 0.0029 },
    { symbol: 'META', referencePrice: 519.1, spreadBps: 2.4, totalVolume: 214000000, volatility: 0.0019 },
    { symbol: 'AMD', referencePrice: 187.7, spreadBps: 2.7, totalVolume: 182000000, volatility: 0.0024 },
    { symbol: 'NFLX', referencePrice: 634.8, spreadBps: 2.9, totalVolume: 171000000, volatility: 0.0025 },
    { symbol: 'JPM', referencePrice: 204.6, spreadBps: 2.1, totalVolume: 163000000, volatility: 0.0019 },
    { symbol: 'BAC', referencePrice: 42.8, spreadBps: 2.3, totalVolume: 148000000, volatility: 0.002 },
    { symbol: 'WMT', referencePrice: 72.1, spreadBps: 2.2, totalVolume: 141000000, volatility: 0.0018 },
    { symbol: 'XOM', referencePrice: 122.4, spreadBps: 2.5, totalVolume: 139000000, volatility: 0.0021 },
    { symbol: 'V', referencePrice: 287.5, spreadBps: 2.1, totalVolume: 129000000, volatility: 0.0018 },
    { symbol: 'DIS', referencePrice: 114.3, spreadBps: 2.6, totalVolume: 122000000, volatility: 0.0023 },
    { symbol: 'QQQ', referencePrice: 514.9, spreadBps: 1.8, totalVolume: 226000000, volatility: 0.0016 },
    { symbol: 'SPY', referencePrice: 539.6, spreadBps: 1.8, totalVolume: 264000000, volatility: 0.0016 },
    { symbol: 'IWM', referencePrice: 217.7, spreadBps: 2.1, totalVolume: 118000000, volatility: 0.0019 }
  ].map((row) => toSeed('equity', row, equityProviders)),
  ...[
    { symbol: 'EURUSD', referencePrice: 1.0842, spreadBps: 1.2, totalVolume: 608000000, volatility: 0.0009 },
    { symbol: 'USDJPY', referencePrice: 149.31, spreadBps: 1.5, totalVolume: 574000000, volatility: 0.0011 },
    { symbol: 'GBPUSD', referencePrice: 1.2746, spreadBps: 1.6, totalVolume: 452000000, volatility: 0.0011 },
    { symbol: 'AUDUSD', referencePrice: 0.6665, spreadBps: 1.8, totalVolume: 317000000, volatility: 0.0012 },
    { symbol: 'USDCAD', referencePrice: 1.3514, spreadBps: 1.7, totalVolume: 296000000, volatility: 0.001 },
    { symbol: 'USDCHF', referencePrice: 0.8931, spreadBps: 1.5, totalVolume: 241000000, volatility: 0.001 },
    { symbol: 'NZDUSD', referencePrice: 0.6128, spreadBps: 1.9, totalVolume: 198000000, volatility: 0.0013 },
    { symbol: 'EURJPY', referencePrice: 161.95, spreadBps: 1.7, totalVolume: 274000000, volatility: 0.0012 },
    { symbol: 'GBPJPY', referencePrice: 190.12, spreadBps: 1.9, totalVolume: 232000000, volatility: 0.0014 },
    { symbol: 'EURGBP', referencePrice: 0.8507, spreadBps: 1.4, totalVolume: 215000000, volatility: 0.001 },
    { symbol: 'AUDJPY', referencePrice: 99.51, spreadBps: 1.8, totalVolume: 188000000, volatility: 0.0013 },
    { symbol: 'CADJPY', referencePrice: 110.42, spreadBps: 1.7, totalVolume: 171000000, volatility: 0.0012 },
    { symbol: 'CHFJPY', referencePrice: 167.24, spreadBps: 1.7, totalVolume: 163000000, volatility: 0.0012 },
    { symbol: 'EURCHF', referencePrice: 0.9684, spreadBps: 1.5, totalVolume: 147000000, volatility: 0.001 }
  ].map((row) => toSeed('fx', row, fxProviders)),
  ...[
    { symbol: 'XAUUSD', referencePrice: 2288.4, spreadBps: 2.6, totalVolume: 338000000, volatility: 0.0021 },
    { symbol: 'XAGUSD', referencePrice: 27.12, spreadBps: 3.1, totalVolume: 182000000, volatility: 0.0031 },
    { symbol: 'WTIUSD', referencePrice: 81.7, spreadBps: 3.4, totalVolume: 264000000, volatility: 0.0038 },
    { symbol: 'BRENTUSD', referencePrice: 86.2, spreadBps: 3.3, totalVolume: 238000000, volatility: 0.0036 },
    { symbol: 'NATGASUSD', referencePrice: 2.42, spreadBps: 5.2, totalVolume: 156000000, volatility: 0.0068 },
    { symbol: 'COPPERUSD', referencePrice: 4.31, spreadBps: 3.9, totalVolume: 131000000, volatility: 0.0045 }
  ].map((row) => toSeed('commodity', row, commodityProviders)),
  ...[
    { symbol: 'SPX', referencePrice: 5398.2, spreadBps: 1.9, totalVolume: 421000000, volatility: 0.0015 },
    { symbol: 'NDX', referencePrice: 18942.1, spreadBps: 2.1, totalVolume: 352000000, volatility: 0.0018 },
    { symbol: 'DJI', referencePrice: 39884.6, spreadBps: 2.3, totalVolume: 292000000, volatility: 0.0014 },
    { symbol: 'RUT', referencePrice: 2122.8, spreadBps: 2.4, totalVolume: 226000000, volatility: 0.0019 },
    { symbol: 'VIX', referencePrice: 16.8, spreadBps: 3.6, totalVolume: 141000000, volatility: 0.0045 },
    { symbol: 'DAX', referencePrice: 18122.4, spreadBps: 2.4, totalVolume: 185000000, volatility: 0.0019 },
    { symbol: 'NIKKEI225', referencePrice: 40124.7, spreadBps: 2.5, totalVolume: 176000000, volatility: 0.0021 }
  ].map((row) => toSeed('index', row, indexProviders)),
  ...[
    { symbol: 'US02Y', referencePrice: 4.72, spreadBps: 2.4, totalVolume: 124000000, volatility: 0.0016 },
    { symbol: 'US05Y', referencePrice: 4.41, spreadBps: 2.2, totalVolume: 118000000, volatility: 0.0014 },
    { symbol: 'US10Y', referencePrice: 4.31, spreadBps: 2.1, totalVolume: 202000000, volatility: 0.0013 },
    { symbol: 'US30Y', referencePrice: 4.46, spreadBps: 2.3, totalVolume: 111000000, volatility: 0.0012 },
    { symbol: 'DE10Y', referencePrice: 2.42, spreadBps: 2.1, totalVolume: 92000000, volatility: 0.0012 },
    { symbol: 'JP10Y', referencePrice: 1.08, spreadBps: 2.4, totalVolume: 87000000, volatility: 0.0015 }
  ].map((row) => toSeed('rates', row, ratesProviders)),
  ...[
    {
      symbol: 'BTC-PERP',
      referencePrice: 69105.4,
      spreadBps: 9.8,
      totalVolume: 2180000000,
      volatility: 0.0054,
      instrumentType: 'future',
      underlying: 'BTCUSDT',
      expiry: 'PERP',
      basisBps: 16.4,
      fundingRateBps: 1.9,
      openInterest: 9650000000,
      openInterestChangePct: 1.4
    },
    {
      symbol: 'ETH-PERP',
      referencePrice: 3481.2,
      spreadBps: 10.6,
      totalVolume: 1730000000,
      volatility: 0.0061,
      instrumentType: 'future',
      underlying: 'ETHUSDT',
      expiry: 'PERP',
      basisBps: 13.2,
      fundingRateBps: 1.4,
      openInterest: 5420000000,
      openInterestChangePct: 1.1
    },
    {
      symbol: 'SOL-PERP',
      referencePrice: 183.1,
      spreadBps: 12.9,
      totalVolume: 822000000,
      volatility: 0.0098,
      instrumentType: 'future',
      underlying: 'SOLUSDT',
      expiry: 'PERP',
      basisBps: 19.6,
      fundingRateBps: 2.4,
      openInterest: 2610000000,
      openInterestChangePct: 1.7
    },
    {
      symbol: 'ESM26',
      referencePrice: 5425.25,
      spreadBps: 2.8,
      totalVolume: 642000000,
      volatility: 0.0022,
      instrumentType: 'future',
      underlying: 'SPY',
      expiry: '2026-06-19',
      basisBps: 6.1,
      fundingRateBps: 0.3,
      openInterest: 4280000000,
      openInterestChangePct: 0.7
    },
    {
      symbol: 'NQM26',
      referencePrice: 19142.8,
      spreadBps: 3.3,
      totalVolume: 528000000,
      volatility: 0.0028,
      instrumentType: 'future',
      underlying: 'QQQ',
      expiry: '2026-06-19',
      basisBps: 7.6,
      fundingRateBps: 0.4,
      openInterest: 3640000000,
      openInterestChangePct: 0.9
    },
    {
      symbol: 'CLM26',
      referencePrice: 82.54,
      spreadBps: 4.4,
      totalVolume: 371000000,
      volatility: 0.0049,
      instrumentType: 'future',
      underlying: 'WTIUSD',
      expiry: '2026-06-20',
      basisBps: -4.8,
      fundingRateBps: -0.2,
      openInterest: 1980000000,
      openInterestChangePct: 0.6
    }
  ].map((row) => toSeed('derivative', row, futuresProviders)),
  ...[
    {
      symbol: 'BTC-30JUN26-70000-C',
      referencePrice: 5942.6,
      spreadBps: 21.8,
      totalVolume: 432000000,
      volatility: 0.0182,
      instrumentType: 'option',
      underlying: 'BTCUSDT',
      expiry: '2026-06-30',
      strike: 70000,
      optionType: 'call',
      impliedVolPct: 58.4,
      optionSkewPct: 4.2,
      putCallRatio: 0.91,
      openInterest: 1480000000,
      openInterestChangePct: 2.1,
      delta: 0.56,
      gamma: 0.0024,
      vega: 22.8,
      theta: -14.2
    },
    {
      symbol: 'BTC-30JUN26-65000-P',
      referencePrice: 4218.9,
      spreadBps: 23.4,
      totalVolume: 388000000,
      volatility: 0.0174,
      instrumentType: 'option',
      underlying: 'BTCUSDT',
      expiry: '2026-06-30',
      strike: 65000,
      optionType: 'put',
      impliedVolPct: 61.3,
      optionSkewPct: 5.7,
      putCallRatio: 1.08,
      openInterest: 1320000000,
      openInterestChangePct: 1.8,
      delta: -0.47,
      gamma: 0.0021,
      vega: 20.6,
      theta: -12.8
    },
    {
      symbol: 'ETH-30JUN26-3600-C',
      referencePrice: 482.1,
      spreadBps: 24.8,
      totalVolume: 314000000,
      volatility: 0.0197,
      instrumentType: 'option',
      underlying: 'ETHUSDT',
      expiry: '2026-06-30',
      strike: 3600,
      optionType: 'call',
      impliedVolPct: 64.5,
      optionSkewPct: 6.4,
      putCallRatio: 0.95,
      openInterest: 1010000000,
      openInterestChangePct: 1.6,
      delta: 0.52,
      gamma: 0.0031,
      vega: 11.9,
      theta: -6.4
    },
    {
      symbol: 'ETH-30JUN26-3200-P',
      referencePrice: 433.5,
      spreadBps: 25.2,
      totalVolume: 286000000,
      volatility: 0.0191,
      instrumentType: 'option',
      underlying: 'ETHUSDT',
      expiry: '2026-06-30',
      strike: 3200,
      optionType: 'put',
      impliedVolPct: 66.8,
      optionSkewPct: 7.3,
      putCallRatio: 1.1,
      openInterest: 942000000,
      openInterestChangePct: 1.4,
      delta: -0.45,
      gamma: 0.0028,
      vega: 10.7,
      theta: -5.8
    },
    {
      symbol: 'SPY-17JUL26-560-C',
      referencePrice: 18.42,
      spreadBps: 14.6,
      totalVolume: 221000000,
      volatility: 0.0128,
      instrumentType: 'option',
      underlying: 'SPY',
      expiry: '2026-07-17',
      strike: 560,
      optionType: 'call',
      impliedVolPct: 22.7,
      optionSkewPct: -1.8,
      putCallRatio: 0.86,
      openInterest: 622000000,
      openInterestChangePct: 1.1,
      delta: 0.49,
      gamma: 0.0142,
      vega: 0.68,
      theta: -0.34
    },
    {
      symbol: 'SPY-17JUL26-530-P',
      referencePrice: 14.74,
      spreadBps: 15.1,
      totalVolume: 206000000,
      volatility: 0.0123,
      instrumentType: 'option',
      underlying: 'SPY',
      expiry: '2026-07-17',
      strike: 530,
      optionType: 'put',
      impliedVolPct: 24.1,
      optionSkewPct: 2.3,
      putCallRatio: 1.07,
      openInterest: 598000000,
      openInterestChangePct: 0.9,
      delta: -0.43,
      gamma: 0.0128,
      vega: 0.61,
      theta: -0.29
    }
  ].map((row) => toSeed('derivative', row, optionsProviders))
];

const fallbackProviderCatalog = (() => {
  const dedup = new Map();
  for (const seed of marketSeeds) {
    for (const provider of seed.providers || []) {
      if (!provider?.id || dedup.has(provider.id)) continue;
      dedup.set(provider.id, provider);
    }
  }
  return [...dedup.values()];
})();

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
    const instrumentType = String(seed?.instrumentType || '').toLowerCase();

    const previousOpenInterest = Math.max(toNum(previous?.openInterest, seed?.openInterest), 1);
    const openInterest = instrumentType
      ? Math.max(previousOpenInterest * (1 + randomBetween(-0.012, 0.016)), 1)
      : undefined;
    const openInterestChangePct = instrumentType ? ((openInterest - previousOpenInterest) / Math.max(previousOpenInterest, 1e-9)) * 100 : undefined;
    const basisBps =
      instrumentType === 'future'
        ? clamp(toNum(previous?.basisBps, toNum(seed?.basisBps, 0)) + randomBetween(-2.4, 2.4) + changePct * 0.06, -180, 180)
        : undefined;
    const fundingRateBps =
      instrumentType === 'future' && String(seed?.expiry || '').toUpperCase() === 'PERP'
        ? clamp(toNum(previous?.fundingRateBps, toNum(seed?.fundingRateBps, 0)) + randomBetween(-0.55, 0.55), -12, 12)
        : instrumentType === 'future'
          ? clamp(toNum(previous?.fundingRateBps, toNum(seed?.fundingRateBps, 0)) + randomBetween(-0.12, 0.12), -2.5, 2.5)
          : undefined;
    const impliedVolPct =
      instrumentType === 'option'
        ? clamp(toNum(previous?.impliedVolPct, toNum(seed?.impliedVolPct, 35)) + randomBetween(-1.4, 1.4) + Math.abs(changePct) * 0.22, 8, 220)
        : undefined;
    const optionSkewPct =
      instrumentType === 'option'
        ? clamp(toNum(previous?.optionSkewPct, toNum(seed?.optionSkewPct, 0)) + randomBetween(-0.55, 0.55), -28, 28)
        : undefined;
    const putCallRatio =
      instrumentType === 'option'
        ? clamp(toNum(previous?.putCallRatio, toNum(seed?.putCallRatio, 1)) + randomBetween(-0.06, 0.06), 0.2, 2.8)
        : undefined;
    const delta =
      instrumentType === 'option'
        ? clamp(toNum(previous?.delta, toNum(seed?.delta, 0.4)) + randomBetween(-0.03, 0.03), -0.99, 0.99)
        : undefined;
    const gamma =
      instrumentType === 'option'
        ? clamp(toNum(previous?.gamma, toNum(seed?.gamma, 0.002)) + randomBetween(-0.00025, 0.00025), 0.00001, 0.4)
        : undefined;
    const vega =
      instrumentType === 'option'
        ? clamp(toNum(previous?.vega, toNum(seed?.vega, 1)) + randomBetween(-0.2, 0.2), 0.01, 600)
        : undefined;
    const theta =
      instrumentType === 'option'
        ? clamp(toNum(previous?.theta, toNum(seed?.theta, -0.2)) + randomBetween(-0.08, 0.08), -500, 100)
        : undefined;

    return {
      key: seed.key,
      symbol: seed.symbol,
      assetClass: seed.assetClass,
      referencePrice,
      changePct,
      spreadBps,
      volatility: toNum(seed.volatility, 0),
      totalVolume,
      providerCount: providers.length,
      venueCount: new Set(providers.map((provider) => provider.venue)).size,
      providers,
      instrumentType: seed.instrumentType,
      underlying: seed.underlying,
      expiry: seed.expiry,
      strike: seed.strike,
      optionType: seed.optionType,
      basisBps,
      fundingRateBps,
      openInterest,
      openInterestChangePct,
      impliedVolPct,
      optionSkewPct,
      putCallRatio,
      delta,
      gamma,
      vega,
      theta,
      updatedAt: now
    };
  });

  const providers = [
    { id: 'socket.binance.bookTicker', name: 'Binance Socket', connected: true, mode: 'local-fallback' },
    { id: 'socket.coinbase.ticker', name: 'Coinbase Socket', connected: true, mode: 'local-fallback' },
    ...fallbackProviderCatalog.map((provider) => ({
      id: `runtime.${provider.id}`,
      name: provider.name,
      connected: true,
      mode: 'local-fallback'
    }))
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

  const strategyOffset = Math.floor(now / 3000) % Math.max(1, STRATEGY_OPTIONS.length);
  const rotatedStrategies = STRATEGY_OPTIONS.map((_, index) => STRATEGY_OPTIONS[(strategyOffset + index) % STRATEGY_OPTIONS.length]);

  const decisions = rotatedStrategies.map((strategy, index) => {
    const market = signalMarkets[index % Math.max(1, signalMarkets.length)] || markets[index % Math.max(1, markets.length)];
    const action = deriveFallbackAction({
      strategyId: strategy.id,
      changePct: toNum(market?.changePct, 0),
      spreadBps: toNum(market?.spreadBps, 0),
      volatility: toNum(market?.volatility, 0)
    });
    const changeAbs = Math.abs(toNum(market?.changePct, 0));
    const scoreBase = action === 'hold' ? changeAbs * 62 : changeAbs * 88;
    const score = Math.round(clamp(scoreBase + randomBetween(7, 19), 8, 99));

    return {
      id: `local-decision:${strategy.id}:${market?.key || 'market'}:${now}:${index}`,
      strategyName: strategy.id,
      action,
      reason: buildFallbackReason({
        strategyLabel: strategy.label || strategy.id,
        action,
        market: market || { symbol: 'UNKNOWN', assetClass: 'unknown' }
      }),
      trigger: 'local-strategy-sim',
      score,
      symbol: market?.symbol || 'UNKNOWN',
      assetClass: market?.assetClass || 'unknown',
      timestamp: now - index * 2600
    };
  });

  const previousUptime = toNum(previousSnapshot?.telemetry?.uptimeMs, 0);
  const previousSignalTotal = toNum(previousSnapshot?.signalSummary?.total, toNum(previousSnapshot?.telemetry?.signalsGenerated, 0));
  const previousDecisionTotal = toNum(previousSnapshot?.strategySummary?.totalDecisions, toNum(previousSnapshot?.telemetry?.decisionsGenerated, 0));
  const nextSignalTotal = previousSignalTotal + signals.length;
  const nextDecisionTotal = previousDecisionTotal + decisions.length;

  return {
    running: true,
    now,
    telemetry: {
      uptimeMs: previousUptime + 3000,
      localFallback: true,
      signalsGenerated: nextSignalTotal,
      decisionsGenerated: nextDecisionTotal
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
      total: nextSignalTotal,
      lastFiveMinutes: signals.length
    },
    strategies: STRATEGY_OPTIONS.map((strategy) => ({
      id: strategy.id,
      name: strategy.label || strategy.id,
      description: strategy.description || '',
      enabled: true
    })),
    strategySummary: {
      totalDecisions: nextDecisionTotal
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
