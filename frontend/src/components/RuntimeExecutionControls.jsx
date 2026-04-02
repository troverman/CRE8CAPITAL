const MODE_OPTIONS = [
  { value: 'best-enabled', label: 'Best Enabled Strategy', desc: 'Picks the highest-scoring enabled strategy for each signal' },
  { value: 'selected-only', label: 'Selected Strategy Only', desc: 'Only the currently selected strategy can trade' }
];

const WALLET_SCOPE_OPTIONS = [
  { value: 'active-only', label: 'Active Wallet Only', desc: 'Trades only affect the selected paper wallet' },
  { value: 'all-enabled', label: 'All Enabled Wallets', desc: 'Trades are mirrored across all enabled paper wallets' }
];

const MARKET_SCOPE_OPTIONS = [
  { value: 'selected-market', label: 'Selected Market', desc: 'Runs execution on the market picked in Strategy Lab' },
  { value: 'scanner-top', label: 'Scanner Top Pick', desc: 'Each tick routes to the highest-ranked scanner market' },
  { value: 'scanner-rotate', label: 'Scanner Rotate Top Set', desc: 'Cycles across top scanner markets for broader market coverage' }
];

const describeMode = (value) => (value === 'selected-only' ? 'selected strategy only' : 'best enabled strategy');
const describeWalletScope = (value) => (value === 'active-only' ? 'active wallet only' : 'all enabled wallets');
const describeMarketScope = (value) => {
  if (value === 'scanner-top') return 'scanner top market';
  if (value === 'scanner-rotate') return 'scanner rotating markets';
  return 'selected market only';
};

export default function RuntimeExecutionControls({
  strategyMode = 'best-enabled',
  walletScope = 'active-only',
  marketScope = 'selected-market',
  onStrategyModeChange,
  onWalletScopeChange,
  onMarketScopeChange,
  showControls = true,
  summaryPrefix = 'Engine mode',
  summarySuffix = '.'
}) {
  const canEditStrategy = typeof onStrategyModeChange === 'function';
  const canEditWallet = typeof onWalletScopeChange === 'function';
  const canEditMarket = typeof onMarketScopeChange === 'function';

  return (
    <>
      {showControls ? (
        <div className="strategy-control-grid">
          <label className="control-field">
            <span>Strategy Selection Rule</span>
            <select value={strategyMode} onChange={(event) => onStrategyModeChange(event.target.value)} disabled={!canEditStrategy}>
              {MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small style={{ color: '#6b7280', fontSize: 11, marginTop: 2 }}>{MODE_OPTIONS.find((option) => option.value === strategyMode)?.desc}</small>
          </label>
          <label className="control-field">
            <span>Wallet Scope</span>
            <select value={walletScope} onChange={(event) => onWalletScopeChange(event.target.value)} disabled={!canEditWallet}>
              {WALLET_SCOPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small style={{ color: '#6b7280', fontSize: 11, marginTop: 2 }}>{WALLET_SCOPE_OPTIONS.find((option) => option.value === walletScope)?.desc}</small>
          </label>
          <label className="control-field">
            <span>Market Scope</span>
            <select value={marketScope} onChange={(event) => onMarketScopeChange(event.target.value)} disabled={!canEditMarket}>
              {MARKET_SCOPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small style={{ color: '#6b7280', fontSize: 11, marginTop: 2 }}>{MARKET_SCOPE_OPTIONS.find((option) => option.value === marketScope)?.desc}</small>
          </label>
        </div>
      ) : null}
      <p className="socket-status-copy">
        <span style={{ background: '#78350f', color: '#fbbf24', padding: '1px 6px', borderRadius: 3, fontSize: 11, fontWeight: 600, marginRight: 6 }}>PAPER</span>
        {summaryPrefix}: {describeMode(strategyMode)} | wallet: {describeWalletScope(walletScope)} | market: {describeMarketScope(marketScope)}
        {summarySuffix}
      </p>
    </>
  );
}
