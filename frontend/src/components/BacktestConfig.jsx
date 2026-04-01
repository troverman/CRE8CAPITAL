import GlowCard from './GlowCard';
import { fmtInt, fmtTime } from '../lib/format';

const BACKTEST_HISTORY_WINDOW_OPTIONS = [
  { key: '5m', label: '5m' },
  { key: '1h', label: '1h' },
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' }
];

/**
 * Strategy selector, symbol picker, date range, fee rate, initial cash inputs. "Run Backtest" button.
 */
export default function BacktestConfig({
  sourceMode,
  setSourceMode,
  strategyId,
  setStrategyId,
  strategyOptions,
  marketKey,
  setMarketKey,
  sortedMarkets,
  scenarioId,
  setScenarioId,
  scenarioOptions,
  historyWindowKey,
  setHistoryWindowKey,
  sampleSize,
  setSampleSize,
  startCash,
  setStartCash,
  maxAbsUnits,
  setMaxAbsUnits,
  slippageBps,
  setSlippageBps,
  onRunBacktest,
  sourceLabel,
  activeSeries,
  selectedMarket,
  ranAt,
  providerHistoryProviderName,
  providerHistorySeries,
  providerWindowHistory
}) {
  const toNum = (value, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  };

  return (
    <GlowCard className="panel-card">
      <div className="section-head">
        <h2>Run Controls</h2>
        <span>{sourceLabel}</span>
      </div>
      <div className="strategy-control-grid">
        <label className="control-field">
          <span>Source</span>
          <select value={sourceMode} onChange={(event) => setSourceMode(event.target.value)}>
            <option value="live-history">live-history</option>
            <option value="provider-history">provider-history</option>
            <option value="scenario">scenario</option>
          </select>
        </label>

        <label className="control-field">
          <span>Strategy</span>
          <select value={strategyId} onChange={(event) => setStrategyId(event.target.value)}>
            {strategyOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="control-field">
          <span>Market</span>
          <select value={marketKey} onChange={(event) => setMarketKey(event.target.value)} disabled={!sortedMarkets.length}>
            {sortedMarkets.map((market) => (
              <option key={market.key} value={market.key}>
                {market.symbol} ({market.assetClass})
              </option>
            ))}
          </select>
        </label>

        <label className="control-field">
          <span>Scenario</span>
          <select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)} disabled={sourceMode !== 'scenario'}>
            {scenarioOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="control-field">
          <span>History Window</span>
          <select value={historyWindowKey} onChange={(event) => setHistoryWindowKey(event.target.value)} disabled={sourceMode !== 'provider-history'}>
            {BACKTEST_HISTORY_WINDOW_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="strategy-risk-grid">
        <label className="control-field">
          <span>Sample Size</span>
          <input type="number" min={64} max={720} step={8} value={sampleSize} onChange={(event) => setSampleSize(Math.max(64, Math.min(720, Math.round(toNum(event.target.value, 280)))))} />
        </label>

        <label className="control-field">
          <span>Start Cash</span>
          <input type="number" min={100} step={100} value={startCash} onChange={(event) => setStartCash(Math.max(100, toNum(event.target.value, 100000)))} />
        </label>

        <label className="control-field">
          <span>Max Units</span>
          <input type="number" min={1} step={1} value={maxAbsUnits} onChange={(event) => setMaxAbsUnits(Math.max(1, Math.round(toNum(event.target.value, 8))))} />
        </label>

        <label className="control-field">
          <span>Slippage (bps)</span>
          <input type="number" min={0} step={0.1} value={slippageBps} onChange={(event) => setSlippageBps(Math.max(0, toNum(event.target.value, 1.2)))} />
        </label>
      </div>

      <div className="hero-actions">
        <button type="button" className="btn primary" onClick={onRunBacktest}>
          Run Backtest
        </button>
      </div>
      <p className="socket-status-copy">
        sample {fmtInt(activeSeries.length)} | market {selectedMarket.symbol} | last run {fmtTime(ranAt)}
      </p>
      {sourceMode === 'provider-history' ? (
        <p className="socket-status-copy">
          provider {providerHistoryProviderName || 'none'} | window {historyWindowKey} | rows{' '}
          {fmtInt(providerHistorySeries.length)}
          {providerWindowHistory.loading ? ' | loading...' : ''}
          {providerWindowHistory.error ? ` | ${providerWindowHistory.error}` : ''}
        </p>
      ) : null}
    </GlowCard>
  );
}
