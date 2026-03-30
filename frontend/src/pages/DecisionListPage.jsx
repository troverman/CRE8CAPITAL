import { useMemo, useState } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import { fmtInt, fmtNum, fmtTime } from '../lib/format';
import { Link } from '../lib/router';

const toText = (value, fallback = '-') => {
  const text = String(value || '').trim();
  return text || fallback;
};

const toAction = (value) => String(value || 'hold').toLowerCase();

export default function DecisionListPage({ snapshot }) {
  const [search, setSearch] = useState('');

  const marketKeyByIdentity = useMemo(() => {
    const map = new Map();
    for (const market of snapshot?.markets || []) {
      const symbol = String(market?.symbol || '').toUpperCase();
      const assetClass = String(market?.assetClass || '').toLowerCase();
      if (!symbol || !assetClass || !market?.key) continue;
      map.set(`${symbol}|${assetClass}`, market.key);
    }
    return map;
  }, [snapshot?.markets]);

  const decisions = useMemo(() => {
    return [...(snapshot?.decisions || [])]
      .map((decision, index) => ({
        id: toText(decision?.id, `decision:${index}`),
        strategyName: toText(decision?.strategyName || decision?.strategy, 'unknown'),
        action: toAction(decision?.action),
        reason: toText(decision?.reason, 'No reason provided'),
        trigger: toText(decision?.trigger),
        score: Number(decision?.score) || 0,
        symbol: toText(decision?.symbol),
        assetClass: toText(decision?.assetClass, 'unknown'),
        timestamp: Number(decision?.timestamp) || 0
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [snapshot?.decisions]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return decisions;
    return decisions.filter((decision) => {
      return (
        String(decision.id).toLowerCase().includes(term) ||
        String(decision.strategyName).toLowerCase().includes(term) ||
        String(decision.action).toLowerCase().includes(term) ||
        String(decision.reason).toLowerCase().includes(term) ||
        String(decision.trigger).toLowerCase().includes(term) ||
        String(decision.symbol).toLowerCase().includes(term) ||
        String(decision.assetClass).toLowerCase().includes(term)
      );
    });
  }, [decisions, search]);

  return (
    <section className="page-grid">
      <GlowCard className="list-header-card">
        <div className="section-head">
          <h1>Decisions</h1>
          <span>
            {filtered.length} shown / {decisions.length} total
          </span>
        </div>
        <input
          className="filter-input"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search strategy, symbol, action, trigger, reason, or id"
          aria-label="Search decisions"
        />
      </GlowCard>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Decision Feed</h2>
          <span>newest first</span>
        </div>
        <FlashList
          items={filtered}
          height={620}
          itemHeight={106}
          className="tick-flash-list decision-feed-list"
          emptyCopy="No decisions matched your search."
          keyExtractor={(decision, index) => `${decision.id}:${index}`}
          renderItem={(decision, index) => {
            const marketKey = marketKeyByIdentity.get(`${String(decision.symbol || '').toUpperCase()}|${String(decision.assetClass || '').toLowerCase()}`);
            return (
              <article className="decision-feed-row">
                <div className="decision-feed-head">
                  <strong>
                    {index + 1}. {decision.symbol} ({decision.assetClass})
                  </strong>
                  <span className={`tensor-chip ${decision.action}`}>{decision.action}</span>
                </div>
                <p>{decision.reason}</p>
                <div className="decision-feed-links">
                  <Link to={`/strategy/${encodeURIComponent(decision.strategyName)}`} className="inline-link">
                    strategy:{decision.strategyName}
                  </Link>
                  {marketKey ? (
                    <Link to={`/market/${encodeURIComponent(marketKey)}`} className="inline-link">
                      market
                    </Link>
                  ) : null}
                </div>
                <div className="item-meta">
                  <small>trigger {decision.trigger}</small>
                  <small>score {fmtNum(decision.score, 2)}</small>
                  <small>{fmtTime(decision.timestamp)}</small>
                  <small>id {decision.id}</small>
                </div>
              </article>
            );
          }}
        />
      </GlowCard>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Decisions</span>
          <strong>{fmtInt(decisions.length)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Distinct Strategies</span>
          <strong>{fmtInt(new Set(decisions.map((decision) => decision.strategyName)).size)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Distinct Markets</span>
          <strong>{fmtInt(new Set(decisions.map((decision) => `${decision.symbol}|${decision.assetClass}`)).size)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Last Decision</span>
          <strong>{fmtTime(decisions[0]?.timestamp)}</strong>
        </GlowCard>
      </div>
    </section>
  );
}
