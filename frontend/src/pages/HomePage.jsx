import { useEffect, useState } from 'react';
import GlowCard from '../components/GlowCard';
import Sparkline from '../components/Sparkline';
import { fmtInt, fmtNum, fmtTime, severityClass } from '../lib/format';
import { fetchWallet, fetchAlerts, fetchExecution } from '../lib/capitalApi';
import { getDisplaySignals } from '../lib/signalView';
import { Link } from '../lib/router';

export default function HomePage({
  snapshot,
  connected,
  syncing,
  onRefresh,
  historyByMarket
}) {
  const providerConnected = snapshot.providers.filter((provider) => provider.connected).length;

  const [wallet, setWallet] = useState(null);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [executionStats, setExecutionStats] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [w, a, e] = await Promise.all([
          fetchWallet(),
          fetchAlerts(1),
          fetchExecution()
        ]);
        setWallet(w);
        setUnreadAlerts(a.unreadCount || 0);
        setExecutionStats(e.stats || null);
      } catch (_) { /* backend may be offline */ }
    };
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, []);
  const topMarkets = snapshot.markets.slice(0, 6);
  const displaySignals = (() => {
    const rows = getDisplaySignals(snapshot, 8);
    if (Array.isArray(snapshot.signals) && snapshot.signals.length > 0) {
      return {
        mode: 'live',
        rows
      };
    }

    return {
      mode: 'fallback',
      rows
    };
  })();

  return (
    <section className="page-grid">
      <GlowCard className="hero-card hero-card-compact">
        <p className="hero-eyebrow">capital.cre8.xyz</p>
        <h1>MultiMarket Strategy Layer</h1>
        <div className="hero-actions">
          <button type="button" className="btn secondary" onClick={onRefresh} disabled={syncing}>
            {syncing ? 'Syncing...' : 'Refresh Snapshot'}
          </button>
          <Link to="/strategy" className="btn secondary">
            Open Strategy Lab
          </Link>
        </div>
      </GlowCard>

      <div className="home-section">
        <h3 className="home-section-label">Runtime</h3>
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
      </div>

      {wallet ? (
        <div className="home-section">
          <h3 className="home-section-label">Wallet</h3>
          <div className="stat-grid">
            <GlowCard className="stat-card stat-card-hero">
              <span>Equity</span>
              <strong className="stat-big">{fmtNum(wallet.equity, 2)}</strong>
            </GlowCard>
            <GlowCard className="stat-card">
              <span>Cash</span>
              <strong>{fmtNum(wallet.cash, 2)}</strong>
            </GlowCard>
            <GlowCard className="stat-card">
              <span>Total P&L</span>
              <strong className={wallet.totalPnl >= 0 ? 'up' : 'down'}>{fmtNum(wallet.totalPnl, 2)}</strong>
            </GlowCard>
            <GlowCard className="stat-card">
              <span>Trades / Win Rate</span>
              <strong>
                {fmtInt(wallet.tradeCount)} / {wallet.tradeCount > 0 ? fmtNum((wallet.winCount / wallet.tradeCount) * 100, 1) : '0'}%
              </strong>
            </GlowCard>
            <GlowCard className="stat-card">
              <span>Mode</span>
              <strong>
                <span className={`status-pill ${executionStats?.mode === 'live' ? 'online' : ''}`}>{executionStats?.mode || 'paper'}</span>
              </strong>
            </GlowCard>
            <GlowCard className="stat-card">
              <span>Unread Alerts</span>
              <strong>{fmtInt(unreadAlerts)}</strong>
            </GlowCard>
          </div>
        </div>
      ) : null}

      <GlowCard className="live-preview-card">
        <div className="section-head">
          <h2>Market Preview</h2>
          <Link to="/markets" className="inline-link">
            Open all markets
          </Link>
        </div>
        <div className="market-preview-list">
          {topMarkets.map((market, index) => (
            <Link key={market.key} to={`/market/${encodeURIComponent(market.key)}`} className={`preview-row ${index % 2 === 1 ? 'preview-row-alt' : ''}`}>
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
        <div className="list-stack signal-preview-scroll">
          {displaySignals.rows.map((signal) => (
            <Link key={signal.id} to={`/signal/${encodeURIComponent(signal.id)}`} className="market-card-link">
              <article className="list-item">
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
            </Link>
          ))}
          {displaySignals.rows.length === 0 ? <p className="action-message">No signals available yet.</p> : null}
        </div>
      </GlowCard>

    </section>
  );
}
