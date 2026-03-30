import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:8787';

const initialSnapshot = {
  running: false,
  telemetry: {},
  controller: {},
  providers: [],
  markets: [],
  marketSummary: {},
  signals: [],
  signalSummary: {},
  strategies: [],
  strategySummary: {},
  positions: [],
  decisions: [],
  feed: []
};

const fmtInt = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return Math.round(num).toLocaleString();
};

const fmtNum = (value, digits = 2) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
};

const fmtCompact = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 2
  }).format(num);
};

const fmtPct = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
};

const fmtTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

const fmtDuration = (value) => {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return '-';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
};

const severityClass = (severity) => {
  if (severity === 'high') return 'high';
  if (severity === 'medium') return 'medium';
  return 'low';
};

export default function App() {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [error, setError] = useState('');
  const [restrategyReason, setRestrategyReason] = useState('manual rebalance check');
  const [restrategyBusy, setRestrategyBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState('');

  const requestRef = useRef({ id: 0, controller: null });
  const mountedRef = useRef(false);

  const loadSnapshot = useCallback(async () => {
    const requestId = requestRef.current.id + 1;
    requestRef.current.id = requestId;

    if (requestRef.current.controller) {
      requestRef.current.controller.abort();
    }

    const controller = new AbortController();
    requestRef.current.controller = controller;
    setSyncing(true);

    try {
      const response = await fetch(`${apiBase}/api/snapshot`, {
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = await response.json();
      if (!mountedRef.current || requestId !== requestRef.current.id) return;

      setSnapshot(payload);
      setConnected(true);
      setError('');
      setLastSyncedAt(Date.now());
    } catch (loadError) {
      if (loadError.name === 'AbortError') return;
      if (!mountedRef.current || requestId !== requestRef.current.id) return;

      setConnected(false);
      setError(loadError.message || 'Snapshot fetch failed');
    } finally {
      if (!mountedRef.current || requestId !== requestRef.current.id) return;
      setSyncing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadSnapshot();

    const intervalId = setInterval(() => {
      loadSnapshot();
    }, 5000);

    return () => {
      mountedRef.current = false;
      clearInterval(intervalId);
      if (requestRef.current.controller) {
        requestRef.current.controller.abort();
      }
    };
  }, [loadSnapshot]);

  const triggerRestrategy = async () => {
    setRestrategyBusy(true);
    setActionMessage('');

    try {
      const response = await fetch(`${apiBase}/api/triggers/restrategy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: restrategyReason,
          source: 'capital-intro'
        })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = await response.json();
      setActionMessage(`Restrategy queued at ${fmtTime(payload.request?.requestedAt)}`);
      await loadSnapshot();
    } catch (triggerError) {
      setActionMessage(`Restrategy failed: ${triggerError.message}`);
    } finally {
      setRestrategyBusy(false);
    }
  };

  const providerCounts = useMemo(() => {
    const connectedCount = snapshot.providers.filter((provider) => provider.connected).length;
    const syntheticCount = snapshot.providers.filter((provider) => provider.kind === 'synthetic').length;
    const externalCount = snapshot.providers.filter((provider) => provider.kind === 'external').length;
    return { connectedCount, syntheticCount, externalCount };
  }, [snapshot.providers]);

  const topMarkets = useMemo(() => snapshot.markets.slice(0, 8), [snapshot.markets]);
  const topSignals = useMemo(() => snapshot.signals.slice(0, 6), [snapshot.signals]);
  const topDecisions = useMemo(() => snapshot.decisions.slice(0, 6), [snapshot.decisions]);
  const architectureItems = useMemo(
    () => [
      {
        title: 'Controller Interface',
        detail: 'Queue + trigger pattern from runtime/CRE8SOCIAL',
        stats: [
          `Tick ${fmtInt(snapshot.controller.tick)}`,
          `Queue ${fmtInt(snapshot.controller.queueDepth)}`,
          `FPS ${fmtInt(snapshot.controller.fps)}`
        ]
      },
      {
        title: 'Signal Engine',
        detail: 'multi-market signal model for momentum, spread, and venue gaps',
        stats: [
          `${fmtInt(snapshot.signalSummary.total)} total signals`,
          `${fmtInt(snapshot.signalSummary.lastFiveMinutes)} in last 5m`,
          `High ${fmtInt(snapshot.signalSummary.bySeverity?.high)}`
        ]
      },
      {
        title: 'Strategy Layer',
        detail: 'strategy models + restrategy trigger over signal output',
        stats: [
          `${fmtInt(snapshot.strategies.length)} strategies`,
          `${fmtInt(snapshot.positions.length)} positions`,
          `${fmtInt(snapshot.strategySummary.totalDecisions)} decisions`
        ]
      }
    ],
    [snapshot]
  );

  return (
    <main className="capital-home">
      <section className="hero-shell">
        <p className="hero-eyebrow">capital.cre8.xyz</p>
        <h1>MultiMarket Capital, Simple Intro</h1>
        <p className="hero-copy">
          CRE8 Capital is the strategy layer above a multimarket runtime. Providers stream market data, signals model
          market states, and strategy engines execute decisions with manual and automatic restrategy triggers.
        </p>

        <div className="hero-actions">
          <button type="button" className="btn secondary" onClick={loadSnapshot} disabled={syncing}>
            {syncing ? 'Syncing...' : 'Refresh Snapshot'}
          </button>
          <button type="button" className="btn primary" onClick={triggerRestrategy} disabled={restrategyBusy}>
            {restrategyBusy ? 'Queuing...' : 'Run Restrategy'}
          </button>
        </div>

        <div className="hero-status-row">
          <span className={connected ? 'status-pill online' : 'status-pill'}>
            {connected ? 'Runtime Connected' : 'Runtime Disconnected'}
          </span>
          <span>Last sync {loading ? '-' : fmtTime(lastSyncedAt)}</span>
          <span>Uptime {fmtDuration(snapshot.telemetry.uptimeMs)}</span>
        </div>

        {error ? <p className="error-copy">{error}</p> : null}
      </section>

      <section className="stats-ribbon">
        <div className="stat-item">
          <span>Providers</span>
          <strong>
            {fmtInt(providerCounts.connectedCount)}/{fmtInt(snapshot.providers.length)}
          </strong>
        </div>
        <div className="stat-item">
          <span>Markets</span>
          <strong>{fmtInt(snapshot.marketSummary.marketCount)}</strong>
        </div>
        <div className="stat-item">
          <span>Signals (5m)</span>
          <strong>{fmtInt(snapshot.signalSummary.lastFiveMinutes)}</strong>
        </div>
        <div className="stat-item">
          <span>Decisions</span>
          <strong>{fmtInt(snapshot.strategySummary.totalDecisions)}</strong>
        </div>
        <div className="stat-item">
          <span>Dropped Actions</span>
          <strong>{fmtInt(snapshot.telemetry.actionsDropped)}</strong>
        </div>
      </section>

      <section className="architecture-section">
        <h2>Runtime Architecture</h2>
        <p>
          This page reflects backend reality: controller pattern, multimarket providers, signal generation, strategy
          decisions, and restrategy event triggers.
        </p>
        <div className="architecture-grid">
          {architectureItems.map((item) => (
            <article key={item.title} className="architecture-card">
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
              <ul>
                {item.stats.map((stat) => (
                  <li key={stat}>{stat}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="live-section">
        <div className="live-header">
          <h2>Live Runtime Snapshot</h2>
          <p>
            synthetic {fmtInt(providerCounts.syntheticCount)} | external {fmtInt(providerCounts.externalCount)} | queue{' '}
            {fmtInt(snapshot.controller.queueDepth)}
          </p>
        </div>

        <div className="live-grid">
          <article className="panel">
            <div className="panel-head">
              <h3>Providers</h3>
              <span>{fmtInt(snapshot.providers.length)}</span>
            </div>
            <div className="list">
              {snapshot.providers.slice(0, 8).map((provider) => (
                <div key={provider.id} className="list-row">
                  <div>
                    <strong>{provider.name}</strong>
                    <p>
                      {provider.assetClass} | {provider.kind}
                    </p>
                  </div>
                  <div className="right-copy">
                    <span className={provider.connected ? 'dot on' : 'dot'} />
                    <small>{fmtTime(provider.lastHeartbeat)}</small>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel wide">
            <div className="panel-head">
              <h3>Markets</h3>
              <span>{fmtInt(topMarkets.length)} shown</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Class</th>
                    <th>Reference</th>
                    <th>Spread (bps)</th>
                    <th>Change</th>
                    <th>Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {topMarkets.map((market) => (
                    <tr key={market.key}>
                      <td>{market.symbol}</td>
                      <td>{market.assetClass}</td>
                      <td>{fmtNum(market.referencePrice, 4)}</td>
                      <td>{fmtNum(market.spreadBps, 1)}</td>
                      <td className={Number(market.changePct) >= 0 ? 'up' : 'down'}>{fmtPct(market.changePct)}</td>
                      <td>{fmtCompact(market.totalVolume)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="panel">
            <div className="panel-head">
              <h3>Signals</h3>
              <span>{fmtInt(topSignals.length)} recent</span>
            </div>
            <div className="list">
              {topSignals.map((signal) => (
                <div key={signal.id} className="list-row stacked">
                  <strong>
                    {signal.symbol} | {signal.type}
                  </strong>
                  <p>{signal.message}</p>
                  <div className="line-row">
                    <span className={`severity ${severityClass(signal.severity)}`}>{signal.severity}</span>
                    <small>score {fmtInt(signal.score)}</small>
                    <small>{fmtTime(signal.timestamp)}</small>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-head">
              <h3>Decisions</h3>
              <span>{fmtInt(topDecisions.length)} recent</span>
            </div>
            <div className="list">
              {topDecisions.map((decision) => (
                <div key={decision.id} className="list-row stacked">
                  <strong>
                    {decision.strategyName} -> {decision.action}
                  </strong>
                  <p>
                    {decision.symbol} | {decision.reason}
                  </p>
                  <div className="line-row">
                    <small>{decision.trigger}</small>
                    <small>score {fmtInt(decision.score)}</small>
                    <small>{fmtTime(decision.timestamp)}</small>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section className="restrategy-section">
        <h2>Restrategy Trigger</h2>
        <p>
          Manual trigger for the backend `restrategy` event. This maps directly to `POST /api/triggers/restrategy`.
        </p>
        <div className="restrategy-row">
          <input
            type="text"
            value={restrategyReason}
            onChange={(event) => setRestrategyReason(event.target.value)}
            placeholder="manual rebalance check"
            aria-label="Restrategy reason"
          />
          <button type="button" className="btn primary" onClick={triggerRestrategy} disabled={restrategyBusy}>
            {restrategyBusy ? 'Queuing...' : 'Queue Restrategy'}
          </button>
        </div>
        {actionMessage ? <p className="action-message">{actionMessage}</p> : null}
      </section>
    </main>
  );
}

