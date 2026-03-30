import { useMemo, useState } from 'react';
import GlowCard from '../components/GlowCard';
import { fmtInt, fmtTime, severityClass } from '../lib/format';
import { getDisplaySignals } from '../lib/signalView';
import { Link } from '../lib/router';

export default function SignalListPage({ snapshot }) {
  const [search, setSearch] = useState('');

  const signals = useMemo(() => {
    return getDisplaySignals(snapshot, 220);
  }, [snapshot]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return signals;
    return signals.filter((signal) => {
      return (
        String(signal.symbol || '').toLowerCase().includes(term) ||
        String(signal.assetClass || '').toLowerCase().includes(term) ||
        String(signal.type || '').toLowerCase().includes(term) ||
        String(signal.direction || '').toLowerCase().includes(term) ||
        String(signal.severity || '').toLowerCase().includes(term) ||
        String(signal.message || '').toLowerCase().includes(term) ||
        String(signal.id || '').toLowerCase().includes(term)
      );
    });
  }, [search, signals]);

  return (
    <section className="page-grid">
      <GlowCard className="list-header-card">
        <div className="section-head">
          <h1>Signals</h1>
          <span>{filtered.length} shown</span>
        </div>
        <input
          className="filter-input"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search symbol, severity, type, direction, or id"
          aria-label="Search signals"
        />
      </GlowCard>

      <div className="signal-grid">
        {filtered.map((signal) => (
          <Link key={signal.id} to={`/signal/${encodeURIComponent(signal.id)}`} className="signal-card-link">
            <GlowCard className="signal-card">
              <div className="signal-head">
                <strong>{signal.symbol || '-'}</strong>
                <span>{signal.assetClass || 'unknown'}</span>
              </div>
              <p>
                {signal.type} | {signal.direction || 'neutral'}
              </p>
              <p>{signal.message || 'No signal message'}</p>
              <div className="item-meta">
                <span className={`severity ${severityClass(signal.severity)}`}>{signal.severity}</span>
                <small>score {fmtInt(signal.score)}</small>
                <small>{fmtTime(signal.timestamp)}</small>
              </div>
            </GlowCard>
          </Link>
        ))}
      </div>
    </section>
  );
}
