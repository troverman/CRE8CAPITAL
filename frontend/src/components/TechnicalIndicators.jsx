import { fmtNum, fmtPct } from '../lib/format';

/**
 * Classic analysis display: SMA, RSI, MACD, Bollinger state chips.
 */
export default function TechnicalIndicators({ classicAnalysis, sourceLabel }) {
  const taTrendTone = classicAnalysis.states.trend === 'bullish' ? 'up' : classicAnalysis.states.trend === 'bearish' ? 'down' : '';
  const taBandTone = classicAnalysis.states.bandState === 'upper-break' ? 'up' : classicAnalysis.states.bandState === 'lower-break' ? 'down' : '';
  const taCrossTone = classicAnalysis.states.crossover === 'bull-cross' ? 'up' : classicAnalysis.states.crossover === 'bear-cross' ? 'down' : '';
  const taSmaSpreadTone =
    Number.isFinite(classicAnalysis.metrics.fastVsSlowPct) && classicAnalysis.metrics.fastVsSlowPct !== 0
      ? classicAnalysis.metrics.fastVsSlowPct > 0
        ? 'up'
        : 'down'
      : '';
  const taEmaSlopeTone =
    Number.isFinite(classicAnalysis.metrics.emaSlopePct) && classicAnalysis.metrics.emaSlopePct !== 0
      ? classicAnalysis.metrics.emaSlopePct > 0
        ? 'up'
        : 'down'
      : '';

  const formatRawPercent = (value) => {
    return Number.isFinite(value) ? `${fmtNum(value, 2)}%` : '-';
  };

  return (
    <>
      <div className="section-head">
        <h2>Classic Analysis</h2>
        <span>{classicAnalysis.sampleSize} samples</span>
      </div>
      <p className="socket-status-copy">
        {classicAnalysis.ready
          ? `Bollinger(${classicAnalysis.periods.bbPeriod},${classicAnalysis.periods.bbMultiplier}) + moving averages on ${sourceLabel}.`
          : `Collecting data for classic indicators (${classicAnalysis.periods.bbPeriod} points required).`}
      </p>
      <div className="ta-grid">
        <article className="ta-item">
          <span>Price vs SMA{classicAnalysis.periods.fastPeriod}</span>
          <strong className={taTrendTone}>{fmtPct(classicAnalysis.metrics.priceVsFastPct)}</strong>
        </article>
        <article className="ta-item">
          <span>SMA{classicAnalysis.periods.fastPeriod} vs SMA{classicAnalysis.periods.slowPeriod}</span>
          <strong className={taSmaSpreadTone}>{fmtPct(classicAnalysis.metrics.fastVsSlowPct)}</strong>
        </article>
        <article className="ta-item">
          <span>EMA Slope (5)</span>
          <strong className={taEmaSlopeTone}>{fmtPct(classicAnalysis.metrics.emaSlopePct)}</strong>
        </article>
        <article className="ta-item">
          <span>Band Width</span>
          <strong>{formatRawPercent(classicAnalysis.metrics.bbWidthPct)}</strong>
        </article>
        <article className="ta-item">
          <span>Band Position</span>
          <strong>{formatRawPercent(classicAnalysis.metrics.bbPositionPct)}</strong>
        </article>
        <article className="ta-item">
          <span>Price / EMA{classicAnalysis.periods.emaPeriod}</span>
          <strong>{fmtNum(classicAnalysis.latest.price, 4)} / {fmtNum(classicAnalysis.latest.ema, 4)}</strong>
        </article>
      </div>
      <div className="ta-chip-row">
        <span className={`status-pill ${taTrendTone}`}>trend {classicAnalysis.states.trend}</span>
        <span className={`status-pill ${taBandTone}`}>band {classicAnalysis.states.bandState}</span>
        <span className={`status-pill ${taCrossTone}`}>cross {classicAnalysis.states.crossover}</span>
      </div>
    </>
  );
}
