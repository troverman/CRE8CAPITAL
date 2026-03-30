import GlowCard from '../components/GlowCard';
import Sparkline from '../components/Sparkline';
import { fmtDuration, fmtInt, fmtPct, fmtTime, severityClass } from '../lib/format';
import { Link } from '../lib/router';

export default function HomePage({
  snapshot,
  connected,
  transport,
  localFallback,
  syncing,
  lastSyncedAt,
  error,
  onRefresh,
  restrategyReason,
  onRestrategyReasonChange,
  onRestrategy,
  restrategyBusy,
  actionMessage,
  historyByMarket
}) {
  const providerConnected = snapshot.providers.filter((provider) => provider.connected).length;
  const topMarkets = snapshot.markets.slice(0, 6);
  const displaySignals = (() => {
    const liveSignals = Array.isArray(snapshot.signals) ? snapshot.signals.slice(0, 8) : [];
    if (liveSignals.length > 0) {
      return {
        mode: 'live',
        rows: liveSignals
      };
    }

    const fallbackRows = [...snapshot.markets]
      .sort((a, b) => Math.abs(Number(b.changePct) || 0) - Math.abs(Number(a.changePct) || 0))
      .slice(0, 8)
      .map((market, index) => {
        const changePct = Number(market.changePct) || 0;
        const absMove = Math.abs(changePct);
        const direction = changePct >= 0 ? 'long' : 'short';
        const severity = absMove > 0.9 ? 'high' : absMove > 0.35 ? 'medium' : 'low';
        return {
          id: `fallback-overview-signal:${market.key}:${index}`,
          type: 'fallback-pulse',
          direction,
          severity,
          score: Math.max(8, Math.min(99, Math.round(absMove * 90))),
          symbol: market.symbol,
          assetClass: market.assetClass,
          message: `Fallback signal: ${market.symbol} drift ${fmtPct(changePct)} while waiting for runtime triggers.`,
          timestamp: market.updatedAt || Date.now()
        };
      });

    return {
      mode: 'fallback',
      rows: fallbackRows
    };
  })();

  return (
    <section className="page-grid">
      <GlowCard className="hero-card">
        <p className="hero-eyebrow">capital.cre8.xyz</p>
        <h1>MultiMarket Strategy Layer</h1>
        <p className="hero-copy">
          Controller-driven runtime, multimarket providers, signal modeling, and strategy execution in one live surface.
          Focus route: market-level live data, with detail pages for each market and asset class.
        </p>

        <div className="hero-actions">
          <button type="button" className="btn secondary" onClick={onRefresh} disabled={syncing}>
            {syncing ? 'Syncing...' : 'Refresh Snapshot'}
          </button>
          <button type="button" className="btn primary" onClick={onRestrategy} disabled={restrategyBusy}>
            {restrategyBusy ? 'Queuing...' : 'Run Restrategy'}
          </button>
        </div>

        <div className="hero-status-row">
          <span className={connected ? 'status-pill online' : 'status-pill'}>{connected ? `Live ${transport}` : 'Disconnected'}</span>
          {localFallback ? <span className="status-pill">Local fallback feed</span> : null}
          <span>Last sync {fmtTime(lastSyncedAt)}</span>
          <span>Uptime {fmtDuration(snapshot.telemetry.uptimeMs)}</span>
        </div>
        {error ? <p className="error-copy">{error}</p> : null}
      </GlowCard>

      <div className="stat-grid">
        <GlowCard className="stat-card">
          <span>Providers</span>
          <strong>
            {fmtInt(providerConnected)}/{fmtInt(snapshot.providers.length)}
          </strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Markets</span>
          <strong>{fmtInt(snapshot.marketSummary.marketCount)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Signals (5m)</span>
          <strong>{fmtInt(snapshot.signalSummary.lastFiveMinutes)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Decisions</span>
          <strong>{fmtInt(snapshot.strategySummary.totalDecisions)}</strong>
        </GlowCard>
      </div>

      <GlowCard className="live-preview-card">
        <div className="section-head">
          <h2>Market Preview</h2>
          <Link to="/markets" className="inline-link">
            Open all markets
          </Link>
        </div>
        <div className="market-preview-list">
          {topMarkets.map((market) => (
            <Link key={market.key} to={`/market/${encodeURIComponent(market.key)}`} className="preview-row">
              <div>
                <strong>{market.symbol}</strong>
                <p>{market.assetClass}</p>
              </div>
              <Sparkline data={(historyByMarket[market.key] || []).map((point) => point.price)} />
            </Link>
          ))}
        </div>
      </GlowCard>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Signal Preview</h2>
          <span>{displaySignals.mode === 'live' ? 'runtime signals' : 'fallback signals'}</span>
        </div>
        <div className="list-stack">
          {displaySignals.rows.map((signal) => (
            <article key={signal.id} className="list-item">
              <strong>
                {signal.type} | {signal.direction} | {signal.symbol}
              </strong>
              <p>{signal.message}</p>
              <div className="item-meta">
                <span className={`severity ${severityClass(signal.severity)}`}>{signal.severity}</span>
                <small>score {fmtInt(signal.score)}</small>
                <small>{signal.assetClass}</small>
                <small>{fmtTime(signal.timestamp)}</small>
              </div>
            </article>
          ))}
          {displaySignals.rows.length === 0 ? <p className="action-message">No signals available yet.</p> : null}
        </div>
      </GlowCard>

      <GlowCard className="restrategy-card">
        <h2>Restrategy Trigger</h2>
        <p>Manual trigger for `POST /api/triggers/restrategy`.</p>
        <div className="restrategy-row">
          <input
            type="text"
            value={restrategyReason}
            onChange={(event) => onRestrategyReasonChange(event.target.value)}
            placeholder="manual rebalance check"
            aria-label="Restrategy reason"
          />
          <button type="button" className="btn primary" onClick={onRestrategy} disabled={restrategyBusy}>
            {restrategyBusy ? 'Queuing...' : 'Queue Restrategy'}
          </button>
        </div>
        {actionMessage ? <p className="action-message">{actionMessage}</p> : null}
      </GlowCard>
    </section>
  );
}
