import GlowCard from './GlowCard';
import { fmtCompact, fmtInt, fmtNum, fmtPct, fmtTime, severityClass } from '../lib/format';
import { Link } from '../lib/router';

/**
 * Market stats: unified quote matrix and signal feed.
 */
export default function MarketStats({
  visibleQuoteRows,
  socketLiveEnabled,
  showRuntimeQuotes,
  setShowRuntimeQuotes,
  quoteRows,
  signals,
  market
}) {
  return (
    <div className="two-col">
      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Provider Quotes</h2>
          <span>{visibleQuoteRows.length} rows</span>
        </div>
        <p className="socket-status-copy">
          {socketLiveEnabled
            ? 'Unified quote view: runtime snapshots plus direct socket quotes when available.'
            : 'Unified quote view: runtime/provider history (direct sockets currently off).'}
        </p>
        {socketLiveEnabled ? (
          <div className="socket-toggle-row">
            <label className="toggle-label">
              <input type="checkbox" checked={showRuntimeQuotes} onChange={(event) => setShowRuntimeQuotes(event.target.checked)} />
              <span>Show diagnostics (all socket rows)</span>
            </label>
            <small>
              direct {quoteRows.filter((row) => row.source === 'socket').length} | runtime {quoteRows.filter((row) => row.source === 'runtime').length}
            </small>
          </div>
        ) : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Provider</th>
                <th>Pair</th>
                <th>Price</th>
                <th>Bid</th>
                <th>Ask</th>
                <th>Volume</th>
                <th>Basis</th>
                <th>At</th>
              </tr>
            </thead>
            <tbody>
              {visibleQuoteRows.map((provider) => (
                <tr key={provider.id}>
                  <td>
                    <span className={`source-badge ${provider.source === 'runtime' ? 'source-runtime' : 'source-socket'}`}>
                      {provider.source === 'runtime' ? 'Runtime' : 'Socket'}
                    </span>
                  </td>
                  <td>{provider.name}</td>
                  <td>{provider.pairLabel}</td>
                  <td>{fmtNum(provider.price, 4)}</td>
                  <td>{fmtNum(provider.bid, 4)}</td>
                  <td>{fmtNum(provider.ask, 4)}</td>
                  <td>{fmtCompact(provider.volume)}</td>
                  <td className={provider.basis?.className || ''}>{provider.basis?.label || '-'}</td>
                  <td>{fmtTime(provider.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlowCard>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Signals</h2>
          <span>{signals.length} recent</span>
        </div>
        <div className="list-stack">
          {signals.map((signal) => (
            <article key={signal.id} className="list-item">
              <strong>
                <Link to={`/signal/${encodeURIComponent(signal.id)}`} className="inline-link">
                  {signal.type}
                </Link>{' '}
                | {signal.direction}
              </strong>
              <p>{signal.message}</p>
              <div className="item-meta">
                <span className={`severity ${severityClass(signal.severity)}`}>{signal.severity}</span>
                <small>score {fmtInt(signal.score)}</small>
                <small>{fmtTime(signal.timestamp)}</small>
              </div>
            </article>
          ))}
        </div>
      </GlowCard>
    </div>
  );
}
