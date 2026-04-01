import { fmtNum, fmtTime } from '../lib/format';

/**
 * Trade history table. Reusable -- takes trades array.
 * Columns: time, symbol, side, qty, price, P&L. Color-codes buy/sell, profit/loss.
 */
export default function TradeTable({ trades = [], emptyMessage = 'No trades yet.' }) {
  if (trades.length === 0) {
    return <p className="action-message">{emptyMessage}</p>;
  }

  return (
    <div className="list-stack">
      {trades.map((trade) => (
        <article key={trade.id} className="list-item wallet-trade-item">
          <div className="wallet-trade-head">
            <strong className={trade.action === 'accumulate' || trade.side === 'buy' ? 'up' : 'down'}>
              {trade.action === 'accumulate' || trade.side === 'buy' ? 'buy' : 'sell'}
              {trade.symbol ? ` | ${trade.symbol}` : ''}
            </strong>
            <small>{fmtTime(trade.timestamp || trade.createdAt)}</small>
          </div>
          <p>{trade.reason || trade.venue || 'trade'}</p>
          <div className="item-meta">
            <small>fill {fmtNum(trade.fillPrice || trade.price, 4)}</small>
            {trade.markPrice ? <small>mark {fmtNum(trade.markPrice, 4)}</small> : null}
            {trade.spreadBps ? <small>spread {fmtNum(trade.spreadBps, 2)} bps</small> : null}
            {trade.quantity ? <small>qty {fmtNum(trade.quantity, 6)}</small> : null}
            {trade.unitsAfter !== undefined ? <small>units {fmtNum(trade.unitsAfter, 4)}</small> : null}
            {trade.fee !== undefined ? <small>fee {fmtNum(trade.fee, 4)}</small> : null}
            <small className={(trade.realizedDelta || 0) >= 0 ? 'up' : 'down'}>
              P&L {fmtNum(trade.realizedDelta || 0, 2)}
            </small>
          </div>
        </article>
      ))}
    </div>
  );
}
