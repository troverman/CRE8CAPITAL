import { useMemo } from 'react';
import GlowCard from '../components/GlowCard';
import { fmtInt, fmtPct } from '../lib/format';
import { Link } from '../lib/router';

const VIEWBOX_WIDTH = 1240;
const VIEWBOX_HEIGHT = 760;

const LIMITS = {
  providers: 18,
  assets: 12,
  markets: 44,
  signals: 28,
  strategies: 14,
  edges: 520
};

const TYPE_X = {
  provider: 115,
  asset: 320,
  market: 610,
  signal: 875,
  strategy: 1125
};

const TYPE_LABEL = {
  provider: 'Providers',
  asset: 'Asset Classes',
  market: 'Markets',
  signal: 'Signals',
  strategy: 'Strategies'
};

const asNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const shortLabel = (value, max = 16) => {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
};

const marketIdentity = (symbol, assetClass) => `${String(symbol || '').toLowerCase()}|${String(assetClass || '').toLowerCase()}`;
const providerKeyOf = (provider) => String(provider?.id || provider?.name || '').toLowerCase();
const strategyKeyOf = (name) => String(name || '').toLowerCase();

const rankMarkets = (markets = []) => {
  return [...markets]
    .filter((market) => Boolean(market?.key))
    .sort((a, b) => {
      const aScore = asNum(a.totalVolume) + Math.abs(asNum(a.changePct)) * 1000000;
      const bScore = asNum(b.totalVolume) + Math.abs(asNum(b.changePct)) * 1000000;
      return bScore - aScore;
    })
    .slice(0, LIMITS.markets);
};

const fallbackSignalRows = (markets) => {
  return [...markets]
    .sort((a, b) => Math.abs(asNum(b.changePct)) - Math.abs(asNum(a.changePct)))
    .slice(0, LIMITS.signals)
    .map((market, index) => {
      const move = asNum(market.changePct);
      return {
        id: `fallback:${market.key}:${index}`,
        symbol: market.symbol,
        assetClass: market.assetClass,
        type: 'fallback-pulse',
        score: Math.max(8, Math.min(99, Math.round(Math.abs(move) * 90))),
        severity: Math.abs(move) > 0.9 ? 'high' : Math.abs(move) > 0.35 ? 'medium' : 'low'
      };
    });
};

const ensureNode = (map, node) => {
  if (!node?.id) return;
  if (map.has(node.id)) return;
  map.set(node.id, node);
};

const buildGraph = (snapshot) => {
  const nodes = new Map();
  const edges = [];
  const edgeSet = new Set();

  const addEdge = (from, to, kind) => {
    if (!from || !to || from === to) return;
    const key = `${from}|${to}|${kind}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ from, to, kind });
  };

  const watchedMarkets = rankMarkets(snapshot.markets || []);
  const marketIdByKey = new Map();
  const marketIdByIdentity = new Map();

  for (const market of watchedMarkets) {
    const id = `market:${market.key}`;
    ensureNode(nodes, {
      id,
      type: 'market',
      label: market.symbol,
      meta: market.assetClass,
      score: asNum(market.totalVolume),
      trend: asNum(market.changePct)
    });
    marketIdByKey.set(market.key, id);
    marketIdByIdentity.set(marketIdentity(market.symbol, market.assetClass), id);
  }

  const assetStats = new Map();
  for (const market of watchedMarkets) {
    const key = String(market.assetClass || 'unknown').toLowerCase();
    const current = assetStats.get(key) || { key, count: 0, volume: 0 };
    current.count += 1;
    current.volume += asNum(market.totalVolume);
    assetStats.set(key, current);
  }

  const assetIds = new Map();
  for (const asset of [...assetStats.values()].sort((a, b) => b.volume - a.volume).slice(0, LIMITS.assets)) {
    const id = `asset:${asset.key}`;
    ensureNode(nodes, {
      id,
      type: 'asset',
      label: asset.key,
      meta: `${asset.count} mkts`,
      score: asset.volume
    });
    assetIds.set(asset.key, id);
  }

  const providerStats = new Map();
  for (const provider of snapshot.providers || []) {
    const key = providerKeyOf(provider);
    if (!key) continue;
    const current = providerStats.get(key) || {
      key,
      name: provider.name || provider.id || key,
      count: 0,
      connected: false
    };
    current.connected = current.connected || Boolean(provider.connected);
    providerStats.set(key, current);
  }
  for (const market of watchedMarkets) {
    for (const provider of market.providers || []) {
      const key = providerKeyOf(provider);
      if (!key) continue;
      const current = providerStats.get(key) || {
        key,
        name: provider.name || provider.id || key,
        count: 0,
        connected: true
      };
      current.count += 1;
      providerStats.set(key, current);
    }
  }

  const providerIds = new Map();
  for (const provider of [...providerStats.values()].sort((a, b) => b.count - a.count).slice(0, LIMITS.providers)) {
    const id = `provider:${provider.key}`;
    ensureNode(nodes, {
      id,
      type: 'provider',
      label: provider.name,
      meta: provider.connected ? 'connected' : 'offline',
      score: provider.count
    });
    providerIds.set(provider.key, id);
  }

  const rawSignals = (snapshot.signals || []).slice(0, LIMITS.signals);
  const signalRows = rawSignals.length > 0 ? rawSignals : fallbackSignalRows(watchedMarkets);
  const signalIds = new Map();
  for (const signal of signalRows) {
    const id = `signal:${signal.id}`;
    ensureNode(nodes, {
      id,
      type: 'signal',
      label: `${signal.type || 'signal'}:${signal.symbol || '-'}`,
      meta: signal.severity || signal.direction || 'info',
      score: asNum(signal.score)
    });
    signalIds.set(signal.id, id);
  }

  const strategyStats = new Map();
  for (const strategy of snapshot.strategies || []) {
    const key = strategyKeyOf(strategy.name || strategy.id);
    if (!key) continue;
    const current = strategyStats.get(key) || { key, name: strategy.name || strategy.id || key, count: 0 };
    strategyStats.set(key, current);
  }
  for (const decision of snapshot.decisions || []) {
    const key = strategyKeyOf(decision.strategyName);
    if (!key) continue;
    const current = strategyStats.get(key) || { key, name: decision.strategyName || key, count: 0 };
    current.count += 1;
    strategyStats.set(key, current);
  }

  const strategyIds = new Map();
  for (const strategy of [...strategyStats.values()].sort((a, b) => b.count - a.count).slice(0, LIMITS.strategies)) {
    const id = `strategy:${strategy.key}`;
    ensureNode(nodes, {
      id,
      type: 'strategy',
      label: strategy.name,
      meta: `${strategy.count} decisions`,
      score: strategy.count
    });
    strategyIds.set(strategy.key, id);
  }

  for (const market of watchedMarkets) {
    const marketId = marketIdByKey.get(market.key);
    const assetId = assetIds.get(String(market.assetClass || 'unknown').toLowerCase());
    addEdge(assetId, marketId, 'asset-market');

    for (const provider of market.providers || []) {
      const providerId = providerIds.get(providerKeyOf(provider));
      addEdge(providerId, marketId, 'provider-market');
    }
  }

  for (const signal of signalRows) {
    const signalId = signalIds.get(signal.id);
    const marketId = marketIdByIdentity.get(marketIdentity(signal.symbol, signal.assetClass));
    addEdge(marketId, signalId, 'market-signal');
  }

  for (const decision of snapshot.decisions || []) {
    const marketId = marketIdByIdentity.get(marketIdentity(decision.symbol, decision.assetClass));
    const strategyId = strategyIds.get(strategyKeyOf(decision.strategyName));
    addEdge(marketId, strategyId, 'market-strategy');
  }

  const strategyFallback = [...strategyIds.values()][0] || null;
  if (strategyFallback) {
    for (const signal of signalRows.slice(0, 14)) {
      const signalId = signalIds.get(signal.id);
      addEdge(signalId, strategyFallback, 'signal-strategy');
    }
  }

  const grouped = {
    provider: [],
    asset: [],
    market: [],
    signal: [],
    strategy: []
  };

  for (const node of nodes.values()) {
    if (!grouped[node.type]) continue;
    grouped[node.type].push(node);
  }

  for (const type of Object.keys(grouped)) {
    grouped[type].sort((a, b) => b.score - a.score);
  }

  const positionedNodes = [];
  const nodeById = new Map();
  const topPadding = 56;
  const bottomPadding = VIEWBOX_HEIGHT - 56;

  for (const [type, list] of Object.entries(grouped)) {
    const x = TYPE_X[type];
    const count = list.length;
    if (count === 0) continue;
    const step = count <= 1 ? 0 : (bottomPadding - topPadding) / (count - 1);

    for (let index = 0; index < count; index += 1) {
      const node = list[index];
      const y = count <= 1 ? VIEWBOX_HEIGHT / 2 : topPadding + index * step;
      const placed = { ...node, x, y };
      positionedNodes.push(placed);
      nodeById.set(node.id, placed);
    }
  }

  const positionedEdges = edges
    .slice(0, LIMITS.edges)
    .map((edge) => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to) return null;
      return { ...edge, from, to };
    })
    .filter((edge) => Boolean(edge));

  return {
    nodes: positionedNodes,
    edges: positionedEdges,
    counts: {
      providers: grouped.provider.length,
      assets: grouped.asset.length,
      markets: grouped.market.length,
      signals: grouped.signal.length,
      strategies: grouped.strategy.length,
      edges: positionedEdges.length
    }
  };
};

export default function GraphPage({ snapshot }) {
  const graph = useMemo(() => buildGraph(snapshot), [snapshot]);

  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>Graph View</h1>
          <Link to="/markets" className="inline-link">
            Back to markets
          </Link>
        </div>
        <p>Connection map for watched markets, providers, signals, and strategies. Graph is intentionally capped to keep memory stable.</p>
      </GlowCard>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Providers</span>
          <strong>{fmtInt(graph.counts.providers)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Assets</span>
          <strong>{fmtInt(graph.counts.assets)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Markets</span>
          <strong>{fmtInt(graph.counts.markets)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Edges</span>
          <strong>{fmtInt(graph.counts.edges)}</strong>
        </GlowCard>
      </div>

      <GlowCard className="graph-card">
        <div className="graph-head">
          <h2>Live Topology</h2>
          <span>
            signals {fmtInt(graph.counts.signals)} | strategies {fmtInt(graph.counts.strategies)}
          </span>
        </div>
        <svg className="graph-svg" viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} role="img" aria-label="Market topology graph">
          <defs>
            <marker id="graph-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <path d="M0,0 L7,3.5 L0,7 Z" fill="rgba(140, 163, 228, 0.45)" />
            </marker>
          </defs>

          {Object.entries(TYPE_LABEL).map(([type, label]) => (
            <g key={type}>
              <text x={TYPE_X[type]} y={24} textAnchor="middle" className="graph-col-label">
                {label}
              </text>
              <line x1={TYPE_X[type]} y1={34} x2={TYPE_X[type]} y2={VIEWBOX_HEIGHT - 16} className="graph-col-line" />
            </g>
          ))}

          {graph.edges.map((edge, index) => {
            const midX = (edge.from.x + edge.to.x) / 2;
            const path = `M${edge.from.x},${edge.from.y} C${midX},${edge.from.y} ${midX},${edge.to.y} ${edge.to.x},${edge.to.y}`;
            return <path key={`${edge.kind}:${index}`} d={path} className={`graph-edge ${edge.kind}`} markerEnd="url(#graph-arrow)" />;
          })}

          {graph.nodes.map((node) => {
            const textAnchor = node.type === 'strategy' ? 'end' : 'start';
            const textX = node.type === 'strategy' ? node.x - 10 : node.x + 10;
            const dotSize = node.type === 'market' ? 4.2 : 3.6;
            return (
              <g key={node.id} className={`graph-node ${node.type}`}>
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={dotSize}
                  className={`graph-node-dot ${node.type} ${node.type === 'market' && asNum(node.trend) >= 0 ? 'up' : ''} ${
                    node.type === 'market' && asNum(node.trend) < 0 ? 'down' : ''
                  }`}
                />
                <text x={textX} y={node.y - 1.2} textAnchor={textAnchor} className="graph-node-label">
                  {shortLabel(node.label)}
                </text>
                <text x={textX} y={node.y + 9.5} textAnchor={textAnchor} className="graph-node-meta">
                  {node.type === 'market' ? `${shortLabel(node.meta, 10)} ${fmtPct(node.trend)}` : shortLabel(node.meta, 18)}
                </text>
              </g>
            );
          })}
        </svg>
      </GlowCard>
    </section>
  );
}
