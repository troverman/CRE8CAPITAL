import { useMemo, useState } from 'react';
import GlowCard from '../components/GlowCard';
import { fmtInt, fmtNum, fmtTime } from '../lib/format';
import { buildStrategyRows } from '../lib/strategyView';
import { Link } from '../lib/router';

export default function StrategyListPage({ snapshot }) {
  const [search, setSearch] = useState('');

  const strategies = useMemo(() => {
    return buildStrategyRows(snapshot);
  }, [snapshot]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return strategies;
    return strategies.filter((strategy) => {
      return (
        String(strategy.name || '').toLowerCase().includes(term) ||
        String(strategy.id || '').toLowerCase().includes(term) ||
        String(strategy.key || '').toLowerCase().includes(term)
      );
    });
  }, [search, strategies]);

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
          <Link key={strategy.key} to={`/strategy/${encodeURIComponent(strategy.id || strategy.name || strategy.key)}`} className="strategy-card-link">
            <GlowCard className="strategy-card">
              <div className="strategy-head">
                <strong>{strategy.name}</strong>
                <span>{strategy.enabled === null ? 'runtime' : strategy.enabled ? 'enabled' : 'disabled'}</span>
              </div>
              <p>
                decisions {fmtInt(strategy.decisionCount)} | markets {fmtInt(strategy.marketCount)}
              </p>
              <div className="strategy-metrics">
                <small>avg score {fmtNum(strategy.avgScore, 2)}</small>
                <small>last action {strategy.lastAction}</small>
                <small>last {fmtTime(strategy.lastDecisionAt)}</small>
              </div>
            </GlowCard>
          </Link>
        ))}
      </div>
    </section>
  );
}
