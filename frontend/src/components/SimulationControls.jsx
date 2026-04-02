import { useState } from 'react';

/**
 * Start/stop/reset simulation buttons with speed/risk controls.
 * Includes confirmation dialog before starting.
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
  executionWalletScopeLabel,
  executionMarketScopeLabel
}) {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleStartClick = () => {
    if (running) {
      onToggleRunning();
    } else {
      setShowConfirm(true);
    }
  };

  const handleConfirmStart = () => {
    setShowConfirm(false);
    onToggleRunning();
  };

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
        <button type="button" className={running ? 'btn secondary' : 'btn primary'} onClick={handleStartClick}>
          {running ? 'Pause Simulation' : 'Start Paper Simulation'}
        </button>
        <button type="button" className="btn secondary" onClick={onManualTrigger} disabled={!running}>
          Step Once
        </button>
        <button type="button" className="btn secondary" onClick={onRunBacktest}>
          Run Backtest
        </button>
        <button type="button" className="btn secondary" onClick={onResetSession}>
          Reset Session
        </button>
      </div>

      {showConfirm && (
        <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, padding: 16, marginTop: 12 }}>
          <p style={{ color: '#f3f4f6', fontWeight: 600, marginBottom: 8 }}>Start Paper Simulation?</p>
          <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 12 }}>
            This will run on <strong style={{ color: '#e5e7eb' }}>{selectedMarketSymbol || 'the selected market'}</strong> in
            <span style={{ background: '#78350f', color: '#fbbf24', padding: '1px 6px', borderRadius: 3, margin: '0 4px', fontSize: 11, fontWeight: 600 }}>PAPER</span>
            mode. No real money will be used. Trades will be simulated with {slippageBps} bps slippage.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn primary" onClick={handleConfirmStart}>
              Confirm - Start Paper Trading
            </button>
            <button type="button" className="btn secondary" onClick={() => setShowConfirm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="strategy-lab-status-row">
        <span className={running ? 'status-pill online' : 'status-pill'}>{running ? 'PAPER simulation active' : 'simulation paused'}</span>
        <span className="status-pill">source: {sourceId}</span>
        <span className="status-pill">market: {selectedMarketSymbol || '-'}</span>
        <span className="status-pill">market scope: {executionMarketScopeLabel || '-'}</span>
        <span className="status-pill">strategy: {executionStrategyModeLabel}</span>
        <span className="status-pill">wallet: {executionWalletScopeLabel}</span>
        <span className={hasLiveHistory ? 'status-pill online' : 'status-pill'}>history {hasLiveHistory ? 'ready' : 'limited'}</span>
      </div>
    </>
  );
}
