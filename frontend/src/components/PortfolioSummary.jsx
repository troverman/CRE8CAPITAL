import { fmtInt, fmtNum, fmtPct } from '../lib/format';

const toneClass = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return '';
  return num > 0 ? 'up' : 'down';
};

/**
 * Portfolio state display: cash, equity, positions, PnL.
 * Used as the session overview in StrategyLabPage.
 */
export default function PortfolioSummary({
  wallet,
  backtestStats,
  enabledAccountCount,
  eventLogCount,
  accountName
}) {
  return (
    <>
      <div className="section-head">
        <h2>Session Overview</h2>
        <span>{accountName || 'paper account'}</span>
      </div>
      <div className="strategy-lab-mini-grid">
        <article className="strategy-lab-mini-stat">
          <span>Wallet Equity</span>
          <strong className={toneClass(wallet.equity - 100000)}>{fmtNum(wallet.equity, 2)}</strong>
        </article>
        <article className="strategy-lab-mini-stat">
          <span>Realized PnL</span>
          <strong className={toneClass(wallet.realizedPnl)}>{fmtNum(wallet.realizedPnl, 2)}</strong>
        </article>
        <article className="strategy-lab-mini-stat">
          <span>Unrealized PnL</span>
          <strong className={toneClass(wallet.unrealizedPnl)}>{fmtNum(wallet.unrealizedPnl, 2)}</strong>
        </article>
        <article className="strategy-lab-mini-stat">
          <span>Position</span>
          <strong>{fmtNum(wallet.units, 0)} units</strong>
        </article>
        {backtestStats ? (
          <>
            <article className="strategy-lab-mini-stat">
              <span>Backtest Return</span>
              <strong className={toneClass(backtestStats.returnPct)}>{fmtPct(backtestStats.returnPct)}</strong>
            </article>
            <article className="strategy-lab-mini-stat">
              <span>Backtest PnL</span>
              <strong className={toneClass(backtestStats.pnl)}>{fmtNum(backtestStats.pnl, 2)}</strong>
            </article>
          </>
        ) : null}
        <article className="strategy-lab-mini-stat">
          <span>Enabled Accounts</span>
          <strong>{fmtInt(enabledAccountCount)}</strong>
        </article>
        <article className="strategy-lab-mini-stat">
          <span>Trigger Events</span>
          <strong>{fmtInt(eventLogCount)}</strong>
        </article>
      </div>
    </>
  );
}
