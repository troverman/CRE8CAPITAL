import { useMemo } from 'react';
import GlowCard from '../components/GlowCard';
import Sparkline from '../components/Sparkline';
import { fmtCompact, fmtNum, fmtPct } from '../lib/format';
import { Link } from '../lib/router';

export default function AssetDetailPage({ assetId, markets, historyByMarket }) {
  const normalizedAssetId = String(assetId || '').toLowerCase();
  const rows = useMemo(() => {
    return markets.filter((market) => String(market.assetClass).toLowerCase() === normalizedAssetId);
  }, [markets, normalizedAssetId]);

  if (!rows.length) {
    return (
      <section className="page-grid">
        <GlowCard className="detail-card">
          <h1>Asset not found</h1>
          <p>No markets found for `{assetId}`.</p>
          <Link to="/assets" className="inline-link">
            Back to assets
          </Link>
        </GlowCard>
      </section>
    );
  }

  const totalVolume = rows.reduce((sum, market) => sum + (Number(market.totalVolume) || 0), 0);

  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>asset:{normalizedAssetId}</h1>
          <Link to="/assets" className="inline-link">
            Back to assets
          </Link>
        </div>
        <p>
          {rows.length} markets | {fmtCompact(totalVolume)} total volume
        </p>
      </GlowCard>

      <div className="market-grid">
        {rows.map((market) => (
          <Link key={market.key} to={`/market/${encodeURIComponent(market.key)}`} className="market-card-link">
            <GlowCard className="market-card">
              <div className="market-head">
                <strong>{market.symbol}</strong>
                <span>{market.key}</span>
              </div>
              <div className="market-metrics">
                <span>{fmtNum(market.referencePrice, 4)}</span>
                <span className={Number(market.changePct) >= 0 ? 'up' : 'down'}>{fmtPct(market.changePct)}</span>
              </div>
              <Sparkline data={(historyByMarket[market.key] || []).map((point) => point.price)} />
              <div className="market-foot">
                <small>spread {fmtNum(market.spreadBps, 1)} bps</small>
                <small>vol {fmtCompact(market.totalVolume)}</small>
              </div>
            </GlowCard>
          </Link>
        ))}
      </div>
    </section>
  );
}

