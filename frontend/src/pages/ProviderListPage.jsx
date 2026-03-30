import { useMemo, useState } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import { fmtInt, fmtNum, fmtTime } from '../lib/format';
import { buildProviderRows } from '../lib/providerView';
import { Link } from '../lib/router';

const toText = (value) => String(value || '').trim().toLowerCase();

export default function ProviderListPage({ snapshot }) {
  const [search, setSearch] = useState('');
  const providers = useMemo(() => buildProviderRows(snapshot), [snapshot]);

  const filtered = useMemo(() => {
    const term = toText(search);
    if (!term) return providers;
    return providers.filter((provider) => {
      return (
        toText(provider.name).includes(term) ||
        toText(provider.id).includes(term) ||
        toText(provider.scope).includes(term) ||
        toText(provider.source).includes(term) ||
        toText(provider.channel).includes(term)
      );
    });
  }, [providers, search]);

  const connectedCount = useMemo(() => providers.filter((provider) => provider.connected).length, [providers]);

  return (
    <section className="page-grid">
      <GlowCard className="list-header-card">
        <div className="section-head">
          <h1>Providers</h1>
          <div className="section-actions">
            <Link to="/knowledge" className="inline-link">
              Knowledge
            </Link>
          </div>
        </div>
        <input
          className="filter-input"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search provider, scope, source, or channel"
          aria-label="Search providers"
        />
      </GlowCard>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Total Providers</span>
          <strong>{fmtInt(providers.length)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Live Providers</span>
          <strong>{fmtInt(connectedCount)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Watchlisted</span>
          <strong>{fmtInt(providers.length - connectedCount)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Shown</span>
          <strong>{fmtInt(filtered.length)}</strong>
        </GlowCard>
      </div>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Provider Registry</h2>
          <span>click provider for id page</span>
        </div>
        <FlashList
          items={filtered}
          height={660}
          itemHeight={90}
          className="tick-flash-list"
          emptyCopy="No providers matched your search."
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
                  {provider.scope} | {provider.source} | coverage {fmtNum(provider.coveragePct, 1)}% | markets {fmtInt(provider.marketCount)}
                </p>
                <div className="item-meta">
                  <small>{provider.id}</small>
                  <small>{provider.channel || 'provider stream'}</small>
                  <small>quotes {fmtInt(provider.quoteCount)}</small>
                  <small>spread {provider.avgSpreadBps === null ? '-' : `${fmtNum(provider.avgSpreadBps, 2)} bps`}</small>
                  <small>{fmtTime(provider.lastSeenAt)}</small>
                </div>
              </article>
            </Link>
          )}
        />
      </GlowCard>
    </section>
  );
}
