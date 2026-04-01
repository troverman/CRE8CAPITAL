/**
 * Strategy picker with enable/disable toggles.
 * Used in StrategyLabPage and WalletPage for multi-strategy selection.
 */
export default function StrategySelector({
  strategyOptions = [],
  enabledStrategySet,
  onToggle,
  onEnableAll,
  onFocusOnly,
  onPreset,
  enabledCount = 0
}) {
  return (
    <>
      <div className="section-head">
        <h2>Multi Strategy Runtime</h2>
        <span>{enabledCount} active</span>
      </div>
      <div className="section-actions">
        {onEnableAll ? (
          <button type="button" className="btn secondary" onClick={onEnableAll}>
            Enable Entire Set
          </button>
        ) : null}
        {onFocusOnly ? (
          <button type="button" className="btn secondary" onClick={onFocusOnly}>
            Focus Only
          </button>
        ) : null}
        {onPreset ? (
          <button type="button" className="btn secondary" onClick={onPreset}>
            Enable Top 3 Preset
          </button>
        ) : null}
      </div>
      <div className="strategy-enabled-grid">
        {strategyOptions.map((option) => {
          const checked = enabledStrategySet.has(option.id);
          return (
            <label key={`strategy-enabled:${option.id}`} className={checked ? 'strategy-toggle-chip active' : 'strategy-toggle-chip'}>
              <input type="checkbox" checked={checked} onChange={() => onToggle(option.id)} />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </>
  );
}
