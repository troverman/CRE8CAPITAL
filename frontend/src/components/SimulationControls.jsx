import { fmtInt, fmtNum } from '../lib/format';

/**
 * Start/stop/reset simulation buttons with speed/risk controls.
 */
export default function SimulationControls({
  running,
  onToggleRunning,
  onManualTrigger,
  onRunBacktest,
  onResetSession,
  intervalMs,
  onUpdateInterval,
  maxAbsUnits,
  slippageBps,
  cooldownMs,
  onChangeRisk,
  sourceId,
  selectedMarketSymbol,
  hasLiveHistory,
  executionStrategyModeLabel,
  executionWalletScopeLabel
}) {
  return (
    <>
      <div className="strategy-risk-grid">
        <label className="control-field">
          <span>Interval (ms)</span>
          <input type="number" min={280} max={5000} step={20} value={intervalMs} onChange={(event) => onUpdateInterval(event.target.value)} />
        </label>
        <label className="control-field">
          <span>Max units</span>
          <input
            type="number"
            min={1}
            max={60}
            step={1}
            value={maxAbsUnits}
            onChange={(event) => onChangeRisk({ nextMaxAbsUnits: event.target.value, nextSlippageBps: slippageBps, nextCooldownMs: cooldownMs })}
          />
        </label>
        <label className="control-field">
          <span>Slippage (bps)</span>
          <input
            type="number"
            min={0}
            max={40}
            step={0.1}
            value={slippageBps}
            onChange={(event) => onChangeRisk({ nextMaxAbsUnits: maxAbsUnits, nextSlippageBps: event.target.value, nextCooldownMs: cooldownMs })}
          />
        </label>
        <label className="control-field">
          <span>Cooldown (ms)</span>
          <input
            type="number"
            min={0}
            max={120000}
            step={200}
            value={cooldownMs}
            onChange={(event) => onChangeRisk({ nextMaxAbsUnits: maxAbsUnits, nextSlippageBps: slippageBps, nextCooldownMs: event.target.value })}
          />
        </label>
      </div>

      <div className="hero-actions">
        <button type="button" className={running ? 'btn secondary' : 'btn primary'} onClick={onToggleRunning}>
          {running ? 'Pause Realtime' : 'Start Realtime'}
        </button>
        <button type="button" className="btn secondary" onClick={onManualTrigger}>
          Manual Trigger
        </button>
        <button type="button" className="btn secondary" onClick={onRunBacktest}>
          Run Backtest
        </button>
        <button type="button" className="btn secondary" onClick={onResetSession}>
          Reset Session
        </button>
      </div>

      <div className="strategy-lab-status-row">
        <span className={running ? 'status-pill online' : 'status-pill'}>{running ? 'realtime active' : 'realtime paused'}</span>
        <span className="status-pill">mode {sourceId}</span>
        <span className="status-pill">market {selectedMarketSymbol || '-'}</span>
        <span className="status-pill">strategy exec {executionStrategyModeLabel}</span>
        <span className="status-pill">wallet exec {executionWalletScopeLabel}</span>
        <span className={hasLiveHistory ? 'status-pill online' : 'status-pill'}>history {hasLiveHistory ? 'available' : 'limited'}</span>
      </div>
    </>
  );
}
