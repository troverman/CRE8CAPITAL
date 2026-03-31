import { useEffect, useMemo } from 'react';
import GlowCard from '../components/GlowCard';
import { fmtInt, fmtNum, fmtTime } from '../lib/format';
import { getStrategyImplementationDetail } from '../lib/strategyEngine';
import { getDisplaySignals } from '../lib/signalView';
import { findStrategyRow, getStrategyDecisions } from '../lib/strategyView';
import { Link } from '../lib/router';
import { useStrategyToggleStore } from '../store/strategyToggleStore';

const resolveEnabled = (strategy, enabledByKey) => {
  const key = String(strategy?.key || '');
  if (typeof enabledByKey?.[key] === 'boolean') return enabledByKey[key];
  if (strategy?.enabled === null || typeof strategy?.enabled === 'undefined') return true;
  return Boolean(strategy.enabled);
};

export default function StrategyDetailPage({ strategyId, snapshot }) {
  const row = useMemo(() => findStrategyRow(snapshot, strategyId), [snapshot, strategyId]);
  const implementation = useMemo(() => getStrategyImplementationDetail(row?.id || strategyId), [row?.id, strategyId]);
  const enabledByKey = useStrategyToggleStore((state) => state.enabledByKey);
  const ensureStrategies = useStrategyToggleStore((state) => state.ensureStrategies);
  const setStrategyEnabled = useStrategyToggleStore((state) => state.setStrategyEnabled);

  useEffect(() => {
    if (!row) return;
    ensureStrategies([row]);
  }, [ensureStrategies, row]);

  if (!row) {
    return (
      <section className="page-grid">
        <GlowCard className="detail-card">
          <h1>Strategy not found</h1>
          <p>No strategy entry found for `{strategyId}`.</p>
          <Link to="/strategies" className="inline-link">
            Back to strategies
          </Link>
        </GlowCard>
      </section>
    );
  }

  const decisions = getStrategyDecisions(snapshot, strategyId).slice(0, 36);
  const strategyEnabled = resolveEnabled(row, enabledByKey);
  const marketKeyByIdentity = new Map(
    (snapshot.markets || []).map((market) => [`${String(market.symbol || '').toUpperCase()}|${String(market.assetClass || '').toLowerCase()}`, market.key])
  );
  const signalByMarketKey = new Map(
    getDisplaySignals(snapshot, 240).map((signal) => [`${String(signal.symbol || '').toUpperCase()}|${String(signal.assetClass || '').toLowerCase()}`, signal])
  );

  const linkedSignals = [];
  const seenKeys = new Set();
  for (const decision of decisions) {
    const key = `${String(decision.symbol || '').toUpperCase()}|${String(decision.assetClass || '').toLowerCase()}`;
    if (seenKeys.has(key)) continue;
    const signal = signalByMarketKey.get(key);
    if (signal) {
      linkedSignals.push(signal);
      seenKeys.add(key);
    }
    if (linkedSignals.length >= 14) break;
  }

  const signalLinkRate = decisions.length > 0 ? (linkedSignals.length / decisions.length) * 100 : 0;
  const runtimeFacts = [
    {
      label: 'Trigger Kind',
      value: implementation.triggerKind
    },
    {
      label: 'Runtime Path',
      value: implementation.runtimePath,
      mono: true
    },
    {
      label: 'Source File',
      value: implementation.sourceFile,
      mono: true
    },
    {
      label: 'Signal Link Rate',
      value: `${fmtNum(signalLinkRate, 2)}%`
    }
  ];

  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>strategy:{row.name}</h1>
          <div className="section-actions">
            <label className="toggle-label strategy-toggle-switch">
              <input type="checkbox" checked={Boolean(strategyEnabled)} onChange={(event) => setStrategyEnabled(row.key, event.target.checked)} />
              <span>{strategyEnabled ? 'enabled' : 'disabled'}</span>
            </label>
            <Link to="/strategies" className="inline-link">
              Back to strategies
            </Link>
            <Link to="/strategy/create" className="inline-link">
              Create strategy
            </Link>
            <Link to="/strategy" className="inline-link">
              Open strategy lab
            </Link>
          </div>
        </div>
        <p>
          id {row.id} | {strategyEnabled ? 'enabled' : 'disabled'}
        </p>
        <p className="socket-status-copy">{row.description || 'No description available yet.'}</p>
      </GlowCard>

      <GlowCard className="panel-card strategy-function-card">
        <div className="strategy-runtime-head">
          <div>
            <div className="section-head">
              <h2>Function Runtime Detail</h2>
              <span>{implementation.name}</span>
            </div>
            <p className="socket-status-copy">
              {implementation.summary} | trigger {implementation.triggerKind} | source {implementation.sourceFile}
            </p>
          </div>
          <div className="strategy-runtime-badges">
            <span className="status-pill">{implementation.triggerKind}</span>
            <span className={strategyEnabled ? 'status-pill online' : 'status-pill'}>{strategyEnabled ? 'enabled' : 'disabled'}</span>
          </div>
        </div>

        <div className="strategy-runtime-facts">
          {runtimeFacts.map((fact) => (
            <article key={`runtime-fact:${fact.label}`} className="strategy-runtime-fact">
              <span className="strategy-runtime-fact-label">{fact.label}</span>
              <strong className={fact.mono ? 'strategy-runtime-fact-value mono' : 'strategy-runtime-fact-value'}>{fact.value}</strong>
            </article>
          ))}
        </div>

        <p className="socket-status-copy">
          Runtime snapshot shows how this strategy scores, what it depends on, and how it transitions from signals/price into actions.
        </p>
        <div className="strategy-function-grid strategy-runtime-metric-grid">
          <article>
            <span>Score Model</span>
            <strong>{implementation.scoreModel}</strong>
          </article>
          <article>
            <span>Rule Count</span>
            <strong>{fmtInt(implementation.actionRules.length)}</strong>
          </article>
          <article>
            <span>Input Count</span>
            <strong>{fmtInt(implementation.inputs.length)}</strong>
          </article>
          <article>
            <span>Prereq Count</span>
            <strong>{fmtInt(implementation.prerequisites.length)}</strong>
          </article>
        </div>
        <div className="two-col strategy-detail-two-col">
          <GlowCard className="panel-card">
            <div className="section-head">
              <h2>Inputs</h2>
              <span>{fmtInt(implementation.inputs.length)}</span>
            </div>
            <ul className="strategy-function-list">
              {implementation.inputs.map((item, index) => (
                <li key={`strategy-input:${implementation.id}:${index}`}>{item}</li>
              ))}
            </ul>
          </GlowCard>
          <GlowCard className="panel-card">
            <div className="section-head">
              <h2>Action Rules</h2>
              <span>{fmtInt(implementation.actionRules.length)}</span>
            </div>
            <ul className="strategy-function-list">
              {implementation.actionRules.map((item, index) => (
                <li key={`strategy-rule:${implementation.id}:${index}`}>{item}</li>
              ))}
            </ul>
          </GlowCard>
        </div>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Prerequisites</h2>
            <span>{fmtInt(implementation.prerequisites.length)}</span>
          </div>
          <div className="strategy-prereq-grid">
            {implementation.prerequisites.map((item, index) => (
              <article key={`strategy-prereq:${implementation.id}:${index}`} className="strategy-prereq-card">
                <strong>{fmtInt(index + 1)}</strong>
                <p>{item}</p>
              </article>
            ))}
          </div>
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Pseudocode</h2>
            <span>running branch</span>
          </div>
          <pre className="strategy-function-code">
            <code>{implementation.pseudoCode}</code>
          </pre>
        </GlowCard>
      </GlowCard>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Decisions</span>
          <strong>{fmtInt(row.decisionCount)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Avg Score</span>
          <strong>{fmtNum(row.avgScore, 2)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Markets Touched</span>
          <strong>{fmtInt(row.marketCount)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Last Decision</span>
          <strong>{fmtTime(row.lastDecisionAt)}</strong>
        </GlowCard>
      </div>

      <div className="two-col strategy-detail-two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Decisions</h2>
            <span>{decisions.length} recent</span>
          </div>
          <div className="list-stack">
            {decisions.map((decision) => {
              const decisionMarketKey = marketKeyByIdentity.get(
                `${String(decision.symbol || '').toUpperCase()}|${String(decision.assetClass || '').toLowerCase()}`
              );
              return (
                <article key={decision.id} className="list-item">
                  <strong>
                    {decision.action} | {decision.symbol} ({decision.assetClass})
                  </strong>
                  <p>{decision.reason}</p>
                  <div className="item-meta">
                    <small>{decision.trigger || '-'}</small>
                    <small>score {fmtNum(decision.score, 2)}</small>
                    <small>{fmtTime(decision.timestamp)}</small>
                    {decisionMarketKey ? (
                      <Link to={`/market/${encodeURIComponent(decisionMarketKey)}`} className="inline-link">
                        market
                      </Link>
                    ) : null}
                  </div>
                </article>
              );
            })}
            {decisions.length === 0 ? <p className="action-message">No decisions recorded yet.</p> : null}
          </div>
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Linked Signals</h2>
            <span>{linkedSignals.length} related</span>
          </div>
          <div className="list-stack">
            {linkedSignals.map((signal) => (
              <article key={signal.id} className="list-item">
                <strong>
                  <Link to={`/signal/${encodeURIComponent(signal.id)}`} className="inline-link">
                    {signal.type}
                  </Link>{' '}
                  | {signal.direction} | {signal.symbol}
                </strong>
                <p>{signal.message}</p>
                <div className="item-meta">
                  <small>score {fmtInt(signal.score)}</small>
                  <small>{signal.severity}</small>
                  <small>{fmtTime(signal.timestamp)}</small>
                </div>
              </article>
            ))}
            {linkedSignals.length === 0 ? <p className="action-message">No linked signals found.</p> : null}
          </div>
        </GlowCard>
      </div>
    </section>
  );
}
