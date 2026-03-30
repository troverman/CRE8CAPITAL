const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toId = (value) => String(value || '');

const asArray = (value) => (Array.isArray(value) ? value : []);

export const selectWalletAccountById = (walletAccounts = [], accountId = '') => {
  const targetId = toId(accountId);
  if (!targetId) return null;
  return asArray(walletAccounts).find((account) => toId(account?.id) === targetId) || null;
};

export const selectActiveWalletAccount = (walletAccounts = [], activeWalletAccountId = '') => {
  const accounts = asArray(walletAccounts);
  if (accounts.length === 0) return null;
  return selectWalletAccountById(accounts, activeWalletAccountId) || accounts[0] || null;
};

export const resolveDrilldownWalletAccountId = ({
  walletAccounts = [],
  requestedDrilldownAccountId = '',
  activeWalletAccountId = ''
}) => {
  // Priority order keeps UI ownership explicit: user-picked drilldown -> active execution account -> first account.
  const accounts = asArray(walletAccounts);
  if (accounts.length === 0) return '';

  const requestedId = toId(requestedDrilldownAccountId);
  if (requestedId && accounts.some((account) => toId(account?.id) === requestedId)) return requestedId;

  const activeId = toId(activeWalletAccountId);
  if (activeId && accounts.some((account) => toId(account?.id) === activeId)) return activeId;

  return toId(accounts[0]?.id);
};

export const countEnabledWalletAccounts = (walletAccounts = []) => {
  return asArray(walletAccounts).filter((account) => Boolean(account?.enabled)).length;
};

export const selectStrategyMeta = (strategyOptions = [], strategyId = '') => {
  const targetId = toId(strategyId);
  if (!targetId) return null;
  return asArray(strategyOptions).find((option) => toId(option?.id) === targetId) || null;
};

export const filterRowsByAccountId = (rows = [], accountId = '') => {
  const targetId = toId(accountId);
  if (!targetId) return [];
  return asArray(rows).filter((row) => toId(row?.accountId) === targetId);
};

export const filterTradeRowsByStrategyId = (tradeRows = [], strategyId = '') => {
  const targetId = toId(strategyId);
  if (!targetId) return [];
  return asArray(tradeRows).filter((trade) => toId(trade?.strategyId || targetId) === targetId);
};

export const filterRowsByStrategyId = (rows = [], strategyId = '') => {
  const targetId = toId(strategyId);
  if (!targetId) return [];
  return asArray(rows).filter((row) => toId(row?.strategyId) === targetId);
};

export const buildAccountEquitySeries = ({ account = null, positionRows = [], maxPoints = 320, defaultStartCash = 100000 }) => {
  if (!account) return [];

  const points = asArray(positionRows)
    .slice()
    .sort((a, b) => toNum(a?.timestamp, 0) - toNum(b?.timestamp, 0))
    .map((row) => toNum(row?.wallet?.equity, NaN))
    .filter((value) => Number.isFinite(value))
    .slice(-Math.max(2, Math.round(toNum(maxPoints, 320))));

  if (points.length >= 2) return points;

  const start = toNum(account?.startCash, defaultStartCash);
  const current = toNum(account?.wallet?.equity, start);
  return [start, current];
};

export const computeStrategyTradeWinRate = (tradeRows = []) => {
  const rows = asArray(tradeRows);
  if (rows.length === 0) return 0;
  const wins = rows.filter((trade) => toNum(trade?.realizedDelta, 0) > 0).length;
  return (wins / rows.length) * 100;
};

export const buildStrategyLabSelectionModel = ({
  walletAccounts = [],
  activeWalletAccountId = '',
  requestedDrilldownAccountId = '',
  strategyOptions = [],
  strategyId = '',
  tradeLog = [],
  txEvents = [],
  positionEvents = []
}) => {
  // Active execution account drives realtime fills; drilldown account drives what the user inspects in the lab views.
  const activeExecutionAccount = selectActiveWalletAccount(walletAccounts, activeWalletAccountId);
  const resolvedDrilldownAccountId = resolveDrilldownWalletAccountId({
    walletAccounts,
    requestedDrilldownAccountId,
    activeWalletAccountId
  });
  const selectedDrillAccount = selectWalletAccountById(walletAccounts, resolvedDrilldownAccountId);
  const enabledAccountCount = countEnabledWalletAccounts(walletAccounts);

  const strategyMeta = selectStrategyMeta(strategyOptions, strategyId);
  const strategyLabel = strategyMeta?.label || toId(strategyId);
  const strategyDescription = strategyMeta?.description || 'No description available yet.';

  const selectedAccountTradeRows = filterRowsByAccountId(tradeLog, selectedDrillAccount?.id);
  const selectedAccountTxRows = filterRowsByAccountId(txEvents, selectedDrillAccount?.id);
  const selectedAccountPositionRows = filterRowsByAccountId(positionEvents, selectedDrillAccount?.id);
  const selectedAccountEquitySeries = buildAccountEquitySeries({
    account: selectedDrillAccount,
    positionRows: selectedAccountPositionRows,
    maxPoints: 320
  });

  const selectedStrategyTradeRows = filterTradeRowsByStrategyId(tradeLog, strategyId);
  const selectedStrategyTxRows = filterRowsByStrategyId(txEvents, strategyId);
  const selectedStrategyPositionRows = filterRowsByStrategyId(positionEvents, strategyId);
  const selectedStrategyWinRate = computeStrategyTradeWinRate(selectedStrategyTradeRows);

  return {
    activeExecutionAccount,
    resolvedDrilldownAccountId,
    selectedDrillAccount,
    enabledAccountCount,
    strategyMeta,
    strategyLabel,
    strategyDescription,
    selectedAccountTradeRows,
    selectedAccountTxRows,
    selectedAccountPositionRows,
    selectedAccountEquitySeries,
    selectedStrategyTradeRows,
    selectedStrategyTxRows,
    selectedStrategyPositionRows,
    selectedStrategyWinRate
  };
};
