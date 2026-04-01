const MODE_OPTIONS = [
  { value: 'best-enabled', label: 'Best Enabled Strategy', desc: 'Picks the highest-scoring enabled strategy for each signal' },
  { value: 'selected-only', label: 'Selected Strategy Only', desc: 'Only the currently selected strategy can trade' }
];

const WALLET_SCOPE_OPTIONS = [
  { value: 'active-only', label: 'Active Wallet Only', desc: 'Trades only affect the selected paper wallet' },
  { value: 'all-enabled', label: 'All Enabled Wallets', desc: 'Trades are mirrored across all enabled paper wallets' }
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
            <span>Strategy Selection Rule</span>
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
            <small style={{color: '#6b7280', fontSize: 11, marginTop: 2}}>
              {MODE_OPTIONS.find(o => o.value === strategyMode)?.desc}
            </small>
          </label>
          <label className="control-field">
            <span>Wallet Scope</span>
            <select value={walletScope} onChange={(event) => onWalletScopeChange(event.target.value)} disabled={!canEdit}>
              {WALLET_SCOPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small style={{color: '#6b7280', fontSize: 11, marginTop: 2}}>
              {WALLET_SCOPE_OPTIONS.find(o => o.value === walletScope)?.desc}
            </small>
          </label>
        </div>
      ) : null}
      <p className="socket-status-copy">
        <span style={{background: '#78350f', color: '#fbbf24', padding: '1px 6px', borderRadius: 3, fontSize: 11, fontWeight: 600, marginRight: 6}}>PAPER</span>
        {summaryPrefix}: {describeMode(strategyMode)} · wallet: {describeWalletScope(walletScope)}
        {summarySuffix}
      </p>
    </>
  );
}
