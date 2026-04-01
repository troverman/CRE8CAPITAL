import { useEffect, useMemo, useRef, useState } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import { fmtInt, fmtTime, severityClass } from '../lib/format';
import { buildSignalStrategyIndex, getDisplaySignals } from '../lib/signalView';
import { Link } from '../lib/router';

const SIGNAL_TYPE_FILTERS = ['momentum', 'volatility', 'spread', 'cross-venue'];

export default function SignalListPage({ snapshot }) {
  const [search, setSearch] = useState('');
  const [activeTypeFilter, setActiveTypeFilter] = useState(null);
  const listRef = useRef(null);

  const signals = useMemo(() => {
    const liveCount = Array.isArray(snapshot?.signals) ? snapshot.signals.length : 0;
    const fallbackCount = Array.isArray(snapshot?.markets) ? snapshot.markets.length : 0;
    const limit = Math.max(1, liveCount, fallbackCount);
    return getDisplaySignals(snapshot, limit).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  }, [snapshot]);

  const filtered = useMemo(() => {
    let result = signals;

    if (activeTypeFilter) {
      result = result.filter((signal) =>
        String(signal.type || '').toLowerCase().includes(activeTypeFilter)
      );
    }

    const term = search.trim().toLowerCase();
    if (term) {
      result = result.filter((signal) => {
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
    }

    return result;
  }, [search, signals, activeTypeFilter]);

  const strategyIndexBySignal = useMemo(() => {
    return buildSignalStrategyIndex(snapshot, signals, 4);
  }, [signals, snapshot]);

  const emittedTotal = useMemo(() => {
    const summaryTotal = Number(snapshot?.signalSummary?.total);
    const telemetryGenerated = Number(snapshot?.telemetry?.signalsGenerated);
    const candidates = [summaryTotal, telemetryGenerated, signals.length].filter((value) => Number.isFinite(value));
    if (candidates.length === 0) return signals.length;
    return Math.max(...candidates);
  }, [signals.length, snapshot?.signalSummary?.total, snapshot?.telemetry?.signalsGenerated]);

  // Auto-scroll to top when new signals arrive
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [signals.length]);

  const toggleTypeFilter = (type) => {
    setActiveTypeFilter((prev) => (prev === type ? null : type));
  };

  return (
    <section className="page-grid">
      <GlowCard className="list-header-card">
        <div className="section-head">
          <h1>Live Signals</h1>
          <span>
            {filtered.length} shown / {fmtInt(emittedTotal)} emitted
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
        <div className="filter-chips">
          {SIGNAL_TYPE_FILTERS.map((type) => (
            <button
              key={type}
              type="button"
              className={`filter-chip ${activeTypeFilter === type ? 'active' : ''}`}
              onClick={() => toggleTypeFilter(type)}
            >
              {type}
            </button>
          ))}
        </div>
      </GlowCard>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Signal Feed</h2>
          <span>newest first</span>
        </div>
        <FlashList
          items={filtered}
          height={560}
          itemHeight={116}
          className="tick-flash-list signal-feed-list"
          emptyCopy="No signals matched your search."
          keyExtractor={(signal, index) => `${signal.id}:${index}`}
          renderItem={(signal, index) => {
            const linkedStrategies = strategyIndexBySignal.get(String(signal.id || '')) || [];
            return (
              <article className="signal-feed-row">
                <div className="signal-feed-head">
                  <strong>
                    <Link to={`/signal/${encodeURIComponent(signal.id)}`} className="inline-link">
                      {index + 1}. {signal.symbol || '-'} ({signal.assetClass || 'unknown'})
                    </Link>
                  </strong>
                  <span className={`severity ${severityClass(signal.severity)}`}>{signal.severity}</span>
                </div>
                <p>
                  {signal.type} | {signal.direction || 'neutral'} | score {fmtInt(signal.score)}
                </p>
                <div className="signal-feed-links">
                  <Link to={`/signal/${encodeURIComponent(signal.id)}`} className="inline-link">
                    open signal
                  </Link>
                  {linkedStrategies.map((strategy) => (
                    <Link key={`signal-strategy:${signal.id}:${strategy.strategyKey}`} to={`/strategy/${encodeURIComponent(strategy.strategyId)}`} className="inline-link">
                      strat:{strategy.strategyName}
                    </Link>
                  ))}
                  {linkedStrategies.length === 0 ? <small>no linked strategy yet</small> : null}
                </div>
                <div className="item-meta">
                  <small>{signal.message || 'No signal message'}</small>
                  <small>{fmtTime(signal.timestamp)}</small>
                </div>
              </article>
            );
          }}
        />
      </GlowCard>
    </section>
  );
}
