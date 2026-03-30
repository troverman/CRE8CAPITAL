import { useMemo, useState } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import { fmtInt, fmtTime, severityClass } from '../lib/format';
import { getDisplaySignals } from '../lib/signalView';
import { Link } from '../lib/router';

export default function SignalListPage({ snapshot }) {
  const [search, setSearch] = useState('');

  const signals = useMemo(() => {
    const liveCount = Array.isArray(snapshot?.signals) ? snapshot.signals.length : 0;
    const fallbackCount = Array.isArray(snapshot?.markets) ? snapshot.markets.length : 0;
    const limit = Math.max(1, liveCount, fallbackCount);
    return getDisplaySignals(snapshot, limit).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
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
          <h1>Live Signals</h1>
          <span>
            {filtered.length} shown / {signals.length} total
          </span>
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

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Signal Feed</h2>
          <span>newest first</span>
        </div>
        <FlashList
          items={filtered}
          height={560}
          itemHeight={94}
          className="tick-flash-list signal-feed-list"
          emptyCopy="No signals matched your search."
          keyExtractor={(signal, index) => `${signal.id}:${index}`}
          renderItem={(signal, index) => (
            <Link to={`/signal/${encodeURIComponent(signal.id)}`} className="signal-feed-link">
              <article className="signal-feed-row">
                <div className="signal-feed-head">
                  <strong>
                    {index + 1}. {signal.symbol || '-'} ({signal.assetClass || 'unknown'})
                  </strong>
                  <span className={`severity ${severityClass(signal.severity)}`}>{signal.severity}</span>
                </div>
                <p>
                  {signal.type} | {signal.direction || 'neutral'} | score {fmtInt(signal.score)}
                </p>
                <div className="item-meta">
                  <small>{signal.message || 'No signal message'}</small>
                  <small>{fmtTime(signal.timestamp)}</small>
                </div>
              </article>
            </Link>
          )}
        />
      </GlowCard>
    </section>
  );
}
