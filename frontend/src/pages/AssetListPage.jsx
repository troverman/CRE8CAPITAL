import { useMemo } from 'react';
import GlowCard from '../components/GlowCard';
import { fmtCompact, fmtInt } from '../lib/format';
import { Link } from '../lib/router';

export default function AssetListPage({ markets }) {
  const assets = useMemo(() => {
    const bucket = new Map();
    for (const market of markets) {
      const key = String(market.assetClass || 'unknown').toLowerCase();
      const existing = bucket.get(key) || {
        id: key,
        marketCount: 0,
        providerCount: 0,
        totalVolume: 0,
        symbols: new Set()
      };
      existing.marketCount += 1;
      existing.providerCount += Number(market.providerCount) || 0;
      existing.totalVolume += Number(market.totalVolume) || 0;
      existing.symbols.add(market.symbol);
      bucket.set(key, existing);
    }
    return [...bucket.values()].sort((a, b) => b.marketCount - a.marketCount);
  }, [markets]);

  return (
    <section className="page-grid">
      <GlowCard className="list-header-card">
        <div className="section-head">
          <h1>Assets</h1>
          <span>{assets.length} classes</span>
        </div>
      </GlowCard>

      <div className="asset-grid">
        {assets.map((asset) => (
          <Link key={asset.id} to={`/asset/${encodeURIComponent(asset.id)}`} className="asset-card-link">
            <GlowCard className="asset-card">
              <div className="asset-head">
                <strong>{asset.id}</strong>
              </div>
              <div className="asset-stats">
                <span>{fmtInt(asset.marketCount)} markets</span>
                <span>{fmtInt(asset.providerCount)} provider touches</span>
                <span>{fmtCompact(asset.totalVolume)} total vol</span>
              </div>
              <p>{[...asset.symbols].slice(0, 6).join(', ')}</p>
            </GlowCard>
          </Link>
        ))}
      </div>
    </section>
  );
}

