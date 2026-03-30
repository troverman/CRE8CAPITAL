import { useEffect, useMemo, useState } from 'react';
import GlowCard from '../components/GlowCard';
import { fmtInt, fmtNum, fmtTime } from '../lib/format';
import { buildStrategyRows } from '../lib/strategyView';
import { Link } from '../lib/router';
import { useStrategyToggleStore } from '../store/strategyToggleStore';

const resolveEnabled = (strategy, enabledByKey) => {
  const key = String(strategy?.key || '');
  if (typeof enabledByKey?.[key] === 'boolean') return enabledByKey[key];
  if (strategy?.enabled === null || typeof strategy?.enabled === 'undefined') return true;
  return Boolean(strategy.enabled);
};

export default function StrategyListPage({ snapshot }) {
  const [search, setSearch] = useState('');
  const enabledByKey = useStrategyToggleStore((state) => state.enabledByKey);
  const ensureStrategies = useStrategyToggleStore((state) => state.ensureStrategies);
  const setStrategyEnabled = useStrategyToggleStore((state) => state.setStrategyEnabled);

  const strategies = useMemo(() => {
    return buildStrategyRows(snapshot);
  }, [snapshot]);

  useEffect(() => {
    ensureStrategies(strategies);
  }, [ensureStrategies, strategies]);

  const hydratedStrategies = useMemo(() => {
    return strategies.map((strategy) => ({
      ...strategy,
      enabled: resolveEnabled(strategy, enabledByKey)
    }));
  }, [enabledByKey, strategies]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return hydratedStrategies;
    return hydratedStrategies.filter((strategy) => {
      return (
        String(strategy.name || '').toLowerCase().includes(term) ||
        String(strategy.id || '').toLowerCase().includes(term) ||
        String(strategy.key || '').toLowerCase().includes(term) ||
        String(strategy.description || '').toLowerCase().includes(term)
      );
    });
  }, [hydratedStrategies, search]);

  return (
    <section className="page-grid">
      <GlowCard className="list-header-card">
        <div className="section-head">
          <h1>Strategies</h1>
          <span>{filtered.length} shown</span>
        </div>
        <input
          className="filter-input"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search strategy name or id"
          aria-label="Search strategies"
        />
      </GlowCard>

      <div className="strategy-grid">
        {filtered.map((strategy) => (
          <GlowCard key={strategy.key} className="strategy-card">
            <div className="strategy-head">
              <strong>
                <Link to={`/strategy/${encodeURIComponent(strategy.id || strategy.name || strategy.key)}`} className="inline-link strategy-title-link">
                  {strategy.name}
                </Link>
              </strong>
              <label className="toggle-label strategy-toggle-switch">
                <input
                  type="checkbox"
                  checked={Boolean(strategy.enabled)}
                  onChange={(event) => setStrategyEnabled(strategy.key, event.target.checked)}
                />
                <span>{strategy.enabled ? 'enabled' : 'disabled'}</span>
              </label>
            </div>
            <p>
              decisions {fmtInt(strategy.decisionCount)} | markets {fmtInt(strategy.marketCount)}
            </p>
            <p className="socket-status-copy">{strategy.description || 'No description available yet.'}</p>
            <div className="strategy-metrics">
              <small>avg score {fmtNum(strategy.avgScore, 2)}</small>
              <small>last action {strategy.lastAction}</small>
              <small>last {fmtTime(strategy.lastDecisionAt)}</small>
              <Link to={`/strategy/${encodeURIComponent(strategy.id || strategy.name || strategy.key)}`} className="inline-link">
                open strategy
              </Link>
            </div>
          </GlowCard>
        ))}
      </div>
    </section>
  );
}
