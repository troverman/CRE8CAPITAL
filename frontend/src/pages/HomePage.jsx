import { useEffect, useState } from 'react';
import GlowCard from '../components/GlowCard';
import Sparkline from '../components/Sparkline';
import { fmtInt, fmtNum, fmtTime, severityClass } from '../lib/format';
import { fetchWallet, fetchAlerts, fetchExecution } from '../lib/capitalApi';
import { getDisplaySignals } from '../lib/signalView';
import { Link } from '../lib/router';
import { useStrategyLabStore } from '../store/strategyLabStore';

export default function HomePage({
  snapshot,
  connected,
  syncing,
  onRefresh,
  historyByMarket
}) {
  const providerConnected = snapshot.providers.filter((provider) => provider.connected).length;

  // Simulation wallet (always available in demo mode)
  const simWallet = useStrategyLabStore((state) => state.wallet);
  const simRunning = useStrategyLabStore((state) => state.running);

  const [wallet, setWallet] = useState(null);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [executionStats, setExecutionStats] = useState(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let retryDelay = 10000;
    let timer;
    let alive = true;

    const load = async () => {
      try {
        const [w, a, e] = await Promise.all([
          fetchWallet(),
          fetchAlerts(1),
          fetchExecution()
        ]);
        if (!alive) return;
        setWallet(w);
        setUnreadAlerts(a.unreadCount || 0);
        setExecutionStats(e.stats || null);
        setOffline(false);
        retryDelay = 10000;
        timer = setTimeout(load, 10000);
      } catch (_) {
        if (!alive) return;
        setOffline(true);
        retryDelay = Math.min(retryDelay * 1.5, 30000);
        timer = setTimeout(load, retryDelay);
      }
    };
    load();
    return () => { alive = false; clearTimeout(timer); };
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
      {offline && (
        <div style={{background: '#1c1917', border: '1px solid #78350f', borderRadius: 8, padding: '8px 16px', marginBottom: 12, color: '#fbbf24', fontSize: 13}}>
          Backend offline — showing cached data. Retrying...
        </div>
      )}
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

      {(() => {
        const displayWallet = wallet || (simWallet && simWallet.equity > 0 ? {
          equity: simWallet.equity,
          cash: simWallet.cash,
          totalPnl: simWallet.realizedPnl || 0,
          tradeCount: simWallet.tradeCount || 0,
          winCount: simWallet.winCount || 0,
        } : null);
        const isLive = Boolean(wallet);
        return displayWallet ? (
          <div className="home-section">
            <h3 className="home-section-label">
              Wallet
              {isLive ? (
                <span style={{background:'#065f46', color:'#34d399', padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:600, marginLeft:8}}>LIVE</span>
              ) : (
                <span style={{background:'#78350f', color:'#fbbf24', padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:600, marginLeft:8}}>PAPER</span>
              )}
            </h3>
            <div className="stat-grid">
              <GlowCard className="stat-card stat-card-hero">
                <span>Equity</span>
                <strong className="stat-big">{fmtNum(displayWallet.equity, 2)}</strong>
              </GlowCard>
              <GlowCard className="stat-card">
                <span>Cash</span>
                <strong>{fmtNum(displayWallet.cash, 2)}</strong>
              </GlowCard>
              <GlowCard className="stat-card">
                <span>Total P&L</span>
                <strong className={displayWallet.totalPnl >= 0 ? 'up' : 'down'}>{fmtNum(displayWallet.totalPnl, 2)}</strong>
              </GlowCard>
              <GlowCard className="stat-card">
                <span>Trades / Win Rate</span>
                <strong>
                  {fmtInt(displayWallet.tradeCount)} / {displayWallet.tradeCount > 0 ? fmtNum((displayWallet.winCount / displayWallet.tradeCount) * 100, 1) : '0'}%
                </strong>
              </GlowCard>
              <GlowCard className="stat-card">
                <span>Mode</span>
                <strong>
                  <span className={`status-pill ${executionStats?.mode === 'live' ? 'online' : ''}`}>{isLive ? (executionStats?.mode || 'live') : (simRunning ? 'paper (running)' : 'paper')}</span>
                </strong>
              </GlowCard>
              <GlowCard className="stat-card">
                <span>Unread Alerts</span>
                <strong>{fmtInt(unreadAlerts)}</strong>
              </GlowCard>
            </div>
          </div>
        ) : null;
      })()}

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
                <p>{market.assetClass} · {market.providerQuotes?.length || market.providerCount || 0} provider{(market.providerQuotes?.length || market.providerCount || 0) === 1 ? '' : 's'}</p>
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
