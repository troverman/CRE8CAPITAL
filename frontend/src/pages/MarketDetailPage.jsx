import { useEffect, useMemo, useState } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import LineChart from '../components/LineChart';
import OrderBook3D from '../components/OrderBook3D';
import Sparkline from '../components/Sparkline';
import useSocketProviders from '../hooks/useSocketProviders';
import useTensorStrategy from '../hooks/useTensorStrategy';
import { fmtCompact, fmtInt, fmtNum, fmtPct, fmtTime, severityClass } from '../lib/format';
import { buildClassicAnalysis } from '../lib/indicators';
import { Link } from '../lib/router';

const MULTIMARKET_URL = import.meta.env.VITE_MULTIMARKET_URL || 'https://multimarket.cre8.xyz';
const DEPTH_SNAPSHOT_LIMIT = 48;
const DEPTH_LEVEL_LIMIT = 12;
const QUOTE_SUFFIXES = ['USDT', 'USDC', 'USD', 'BTC', 'ETH', 'EUR', 'GBP', 'JPY'];
const STABLE_QUOTES = new Set(['USDT', 'USDC', 'USD']);
const MARKET_SUBTAB_DEFS = [
  {
    key: 'overview',
    label: 'Overview',
    socketOnly: false,
    description: 'Reference price, spread, and classic indicator context.'
  },
  {
    key: 'tensor',
    label: 'Tensor',
    socketOnly: true,
    description: 'Micro-weighted tensor model, strategy score, and live tensor events.'
  },
  {
    key: 'depth',
    label: 'Depth',
    socketOnly: true,
    description: 'Provider socket status, order book depth, and live tick tape.'
  },
  {
    key: 'intel',
    label: 'Intel',
    socketOnly: false,
    description: 'Runtime/provider quote table with linked signal feed.'
  },
  {
    key: 'decisions',
    label: 'Decisions',
    socketOnly: false,
    description: 'Recent strategy decisions and trigger context for this market.'
  }
];

const pickFirstFinite = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'boolean') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
};

const normalizeSymbolText = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const splitSymbolPair = (symbol) => {
  const normalized = normalizeSymbolText(symbol);
  if (!normalized) return null;
  for (const quote of QUOTE_SUFFIXES) {
    if (normalized.endsWith(quote) && normalized.length > quote.length) {
      const base = normalized.slice(0, normalized.length - quote.length);
      if (base.length >= 2) return { base, quote, normalized };
    }
  }
  return null;
};

const formatSymbolPair = (pair, fallbackSymbol) => {
  if (!pair) return normalizeSymbolText(fallbackSymbol) || '-';
  return `${pair.base}/${pair.quote}`;
};

const getPairBasis = (marketPair, rowPair) => {
  if (!marketPair || !rowPair) return { label: 'unknown', className: '', score: 1 };
  if (rowPair.base !== marketPair.base) return { label: `pair mismatch (${rowPair.base} vs ${marketPair.base})`, className: 'down', score: 0 };
  if (rowPair.quote === marketPair.quote) return { label: 'aligned', className: 'up', score: 4 };
  if (STABLE_QUOTES.has(rowPair.quote) && STABLE_QUOTES.has(marketPair.quote)) {
    return { label: `stable proxy (${rowPair.quote} vs ${marketPair.quote})`, className: '', score: 3 };
  }
  return { label: `quote mismatch (${rowPair.quote} vs ${marketPair.quote})`, className: 'down', score: 2 };
};

const normalizeDepthSide = (levels, side) => {
  return (Array.isArray(levels) ? levels : [])
    .map((level) => ({
      price: Number(Array.isArray(level) ? level[0] : level?.price),
      size: Number(Array.isArray(level) ? level[1] : level?.size)
    }))
    .filter((level) => Number.isFinite(level.price) && level.price > 0 && Number.isFinite(level.size) && level.size > 0)
    .sort((a, b) => (side === 'bid' ? b.price - a.price : a.price - b.price))
    .slice(0, DEPTH_LEVEL_LIMIT);
};

const normalizeDepthPayload = (depth, fallbackProviderName) => {
  if (!depth) return null;
  const bids = normalizeDepthSide(depth?.bids, 'bid');
  const asks = normalizeDepthSide(depth?.asks, 'ask');
  if (bids.length === 0 && asks.length === 0) return null;

  return {
    providerId: String(depth?.providerId || ''),
    providerName: String(depth?.providerName || fallbackProviderName || ''),
    symbol: depth?.symbol || null,
    assetClass: depth?.assetClass || null,
    venue: depth?.venue || null,
    timestamp: pickFirstFinite(depth?.timestamp, Date.now()),
    bids,
    asks
  };
};

const buildDerivedDepth = ({ midPrice, spreadBps, baseSize, symbol, assetClass, timestamp }) => {
  const safeMidPrice = Number(midPrice);
  if (!Number.isFinite(safeMidPrice) || safeMidPrice <= 0) return null;

  const safeSpreadBps = pickFirstFinite(spreadBps, 8);
  const halfSpread = Math.max((safeMidPrice * Math.max(safeSpreadBps, 0.35)) / 20000, safeMidPrice * 0.00003);
  const stepBase = Math.max(halfSpread * 0.6, safeMidPrice * 0.00006);
  const safeBaseSize = Math.max(Number(baseSize) || 0, 0.0001);

  const bids = [];
  const asks = [];
  for (let index = 0; index < DEPTH_LEVEL_LIMIT; index += 1) {
    const depthLevel = index + 1;
    const distance = halfSpread + stepBase * depthLevel;
    const sizeScale = (1 / Math.sqrt(depthLevel)) * (1 + (DEPTH_LEVEL_LIMIT - depthLevel) * 0.03);
    const size = safeBaseSize * sizeScale;

    bids.push({
      price: Math.max(safeMidPrice - distance, 0.00000001),
      size
    });
    asks.push({
      price: safeMidPrice + distance,
      size: Math.max(size * (0.92 + depthLevel * 0.01), safeBaseSize * 0.18)
    });
  }

  return {
    providerId: 'socket.local.derivedDepth',
    providerName: 'Derived Local Depth',
    symbol: symbol || null,
    assetClass: assetClass || null,
    venue: 'LOCAL',
    timestamp: pickFirstFinite(timestamp, Date.now()),
    bids,
    asks
  };
};

export default function MarketDetailPage({ marketId, snapshot, historyByMarket, onRefresh, syncing }) {
  const normalizedId = String(marketId || '').toLowerCase();
  const market = snapshot.markets.find((item) => {
    return item.key === marketId || String(item.symbol || '').toLowerCase() === normalizedId;
  });

  const supportsSocketProviders = Boolean(market) && String(market.assetClass || '').toLowerCase() === 'crypto';
  const [socketEnabled, setSocketEnabled] = useState(false);
  const [showOrderBook3D, setShowOrderBook3D] = useState(false);
  const [depthSnapshots, setDepthSnapshots] = useState([]);
  const [activeSubtab, setActiveSubtab] = useState('overview');
  const [showRuntimeQuotes, setShowRuntimeQuotes] = useState(false);

  useEffect(() => {
    setSocketEnabled(supportsSocketProviders);
  }, [supportsSocketProviders, market?.key]);

  const socketLiveEnabled = supportsSocketProviders && socketEnabled;
  const marketSubtabs = useMemo(() => {
    return MARKET_SUBTAB_DEFS.filter((tab) => !tab.socketOnly || supportsSocketProviders);
  }, [supportsSocketProviders]);
  const {
    providerStates,
    seriesByProvider,
    depthByProvider,
    primaryProvider,
    primarySeries,
    primaryDepth,
    recentTicks,
    localFallbackActive,
    externalProviderCount,
    externalConnectedCount
  } =
    useSocketProviders({
      market,
      enabled: socketLiveEnabled
    });

  const marketPair = useMemo(() => splitSymbolPair(market?.symbol), [market?.symbol]);
  const latestTickByProviderId = useMemo(() => {
    const map = new Map();
    for (const tick of recentTicks) {
      const providerId = String(tick?.providerId || '');
      if (!providerId || map.has(providerId)) continue;
      map.set(providerId, tick);
    }
    return map;
  }, [recentTicks]);

  const socketPrimarySelection = useMemo(() => {
    const candidates = providerStates
      .map((provider) => {
        const series = Array.isArray(seriesByProvider[provider.id]) ? seriesByProvider[provider.id] : [];
        const latestPoint = series[series.length - 1] || null;
        const latestTickAt = pickFirstFinite(provider?.lastTickAt, latestPoint?.t, 0);
        const latestTick = latestTickByProviderId.get(provider.id) || null;
        const symbol = latestTick?.symbol || depthByProvider[provider.id]?.symbol || null;
        const pair = splitSymbolPair(symbol);
        const basis = getPairBasis(marketPair, pair);
        return {
          provider,
          series,
          latestTickAt: Number.isFinite(latestTickAt) ? latestTickAt : 0,
          hasSeries: series.length > 0,
          basis,
          symbol
        };
      })
      .filter((candidate) => candidate.hasSeries || Number.isFinite(Number(candidate.provider?.price)));

    if (candidates.length === 0) return null;

    const alignedCandidates = candidates.filter((candidate) => candidate.basis.score >= 2);
    const ranked = alignedCandidates.length > 0 ? alignedCandidates : candidates;
    ranked.sort((a, b) => {
      if (a.basis.score !== b.basis.score) return b.basis.score - a.basis.score;
      if (a.provider.connected !== b.provider.connected) return a.provider.connected ? -1 : 1;
      if (a.provider.local !== b.provider.local) return a.provider.local ? 1 : -1;
      if (a.hasSeries !== b.hasSeries) return a.hasSeries ? -1 : 1;
      if (a.series.length !== b.series.length) return b.series.length - a.series.length;
      if (a.latestTickAt !== b.latestTickAt) return b.latestTickAt - a.latestTickAt;
      return 0;
    });

    return ranked[0];
  }, [depthByProvider, latestTickByProviderId, marketPair, providerStates, seriesByProvider]);

  const resolvedPrimaryProvider = socketPrimarySelection?.provider || primaryProvider;
  const resolvedPrimarySeries = socketPrimarySelection?.series || primarySeries;
  const resolvedPrimaryDepth = resolvedPrimaryProvider ? depthByProvider[resolvedPrimaryProvider.id] || primaryDepth : primaryDepth;

  const {
    snapshot: tensorSnapshot,
    tensorSeries,
    strategy: tensorStrategy,
    strategyEvents,
    paper: tensorPaper
  } = useTensorStrategy({
    market,
    enabled: socketLiveEnabled,
    providerStates,
    depthByProvider
  });

  const resolvedDepth = useMemo(() => {
    const primaryResolved = normalizeDepthPayload(resolvedPrimaryDepth, resolvedPrimaryProvider?.name || resolvedPrimaryProvider?.id || null);
    if (primaryResolved) {
      return {
        depth: primaryResolved,
        providerName: primaryResolved.providerName || resolvedPrimaryProvider?.name || null,
        sourceLabel: ''
      };
    }

    for (const provider of providerStates) {
      const fallbackResolved = normalizeDepthPayload(depthByProvider[provider.id], provider.name || provider.id);
      if (fallbackResolved) {
        return {
          depth: fallbackResolved,
          providerName: fallbackResolved.providerName || provider.name || null,
          sourceLabel: provider.connected ? 'fallback provider' : 'cached fallback'
        };
      }
    }

    const latestSeriesPoint = resolvedPrimarySeries[resolvedPrimarySeries.length - 1] || null;
    const runtimeProvider = (market?.providers || []).find((provider) => {
      const price = Number(provider?.price);
      return Number.isFinite(price) && price > 0;
    });
    const midPrice = pickFirstFinite(resolvedPrimaryProvider?.price, latestSeriesPoint?.price, runtimeProvider?.price, market?.referencePrice);
    if (!Number.isFinite(midPrice) || midPrice <= 0) {
      return {
        depth: null,
        providerName: null,
        sourceLabel: ''
      };
    }

    const bid = pickFirstFinite(resolvedPrimaryProvider?.bid, runtimeProvider?.bid);
    const ask = pickFirstFinite(resolvedPrimaryProvider?.ask, runtimeProvider?.ask);
    const liveSpreadBps =
      Number.isFinite(bid) && Number.isFinite(ask) && ask > bid ? ((ask - bid) / Math.max(midPrice, 1e-9)) * 10000 : null;
    const spreadBps = pickFirstFinite(liveSpreadBps, market?.spreadBps, 8);
    const quoteVolume = pickFirstFinite(resolvedPrimaryProvider?.volume, runtimeProvider?.volume, market?.totalVolume, 100000);
    const baseSize = Math.max(quoteVolume / Math.max(midPrice, 1) / 1900, 0.01);
    const derivedDepth = buildDerivedDepth({
      midPrice,
      spreadBps,
      baseSize,
      symbol: market?.symbol,
      assetClass: market?.assetClass,
      timestamp: pickFirstFinite(resolvedPrimaryProvider?.lastTickAt, latestSeriesPoint?.t, runtimeProvider?.timestamp)
    });
    const normalizedDerived = normalizeDepthPayload(derivedDepth, 'Derived Local Depth');

    return {
      depth: normalizedDerived,
      providerName: normalizedDerived?.providerName || null,
      sourceLabel: 'derived fallback'
    };
  }, [
    depthByProvider,
    market?.assetClass,
    market?.providers,
    market?.referencePrice,
    market?.spreadBps,
    market?.symbol,
    market?.totalVolume,
    resolvedPrimaryDepth,
    resolvedPrimaryProvider?.ask,
    resolvedPrimaryProvider?.bid,
    resolvedPrimaryProvider?.id,
    resolvedPrimaryProvider?.lastTickAt,
    resolvedPrimaryProvider?.name,
    resolvedPrimaryProvider?.price,
    resolvedPrimaryProvider?.volume,
    resolvedPrimarySeries,
    providerStates
  ]);

  useEffect(() => {
    setActiveSubtab('overview');
    setShowOrderBook3D(false);
    setDepthSnapshots([]);
    setShowRuntimeQuotes(false);
  }, [market?.key]);

  useEffect(() => {
    if (!socketLiveEnabled) {
      setShowOrderBook3D(false);
      setDepthSnapshots([]);
      setShowRuntimeQuotes(true);
    }
  }, [socketLiveEnabled]);

  useEffect(() => {
    if (!marketSubtabs.some((tab) => tab.key === activeSubtab)) {
      setActiveSubtab(marketSubtabs[0]?.key || 'overview');
    }
  }, [activeSubtab, marketSubtabs]);

  useEffect(() => {
    const activeDepth = resolvedDepth.depth;
    if (!socketLiveEnabled || !activeDepth) return;

    const bids = normalizeDepthSide(activeDepth.bids, 'bid');
    const asks = normalizeDepthSide(activeDepth.asks, 'ask');
    if (bids.length === 0 && asks.length === 0) return;

    const timestamp = pickFirstFinite(activeDepth.timestamp, Date.now());
    const snapshotRow = {
      providerId: String(activeDepth.providerId || resolvedPrimaryProvider?.id || ''),
      providerName: String(activeDepth.providerName || resolvedDepth.providerName || ''),
      timestamp,
      bids,
      asks
    };

    setDepthSnapshots((current) => {
      const last = current[current.length - 1];
      if (last && last.timestamp === snapshotRow.timestamp && last.providerId === snapshotRow.providerId) {
        return current;
      }
      const next = [...current, snapshotRow];
      if (next.length > DEPTH_SNAPSHOT_LIMIT) {
        next.splice(0, next.length - DEPTH_SNAPSHOT_LIMIT);
      }
      return next;
    });
  }, [resolvedPrimaryProvider?.id, resolvedDepth.depth, resolvedDepth.providerName, socketLiveEnabled]);

  if (!market) {
    return (
      <section className="page-grid">
        <GlowCard className="detail-card">
          <h1>Market not found</h1>
          <p>No market entry found for `{marketId}` in the current snapshot.</p>
          <Link to="/markets" className="inline-link">
            Back to markets
          </Link>
        </GlowCard>
      </section>
    );
  }

  const history = historyByMarket[market.key] || [];
  const signals = snapshot.signals.filter((signal) => signal.symbol === market.symbol && signal.assetClass === market.assetClass).slice(0, 10);
  const decisions = snapshot.decisions.filter((decision) => decision.symbol === market.symbol && decision.assetClass === market.assetClass).slice(0, 10);

  const runtimePriceSeries = history.map((point) => point.price);
  const runtimeSpreadSeries = history.map((point) => point.spread);
  const socketPriceSeries = resolvedPrimarySeries.map((point) => point.price);
  const socketSpreadSeries = resolvedPrimarySeries.map((point) => point.spread);
  const tensorPriceSeries = tensorSeries.map((point) => point.price);

  const socketLatestPoint = resolvedPrimarySeries[resolvedPrimarySeries.length - 1] || null;
  const socketLatestPrice = pickFirstFinite(resolvedPrimaryProvider?.price, socketLatestPoint?.price);
  const runtimeLatestPrice = runtimePriceSeries[runtimePriceSeries.length - 1];
  const socketLatestSpreadFromQuote =
    Number.isFinite(Number(resolvedPrimaryProvider?.bid)) &&
    Number.isFinite(Number(resolvedPrimaryProvider?.ask)) &&
    Number(resolvedPrimaryProvider?.ask) > Number(resolvedPrimaryProvider?.bid) &&
    Number.isFinite(Number(socketLatestPrice)) &&
    Number(socketLatestPrice) > 0
      ? ((Number(resolvedPrimaryProvider?.ask) - Number(resolvedPrimaryProvider?.bid)) / Number(socketLatestPrice)) * 10000
      : null;
  const socketLatestSpread = pickFirstFinite(socketLatestSpreadFromQuote, socketLatestPoint?.spread);
  const runtimeLatestSpread = runtimeSpreadSeries[runtimeSpreadSeries.length - 1];
  const selectedSocketBasis = socketPrimarySelection?.basis || { score: 0, label: 'unknown' };
  const useSocketAsPrimary = socketLiveEnabled && selectedSocketBasis.score >= 2 && Number.isFinite(Number(socketLatestPrice));
  const priceSeries = useSocketAsPrimary ? (socketPriceSeries.length > 0 ? socketPriceSeries : [socketLatestPrice]) : runtimePriceSeries;
  const spreadSeries = useSocketAsPrimary ? (socketSpreadSeries.length > 0 ? socketSpreadSeries : Number.isFinite(Number(socketLatestSpread)) ? [socketLatestSpread] : []) : runtimeSpreadSeries;
  const sourceLabel = useSocketAsPrimary
    ? `${resolvedPrimaryProvider?.name || 'Socket'} socket${selectedSocketBasis.label ? ` (${selectedSocketBasis.label})` : ''}`
    : 'Runtime snapshot';
  const displayedReferencePrice = pickFirstFinite(useSocketAsPrimary ? socketLatestPrice : null, runtimeLatestPrice, market.referencePrice);
  const displayedSpreadBps = pickFirstFinite(useSocketAsPrimary ? socketLatestSpread : null, runtimeLatestSpread, market.spreadBps);
  const displayedVolume = pickFirstFinite(useSocketAsPrimary ? resolvedPrimaryProvider?.volume : null, market.totalVolume);
  const tensorActionClass = tensorStrategy.action === 'accumulate' ? 'up' : tensorStrategy.action === 'reduce' ? 'down' : '';
  const classicAnalysis = useMemo(() => {
    return buildClassicAnalysis(priceSeries, {
      fastPeriod: 20,
      slowPeriod: 50,
      emaPeriod: 21,
      bbPeriod: 20,
      bbMultiplier: 2
    });
  }, [priceSeries]);
  const taOverlays = useMemo(() => {
    return [
      {
        key: 'sma-fast',
        label: `SMA${classicAnalysis.periods.fastPeriod}`,
        points: classicAnalysis.series.smaFast,
        stroke: '#98b4ff',
        strokeWidth: 1.6
      },
      {
        key: 'sma-slow',
        label: `SMA${classicAnalysis.periods.slowPeriod}`,
        points: classicAnalysis.series.smaSlow,
        stroke: '#af8dff',
        strokeWidth: 1.5
      },
      {
        key: 'ema',
        label: `EMA${classicAnalysis.periods.emaPeriod}`,
        points: classicAnalysis.series.ema,
        stroke: '#62ffcc',
        strokeWidth: 1.6
      },
      {
        key: 'bb-upper',
        label: `BB Upper ${classicAnalysis.periods.bbPeriod}`,
        points: classicAnalysis.series.bbUpper,
        stroke: '#ffb372',
        strokeWidth: 1.35,
        dasharray: '6 5'
      },
      {
        key: 'bb-lower',
        label: `BB Lower ${classicAnalysis.periods.bbPeriod}`,
        points: classicAnalysis.series.bbLower,
        stroke: '#ff87b1',
        strokeWidth: 1.35,
        dasharray: '6 5'
      }
    ];
  }, [classicAnalysis]);

  const taTrendTone = classicAnalysis.states.trend === 'bullish' ? 'up' : classicAnalysis.states.trend === 'bearish' ? 'down' : '';
  const taBandTone = classicAnalysis.states.bandState === 'upper-break' ? 'up' : classicAnalysis.states.bandState === 'lower-break' ? 'down' : '';
  const taCrossTone = classicAnalysis.states.crossover === 'bull-cross' ? 'up' : classicAnalysis.states.crossover === 'bear-cross' ? 'down' : '';
  const taSmaSpreadTone =
    Number.isFinite(classicAnalysis.metrics.fastVsSlowPct) && classicAnalysis.metrics.fastVsSlowPct !== 0
      ? classicAnalysis.metrics.fastVsSlowPct > 0
        ? 'up'
        : 'down'
      : '';
  const taEmaSlopeTone =
    Number.isFinite(classicAnalysis.metrics.emaSlopePct) && classicAnalysis.metrics.emaSlopePct !== 0
      ? classicAnalysis.metrics.emaSlopePct > 0
        ? 'up'
        : 'down'
      : '';
  const formatRawPercent = (value) => {
    return Number.isFinite(value) ? `${fmtNum(value, 2)}%` : '-';
  };

  const depthBook = useMemo(() => {
    const activeDepth = resolvedDepth.depth || null;
    const bids = normalizeDepthSide(activeDepth?.bids, 'bid');
    const asks = normalizeDepthSide(activeDepth?.asks, 'ask');
    const maxSize = Math.max(1, ...bids.map((level) => Number(level.size) || 0), ...asks.map((level) => Number(level.size) || 0));
    const bidNotional = bids.reduce((sum, level) => sum + (Number(level.price) || 0) * (Number(level.size) || 0), 0);
    const askNotional = asks.reduce((sum, level) => sum + (Number(level.price) || 0) * (Number(level.size) || 0), 0);
    const imbalanceDenominator = Math.max(bidNotional + askNotional, 1e-9);
    const imbalance = ((bidNotional - askNotional) / imbalanceDenominator) * 100;
    return {
      bids,
      asks,
      maxSize,
      bidNotional,
      askNotional,
      imbalance,
      timestamp: activeDepth?.timestamp || null,
      providerName: resolvedDepth.providerName || null,
      sourceLabel: resolvedDepth.sourceLabel || ''
    };
  }, [resolvedDepth]);

  const quoteRows = useMemo(() => {
    const runtimeRows = market.providers.map((provider) => ({
      id: `runtime:${provider.id}`,
      source: 'runtime',
      sourceLabel: 'runtime snapshot',
      name: provider.name || provider.id,
      symbol: market.symbol,
      price: provider.price,
      bid: provider.bid,
      ask: provider.ask,
      volume: provider.volume,
      timestamp: provider.timestamp
    })).map((row) => {
      const pair = splitSymbolPair(row.symbol);
      return {
        ...row,
        pairLabel: formatSymbolPair(pair, row.symbol),
        basis: getPairBasis(marketPair, pair)
      };
    });

    const socketRows = providerStates
      .filter((provider) => provider.price !== null)
      .map((provider) => ({
        id: `socket:${provider.id}`,
        source: 'socket',
        sourceLabel: 'frontend socket',
        name: provider.name || provider.id,
        symbol: latestTickByProviderId.get(provider.id)?.symbol || market.symbol,
        price: provider.price,
        bid: provider.bid,
        ask: provider.ask,
        volume: provider.volume,
        timestamp: provider.lastTickAt
      }))
      .map((row) => {
        const pair = splitSymbolPair(row.symbol);
        return {
          ...row,
          pairLabel: formatSymbolPair(pair, row.symbol),
          basis: getPairBasis(marketPair, pair)
        };
      });

    return [...socketRows, ...runtimeRows];
  }, [latestTickByProviderId, market.providers, market.symbol, marketPair, providerStates]);

  const visibleQuoteRows = useMemo(() => {
    const socketRows = quoteRows.filter((row) => row.source === 'socket');
    if (!socketLiveEnabled) return quoteRows;
    if (showRuntimeQuotes) return quoteRows;
    return socketRows.length > 0 ? socketRows : quoteRows;
  }, [quoteRows, showRuntimeQuotes, socketLiveEnabled]);

  const multimarketHref = useMemo(() => {
    const base = String(MULTIMARKET_URL || '').trim();
    if (!base) return null;
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}symbol=${encodeURIComponent(market.symbol || '')}&assetClass=${encodeURIComponent(market.assetClass || '')}`;
  }, [market.assetClass, market.symbol]);
  const activeSubtabMeta = marketSubtabs.find((tab) => tab.key === activeSubtab) || marketSubtabs[0] || MARKET_SUBTAB_DEFS[0];

  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>market:{market.symbol}</h1>
          <div className="section-actions">
            <Link to="/markets" className="inline-link">
              Back to markets
            </Link>
            <button type="button" className="btn secondary" onClick={onRefresh} disabled={syncing}>
              {syncing ? 'Syncing...' : 'Refresh'}
            </button>
          </div>
        </div>
        <p>
          {market.assetClass} | key {market.key} | providers {fmtInt(market.providerCount)} | venues {fmtInt(market.venueCount)}
        </p>

        <div className="socket-toggle-row">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={socketEnabled}
              onChange={(event) => setSocketEnabled(event.target.checked)}
              disabled={!supportsSocketProviders}
            />
            <span>Frontend socket providers</span>
          </label>
              <small>
                {supportsSocketProviders
                  ? localFallbackActive
                    ? 'External sockets unavailable, using local synthetic fallback'
                    : `Frontend socket feed active | external ${externalConnectedCount}/${externalProviderCount} connected`
                  : 'Socket providers currently enabled for crypto markets'}
              </small>
        </div>
      </GlowCard>

      <GlowCard className="panel-card market-subtab-card">
        <div className="market-subtab-row">
          {marketSubtabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`market-subtab-btn ${activeSubtab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveSubtab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className="socket-status-copy">{activeSubtabMeta.description}</p>
      </GlowCard>

      {activeSubtab === 'overview' ? (
        <>
          <div className="detail-stat-grid">
            <GlowCard className="stat-card">
              <span>Reference</span>
              <strong>{fmtNum(displayedReferencePrice, 4)}</strong>
            </GlowCard>
            <GlowCard className="stat-card">
              <span>Change</span>
              <strong className={Number(market.changePct) >= 0 ? 'up' : 'down'}>{fmtPct(market.changePct)}</strong>
            </GlowCard>
            <GlowCard className="stat-card">
              <span>Spread</span>
              <strong>{fmtNum(displayedSpreadBps, 2)} bps</strong>
            </GlowCard>
            <GlowCard className="stat-card">
              <span>Volume</span>
              <strong>{fmtCompact(displayedVolume)}</strong>
            </GlowCard>
          </div>

          <GlowCard className="chart-card">
            <LineChart
              title={`Reference Price (Live) - ${sourceLabel}`}
              points={priceSeries}
              stroke="#77dcff"
              fillFrom="rgba(58, 147, 255, 0.36)"
              fillTo="rgba(58, 147, 255, 0.02)"
              overlays={taOverlays}
            />
          </GlowCard>
        </>
      ) : null}

      {activeSubtab === 'overview' ? (
        <>
          <GlowCard className="panel-card">
            <div className="section-head">
              <h2>Classic Analysis</h2>
              <span>{classicAnalysis.sampleSize} samples</span>
            </div>
            <p className="socket-status-copy">
              {classicAnalysis.ready
                ? `Bollinger(${classicAnalysis.periods.bbPeriod},${classicAnalysis.periods.bbMultiplier}) + moving averages on ${sourceLabel}.`
                : `Collecting data for classic indicators (${classicAnalysis.periods.bbPeriod} points required).`}
            </p>
            <div className="ta-grid">
              <article className="ta-item">
                <span>Price vs SMA{classicAnalysis.periods.fastPeriod}</span>
                <strong className={taTrendTone}>{fmtPct(classicAnalysis.metrics.priceVsFastPct)}</strong>
              </article>
              <article className="ta-item">
                <span>SMA{classicAnalysis.periods.fastPeriod} vs SMA{classicAnalysis.periods.slowPeriod}</span>
                <strong className={taSmaSpreadTone}>{fmtPct(classicAnalysis.metrics.fastVsSlowPct)}</strong>
              </article>
              <article className="ta-item">
                <span>EMA Slope (5)</span>
                <strong className={taEmaSlopeTone}>{fmtPct(classicAnalysis.metrics.emaSlopePct)}</strong>
              </article>
              <article className="ta-item">
                <span>Band Width</span>
                <strong>{formatRawPercent(classicAnalysis.metrics.bbWidthPct)}</strong>
              </article>
              <article className="ta-item">
                <span>Band Position</span>
                <strong>{formatRawPercent(classicAnalysis.metrics.bbPositionPct)}</strong>
              </article>
              <article className="ta-item">
                <span>Price / EMA{classicAnalysis.periods.emaPeriod}</span>
                <strong>{fmtNum(classicAnalysis.latest.price, 4)} / {fmtNum(classicAnalysis.latest.ema, 4)}</strong>
              </article>
            </div>
            <div className="ta-chip-row">
              <span className={`status-pill ${taTrendTone}`}>trend {classicAnalysis.states.trend}</span>
              <span className={`status-pill ${taBandTone}`}>band {classicAnalysis.states.bandState}</span>
              <span className={`status-pill ${taCrossTone}`}>cross {classicAnalysis.states.crossover}</span>
            </div>
          </GlowCard>

          <GlowCard className="chart-card">
            <LineChart
              title={`Spread (bps) - ${sourceLabel}`}
              points={spreadSeries}
              stroke="#ff9e74"
              fillFrom="rgba(255, 122, 64, 0.35)"
              fillTo="rgba(255, 122, 64, 0.02)"
              unit=" bps"
            />
          </GlowCard>
        </>
      ) : null}

      {supportsSocketProviders && activeSubtab === 'tensor' ? (
        <GlowCard className="chart-card">
          <LineChart
            title={`Tensor Price (micro-weighted) - ${sourceLabel}`}
            points={tensorPriceSeries}
            stroke="#62ffc4"
            fillFrom="rgba(65, 245, 173, 0.31)"
            fillTo="rgba(65, 245, 173, 0.02)"
          />
        </GlowCard>
      ) : null}

      {supportsSocketProviders && activeSubtab === 'tensor' ? (
        <div className="tensor-grid">
          <GlowCard className="panel-card tensor-panel">
            <div className="section-head">
              <h2>Tensor Strategy (Local)</h2>
              <span className={`tensor-chip ${tensorStrategy.action}`}>{tensorStrategy.action}</span>
            </div>
            <p className="socket-status-copy">{tensorStrategy.reason}</p>
            <div className="tensor-metrics">
              <article>
                <span>Tensor Price</span>
                <strong>{fmtNum(tensorSnapshot?.tensorPrice || market.referencePrice, 4)}</strong>
              </article>
              <article>
                <span>Tensor Spread</span>
                <strong>{fmtNum(tensorSnapshot?.tensorSpreadBps || market.spreadBps, 2)} bps</strong>
              </article>
              <article>
                <span>Confidence</span>
                <strong>{fmtPct((tensorSnapshot?.confidence || 0) * 100)}</strong>
              </article>
              <article>
                <span>Score</span>
                <strong className={tensorActionClass}>{fmtNum(tensorStrategy.score, 2)}</strong>
              </article>
              <article>
                <span>Trend</span>
                <strong className={tensorActionClass}>{fmtNum(tensorStrategy.trendBps, 2)} bps</strong>
              </article>
              <article>
                <span>Momentum</span>
                <strong className={tensorActionClass}>{fmtPct(tensorStrategy.momentumPct)}</strong>
              </article>
              <article>
                <span>Paper Position</span>
                <strong>{fmtNum(tensorPaper.units, 0)} units</strong>
              </article>
              <article>
                <span>Paper Equity</span>
                <strong className={Number(tensorPaper.equity) >= 0 ? 'up' : 'down'}>{fmtNum(tensorPaper.equity, 2)}</strong>
              </article>
            </div>
            <div className="tensor-components">
              {(tensorSnapshot?.components || []).slice(0, 4).map((component) => (
                <article key={`tensor-comp:${component.providerId}`} className="tensor-component-row">
                  <strong>{component.providerName || component.providerId}</strong>
                  <small>
                    w {fmtPct(component.contribution * 100)} | px {fmtNum(component.tensorComponent, 4)} | spr {fmtNum(component.spreadBps, 2)} bps
                  </small>
                </article>
              ))}
              {(tensorSnapshot?.components || []).length === 0 ? <p className="depth-empty">Waiting for weighted provider components...</p> : null}
            </div>
          </GlowCard>

          <GlowCard className="panel-card">
            <div className="section-head">
              <h2>Tensor Events</h2>
              <span>{strategyEvents.length} recent</span>
            </div>
            <p className="socket-status-copy">
              cash {fmtNum(tensorPaper.cash, 2)} | mark {fmtNum(tensorPaper.markValue, 2)} | avg entry {fmtNum(tensorPaper.avgEntry, 4)}
            </p>
            <FlashList
              items={strategyEvents}
              height={286}
              itemHeight={72}
              className="tick-flash-list"
              emptyCopy={socketLiveEnabled ? 'No tensor action flips yet. Strategy currently stable.' : 'Enable frontend socket providers to run tensor strategy.'}
              keyExtractor={(event) => event.id}
              renderItem={(event) => (
                <article className="tensor-event-row">
                  <strong className={event.action === 'accumulate' ? 'up' : event.action === 'reduce' ? 'down' : ''}>
                    {event.action} | {event.stance}
                  </strong>
                  <p>{event.reason}</p>
                  <small>
                    score {fmtNum(event.score, 2)} | px {fmtNum(event.price, 4)} | spr {fmtNum(event.spreadBps, 2)} bps | {fmtTime(event.timestamp)}
                  </small>
                </article>
              )}
            />
          </GlowCard>
        </div>
      ) : null}

      {supportsSocketProviders && activeSubtab === 'intel' ? (
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Socket Provider Status</h2>
            <span>
              {providerStates.filter((provider) => provider.connected).length}/{providerStates.length} connected
            </span>
          </div>
          <p className="socket-status-copy">
            external {externalConnectedCount}/{externalProviderCount} connected
            {localFallbackActive ? ' | local fallback active' : ''}
          </p>
          <div className="socket-provider-grid">
            {providerStates.map((provider) => (
              <article key={provider.id} className="socket-provider-card">
                <div className="socket-provider-head">
                  <strong>{provider.name}</strong>
                  <span className={provider.connected ? 'status-pill online' : 'status-pill'}>
                    {provider.connected ? 'connected' : 'offline'}
                  </span>
                </div>
                <p>
                  price {fmtNum(provider.price, 4)} | bid {fmtNum(provider.bid, 4)} | ask {fmtNum(provider.ask, 4)}
                </p>
                <small>symbol {latestTickByProviderId.get(provider.id)?.symbol || depthByProvider[provider.id]?.symbol || '-'}</small>
                <Sparkline data={(seriesByProvider[provider.id] || []).map((point) => point.price)} width={160} height={42} />
                <small>{provider.error || `last tick ${fmtTime(provider.lastTickAt)}`}</small>
              </article>
            ))}
          </div>
        </GlowCard>
      ) : null}

      {supportsSocketProviders && activeSubtab === 'depth' ? (
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Order Book Depth</h2>
            <div className="section-actions">
              <span>
                {depthBook.providerName
                  ? `${depthBook.providerName}${depthBook.sourceLabel ? ` (${depthBook.sourceLabel})` : ''}`
                  : 'No provider depth yet'}
              </span>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setShowOrderBook3D((current) => !current)}
                disabled={!socketLiveEnabled}
              >
                {showOrderBook3D ? 'Hide MultiMarket 3D' : 'Open MultiMarket 3D'}
              </button>
              {multimarketHref ? (
                <a className="btn secondary" href={multimarketHref} target="_blank" rel="noreferrer">
                  Open External
                </a>
              ) : null}
            </div>
          </div>
          <p className="socket-status-copy">
            bids {fmtCompact(depthBook.bidNotional)} | asks {fmtCompact(depthBook.askNotional)} | imbalance {fmtPct(depthBook.imbalance)} | at{' '}
            {fmtTime(depthBook.timestamp)}
          </p>
          <div className="depth-grid">
            <section className="depth-side bid">
              <h3>Bid Depth</h3>
              {(depthBook.bids || []).map((level, index) => (
                <article key={`bid:${index}:${level.price}`} className="depth-row bid-row">
                  <div className="depth-bar bid" style={{ width: `${Math.min(100, (Number(level.size) / depthBook.maxSize) * 100)}%` }} />
                  <div className="depth-content">
                    <strong>{fmtNum(level.price, 4)}</strong>
                    <small>{fmtCompact(level.size)}</small>
                  </div>
                </article>
              ))}
              {depthBook.bids.length === 0 ? <p className="depth-empty">No bid depth yet.</p> : null}
            </section>

            <section className="depth-side ask">
              <h3>Ask Depth</h3>
              {(depthBook.asks || []).map((level, index) => (
                <article key={`ask:${index}:${level.price}`} className="depth-row ask-row">
                  <div className="depth-bar ask" style={{ width: `${Math.min(100, (Number(level.size) / depthBook.maxSize) * 100)}%` }} />
                  <div className="depth-content">
                    <strong>{fmtNum(level.price, 4)}</strong>
                    <small>{fmtCompact(level.size)}</small>
                  </div>
                </article>
              ))}
              {depthBook.asks.length === 0 ? <p className="depth-empty">No ask depth yet.</p> : null}
            </section>
          </div>
          {showOrderBook3D ? (
            <section className="depth-3d-wrap">
              <div className="depth-3d-head">
                <strong>3D Order Book (Live)</strong>
                <small>{fmtInt(depthSnapshots.length)} snapshots buffered</small>
              </div>
              <OrderBook3D snapshots={depthSnapshots} />
            </section>
          ) : null}
        </GlowCard>
      ) : null}

      {supportsSocketProviders && activeSubtab === 'depth' ? (
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Live Tick Tape</h2>
            <span>{recentTicks.length} buffered</span>
          </div>
          <FlashList
            items={recentTicks}
            height={290}
            itemHeight={58}
            className="tick-flash-list"
            emptyCopy={socketLiveEnabled ? 'Waiting for live ticks...' : 'Enable frontend socket providers to stream ticks.'}
            keyExtractor={(tick) => tick.id}
            renderItem={(tick) => (
              <article className="tick-row">
                <div className="tick-main">
                  <strong>{tick.providerName || tick.providerId}</strong>
                  <small>
                    {tick.venue || 'unknown'} | {tick.symbol || '-'}
                  </small>
                </div>
                <div className="tick-metrics">
                  <span>{fmtNum(tick.price, 4)}</span>
                  <small>
                    spr {fmtNum(tick.spread, 2)} bps | vol {fmtCompact(tick.volume)}
                  </small>
                </div>
                <small>{fmtTime(tick.timestamp)}</small>
              </article>
            )}
          />
        </GlowCard>
      ) : null}

      {activeSubtab === 'intel' ? (
        <div className="two-col">
          <GlowCard className="panel-card">
            <div className="section-head">
              <h2>Provider Quotes</h2>
              <span>{visibleQuoteRows.length} rows</span>
            </div>
            <p className="socket-status-copy">
              With frontend sockets enabled, this table defaults to socket quotes to avoid runtime-vs-socket confusion. Toggle runtime rows only for diagnostics.
            </p>
            {socketLiveEnabled ? (
              <div className="socket-toggle-row">
                <label className="toggle-label">
                  <input type="checkbox" checked={showRuntimeQuotes} onChange={(event) => setShowRuntimeQuotes(event.target.checked)} />
                  <span>Include runtime snapshot rows</span>
                </label>
                <small>
                  socket {quoteRows.filter((row) => row.source === 'socket').length} | runtime {quoteRows.filter((row) => row.source === 'runtime').length}
                </small>
              </div>
            ) : null}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Provider</th>
                    <th>Pair</th>
                    <th>Price</th>
                    <th>Bid</th>
                    <th>Ask</th>
                    <th>Volume</th>
                    <th>Basis</th>
                    <th>At</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleQuoteRows.map((provider) => (
                    <tr key={provider.id}>
                      <td>{provider.sourceLabel || provider.source}</td>
                      <td>{provider.name}</td>
                      <td>{provider.pairLabel}</td>
                      <td>{fmtNum(provider.price, 4)}</td>
                      <td>{fmtNum(provider.bid, 4)}</td>
                      <td>{fmtNum(provider.ask, 4)}</td>
                      <td>{fmtCompact(provider.volume)}</td>
                      <td className={provider.basis?.className || ''}>{provider.basis?.label || '-'}</td>
                      <td>{fmtTime(provider.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlowCard>

          <GlowCard className="panel-card">
            <div className="section-head">
              <h2>Signals</h2>
              <span>{signals.length} recent</span>
            </div>
            <div className="list-stack">
              {signals.map((signal) => (
                <article key={signal.id} className="list-item">
                  <strong>
                    <Link to={`/signal/${encodeURIComponent(signal.id)}`} className="inline-link">
                      {signal.type}
                    </Link>{' '}
                    | {signal.direction}
                  </strong>
                  <p>{signal.message}</p>
                  <div className="item-meta">
                    <span className={`severity ${severityClass(signal.severity)}`}>{signal.severity}</span>
                    <small>score {fmtInt(signal.score)}</small>
                    <small>{fmtTime(signal.timestamp)}</small>
                  </div>
                </article>
              ))}
            </div>
          </GlowCard>
        </div>
      ) : null}

      {activeSubtab === 'decisions' ? (
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Decisions</h2>
            <span>{decisions.length} recent</span>
          </div>
          <div className="list-stack">
            {decisions.map((decision) => (
              <article key={decision.id} className="list-item">
                <strong>
                  <Link to={`/strategy/${encodeURIComponent(decision.strategyName || 'unknown')}`} className="inline-link">
                    {decision.strategyName || 'unknown'}
                  </Link>{' '}
                  - {decision.action}
                </strong>
                <p>{decision.reason}</p>
                <div className="item-meta">
                  <small>{decision.trigger}</small>
                  <small>score {fmtInt(decision.score)}</small>
                  <small>{fmtTime(decision.timestamp)}</small>
                </div>
              </article>
            ))}
          </div>
        </GlowCard>
      ) : null}
    </section>
  );
}
