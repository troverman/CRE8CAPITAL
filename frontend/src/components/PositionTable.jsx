import { fmtNum, fmtTime } from '../lib/format';

/**
 * Active positions table. Reusable -- takes positions array.
 * Shows symbol, side, units, avg entry, mark price, notional, unrealized P&L.
 */
export default function PositionTable({ positions = [], emptyMessage = 'No open positions.' }) {
  if (positions.length === 0) {
    return <p className="action-message">{emptyMessage}</p>;
  }

  return (
    <div className="list-stack">
      {positions.map((pos) => (
        <article key={`pos:${pos.marketKey || pos.symbol}`} className="list-item wallet-holding-item">
          <div className="wallet-holding-head">
            <strong>
              {pos.symbol} ({pos.assetClass || 'unknown'})
            </strong>
            <span className={pos.units >= 0 ? 'status-pill up' : 'status-pill down'}>
              {pos.units >= 0 ? 'long' : 'short'}
            </span>
          </div>
          <div className="item-meta">
            <small>units {fmtNum(pos.units, 4)}</small>
            <small>avg {pos.avgEntry === null || pos.avgEntry === undefined ? '-' : fmtNum(pos.avgEntry || pos.avgEntryPrice, 4)}</small>
            <small>mark {fmtNum(pos.markPrice || pos.lastPrice, 4)}</small>
            {pos.notional !== undefined ? <small>notional {fmtNum(pos.notional, 2)}</small> : null}
            {pos.quantity !== undefined ? <small>qty {fmtNum(pos.quantity, 6)}</small> : null}
            {pos.unrealized !== undefined ? (
              <small className={pos.unrealized >= 0 ? 'up' : 'down'}>uPnL {fmtNum(pos.unrealized, 2)}</small>
            ) : null}
            {pos.updatedAt ? <small>{fmtTime(pos.updatedAt)}</small> : null}
          </div>
        </article>
      ))}
    </div>
  );
}
