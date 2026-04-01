import GlowCard from './GlowCard';
import { fmtCompact, fmtNum, fmtPct } from '../lib/format';

/**
 * Big price display with reference, change %, spread, volume.
 * Used at top of MarketDetailPage overview tab.
 */
export default function PriceHeader({ referencePrice, changePct, spreadBps, volume }) {
  const safePrice = Number(referencePrice);
  const hasPrice = Number.isFinite(safePrice) && safePrice > 0;

  return (
    <div className="detail-stat-grid">
      <GlowCard className="stat-card">
        <span>Reference</span>
        <strong>{hasPrice ? fmtNum(safePrice, 4) : 'Awaiting data...'}</strong>
      </GlowCard>
      <GlowCard className="stat-card">
        <span>Change</span>
        <strong className={Number(changePct) >= 0 ? 'up' : 'down'}>{fmtPct(changePct)}</strong>
      </GlowCard>
      <GlowCard className="stat-card">
        <span>Spread</span>
        <strong>{fmtNum(spreadBps, 2)} bps</strong>
      </GlowCard>
      <GlowCard className="stat-card">
        <span>Volume</span>
        <strong>{fmtCompact(volume)}</strong>
      </GlowCard>
    </div>
  );
}
