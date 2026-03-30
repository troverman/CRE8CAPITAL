import { useMemo } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import { fmtInt, fmtNum, fmtTime } from '../lib/format';
import { buildProviderInfluenceFeed, buildProviderRows, findProviderRow, getProviderMarketRows } from '../lib/providerView';
import { Link } from '../lib/router';

const toneClass = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  if (num > 0) return 'up';
  if (num < 0) return 'down';
  return '';
};

export default function ProviderDetailPage({ providerId, snapshot }) {
  const provider = useMemo(() => findProviderRow(snapshot, providerId), [providerId, snapshot]);
  const providerRows = useMemo(() => buildProviderRows(snapshot), [snapshot]);
  const feed = useMemo(() => buildProviderInfluenceFeed({ snapshot, providerRows, limit: 320 }), [providerRows, snapshot]);
  const marketRows = useMemo(() => (provider ? getProviderMarketRows(snapshot, provider.id) : []), [provider, snapshot]);
  const providerFeed = useMemo(
    () => (provider ? feed.filter((row) => String(row.providerKey || '') === String(provider.key || '')).slice(0, 120) : []),
    [feed, provider]
  );

  if (!provider) {
    return (
      <section className="page-grid">
        <GlowCard className="detail-card">
          <h1>Provider not found</h1>
          <p>No provider entry found for `{providerId}`.</p>
          <Link to="/providers" className="inline-link">
            Back to providers
          </Link>
        </GlowCard>
      </section>
    );
  }

  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>provider:{provider.name}</h1>
          <div className="section-actions">
            <Link to="/knowledge" className="inline-link">
              Knowledge
            </Link>
            <Link to="/providers" className="inline-link">
              Back to providers
            </Link>
          </div>
        </div>
        <p>
          id {provider.id} | scope {provider.scope} | {provider.connected ? 'live' : 'watch'}
        </p>
      </GlowCard>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Status</span>
          <strong>{provider.connected ? 'live' : 'watch'}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Coverage</span>
          <strong>{fmtNum(provider.coveragePct, 1)}%</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Markets</span>
          <strong>{fmtInt(provider.marketCount)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Asset Classes</span>
          <strong>{fmtInt(provider.assetCount)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Quotes</span>
          <strong>{fmtInt(provider.quoteCount)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Avg Spread</span>
          <strong>{provider.avgSpreadBps === null ? '-' : `${fmtNum(provider.avgSpreadBps, 2)} bps`}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Quote Volume</span>
          <strong>{fmtNum(provider.totalQuoteVolume, 0)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Last Seen</span>
          <strong>{fmtTime(provider.lastSeenAt)}</strong>
        </GlowCard>
      </div>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Influence Feed</h2>
            <span>{providerFeed.length} rows</span>
          </div>
          <FlashList
            items={providerFeed}
            height={420}
            itemHeight={88}
            className="tick-flash-list"
            emptyCopy="No knowledge rows for this provider yet."
            keyExtractor={(row) => row.id}
            renderItem={(row, index) => (
              <article className="knowledge-feed-row">
                <div className="section-head">
                  <strong>
                    {index + 1}. {row.kind}
                  </strong>
                  <span className={toneClass(row.influence)}>{fmtNum((row.influence || 0) * 100, 1)}%</span>
                </div>
                <p>{row.message}</p>
                <div className="item-meta">
                  <small>{row.scope}</small>
                  <small>{row.channel}</small>
                  <small>score {fmtNum(row.score, 1)}</small>
                  <small>{row.stance}</small>
                  <small>{fmtTime(row.timestamp)}</small>
                </div>
              </article>
            )}
          />
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Markets Touched</h2>
            <span>{marketRows.length} rows</span>
          </div>
          <FlashList
            items={marketRows}
            height={420}
            itemHeight={86}
            className="tick-flash-list"
            emptyCopy="No market quotes found for this provider yet."
            keyExtractor={(row) => `provider-market:${provider.id}:${row.key}`}
            renderItem={(row, index) => (
              <article className="knowledge-feed-row">
                <div className="section-head">
                  <strong>
                    {index + 1}. {row.symbol} ({row.assetClass})
                  </strong>
                  <Link to={`/market/${encodeURIComponent(row.key)}`} className="inline-link">
                    market
                  </Link>
                </div>
                <p>
                  px {fmtNum(row.price, 4)} | bid {fmtNum(row.bid, 4)} | ask {fmtNum(row.ask, 4)}
                </p>
                <div className="item-meta">
                  <small>volume {fmtNum(row.volume, 0)}</small>
                  <small>{fmtTime(row.timestamp)}</small>
                </div>
              </article>
            )}
          />
        </GlowCard>
      </div>
    </section>
  );
}
