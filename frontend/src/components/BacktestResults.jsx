import FlashList from './FlashList';
import GlowCard from './GlowCard';
import LineChart from './LineChart';
import MetricsGrid from './MetricsGrid';
import { fmtInt, fmtNum, fmtPct, fmtTime } from '../lib/format';

const actionClass = (action) => {
  if (action === 'accumulate' || action === 'buy') return 'up';
  if (action === 'reduce' || action === 'sell') return 'down';
  return '';
};

/**
 * Backtest results: metrics, equity curve chart, trade list.
 */
export default function BacktestResults({
  stats,
  equitySeries,
  tradeRows,
  signalRows,
  sourcePriceSeries,
  sourceLabel,
  oracleStats,
  pdfPolicyStats
}) {
  const metrics = [
    { label: 'Return', value: fmtPct(stats.returnPct), className: stats.returnPct >= 0 ? 'up' : 'down' },
    { label: 'PnL', value: fmtNum(stats.pnl, 2), className: stats.pnl >= 0 ? 'up' : 'down' },
    { label: 'Trades', value: fmtInt(stats.tradeCount) },
    { label: 'Max Drawdown', value: fmtPct(stats.maxDrawdownPct), className: stats.maxDrawdownPct > 0 ? 'down' : '' }
  ];

  if (oracleStats) {
    metrics.push(
      { label: 'Oracle Return', value: fmtPct(oracleStats.returnPct), className: oracleStats.returnPct >= 0 ? 'up' : 'down' },
      { label: 'PDF Return', value: fmtPct(pdfPolicyStats.returnPct), className: pdfPolicyStats.returnPct >= 0 ? 'up' : 'down' },
      { label: 'Oracle Edge', value: fmtPct(oracleStats.returnPct - stats.returnPct), className: oracleStats.returnPct - stats.returnPct >= 0 ? 'up' : 'down' },
      { label: 'PDF Edge', value: fmtPct(pdfPolicyStats.returnPct - stats.returnPct), className: pdfPolicyStats.returnPct - stats.returnPct >= 0 ? 'up' : 'down' },
      { label: 'Oracle vs PDF', value: fmtPct(oracleStats.returnPct - pdfPolicyStats.returnPct), className: oracleStats.returnPct - pdfPolicyStats.returnPct >= 0 ? 'up' : 'down' }
    );
  }

  return (
    <>
      <MetricsGrid metrics={metrics} />

      <div className="strategy-lab-chart-grid">
        <GlowCard className="chart-card">
          <LineChart
            title={`Backtest Equity Curve (${fmtInt(equitySeries?.length || 0)} points)`}
            points={equitySeries || []}
            stroke="#9d92ff"
            fillFrom="rgba(150, 130, 255, 0.3)"
            fillTo="rgba(150, 130, 255, 0.02)"
          />
        </GlowCard>

        <GlowCard className="chart-card">
          <LineChart
            title={`Source Price (${sourceLabel})`}
            points={sourcePriceSeries}
            stroke="#72ecff"
            fillFrom="rgba(82, 199, 255, 0.32)"
            fillTo="rgba(82, 199, 255, 0.02)"
          />
        </GlowCard>
      </div>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Backtest Trade Tape</h2>
            <span>{fmtInt(tradeRows.length)} rows</span>
          </div>
          <FlashList
            items={tradeRows}
            height={320}
            itemHeight={72}
            className="tick-flash-list"
            emptyCopy="No backtest trades generated for this run."
            keyExtractor={(trade) => trade.id}
            renderItem={(trade) => (
              <article className="tensor-event-row">
                <strong className={actionClass(trade.action)}>
                  {trade.action} | fill {fmtNum(trade.fillPrice, 4)}
                </strong>
                <p>{trade.reason || 'backtest execution'}</p>
                <small>
                  units {fmtNum(trade.unitsAfter, 0)} | realized {fmtNum(trade.realizedDelta, 2)} | spread {fmtNum(trade.spreadBps, 2)} bps | {fmtTime(trade.timestamp)}
                </small>
              </article>
            )}
          />
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Backtest Signal Tape</h2>
            <span>{fmtInt(signalRows.length)} rows</span>
          </div>
          <FlashList
            items={signalRows}
            height={320}
            itemHeight={72}
            className="tick-flash-list"
            emptyCopy="No backtest signals generated for this run."
            keyExtractor={(signal) => signal.id}
            renderItem={(signal) => (
              <article className="tensor-event-row">
                <strong className={actionClass(signal.action)}>
                  {signal.action} | {signal.stance}
                </strong>
                <p>{signal.reason}</p>
                <small>
                  score {fmtNum(signal.score, 2)} | px {fmtNum(signal.price, 4)} | sigs {fmtInt(signal.signalCount)} | {fmtTime(signal.timestamp)}
                </small>
              </article>
            )}
          />
        </GlowCard>
      </div>
    </>
  );
}
