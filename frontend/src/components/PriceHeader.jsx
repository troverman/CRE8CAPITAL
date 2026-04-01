import GlowCard from './GlowCard';
import { fmtCompact, fmtNum, fmtPct } from '../lib/format';

/**
 * Big price display with reference, change %, spread, volume.
 * Used at top of MarketDetailPage overview tab.
 */
export default function PriceHeader({ referencePrice, changePct, spreadBps, volume }) {
  return (
    <div className="detail-stat-grid">
      <GlowCard className="stat-card">
        <span>Reference</span>
        <strong>{fmtNum(referencePrice, 4)}</strong>
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
