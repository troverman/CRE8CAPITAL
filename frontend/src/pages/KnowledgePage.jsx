import { useMemo, useState } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import { fmtInt, fmtNum, fmtTime, severityClass } from '../lib/format';
import { buildProviderInfluenceFeed, buildProviderRows, summarizeProviderScopes } from '../lib/providerView';
import { Link } from '../lib/router';

const toText = (value) => String(value || '').trim().toLowerCase();

const scopeLabel = (value) => {
  const text = String(value || '').trim();
  return text ? text : 'cross-market';
};

const toneClass = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  if (num > 0) return 'up';
  if (num < 0) return 'down';
  return '';
};

export default function KnowledgePage({ snapshot }) {
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState('all');

  const providerRows = useMemo(() => buildProviderRows(snapshot), [snapshot]);
  const scopeRows = useMemo(() => summarizeProviderScopes(providerRows), [providerRows]);

  const influenceFeed = useMemo(() => {
    return buildProviderInfluenceFeed({
      snapshot,
      providerRows,
      limit: 320
    });
  }, [providerRows, snapshot]);

  const scopeOptions = useMemo(() => {
    const values = new Set(['all']);
    for (const row of scopeRows) values.add(String(row.scope || 'cross-market'));
    for (const row of providerRows) values.add(String(row.scope || 'cross-market'));
    return [...values];
  }, [providerRows, scopeRows]);

  const filteredProviders = useMemo(() => {
    const term = toText(search);
    return providerRows.filter((provider) => {
      const scope = String(provider.scope || 'cross-market');
      if (scopeFilter !== 'all' && scope !== scopeFilter) return false;
      if (!term) return true;
      return (
        toText(provider.name).includes(term) ||
        toText(provider.id).includes(term) ||
        toText(provider.scope).includes(term) ||
        toText(provider.source).includes(term) ||
        toText(provider.channel).includes(term)
      );
    });
  }, [providerRows, scopeFilter, search]);

  const filteredFeed = useMemo(() => {
    const term = toText(search);
    return influenceFeed.filter((row) => {
      const scope = String(row.scope || 'cross-market');
      if (scopeFilter !== 'all' && scope !== scopeFilter) return false;
      if (!term) return true;
      return (
        toText(row.providerName).includes(term) ||
        toText(row.providerId).includes(term) ||
        toText(row.scope).includes(term) ||
        toText(row.kind).includes(term) ||
        toText(row.source).includes(term) ||
        toText(row.message).includes(term) ||
        toText(row.symbol).includes(term) ||
        toText(row.strategyId).includes(term)
      );
    });
  }, [influenceFeed, scopeFilter, search]);

  const connectedProviderCount = useMemo(() => providerRows.filter((provider) => provider.connected).length, [providerRows]);
  const highImpactCount = useMemo(() => filteredFeed.filter((row) => Number(row.score) >= 72 || Number(row.score) <= 28).length, [filteredFeed]);

  return (
    <section className="page-grid">
      <GlowCard className="list-header-card">
        <div className="section-head">
          <h1>Knowledge</h1>
          <div className="section-actions">
            <Link to="/providers" className="inline-link">
              Provider list
            </Link>
            <Link to="/strategy" className="inline-link">
              Open strategy lab
            </Link>
          </div>
        </div>
        <p className="socket-status-copy">External context stream for strategy influence: provider health, regime drift, macro/sentiment watch, and signal-decision relays.</p>
        <div className="knowledge-controls-grid">
          <label className="control-field">
            <span>Search</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search provider, scope, channel, message, symbol, or strategy"
              aria-label="Search knowledge"
            />
          </label>
          <label className="control-field">
            <span>Scope</span>
            <select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value)}>
              {scopeOptions.map((option) => (
                <option key={`scope:${option}`} value={option}>
                  {scopeLabel(option)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </GlowCard>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Providers</span>
          <strong>{fmtInt(providerRows.length)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Live Providers</span>
          <strong>{fmtInt(connectedProviderCount)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Knowledge Rows</span>
          <strong>{fmtInt(filteredFeed.length)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>High Impact</span>
          <strong>{fmtInt(highImpactCount)}</strong>
        </GlowCard>
      </div>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Provider Scope Matrix</h2>
            <span>{scopeRows.length} scopes</span>
          </div>
          <div className="list-stack">
            {scopeRows.map((scope) => (
              <article key={`scope-row:${scope.scope}`} className="list-item">
                <strong>{scope.scope}</strong>
                <p>
                  providers {fmtInt(scope.count)} | live {fmtInt(scope.connected)} | market touches {fmtInt(scope.marketTouches)}
                </p>
                <div className="item-meta">
                  <small>live ratio {fmtNum(scope.connectedPct, 1)}%</small>
                  <small>avg coverage {fmtNum(scope.avgCoveragePct, 1)}%</small>
                </div>
              </article>
            ))}
            {scopeRows.length === 0 ? <p className="action-message">No scopes available yet.</p> : null}
          </div>
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Provider Registry</h2>
            <span>{filteredProviders.length} shown</span>
          </div>
          <FlashList
            items={filteredProviders}
            height={360}
            itemHeight={84}
            className="tick-flash-list"
            emptyCopy="No providers matched your filters."
            keyExtractor={(provider) => provider.key}
            renderItem={(provider, index) => (
              <Link to={`/provider/${encodeURIComponent(provider.id)}`} className="knowledge-provider-link">
                <article className="knowledge-provider-row">
                  <div className="section-head">
                    <strong>
                      {index + 1}. {provider.name}
                    </strong>
                    <span className={provider.connected ? 'status-pill online' : 'status-pill'}>{provider.connected ? 'live' : 'watch'}</span>
                  </div>
                  <p>
                    {provider.scope} | {provider.source} | coverage {fmtNum(provider.coveragePct, 1)}%
                  </p>
                  <div className="item-meta">
                    <small>{provider.id}</small>
                    <small>{provider.channel || 'provider stream'}</small>
                    <small>quotes {fmtInt(provider.quoteCount)}</small>
                    <small>{fmtTime(provider.lastSeenAt)}</small>
                  </div>
                </article>
              </Link>
            )}
          />
        </GlowCard>
      </div>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Knowledge Feed</h2>
          <span>{filteredFeed.length} rows</span>
        </div>
        <FlashList
          items={filteredFeed}
          height={620}
          itemHeight={102}
          className="tick-flash-list"
          emptyCopy="No knowledge rows matched your filters."
          keyExtractor={(row) => row.id}
          renderItem={(row, index) => (
            <article className="knowledge-feed-row">
              <div className="section-head">
                <strong>
                  {index + 1}. {row.providerName}
                </strong>
                <span className={`severity ${severityClass(row.severity)}`}>{row.severity}</span>
              </div>
              <p>{row.message}</p>
              <div className="item-meta">
                <small>{row.kind}</small>
                <small>{row.scope}</small>
                <small>score {fmtNum(row.score, 1)}</small>
                <small className={toneClass(row.influence)}>{fmtNum((row.influence || 0) * 100, 1)}%</small>
                <small>{row.stance}</small>
                <small>{fmtTime(row.timestamp)}</small>
                {row.kind === 'provider' && row.providerId ? (
                  <Link to={`/provider/${encodeURIComponent(row.providerId)}`} className="inline-link">
                    provider
                  </Link>
                ) : null}
                {row.marketKey ? (
                  <Link to={`/market/${encodeURIComponent(row.marketKey)}`} className="inline-link">
                    market
                  </Link>
                ) : null}
                {row.signalId ? (
                  <Link to={`/signal/${encodeURIComponent(row.signalId)}`} className="inline-link">
                    signal
                  </Link>
                ) : null}
                {row.decisionId ? (
                  <Link to={`/decision/${encodeURIComponent(row.decisionId)}`} className="inline-link">
                    decision
                  </Link>
                ) : null}
                {row.strategyId ? (
                  <Link to={`/strategy/${encodeURIComponent(row.strategyId)}`} className="inline-link">
                    strategy
                  </Link>
                ) : null}
              </div>
            </article>
          )}
        />
      </GlowCard>
    </section>
  );
}
