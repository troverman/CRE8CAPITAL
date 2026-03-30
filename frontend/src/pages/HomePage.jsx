import GlowCard from '../components/GlowCard';
import Sparkline from '../components/Sparkline';
import { fmtDuration, fmtInt, fmtTime } from '../lib/format';
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
