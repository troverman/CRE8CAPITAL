const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toText = (value, fallback = '-') => {
  const text = String(value || '').trim();
  return text || fallback;
};

const hashSeed = (text) => {
  const value = String(text || 'seed');
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const pulseForKey = (key, timestamp) => {
  const bucket = Math.floor(toNum(timestamp, Date.now()) / 30000);
  const seed = hashSeed(`${key}:${bucket}`);
  return ((seed % 2000) / 1000 - 1) * 0.82;
};

const inferScope = ({ key = '', name = '', assetSet = new Set() }) => {
  const merged = `${String(key || '').toLowerCase()} ${String(name || '').toLowerCase()}`;
  const assets = [...assetSet].map((value) => String(value || '').toLowerCase());
  const uniqueAssets = new Set(assets);
  if (merged.includes('future') || merged.includes('futures') || merged.includes('perp')) return 'futures';
  if (merged.includes('option') || merged.includes('options')) return 'options';
  if (merged.includes('derivative')) return 'derivatives';
  if (merged.includes('macro') || merged.includes('fred') || merged.includes('calendar')) return 'macro';
  if (merged.includes('news') || merged.includes('sentiment')) return 'sentiment';
  if (merged.includes('onchain') || merged.includes('glassnode') || merged.includes('dune')) return 'on-chain';
  if (merged.includes('rate') || merged.includes('yield') || merged.includes('ust')) return 'rates';
  if (uniqueAssets.size === 1) {
    const [first] = uniqueAssets;
    if (first) return first;
  }
  if (uniqueAssets.has('crypto')) return 'crypto';
  if (uniqueAssets.has('equity')) return 'equity';
  if (uniqueAssets.has('fx')) return 'fx';
  if (uniqueAssets.has('commodity')) return 'commodity';
  if (uniqueAssets.has('index')) return 'index';
  return 'cross-market';
};

export const toProviderKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

export const PROVIDER_SCOPE_CATALOG = [
  { id: 'binance', name: 'Binance Socket', scope: 'crypto', channel: 'spot/orderbook', source: 'market-data' },
  { id: 'coinbase', name: 'Coinbase Socket', scope: 'crypto', channel: 'spot/orderbook', source: 'market-data' },
  { id: 'kraken', name: 'Kraken Socket', scope: 'crypto', channel: 'spot/orderbook', source: 'market-data' },
  { id: 'okx', name: 'OKX Socket', scope: 'crypto', channel: 'spot/orderbook', source: 'market-data' },
  { id: 'bybit', name: 'Bybit Socket', scope: 'crypto', channel: 'derivatives/spot', source: 'market-data' },
  { id: 'binance-futures', name: 'Binance Futures', scope: 'futures', channel: 'perp/futures orderbook', source: 'derivatives' },
  { id: 'bybit-futures', name: 'Bybit Futures', scope: 'futures', channel: 'perp/futures orderbook', source: 'derivatives' },
  { id: 'deribit-futures', name: 'Deribit Futures', scope: 'futures', channel: 'perp/futures orderbook', source: 'derivatives' },
  { id: 'cme-futures', name: 'CME Futures', scope: 'futures', channel: 'futures tape', source: 'derivatives' },
  { id: 'deribit-options', name: 'Deribit Options', scope: 'options', channel: 'options chain', source: 'derivatives' },
  { id: 'cboe-options', name: 'CBOE Options', scope: 'options', channel: 'options chain', source: 'derivatives' },
  { id: 'cme-options', name: 'CME Options', scope: 'options', channel: 'options chain', source: 'derivatives' },
  { id: 'iex-equity', name: 'IEX Equity Feed', scope: 'equity', channel: 'equity tape', source: 'market-data' },
  { id: 'polygon-equity', name: 'Polygon Equity Feed', scope: 'equity', channel: 'equity tape', source: 'market-data' },
  { id: 'alpaca-equity', name: 'Alpaca Equity Feed', scope: 'equity', channel: 'broker feed', source: 'market-data' },
  { id: 'oanda-fx', name: 'Oanda FX Feed', scope: 'fx', channel: 'fx stream', source: 'market-data' },
  { id: 'fxcm-fx', name: 'FXCM FX Feed', scope: 'fx', channel: 'fx stream', source: 'market-data' },
  { id: 'cme-commodities', name: 'CME Commodities Feed', scope: 'commodity', channel: 'futures', source: 'market-data' },
  { id: 'ice-commodities', name: 'ICE Commodities Feed', scope: 'commodity', channel: 'futures', source: 'market-data' },
  { id: 'cboe-index', name: 'CBOE Index Feed', scope: 'index', channel: 'index tape', source: 'market-data' },
  { id: 'eurex-index', name: 'Eurex Index Feed', scope: 'index', channel: 'index tape', source: 'market-data' },
  { id: 'cme-rates', name: 'CME Rates Feed', scope: 'rates', channel: 'rates futures', source: 'market-data' },
  { id: 'ust-rates', name: 'UST Rates Feed', scope: 'rates', channel: 'treasury curve', source: 'market-data' },
  { id: 'fred-macro', name: 'FRED Macro', scope: 'macro', channel: 'inflation/rates', source: 'macro' },
  { id: 'bls-labor', name: 'BLS Labor', scope: 'macro', channel: 'employment', source: 'macro' },
  { id: 'bea-growth', name: 'BEA GDP', scope: 'macro', channel: 'growth', source: 'macro' },
  { id: 'fomc-policy', name: 'FOMC Policy', scope: 'macro', channel: 'policy', source: 'policy' },
  { id: 'sec-regulatory', name: 'SEC Regulatory', scope: 'policy', channel: 'regulation', source: 'policy' },
  { id: 'cftc-cot', name: 'CFTC COT', scope: 'policy', channel: 'positioning', source: 'policy' },
  { id: 'glassnode-onchain', name: 'Glassnode On-Chain', scope: 'on-chain', channel: 'network metrics', source: 'on-chain' },
  { id: 'dune-onchain', name: 'Dune On-Chain', scope: 'on-chain', channel: 'protocol flow', source: 'on-chain' },
  { id: 'lunarcrush-sentiment', name: 'LunarCrush Sentiment', scope: 'sentiment', channel: 'social sentiment', source: 'sentiment' },
  { id: 'news-wire', name: 'News Wire', scope: 'news', channel: 'breaking headlines', source: 'news' }
];

const ensureProvider = (map, key, defaults = {}) => {
  const safeKey = toProviderKey(key);
  if (!safeKey) return null;
  const existing = map.get(safeKey) || {
    key: safeKey,
    id: defaults.id || safeKey,
    name: defaults.name || safeKey,
    channel: defaults.channel || '',
    source: defaults.source || 'market-data',
    scope: defaults.scope || 'cross-market',
    connected: false,
    error: '',
    lastSeenAt: 0,
    marketSet: new Set(),
    assetSet: new Set(),
    quoteCount: 0,
    totalQuoteVolume: 0,
    spreadSumBps: 0,
    spreadCount: 0,
    runtimeSeen: false,
    watchlisted: false
  };
  if (defaults.id && (!existing.id || existing.id === existing.key)) existing.id = defaults.id;
  if (defaults.name && (!existing.name || existing.name === existing.key)) existing.name = defaults.name;
  if (defaults.channel && !existing.channel) existing.channel = defaults.channel;
  if (defaults.source && !existing.source) existing.source = defaults.source;
  if (defaults.scope && (!existing.scope || existing.scope === 'cross-market')) existing.scope = defaults.scope;
  map.set(safeKey, existing);
  return existing;
};

const buildMarketKeyByIdentity = (markets = []) => {
  const map = new Map();
  for (const market of markets) {
    const symbol = String(market?.symbol || '').toUpperCase();
    const assetClass = String(market?.assetClass || '').toLowerCase();
    if (!symbol || !assetClass || !market?.key) continue;
    map.set(`${symbol}|${assetClass}`, market.key);
  }
  return map;
};

const aggregateScopeRegime = (markets = []) => {
  const bucket = new Map();
  for (const market of markets || []) {
    const scope = String(market?.assetClass || 'unknown').toLowerCase();
    const row = bucket.get(scope) || {
      scope,
      weightedChange: 0,
      weight: 0,
      positive: 0,
      negative: 0
    };
    const weight = Math.max(1, Math.log1p(Math.max(toNum(market?.totalVolume, 1), 1)));
    const change = toNum(market?.changePct, 0);
    row.weightedChange += change * weight;
    row.weight += weight;
    if (change > 0) row.positive += 1;
    else if (change < 0) row.negative += 1;
    bucket.set(scope, row);
  }
  return [...bucket.values()].map((row) => {
    const avgChange = row.weightedChange / Math.max(row.weight, 1e-9);
    const breadth = (row.positive - row.negative) / Math.max(row.positive + row.negative, 1);
    return {
      ...row,
      avgChange,
      breadth
    };
  });
};

export const buildProviderRows = (snapshot) => {
  const map = new Map();
  const markets = Array.isArray(snapshot?.markets) ? snapshot.markets : [];
  const totalMarkets = Math.max(1, markets.length);
  const runtimeProviders = Array.isArray(snapshot?.providers) ? snapshot.providers : [];

  for (const runtime of runtimeProviders) {
    const key = toProviderKey(runtime?.id || runtime?.name);
    if (!key) continue;
    const row = ensureProvider(map, key, {
      id: toText(runtime?.id, key),
      name: toText(runtime?.name, key),
      source: 'runtime'
    });
    if (!row) continue;
    row.connected = Boolean(runtime?.connected) || row.connected;
    row.error = toText(runtime?.error, '');
    row.lastSeenAt = Math.max(row.lastSeenAt, toNum(runtime?.lastTickAt, 0), toNum(snapshot?.now, 0));
    row.runtimeSeen = true;
  }

  for (const market of markets) {
    for (const provider of market?.providers || []) {
      const key = toProviderKey(provider?.id || provider?.name);
      if (!key) continue;
      const row = ensureProvider(map, key, {
        id: toText(provider?.id, key),
        name: toText(provider?.name, key),
        source: 'market-data'
      });
      if (!row) continue;
      row.marketSet.add(String(market?.key || ''));
      row.assetSet.add(String(market?.assetClass || 'unknown').toLowerCase());
      row.quoteCount += 1;
      row.totalQuoteVolume += Math.max(0, toNum(provider?.volume, 0));
      row.lastSeenAt = Math.max(row.lastSeenAt, toNum(provider?.timestamp, 0), toNum(market?.updatedAt, 0), toNum(snapshot?.now, 0));

      const bid = toNum(provider?.bid, NaN);
      const ask = toNum(provider?.ask, NaN);
      const px = Math.max(toNum(provider?.price, toNum(market?.referencePrice, NaN)), 1e-9);
      if (Number.isFinite(bid) && Number.isFinite(ask) && ask > bid && Number.isFinite(px) && px > 0) {
        row.spreadSumBps += ((ask - bid) / px) * 10000;
        row.spreadCount += 1;
      }
      if (Number.isFinite(toNum(provider?.price, NaN))) row.connected = true;
    }
  }

  for (const scopeProvider of PROVIDER_SCOPE_CATALOG) {
    const key = toProviderKey(scopeProvider.id);
    const row = ensureProvider(map, key, {
      id: scopeProvider.id,
      name: scopeProvider.name,
      scope: scopeProvider.scope,
      channel: scopeProvider.channel,
      source: scopeProvider.source
    });
    if (!row) continue;
    row.watchlisted = true;
  }

  return [...map.values()]
    .map((row) => {
      const scope = row.scope && row.scope !== 'cross-market' ? row.scope : inferScope(row);
      const coveragePct = (row.marketSet.size / totalMarkets) * 100;
      return {
        id: row.id || row.key,
        key: row.key,
        name: row.name || row.key,
        scope,
        channel: row.channel || '',
        source: row.source || 'market-data',
        connected: Boolean(row.connected),
        error: row.error || '',
        lastSeenAt: row.lastSeenAt || null,
        marketCount: row.marketSet.size,
        assetCount: row.assetSet.size,
        coveragePct,
        quoteCount: row.quoteCount,
        totalQuoteVolume: row.totalQuoteVolume,
        avgSpreadBps: row.spreadCount > 0 ? row.spreadSumBps / row.spreadCount : null,
        assetClasses: [...row.assetSet].sort(),
        runtimeSeen: row.runtimeSeen,
        watchlisted: row.watchlisted
      };
    })
    .sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      if (b.coveragePct !== a.coveragePct) return b.coveragePct - a.coveragePct;
      if (b.quoteCount !== a.quoteCount) return b.quoteCount - a.quoteCount;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
};

export const summarizeProviderScopes = (providerRows = []) => {
  const bucket = new Map();
  for (const provider of providerRows || []) {
    const scope = String(provider?.scope || 'cross-market').toLowerCase();
    const row = bucket.get(scope) || {
      scope,
      count: 0,
      connected: 0,
      marketTouches: 0,
      coverageTotal: 0
    };
    row.count += 1;
    if (provider?.connected) row.connected += 1;
    row.marketTouches += toNum(provider?.marketCount, 0);
    row.coverageTotal += toNum(provider?.coveragePct, 0);
    bucket.set(scope, row);
  }

  return [...bucket.values()]
    .map((row) => ({
      ...row,
      connectedPct: row.count > 0 ? (row.connected / row.count) * 100 : 0,
      avgCoveragePct: row.count > 0 ? row.coverageTotal / row.count : 0
    }))
    .sort((a, b) => b.count - a.count);
};

export const getProviderMarketRows = (snapshot, providerId) => {
  const target = toProviderKey(providerId);
  if (!target) return [];
  const markets = Array.isArray(snapshot?.markets) ? snapshot.markets : [];
  const rows = [];
  for (const market of markets) {
    for (const provider of market?.providers || []) {
      const key = toProviderKey(provider?.id || provider?.name);
      if (key !== target) continue;
      rows.push({
        key: market.key,
        symbol: market.symbol,
        assetClass: market.assetClass,
        price: toNum(provider?.price, toNum(market?.referencePrice, 0)),
        bid: toNum(provider?.bid, NaN),
        ask: toNum(provider?.ask, NaN),
        volume: Math.max(0, toNum(provider?.volume, 0)),
        timestamp: toNum(provider?.timestamp, toNum(market?.updatedAt, toNum(snapshot?.now, Date.now())))
      });
      break;
    }
  }
  return rows.sort((a, b) => b.timestamp - a.timestamp);
};

export const findProviderRow = (snapshot, providerId) => {
  const target = toProviderKey(providerId);
  if (!target) return null;
  return buildProviderRows(snapshot).find((row) => row.key === target || toProviderKey(row.id) === target || toProviderKey(row.name) === target) || null;
};

export const buildProviderInfluenceFeed = ({ snapshot, providerRows = [], limit = 220 }) => {
  const now = toNum(snapshot?.now, Date.now());
  const markets = Array.isArray(snapshot?.markets) ? snapshot.markets : [];
  const signals = Array.isArray(snapshot?.signals) ? snapshot.signals : [];
  const decisions = Array.isArray(snapshot?.decisions) ? snapshot.decisions : [];
  const scopeRegimes = aggregateScopeRegime(markets);
  const scopeRegimeMap = new Map(scopeRegimes.map((row) => [row.scope, row]));
  const marketKeyByIdentity = buildMarketKeyByIdentity(markets);

  const rows = [];
  const providers = Array.isArray(providerRows) ? providerRows : [];

  providers.slice(0, 96).forEach((provider, index) => {
    const scope = String(provider?.scope || 'cross-market').toLowerCase();
    const scopeRow = scopeRegimeMap.get(scope) || scopeRegimeMap.get('crypto') || { avgChange: 0, breadth: 0 };
    const pulse = pulseForKey(provider.key, now);
    const regimeBias = clamp(toNum(scopeRow.avgChange, 0) / 2.8 + toNum(scopeRow.breadth, 0) * 0.7, -1, 1);
    const connectivityBias = provider.connected ? 0.14 : -0.24;
    const coverageBias = clamp(toNum(provider.coveragePct, 0) / 100, 0, 1) * 0.3;
    const scorePct = clamp((0.5 + pulse * 0.27 + regimeBias * 0.34 + connectivityBias + coverageBias) * 100, 1, 99);
    const stance = scorePct >= 56 ? 'risk-on' : scorePct <= 44 ? 'risk-off' : 'neutral';
    const severity = scorePct >= 76 || scorePct <= 24 ? 'high' : scorePct >= 62 || scorePct <= 38 ? 'medium' : 'low';
    const influence = (scorePct - 50) / 50;

    rows.push({
      id: `knowledge:provider:${provider.key}:${Math.floor(now / 30000)}:${index}`,
      kind: 'provider',
      providerKey: provider.key,
      providerId: provider.id,
      providerName: provider.name,
      scope,
      source: provider.source || 'market-data',
      channel: provider.channel || 'market feed',
      message: `${provider.name} ${provider.connected ? 'is live' : 'is watchlisted'} | scope ${scope} | coverage ${provider.coveragePct.toFixed(1)}%`,
      score: scorePct,
      influence,
      stance,
      severity,
      timestamp: now - index * 9000
    });
  });

  scopeRegimes.slice(0, 10).forEach((regime, index) => {
    const scorePct = clamp(50 + regime.avgChange * 13 + regime.breadth * 24, 1, 99);
    rows.push({
      id: `knowledge:regime:${regime.scope}:${Math.floor(now / 20000)}:${index}`,
      kind: 'regime',
      providerKey: '',
      providerId: '',
      providerName: `${regime.scope} regime`,
      scope: regime.scope,
      source: 'cross-market',
      channel: 'regime',
      message: `${regime.scope} weighted drift ${regime.avgChange.toFixed(3)}% | breadth ${regime.breadth.toFixed(3)}`,
      score: scorePct,
      influence: (scorePct - 50) / 50,
      stance: scorePct >= 54 ? 'risk-on' : scorePct <= 46 ? 'risk-off' : 'neutral',
      severity: scorePct >= 72 || scorePct <= 28 ? 'high' : 'medium',
      timestamp: now - 120000 - index * 9000
    });
  });

  signals.slice(0, 24).forEach((signal, index) => {
    const score = clamp(toNum(signal?.score, 50), 1, 99);
    const direction = String(signal?.direction || 'neutral').toLowerCase();
    rows.push({
      id: `knowledge:signal:${toText(signal?.id, index)}:${index}`,
      kind: 'signal',
      providerKey: 'signal-engine',
      providerId: 'signal-engine',
      providerName: 'Signal Engine',
      scope: String(signal?.assetClass || 'cross-market').toLowerCase(),
      source: 'signal',
      channel: toText(signal?.type, 'signal'),
      message: toText(signal?.message, `Signal relay ${signal?.symbol || '-'}`),
      score,
      influence: direction === 'long' ? score / 100 : direction === 'short' ? -score / 100 : (score - 50) / 100,
      stance: direction === 'long' ? 'risk-on' : direction === 'short' ? 'risk-off' : 'neutral',
      severity: String(signal?.severity || 'low').toLowerCase(),
      signalId: toText(signal?.id, ''),
      symbol: toText(signal?.symbol, '-'),
      assetClass: toText(signal?.assetClass, 'unknown'),
      marketKey: marketKeyByIdentity.get(`${String(signal?.symbol || '').toUpperCase()}|${String(signal?.assetClass || '').toLowerCase()}`) || '',
      timestamp: toNum(signal?.timestamp, now - 260000 - index * 4000)
    });
  });

  decisions.slice(0, 24).forEach((decision, index) => {
    const score = clamp(toNum(decision?.score, 50), 1, 99);
    const action = String(decision?.action || 'hold').toLowerCase();
    rows.push({
      id: `knowledge:decision:${toText(decision?.id, index)}:${index}`,
      kind: 'decision',
      providerKey: 'strategy-engine',
      providerId: 'strategy-engine',
      providerName: 'Strategy Engine',
      scope: String(decision?.assetClass || 'cross-market').toLowerCase(),
      source: 'decision',
      channel: toText(decision?.trigger, 'decision'),
      message: toText(decision?.reason, `${decision?.strategyName || 'strategy'} decision`),
      score,
      influence: action === 'accumulate' ? score / 100 : action === 'reduce' ? -score / 100 : (score - 50) / 100,
      stance: action === 'accumulate' ? 'risk-on' : action === 'reduce' ? 'risk-off' : 'neutral',
      severity: score >= 72 ? 'high' : score >= 56 ? 'medium' : 'low',
      decisionId: toText(decision?.id, ''),
      strategyId: toText(decision?.strategyName || decision?.strategy, ''),
      symbol: toText(decision?.symbol, '-'),
      assetClass: toText(decision?.assetClass, 'unknown'),
      marketKey: marketKeyByIdentity.get(`${String(decision?.symbol || '').toUpperCase()}|${String(decision?.assetClass || '').toLowerCase()}`) || '',
      timestamp: toNum(decision?.timestamp, now - 340000 - index * 3500)
    });
  });

  return rows
    .sort((a, b) => {
      if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
      return toNum(b.score, 0) - toNum(a.score, 0);
    })
    .slice(0, Math.max(20, Math.round(toNum(limit, 220))));
};
