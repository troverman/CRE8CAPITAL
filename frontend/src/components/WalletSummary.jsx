import GlowCard from './GlowCard';
import { fmtCompact, fmtNum, fmtPct } from '../lib/format';

/**
 * Wallet summary: equity, cash, P&L, trade count, win rate.
 * Reusable for both runtime and server wallets.
 */
export default function WalletSummary({ equity, cash, totalPnl, unrealizedPnl, tradeCount, winRate, openNotional, startCash }) {
  const safeStartCash = startCash || 100000;
  return (
    <div className="detail-stat-grid">
      {equity !== undefined ? (
        <GlowCard className="stat-card">
          <span>Equity</span>
          <strong className={equity >= safeStartCash ? 'up' : 'down'}>{fmtNum(equity, 2)}</strong>
        </GlowCard>
      ) : null}
      {cash !== undefined ? (
        <GlowCard className="stat-card">
          <span>Cash</span>
          <strong>{fmtNum(cash, 2)}</strong>
        </GlowCard>
      ) : null}
      {totalPnl !== undefined ? (
        <GlowCard className="stat-card">
          <span>Total P&L</span>
          <strong className={totalPnl >= 0 ? 'up' : 'down'}>{fmtNum(totalPnl, 2)}</strong>
        </GlowCard>
      ) : null}
      {unrealizedPnl !== undefined ? (
        <GlowCard className="stat-card">
          <span>Unrealized P&L</span>
          <strong className={unrealizedPnl >= 0 ? 'up' : 'down'}>{fmtNum(unrealizedPnl, 2)}</strong>
        </GlowCard>
      ) : null}
      {tradeCount !== undefined ? (
        <GlowCard className="stat-card">
          <span>Trades</span>
          <strong>{tradeCount}</strong>
        </GlowCard>
      ) : null}
      {winRate !== undefined ? (
        <GlowCard className="stat-card">
          <span>Win Rate</span>
          <strong>{fmtNum(winRate, 1)}%</strong>
        </GlowCard>
      ) : null}
      {openNotional !== undefined ? (
        <GlowCard className="stat-card">
          <span>Open Notional</span>
          <strong>{fmtCompact(openNotional)}</strong>
        </GlowCard>
      ) : null}
    </div>
  );
}
