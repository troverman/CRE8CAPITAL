import { fmtCompact, fmtInt, fmtNum, fmtPct, fmtTime } from '../lib/format';
import OrderBook3D from './OrderBook3D';

/**
 * Order book depth panel with bid/ask rendering, imbalance stats, and optional 3D view.
 */
export default function OrderBookPanel({
  depthBook,
  showOrderBook3D,
  setShowOrderBook3D,
  socketLiveEnabled,
  multimarketHref,
  depthSnapshots
}) {
  return (
    <>
      <div className="section-head">
        <h2>Order Book Depth</h2>
        <div className="section-actions">
          <span>
            {depthBook.providerName
              ? `${depthBook.providerName}${depthBook.sourceLabel ? ` (${depthBook.sourceLabel})` : ''}`
              : 'No provider depth yet'}
          </span>
          <button
            type="button"
            className="btn secondary"
            onClick={() => setShowOrderBook3D((current) => !current)}
            disabled={!socketLiveEnabled}
          >
            {showOrderBook3D ? 'Hide MultiMarket 3D' : 'Open MultiMarket 3D'}
          </button>
          {multimarketHref ? (
            <a className="btn secondary" href={multimarketHref} target="_blank" rel="noreferrer">
              Open External
            </a>
          ) : null}
        </div>
      </div>
      <p className="socket-status-copy">
        bids {fmtCompact(depthBook.bidNotional)} | asks {fmtCompact(depthBook.askNotional)} | imbalance {fmtPct(depthBook.imbalance)} | at{' '}
        {fmtTime(depthBook.timestamp)}
      </p>
      <div className="depth-grid">
        <section className="depth-side bid">
          <h3>Bid Depth</h3>
          {(depthBook.bids || []).map((level, index) => (
            <article key={`bid:${index}:${level.price}`} className="depth-row bid-row">
              <div className="depth-bar bid" style={{ width: `${Math.min(100, (Number(level.size) / depthBook.maxSize) * 100)}%` }} />
              <div className="depth-content">
                <strong>{fmtNum(level.price, 4)}</strong>
                <small>{fmtCompact(level.size)}</small>
              </div>
            </article>
          ))}
          {depthBook.bids.length === 0 ? <p className="depth-empty">No bid depth yet.</p> : null}
        </section>

        <section className="depth-side ask">
          <h3>Ask Depth</h3>
          {(depthBook.asks || []).map((level, index) => (
            <article key={`ask:${index}:${level.price}`} className="depth-row ask-row">
              <div className="depth-bar ask" style={{ width: `${Math.min(100, (Number(level.size) / depthBook.maxSize) * 100)}%` }} />
              <div className="depth-content">
                <strong>{fmtNum(level.price, 4)}</strong>
                <small>{fmtCompact(level.size)}</small>
              </div>
            </article>
          ))}
          {depthBook.asks.length === 0 ? <p className="depth-empty">No ask depth yet.</p> : null}
        </section>
      </div>
      {showOrderBook3D ? (
        <section className="depth-3d-wrap">
          <div className="depth-3d-head">
            <strong>3D Order Book (Live)</strong>
            <small>{fmtInt(depthSnapshots.length)} snapshots buffered</small>
          </div>
          <OrderBook3D snapshots={depthSnapshots} />
        </section>
      ) : null}
    </>
  );
}
