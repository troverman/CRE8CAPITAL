import { useEffect, useMemo, useState } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import LineChart from '../components/LineChart';
import MarketStats from '../components/MarketStats';
import OrderBookPanel from '../components/OrderBookPanel';
import OrderBook3D from '../components/OrderBook3D';
import PriceHeader from '../components/PriceHeader';
import Sparkline from '../components/Sparkline';
import TechnicalIndicators from '../components/TechnicalIndicators';
import useProviderWindowHistory, { LIVE_WINDOW_OPTIONS, resolveWindowMs } from '../hooks/useProviderWindowHistory';
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
    description: 'Unified market view: windowed price/spread with classic indicator context.'
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
    description: 'Order book depth, socket health, and live tick tape in one depth workspace.'
  },
  {
    key: 'intel',
    label: 'Intel',
    socketOnly: false,
    description: 'Unified quote matrix (runtime + direct sockets) with linked signal feed.'
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

const normalizeSeriesRows = (rows = []) => {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const t = Number(row?.t || row?.timestamp);
      const price = Number(row?.price);
      const spread = Number(row?.spread);
      const volume = Number(row?.volume);
      if (!Number.isFinite(t) || !Number.isFinite(price) || price <= 0) return null;
      return {
        t,
        price,
        spread: Number.isFinite(spread) ? spread : 0,
        volume: Number.isFinite(volume) ? volume : 0
      };
    })
    .filter((row) => Boolean(row));
};

const mergeSeriesRows = (historyRows = [], liveRows = []) => {
  const merged = [...normalizeSeriesRows(historyRows), ...normalizeSeriesRows(liveRows)].sort((a, b) => a.t - b.t);
  if (merged.length <= 1) return merged;

  const deduped = [];
  for (const row of merged) {
    const last = deduped[deduped.length - 1];
    if (last && last.t === row.t) {
      deduped[deduped.length - 1] = row;
      continue;
    }
    deduped.push(row);
  }
  return deduped;
};

const CHART_STEP_MS_BY_WINDOW = {
  '5m': 5 * 1000,
  '1h': 30 * 1000,
  '24h': 5 * 60 * 1000
};

const resolveChartStepMs = (windowKey, windowMs) => {
  if (CHART_STEP_MS_BY_WINDOW[windowKey]) return CHART_STEP_MS_BY_WINDOW[windowKey];
  return Math.max(1000, Math.round(Math.max(windowMs || 0, 60 * 1000) / 180));
};

const formatStepLabel = (stepMs) => {
  const safe = Math.max(1000, Math.round(Number(stepMs) || 0));
  if (safe % 60000 === 0) return `${safe / 60000}m`;
  if (safe % 1000 === 0) return `${safe / 1000}s`;
  return `${safe}ms`;
};

const bucketSeriesRows = ({ rows = [], stepMs = 1000, windowStartTs = 0 }) => {
  const safeStep = Math.max(1000, Math.round(Number(stepMs) || 0));
  const sortedRows = [...normalizeSeriesRows(rows)].sort((a, b) => a.t - b.t);
  if (sortedRows.length <= 2) return sortedRows;

  const bucketMap = new Map();
  for (const row of sortedRows) {
    const bucketIndex = Math.floor((row.t - windowStartTs) / safeStep);
    const existing = bucketMap.get(bucketIndex);
    if (!existing || row.t >= existing.t) {
      bucketMap.set(bucketIndex, row);
    }
  }

  const sampledRows = [...bucketMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map((entry) => entry[1]);

  if (sampledRows.length === 0) return sortedRows;
  const lastSourceRow = sortedRows[sortedRows.length - 1];
  const lastSampledRow = sampledRows[sampledRows.length - 1];
  if (!lastSampledRow || lastSampledRow.t !== lastSourceRow.t) {
    sampledRows.push(lastSourceRow);
  }

  return sampledRows;
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
  const [liveWindowKey, setLiveWindowKey] = useState('1h');

  useEffect(() => {
    setSocketEnabled(supportsSocketProviders);
  }, [supportsSocketProviders, market?.key]);

  const socketLiveEnabled = supportsSocketProviders && socketEnabled;
  const marketSubtabs = useMemo(() => {
    return MARKET_SUBTAB_DEFS.filter((tab) => !tab.socketOnly || supportsSocketProviders);
  }, [supportsSocketProviders]);
  const {
    providerStates,
    providerById,
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

  const socketDepthSelection = useMemo(() => {
    const candidates = providerStates
      .map((provider) => {
        const rawDepth = depthByProvider[provider.id];
        const normalizedDepth = normalizeDepthPayload(rawDepth, provider.name || provider.id);
        if (!normalizedDepth) return null;
        const latestTick = latestTickByProviderId.get(provider.id) || null;
        const symbol = latestTick?.symbol || normalizedDepth?.symbol || null;
        const pair = splitSymbolPair(symbol);
        const basis = getPairBasis(marketPair, pair);
        const depthAt = pickFirstFinite(normalizedDepth?.timestamp, provider?.lastTickAt, 0);
        return {
          provider,
          depth: normalizedDepth,
          symbol,
          basis,
          depthAt: Number.isFinite(depthAt) ? depthAt : 0
        };
      })
      .filter((candidate) => Boolean(candidate));

    if (candidates.length === 0) return null;

    const alignedCandidates = candidates.filter((candidate) => candidate.basis.score >= 2);
    const ranked = alignedCandidates.length > 0 ? alignedCandidates : candidates;
    ranked.sort((a, b) => {
      if (a.basis.score !== b.basis.score) return b.basis.score - a.basis.score;
      if (a.provider.connected !== b.provider.connected) return a.provider.connected ? -1 : 1;
      if (a.provider.local !== b.provider.local) return a.provider.local ? 1 : -1;
      if (a.depthAt !== b.depthAt) return b.depthAt - a.depthAt;
      return 0;
    });

    return ranked[0];
  }, [depthByProvider, latestTickByProviderId, marketPair, providerStates]);

  const resolvedPrimaryProvider = socketPrimarySelection?.provider || primaryProvider;
  const resolvedPrimarySeries = socketPrimarySelection?.series || primarySeries;
  const resolvedDepthProvider = socketDepthSelection?.provider || resolvedPrimaryProvider;
  const resolvedPrimaryDepth = socketDepthSelection?.depth || (resolvedDepthProvider ? depthByProvider[resolvedDepthProvider.id] || primaryDepth : primaryDepth);
  const resolvedPrimaryProviderModel = resolvedPrimaryProvider ? providerById[resolvedPrimaryProvider.id] || null : null;
  const localHistoryFallbackProvider = providerById['socket.local.synthetic'] || null;
  const selectedWindowMs = resolveWindowMs(liveWindowKey);
  const providerWindowHistory = useProviderWindowHistory({
    provider: resolvedPrimaryProviderModel,
    fallbackProvider: localHistoryFallbackProvider,
    market,
    windowKey: liveWindowKey,
    enabled: supportsSocketProviders && activeSubtab === 'overview'
  });

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
    const primaryResolved = normalizeDepthPayload(resolvedPrimaryDepth, resolvedDepthProvider?.name || resolvedDepthProvider?.id || null);
    if (primaryResolved) {
      return {
        depth: primaryResolved,
        providerName: primaryResolved.providerName || resolvedDepthProvider?.name || null,
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
    resolvedDepthProvider?.id,
    resolvedDepthProvider?.name,
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
      setShowRuntimeQuotes(false);
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
  }, [resolvedDepth.depth, resolvedDepth.providerName, resolvedDepthProvider?.id, socketLiveEnabled]);

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
  const selectedWindowMeta = LIVE_WINDOW_OPTIONS.find((option) => option.key === liveWindowKey) || LIVE_WINDOW_OPTIONS[1];
  const chartStepMs = resolveChartStepMs(liveWindowKey, selectedWindowMs);
  const chartStepLabel = formatStepLabel(chartStepMs);
  const nowTs = Date.now();
  const windowStartTs = nowTs - selectedWindowMs;
  const runtimeWindowRows = normalizeSeriesRows(history).filter((point) => point.t >= windowStartTs);
  const providerWindowRows = normalizeSeriesRows(providerWindowHistory.rows).filter((point) => point.t >= windowStartTs);
  const socketLiveRows = normalizeSeriesRows(resolvedPrimarySeries).filter((point) => point.t >= windowStartTs);
  const selectedSocketBasis = socketPrimarySelection?.basis || { score: 0, label: 'unknown' };
  const socketSeriesEligible = socketLiveEnabled && selectedSocketBasis.score >= 2;
  const providerMergedRows = mergeSeriesRows(providerWindowRows, socketSeriesEligible ? socketLiveRows : []);
  const unifiedWindowRows = mergeSeriesRows(runtimeWindowRows, providerMergedRows);
  const chartRows = bucketSeriesRows({
    rows: unifiedWindowRows,
    stepMs: chartStepMs,
    windowStartTs
  });

  const runtimePriceSeries = runtimeWindowRows.map((point) => point.price);
  const runtimeSpreadSeries = runtimeWindowRows.map((point) => point.spread);
  const priceSeries = chartRows.map((point) => point.price);
  const spreadSeries = chartRows.map((point) => point.spread);
  const tensorPriceSeries = tensorSeries.map((point) => point.price);
  const socketLatestPoint = providerMergedRows[providerMergedRows.length - 1] || null;
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
  const socketHasRealPrice = socketSeriesEligible && Number.isFinite(Number(socketLatestPrice)) && Number(socketLatestPrice) > 0;
  const chartLatestPrice = priceSeries[priceSeries.length - 1];
  const chartLatestSpread = spreadSeries[spreadSeries.length - 1];
  const sourceLabel = `Unified view | ${selectedWindowMeta.label} | step ${chartStepLabel}`;

  // Use unified chart as primary reference; runtime/socket rows remain available in intel/depth.
  const displayedReferencePrice = pickFirstFinite(chartLatestPrice, runtimeLatestPrice, market.referencePrice, socketHasRealPrice ? socketLatestPrice : null);
  const displayedSpreadBps = pickFirstFinite(chartLatestSpread, runtimeLatestSpread, market.spreadBps, socketHasRealPrice ? socketLatestSpread : null);
  const displayedVolume = pickFirstFinite(market.totalVolume, socketHasRealPrice ? resolvedPrimaryProvider?.volume : null);
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
    // Always show runtime rows; include socket rows that have real prices
    const runtimeRows = quoteRows.filter((row) => row.source === 'runtime');
    const socketRowsWithData = quoteRows.filter((row) => row.source === 'socket' && Number.isFinite(Number(row.price)) && Number(row.price) > 0);
    if (!socketLiveEnabled || !showRuntimeQuotes) {
      // Default: show runtime rows plus any socket rows with real data
      return [...socketRowsWithData, ...runtimeRows];
    }
    // Toggle on: show everything including socket rows without data (for diagnostics)
    return quoteRows;
  }, [quoteRows, showRuntimeQuotes, socketLiveEnabled]);

  const multimarketHref = useMemo(() => {
    const base = String(MULTIMARKET_URL || '').trim();
    if (!base) return null;
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}symbol=${encodeURIComponent(market.symbol || '')}&assetClass=${encodeURIComponent(market.assetClass || '')}`;
  }, [market.assetClass, market.symbol]);
  const activeSubtabMeta = marketSubtabs.find((tab) => tab.key === activeSubtab) || marketSubtabs[0] || MARKET_SUBTAB_DEFS[0];
  const socketStatusCopy = supportsSocketProviders
    ? socketEnabled
      ? externalConnectedCount > 0
        ? `Direct sockets ${externalConnectedCount}/${externalProviderCount} connected - blended into unified chart when aligned`
        : localFallbackActive
          ? 'Direct sockets blocked in browser - local/provider history continues in unified chart'
          : 'Connecting direct sockets - unified chart stays live from runtime/provider history'
      : 'Direct sockets off - unified chart uses runtime/provider history'
    : 'Direct sockets available for crypto markets only';

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
          <small>{socketStatusCopy}</small>
        </div>

        <div className="socket-toggle-row live-window-toggle-row">
          <div className="live-window-chip-row">
            {LIVE_WINDOW_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`market-subtab-btn ${liveWindowKey === option.key ? 'active' : ''}`}
                onClick={() => setLiveWindowKey(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <small>
            live window {selectedWindowMeta.label} | step {chartStepLabel} | points {fmtInt(priceSeries.length)}
            {providerWindowHistory.loading ? ' | loading provider history...' : ''}
            {providerWindowHistory.updatedAt ? ` | updated ${fmtTime(providerWindowHistory.updatedAt)}` : ''}
            {providerWindowHistory.error ? ` | ${providerWindowHistory.error}` : ''}
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
          <PriceHeader
            referencePrice={displayedReferencePrice}
            changePct={market.changePct}
            spreadBps={displayedSpreadBps}
            volume={displayedVolume}
          />

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
            <TechnicalIndicators classicAnalysis={classicAnalysis} sourceLabel={sourceLabel} />
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

      {activeSubtab === 'intel' ? (
        <MarketStats
          visibleQuoteRows={visibleQuoteRows}
          socketLiveEnabled={socketLiveEnabled}
          showRuntimeQuotes={showRuntimeQuotes}
          setShowRuntimeQuotes={setShowRuntimeQuotes}
          quoteRows={quoteRows}
          signals={signals}
          market={market}
        />
      ) : null}

      {supportsSocketProviders && activeSubtab === 'intel' ? (() => {
        const withData = providerStates.filter((provider) => provider.connected && Number.isFinite(Number(provider.price)) && Number(provider.price) > 0);
        const withoutData = providerStates.filter((provider) => !withData.includes(provider));
        const summaryParts = withoutData.map((provider) => {
          const reason = provider.error || (!provider.connected ? 'blocked' : 'no data');
          return `${provider.name} (${reason})`;
        });
        return (
          <GlowCard className="panel-card">
            <div className="section-head">
              <h2>Direct Exchange Sockets</h2>
              <small>Optional - direct exchange feed</small>
            </div>
            {withData.length > 0 ? (
              <div className="socket-provider-grid">
                {withData.map((provider) => (
                  <article key={provider.id} className="socket-provider-card">
                    <div className="socket-provider-head">
                      <strong>{provider.name}</strong>
                      <span className="status-pill online">live</span>
                    </div>
                    <p>
                      price {fmtNum(provider.price, 4)} | bid {fmtNum(provider.bid, 4)} | ask {fmtNum(provider.ask, 4)}
                    </p>
                    <small>symbol {latestTickByProviderId.get(provider.id)?.symbol || depthByProvider[provider.id]?.symbol || '-'}</small>
                    <Sparkline data={(seriesByProvider[provider.id] || []).map((point) => point.price)} width={160} height={42} />
                    <small>last tick {fmtTime(provider.lastTickAt)}</small>
                  </article>
                ))}
              </div>
            ) : null}
            {summaryParts.length > 0 ? (
              <p className="socket-status-copy">
                {withData.length > 0 ? 'Other sockets: ' : 'Direct sockets: '}{summaryParts.join(', ')} - unified chart remains live from runtime/provider flow
              </p>
            ) : null}
          </GlowCard>
        );
      })() : null}

      {supportsSocketProviders && activeSubtab === 'depth' ? (
        <GlowCard className="panel-card">
          <OrderBookPanel
            depthBook={depthBook}
            showOrderBook3D={showOrderBook3D}
            setShowOrderBook3D={setShowOrderBook3D}
            socketLiveEnabled={socketLiveEnabled}
            multimarketHref={multimarketHref}
            depthSnapshots={depthSnapshots}
          />
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

