import GlowCard from '../components/GlowCard';
import { fmtInt, fmtNum, fmtTime, severityClass } from '../lib/format';
import { findDisplaySignalById } from '../lib/signalView';
import { Link } from '../lib/router';

export default function SignalDetailPage({ signalId, snapshot }) {
  const signal = findDisplaySignalById(snapshot, signalId, 260);

  if (!signal) {
    return (
      <section className="page-grid">
        <GlowCard className="detail-card">
          <h1>Signal not found</h1>
          <p>No signal entry found for `{signalId}`.</p>
          <Link to="/signals" className="inline-link">
            Back to signals
          </Link>
        </GlowCard>
      </section>
    );
  }

  const relatedDecisions = (snapshot.decisions || [])
    .filter((decision) => {
      return String(decision.symbol || '').toUpperCase() === String(signal.symbol || '').toUpperCase() && String(decision.assetClass || '').toLowerCase() === String(signal.assetClass || '').toLowerCase();
    })
    .slice(0, 18);

  const relatedMarket = (snapshot.markets || []).find((market) => {
    return String(market.symbol || '').toUpperCase() === String(signal.symbol || '').toUpperCase() && String(market.assetClass || '').toLowerCase() === String(signal.assetClass || '').toLowerCase();
  });

  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>signal:{signal.symbol}</h1>
          <div className="section-actions">
            <Link to="/signals" className="inline-link">
              Back to signals
            </Link>
            {relatedMarket ? (
              <Link to={`/market/${encodeURIComponent(relatedMarket.key)}`} className="inline-link">
                Open market
              </Link>
            ) : null}
          </div>
        </div>
        <p>
          id {signal.id} | {signal.assetClass} | {signal.type}
        </p>
      </GlowCard>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Direction</span>
          <strong>{signal.direction || 'neutral'}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Severity</span>
          <strong className={`severity ${severityClass(signal.severity)}`}>{signal.severity}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Score</span>
          <strong>{fmtInt(signal.score)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Timestamp</span>
          <strong>{fmtTime(signal.timestamp)}</strong>
        </GlowCard>
      </div>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Signal Message</h2>
        </div>
        <p>{signal.message || 'No message provided.'}</p>
      </GlowCard>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Related Strategy Decisions</h2>
          <span>{relatedDecisions.length} recent</span>
        </div>
        <div className="list-stack">
          {relatedDecisions.map((decision) => (
            <article key={decision.id} className="list-item">
              <strong>
                <Link to={`/strategy/${encodeURIComponent(decision.strategyName || 'unknown')}`} className="inline-link">
                  {decision.strategyName || 'unknown'}
                </Link>{' '}
                | {decision.action}
              </strong>
              <p>{decision.reason}</p>
              <div className="item-meta">
                <small>{decision.trigger || '-'}</small>
                <small>score {fmtNum(decision.score, 2)}</small>
                <small>{fmtTime(decision.timestamp)}</small>
              </div>
            </article>
          ))}
          {relatedDecisions.length === 0 ? <p className="action-message">No linked decisions found yet.</p> : null}
        </div>
      </GlowCard>
    </section>
  );
}
