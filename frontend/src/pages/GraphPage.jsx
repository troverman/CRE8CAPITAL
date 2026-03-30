import { useEffect, useMemo } from 'react';
import GlowCard from '../components/GlowCard';
import { fmtInt, fmtPct } from '../lib/format';
import { Link, navigate } from '../lib/router';
import { buildStrategyRows } from '../lib/strategyView';
import { useStrategyToggleStore } from '../store/strategyToggleStore';

const VIEWBOX_WIDTH = 1240;
const VIEWBOX_HEIGHT = 760;
const STRUCTURE_WIDTH = 1240;
const STRUCTURE_HEIGHT = 690;

const LIMITS = {
  providers: 18,
  assets: 12,
  markets: 44,
  signals: 28,
  strategies: 14,
  edges: 520
};

const STRUCTURE_LIMITS = {
  markets: 96,
  tokens: 30,
  edges: 130
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

const QUOTE_SUFFIXES = ['USDT', 'USDC', 'USD', 'BTC', 'ETH', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];
const STABLE_TOKENS = new Set(['USDT', 'USDC', 'USD']);

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

const resolveEnabled = (strategy, enabledByKey) => {
  const key = String(strategy?.key || '');
  if (typeof enabledByKey?.[key] === 'boolean') return enabledByKey[key];
  if (strategy?.enabled === null || typeof strategy?.enabled === 'undefined') return true;
  return Boolean(strategy.enabled);
};

const normalizeSymbol = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const parsePair = (symbol, assetClass) => {
  const clean = String(symbol || '').toUpperCase();
  if (!clean) return null;

  if (clean.includes('/')) {
    const [base, quote] = clean.split('/');
    if (base && quote) return { base: normalizeSymbol(base), quote: normalizeSymbol(quote) };
  }
  if (clean.includes('-')) {
    const [base, quote] = clean.split('-');
    if (base && quote) return { base: normalizeSymbol(base), quote: normalizeSymbol(quote) };
  }

  const normalized = normalizeSymbol(clean);
  const lowerAsset = String(assetClass || '').toLowerCase();

  if (lowerAsset === 'fx' && normalized.length === 6) {
    return {
      base: normalized.slice(0, 3),
      quote: normalized.slice(3)
    };
  }

  for (const suffix of QUOTE_SUFFIXES) {
    if (normalized.endsWith(suffix) && normalized.length > suffix.length + 1) {
      return {
        base: normalized.slice(0, normalized.length - suffix.length),
        quote: suffix
      };
    }
  }

  if (lowerAsset === 'equity') {
    return {
      base: normalized,
      quote: 'USD'
    };
  }

  return null;
};

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

const buildGraph = (snapshot, strategyRows) => {
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

  const rankedStrategies = [...(strategyRows || [])]
    .filter((strategy) => Boolean(strategy?.key) && strategy.enabled !== false)
    .sort((a, b) => {
      if (b.decisionCount !== a.decisionCount) return b.decisionCount - a.decisionCount;
      return asNum(b.avgScore) - asNum(a.avgScore);
    })
    .slice(0, LIMITS.strategies);
  const strategyIds = new Map();
  for (const strategy of rankedStrategies) {
    const id = `strategy:${strategy.key}`;
    ensureNode(nodes, {
      id,
      type: 'strategy',
      label: strategy.name,
      meta: `${fmtInt(strategy.decisionCount || 0)} decisions`,
      score: Math.max(1, asNum(strategy.decisionCount)),
      strategyId: strategy.id || strategy.name || strategy.key
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
    const strategyId = strategyIds.get(strategyKeyOf(decision.strategyName || decision.strategy));
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

const buildStructureGraph = (snapshot) => {
  const watchedMarkets = [...(snapshot.markets || [])]
    .filter((market) => Boolean(market?.key))
    .sort((a, b) => asNum(b.totalVolume) - asNum(a.totalVolume))
    .slice(0, STRUCTURE_LIMITS.markets);

  const tokenStats = new Map();
  const edgeStats = new Map();

  const touchToken = (token, marketVolume) => {
    const key = normalizeSymbol(token);
    if (!key) return null;
    const current = tokenStats.get(key) || {
      key,
      count: 0,
      volume: 0
    };
    current.count += 1;
    current.volume += asNum(marketVolume);
    tokenStats.set(key, current);
    return current;
  };

  for (const market of watchedMarkets) {
    const pair = parsePair(market.symbol, market.assetClass);
    if (!pair || !pair.base || !pair.quote || pair.base === pair.quote) continue;
    const base = normalizeSymbol(pair.base);
    const quote = normalizeSymbol(pair.quote);
    const marketVolume = asNum(market.totalVolume);
    touchToken(base, marketVolume);
    touchToken(quote, marketVolume);

    const edgeKey = [base, quote].sort().join('|');
    const current = edgeStats.get(edgeKey) || {
      key: edgeKey,
      from: base,
      to: quote,
      marketCount: 0,
      volume: 0
    };
    current.marketCount += 1;
    current.volume += marketVolume;
    edgeStats.set(edgeKey, current);
  }

  if (tokenStats.has('BTC')) {
    for (const token of tokenStats.values()) {
      if (!token?.key || token.key === 'BTC' || STABLE_TOKENS.has(token.key)) continue;
      const edgeKey = [token.key, 'BTC'].sort().join('|');
      const current = edgeStats.get(edgeKey) || {
        key: edgeKey,
        from: token.key,
        to: 'BTC',
        marketCount: 0,
        volume: 0
      };
      current.marketCount += 0.45;
      current.volume += token.volume * 0.18;
      edgeStats.set(edgeKey, current);
    }
  }

  const rankedTokens = [...tokenStats.values()]
    .map((token) => ({
      ...token,
      score: token.count * 2 + Math.log1p(token.volume / 1000000)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, STRUCTURE_LIMITS.tokens);

  const selectedTokenSet = new Set(rankedTokens.map((token) => token.key));
  const selectedEdges = [...edgeStats.values()]
    .filter((edge) => selectedTokenSet.has(edge.from) && selectedTokenSet.has(edge.to))
    .sort((a, b) => {
      const aWeight = a.marketCount * 3 + Math.log1p(a.volume / 1000000);
      const bWeight = b.marketCount * 3 + Math.log1p(b.volume / 1000000);
      return bWeight - aWeight;
    })
    .slice(0, STRUCTURE_LIMITS.edges);

  const degreeMap = new Map();
  for (const token of rankedTokens) {
    degreeMap.set(token.key, 0);
  }
  for (const edge of selectedEdges) {
    degreeMap.set(edge.from, asNum(degreeMap.get(edge.from)) + edge.marketCount);
    degreeMap.set(edge.to, asNum(degreeMap.get(edge.to)) + edge.marketCount);
  }

  const rankedByDegree = [...rankedTokens].sort((a, b) => asNum(degreeMap.get(b.key)) - asNum(degreeMap.get(a.key)));
  const hub = rankedByDegree[0] || null;

  const centerX = STRUCTURE_WIDTH / 2;
  const centerY = STRUCTURE_HEIGHT / 2;
  const ringA = 185;
  const ringB = 300;
  const others = rankedByDegree.slice(1);
  const coreCount = Math.min(10, others.length);
  const core = others.slice(0, coreCount);
  const outer = others.slice(coreCount);
  const positions = new Map();

  if (hub) {
    positions.set(hub.key, {
      ...hub,
      x: centerX,
      y: centerY,
      tier: 'hub',
      degree: asNum(degreeMap.get(hub.key))
    });
  }

  for (let index = 0; index < core.length; index += 1) {
    const token = core[index];
    const angle = (Math.PI * 2 * index) / Math.max(core.length, 1) - Math.PI / 2;
    positions.set(token.key, {
      ...token,
      x: centerX + Math.cos(angle) * ringA,
      y: centerY + Math.sin(angle) * ringA,
      tier: 'core',
      degree: asNum(degreeMap.get(token.key))
    });
  }

  for (let index = 0; index < outer.length; index += 1) {
    const token = outer[index];
    const angle = (Math.PI * 2 * index) / Math.max(outer.length, 1) - Math.PI / 2 + 0.12;
    positions.set(token.key, {
      ...token,
      x: centerX + Math.cos(angle) * ringB,
      y: centerY + Math.sin(angle) * ringB,
      tier: 'outer',
      degree: asNum(degreeMap.get(token.key))
    });
  }

  const nodes = [...positions.values()];
  const edges = selectedEdges
    .map((edge) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) return null;
      return {
        ...edge,
        from,
        to,
        width: Math.min(4.6, 0.9 + edge.marketCount * 0.45)
      };
    })
    .filter((edge) => Boolean(edge));

  return {
    nodes,
    edges,
    hub: hub
      ? {
          ...hub,
          links: asNum(degreeMap.get(hub.key))
        }
      : null,
    counts: {
      markets: watchedMarkets.length,
      tokens: nodes.length,
      edges: edges.length
    }
  };
};

export default function GraphPage({ snapshot }) {
  const enabledByKey = useStrategyToggleStore((state) => state.enabledByKey);
  const ensureStrategies = useStrategyToggleStore((state) => state.ensureStrategies);
  const setStrategyEnabled = useStrategyToggleStore((state) => state.setStrategyEnabled);

  const strategyRows = useMemo(() => buildStrategyRows(snapshot), [snapshot]);

  useEffect(() => {
    ensureStrategies(strategyRows);
  }, [ensureStrategies, strategyRows]);

  const hydratedStrategies = useMemo(() => {
    return strategyRows.map((strategy) => ({
      ...strategy,
      enabled: resolveEnabled(strategy, enabledByKey)
    }));
  }, [enabledByKey, strategyRows]);

  const strategyControls = useMemo(() => {
    return [...hydratedStrategies].sort((a, b) => {
      if (b.decisionCount !== a.decisionCount) return b.decisionCount - a.decisionCount;
      return asNum(b.avgScore) - asNum(a.avgScore);
    });
  }, [hydratedStrategies]);

  const enabledStrategyCount = useMemo(() => strategyControls.filter((strategy) => strategy.enabled).length, [strategyControls]);

  const graph = useMemo(() => buildGraph(snapshot, hydratedStrategies), [hydratedStrategies, snapshot]);
  const structure = useMemo(() => buildStructureGraph(snapshot), [snapshot]);

  const openStrategyNode = (node) => {
    if (!node?.strategyId) return;
    navigate(`/strategy/${encodeURIComponent(node.strategyId)}`);
  };

  const handleStrategyNodeKeyDown = (event, node) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openStrategyNode(node);
  };

  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>Graph View</h1>
          <div className="section-actions">
            <Link to="/strategies" className="inline-link">
              Open strategies
            </Link>
            <Link to="/markets" className="inline-link">
              Back to markets
            </Link>
          </div>
        </div>
        <p>Connection map for watched markets, providers, signals, and strategies, plus a token-structure hub graph to expose central assets.</p>
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

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Strategy Switchboard</h2>
          <span>
            enabled {fmtInt(enabledStrategyCount)} / {fmtInt(strategyControls.length)}
          </span>
        </div>
        <p className="socket-status-copy">Toggle strategy visibility directly from graph view. Disabled strategies are removed from strategy nodes and strategy edges.</p>
        <div className="graph-strategy-grid">
          {strategyControls.map((strategy) => (
            <article key={`toggle:${strategy.key}`} className={strategy.enabled ? 'graph-strategy-row' : 'graph-strategy-row disabled'}>
              <div className="graph-strategy-meta">
                <strong>
                  <Link to={`/strategy/${encodeURIComponent(strategy.id || strategy.name || strategy.key)}`} className="inline-link strategy-title-link">
                    {strategy.name}
                  </Link>
                </strong>
                <small>
                  decisions {fmtInt(strategy.decisionCount)} | markets {fmtInt(strategy.marketCount)} | avg score {asNum(strategy.avgScore).toFixed(2)}
                </small>
                <small>{strategy.description || 'No description available yet.'}</small>
              </div>
              <label className="toggle-label strategy-toggle-switch">
                <input
                  type="checkbox"
                  checked={Boolean(strategy.enabled)}
                  onChange={(event) => setStrategyEnabled(strategy.key, event.target.checked)}
                />
                <span>{strategy.enabled ? 'on' : 'off'}</span>
              </label>
            </article>
          ))}
        </div>
      </GlowCard>

      <GlowCard className="graph-card">
        <div className="graph-head">
          <h2>Live Topology</h2>
          <span>
            signals {fmtInt(graph.counts.signals)} | strategies {fmtInt(graph.counts.strategies)} visible
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
            const strategyNode = node.type === 'strategy' && Boolean(node.strategyId);
            return (
              <g
                key={node.id}
                className={`graph-node ${node.type} ${strategyNode ? 'clickable' : ''}`}
                role={strategyNode ? 'link' : undefined}
                tabIndex={strategyNode ? 0 : undefined}
                onClick={strategyNode ? () => openStrategyNode(node) : undefined}
                onKeyDown={strategyNode ? (event) => handleStrategyNodeKeyDown(event, node) : undefined}
              >
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

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Hub Token</span>
          <strong>{structure.hub?.key || '-'}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Paired Markets</span>
          <strong>{fmtInt(structure.counts.markets)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Tokens</span>
          <strong>{fmtInt(structure.counts.tokens)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Token Edges</span>
          <strong>{fmtInt(structure.counts.edges)}</strong>
        </GlowCard>
      </div>

      <GlowCard className="graph-card">
        <div className="graph-head">
          <h2>Market Structure Hubs</h2>
          <span>
            central {structure.hub?.key || '-'} | degree {fmtInt(structure.hub?.links || 0)}
          </span>
        </div>
        <svg className="structure-graph-svg" viewBox={`0 0 ${STRUCTURE_WIDTH} ${STRUCTURE_HEIGHT}`} role="img" aria-label="Token hub graph">
          <circle cx={STRUCTURE_WIDTH / 2} cy={STRUCTURE_HEIGHT / 2} r="185" className="structure-ring" />
          <circle cx={STRUCTURE_WIDTH / 2} cy={STRUCTURE_HEIGHT / 2} r="300" className="structure-ring outer" />

          {structure.edges.map((edge) => (
            <line
              key={`edge:${edge.key}`}
              x1={edge.from.x}
              y1={edge.from.y}
              x2={edge.to.x}
              y2={edge.to.y}
              className="structure-edge"
              style={{ strokeWidth: edge.width }}
            />
          ))}

          {structure.nodes.map((node) => (
            <g key={`token:${node.key}`}>
              <circle cx={node.x} cy={node.y} r={node.tier === 'hub' ? 10.5 : node.tier === 'core' ? 8.4 : 6.3} className={`structure-node ${node.tier}`} />
              <text x={node.x} y={node.y - (node.tier === 'hub' ? 14 : 10)} textAnchor="middle" className="structure-label">
                {shortLabel(node.key, 11)}
              </text>
              <text x={node.x} y={node.y + (node.tier === 'hub' ? 18 : 15)} textAnchor="middle" className="structure-meta">
                {fmtInt(node.degree)} links
              </text>
            </g>
          ))}
        </svg>
      </GlowCard>
    </section>
  );
}
