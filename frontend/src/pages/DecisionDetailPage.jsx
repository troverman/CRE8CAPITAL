import { useMemo } from 'react';
import GlowCard from '../components/GlowCard';
import { buildDecisionWalletLinkIndex } from '../lib/decisionWalletLink';
import { buildDecisionRows } from '../lib/decisionView';
import { fmtInt, fmtNum, fmtTime } from '../lib/format';
import { Link } from '../lib/router';
import { getDisplaySignals } from '../lib/signalView';
import { useExecutionFeedStore } from '../store/executionFeedStore';
import { useStrategyLabStore } from '../store/strategyLabStore';

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toIdentity = (symbol, assetClass) => `${String(symbol || '').toUpperCase()}|${String(assetClass || '').toLowerCase()}`;

export default function DecisionDetailPage({ decisionId, snapshot }) {
  const walletAccounts = useStrategyLabStore((state) => state.walletAccounts);
  const runtimeDecisionEvents = useStrategyLabStore((state) => state.eventLog);
  const txEvents = useExecutionFeedStore((state) => state.txEvents);
  const decisions = useMemo(() => {
    return buildDecisionRows({
      snapshotDecisions: snapshot?.decisions || [],
      runtimeEvents: runtimeDecisionEvents || []
    });
  }, [runtimeDecisionEvents, snapshot?.decisions]);

  const walletLinkByDecisionId = useMemo(() => {
    return buildDecisionWalletLinkIndex({
      decisions,
      walletAccounts,
      txEvents,
      timeWindowMs: 210000
    });
  }, [decisions, txEvents, walletAccounts]);

  const targetId = String(decisionId || '');
  const decision = decisions.find((item) => String(item.id) === targetId) || null;
  const walletLink = decision ? walletLinkByDecisionId.get(String(decision.id || '')) || null : null;

  if (!decision) {
    return (
      <section className="page-grid">
        <GlowCard className="detail-card">
          <h1>Decision not found</h1>
          <p>No decision entry found for `{decisionId}`.</p>
          <Link to="/decisions" className="inline-link">
            Back to decisions
          </Link>
        </GlowCard>
      </section>
    );
  }

  const marketKeyByIdentity = new Map();
  for (const market of snapshot?.markets || []) {
    const key = market?.key ? String(market.key) : '';
    if (!key) continue;
    marketKeyByIdentity.set(toIdentity(market?.symbol, market?.assetClass), key);
  }

  const identity = toIdentity(decision.symbol, decision.assetClass);
  const marketKey = marketKeyByIdentity.get(identity) || '';
  const strategyDecisions = decisions.filter((item) => item.strategyName === decision.strategyName).slice(0, 48);
  const marketDecisions = decisions.filter((item) => toIdentity(item.symbol, item.assetClass) === identity).slice(0, 48);

  const relatedSignals = getDisplaySignals(snapshot, 320)
    .filter((signal) => toIdentity(signal?.symbol, signal?.assetClass) === identity)
    .sort((a, b) => toNum(b.timestamp, 0) - toNum(a.timestamp, 0))
    .slice(0, 24);

  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>decision:{decision.id}</h1>
          <div className="section-actions">
            <Link to="/decisions" className="inline-link">
              Back to decisions
            </Link>
            <Link to={`/strategy/${encodeURIComponent(decision.strategyName)}`} className="inline-link">
              strategy
            </Link>
            {marketKey ? (
              <Link to={`/market/${encodeURIComponent(marketKey)}`} className="inline-link">
                market
              </Link>
            ) : null}
            {walletLink ? (
              <Link to={`/wallet/${encodeURIComponent(walletLink.accountId)}`} className="inline-link">
                wallet:{walletLink.accountName}
              </Link>
            ) : null}
          </div>
        </div>
        <p>
          {decision.symbol} ({decision.assetClass}) | trigger {decision.trigger}
        </p>
      </GlowCard>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Action</span>
          <strong>{decision.action}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Score</span>
          <strong>{fmtNum(decision.score, 2)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Strategy Decisions</span>
          <strong>{fmtInt(strategyDecisions.length)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Timestamp</span>
          <strong>{fmtTime(decision.timestamp)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Source</span>
          <strong>{decision.source || '-'}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Wallet</span>
          <strong>
            {walletLink ? (
              <Link to={`/wallet/${encodeURIComponent(walletLink.accountId)}`} className="inline-link">
                {walletLink.accountName}
              </Link>
            ) : (
              '-'
            )}
          </strong>
        </GlowCard>
      </div>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Decision Reason</h2>
        </div>
        <p>{decision.reason}</p>
      </GlowCard>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Strategy Context</h2>
            <span>{fmtInt(strategyDecisions.length)} recent</span>
          </div>
          <div className="list-stack">
            {strategyDecisions.map((item) => {
              const isCurrent = String(item.id) === String(decision.id);
              const itemWalletLink = walletLinkByDecisionId.get(String(item.id || '')) || null;
              return (
                <article key={`strategy-context:${item.id}:${item.timestamp}`} className="list-item">
                  <strong>
                    {isCurrent ? (
                      <span>
                        {item.action} | {item.symbol} ({item.assetClass}) | selected
                      </span>
                    ) : (
                      <Link to={`/decision/${encodeURIComponent(item.id)}`} className="inline-link">
                        {item.action} | {item.symbol} ({item.assetClass})
                      </Link>
                    )}
                  </strong>
                  <p>{item.reason}</p>
                  <div className="item-meta">
                    <small>trigger {item.trigger}</small>
                    <small>score {fmtNum(item.score, 2)}</small>
                    <small>{fmtTime(item.timestamp)}</small>
                    {itemWalletLink ? (
                      <small>
                        <Link to={`/wallet/${encodeURIComponent(itemWalletLink.accountId)}`} className="inline-link">
                          wallet:{itemWalletLink.accountName}
                        </Link>
                      </small>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Market Context</h2>
            <span>{fmtInt(marketDecisions.length)} recent</span>
          </div>
          <div className="list-stack">
            {marketDecisions.map((item) => {
              const isCurrent = String(item.id) === String(decision.id);
              const itemWalletLink = walletLinkByDecisionId.get(String(item.id || '')) || null;
              return (
                <article key={`market-context:${item.id}:${item.timestamp}`} className="list-item">
                  <strong>
                    {isCurrent ? (
                      <span>
                        {item.action} | {item.strategyName} | selected
                      </span>
                    ) : (
                      <Link to={`/decision/${encodeURIComponent(item.id)}`} className="inline-link">
                        {item.action} | {item.strategyName}
                      </Link>
                    )}
                  </strong>
                  <p>{item.reason}</p>
                  <div className="item-meta">
                    <small>trigger {item.trigger}</small>
                    <small>score {fmtNum(item.score, 2)}</small>
                    <small>{fmtTime(item.timestamp)}</small>
                    {itemWalletLink ? (
                      <small>
                        <Link to={`/wallet/${encodeURIComponent(itemWalletLink.accountId)}`} className="inline-link">
                          wallet:{itemWalletLink.accountName}
                        </Link>
                      </small>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </GlowCard>
      </div>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Linked Signals</h2>
          <span>{fmtInt(relatedSignals.length)} recent</span>
        </div>
        <div className="list-stack">
          {relatedSignals.map((signal) => (
            <article key={`signal-context:${signal.id}`} className="list-item">
              <strong>
                <Link to={`/signal/${encodeURIComponent(signal.id)}`} className="inline-link">
                  {signal.type}
                </Link>{' '}
                | {signal.direction} | {signal.symbol}
              </strong>
              <p>{signal.message || 'No message provided.'}</p>
              <div className="item-meta">
                <small>severity {signal.severity || 'low'}</small>
                <small>score {fmtInt(signal.score)}</small>
                <small>{fmtTime(signal.timestamp)}</small>
              </div>
            </article>
          ))}
          {relatedSignals.length === 0 ? <p className="action-message">No linked signals for this market yet.</p> : null}
        </div>
      </GlowCard>
    </section>
  );
}
