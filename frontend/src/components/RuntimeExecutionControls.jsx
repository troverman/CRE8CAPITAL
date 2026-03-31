const MODE_OPTIONS = [
  { value: 'best-enabled', label: 'Best Enabled Strategy' },
  { value: 'selected-only', label: 'Selected Strategy Only' }
];

const WALLET_SCOPE_OPTIONS = [
  { value: 'active-only', label: 'Active Wallet Only' },
  { value: 'all-enabled', label: 'All Enabled Wallets' }
];

const describeMode = (value) => (value === 'selected-only' ? 'selected strategy only' : 'best enabled strategy');
const describeWalletScope = (value) => (value === 'active-only' ? 'active wallet only' : 'all enabled wallets');

export default function RuntimeExecutionControls({
  strategyMode = 'best-enabled',
  walletScope = 'active-only',
  onStrategyModeChange,
  onWalletScopeChange,
  showControls = true,
  summaryPrefix = 'Engine mode',
  summarySuffix = '.'
}) {
  const canEdit = typeof onStrategyModeChange === 'function' && typeof onWalletScopeChange === 'function';

  return (
    <>
      {showControls ? (
        <div className="strategy-control-grid">
          <label className="control-field">
            <span>Execution Strategy</span>
            <select
              value={strategyMode}
              onChange={(event) => onStrategyModeChange(event.target.value)}
              disabled={!canEdit}
            >
              {MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="control-field">
            <span>Wallet Target</span>
            <select value={walletScope} onChange={(event) => onWalletScopeChange(event.target.value)} disabled={!canEdit}>
              {WALLET_SCOPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <p className="socket-status-copy">
        {summaryPrefix} {describeMode(strategyMode)} | wallet scope {describeWalletScope(walletScope)}
        {summarySuffix}
      </p>
    </>
  );
}
