// This store manages SIMULATED paper trading state — not real server execution
import { create } from 'zustand';
import { createWalletState, executeWalletAction, evaluateStrategy, markWallet, STRATEGY_OPTIONS } from '../lib/strategyEngine';
import { useExecutionFeedStore } from './executionFeedStore';
import { useCapitalStore } from './capitalStore';

// NOTE: Wallet sync to capitalStore is handled by useStoreSync() subscriber.
// Do NOT call syncWalletAccountsToCapital directly from store actions.

const MAX_RUNTIME_POINTS = 480;
const MAX_EQUITY_POINTS = 480;
const MAX_EVENTS = 280;
const MAX_TRADES = 220;
const MAX_WALLET_ACCOUNTS = 12;
const MAIN_ACCOUNT_ID = 'paper-main';
const EXECUTION_STRATEGY_MODES = new Set(['best-enabled', 'selected-only']);
const EXECUTION_WALLET_SCOPES = new Set(['active-only', 'all-enabled']);
const EXECUTION_MARKET_SCOPES = new Set(['selected-market', 'scanner-top', 'scanner-rotate']);
const STRATEGY_IDS = STRATEGY_OPTIONS.map((option) => String(option.id || '')).filter((id) => Boolean(id));
const DEFAULT_PRIMARY_STRATEGY_ID = STRATEGY_IDS.includes('tensor-lite') ? 'tensor-lite' : STRATEGY_IDS[0] || 'tensor-lite';

const sanitizeEnabledStrategyIds = (strategyIds, fallbackStrategyId = DEFAULT_PRIMARY_STRATEGY_ID) => {
  const fallback = String(fallbackStrategyId || DEFAULT_PRIMARY_STRATEGY_ID);
  const candidateIds = Array.isArray(strategyIds) ? strategyIds : [];
  const deduped = [];
  for (const rawId of candidateIds) {
    const id = String(rawId || '');
    if (!id || !STRATEGY_IDS.includes(id) || deduped.includes(id)) continue;
    deduped.push(id);
  }

  if (!deduped.includes(fallback) && STRATEGY_IDS.includes(fallback)) {
    deduped.unshift(fallback);
  }

  if (deduped.length === 0) {
    const first = STRATEGY_IDS[0] || DEFAULT_PRIMARY_STRATEGY_ID;
    return [first];
  }
  return deduped;
};

const buildSignalActionMap = (strategyIds, previous = null) => {
  const previousMap = previous && typeof previous === 'object' ? previous : {};
  const next = {};
  for (const strategyId of sanitizeEnabledStrategyIds(strategyIds)) {
    next[strategyId] = String(previousMap[strategyId] || 'hold');
  }
  return next;
};

const sameIdArray = (a = [], b = []) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (String(a[index] || '') !== String(b[index] || '')) return false;
  }
  return true;
};

const trimTail = (list, maxLength) => {
  if (list.length <= maxLength) return list;
  return list.slice(list.length - maxLength);
};

const trimHead = (list, maxLength) => {
  if (list.length <= maxLength) return list;
  return list.slice(0, maxLength);
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toTs = (value) => Math.max(0, Math.round(toNum(value, Date.now())));

const toFiniteOrNull = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const normalizeExecutionStrategyMode = (value) => {
  const next = String(value || '');
  if (EXECUTION_STRATEGY_MODES.has(next)) return next;
  return 'best-enabled';
};

const normalizeExecutionWalletScope = (value) => {
  const next = String(value || '');
  if (EXECUTION_WALLET_SCOPES.has(next)) return next;
  return 'active-only';
};

const normalizeExecutionMarketScope = (value) => {
  const next = String(value || '');
  if (EXECUTION_MARKET_SCOPES.has(next)) return next;
  return 'selected-market';
};

const sanitizeDepthSide = (levels, side) => {
  const list = Array.isArray(levels) ? levels : [];
  const mapped = list
    .map((level) => {
      if (Array.isArray(level)) {
        const price = toFiniteOrNull(level[0]);
        const size = toFiniteOrNull(level[1]);
        if (price === null || size === null || price <= 0 || size <= 0) return null;
        return { price, size };
      }
      const price = toFiniteOrNull(level?.price);
      const size = toFiniteOrNull(level?.size);
      if (price === null || size === null || price <= 0 || size <= 0) return null;
      return { price, size };
    })
    .filter((level) => Boolean(level))
    .sort((a, b) => (side === 'bid' ? b.price - a.price : a.price - b.price));
  if (mapped.length > 40) {
    mapped.length = 40;
  }
  return mapped;
};

const createWalletAccount = ({ id, name, startCash = 100000, maxAbsUnits = 10, slippageBps = 1.2, enabled = true }) => ({
  id: String(id || `paper-${Date.now()}`),
  name: String(name || 'Paper Account'),
  enabled: Boolean(enabled),
  startCash: Math.max(100, toNum(startCash, 100000)),
  maxAbsUnits: clamp(Math.round(toNum(maxAbsUnits, 10)), 1, 80),
  slippageBps: clamp(toNum(slippageBps, 1.2), 0, 60),
  wallet: createWalletState(startCash)
});

const createDefaultWalletAccounts = () => {
  return [
    createWalletAccount({
      id: MAIN_ACCOUNT_ID,
      name: 'Paper Main',
      startCash: 100000,
      maxAbsUnits: 10,
      slippageBps: 1.2,
      enabled: true
    })
  ];
};

const defaultEnabledStrategies = sanitizeEnabledStrategyIds([DEFAULT_PRIMARY_STRATEGY_ID], DEFAULT_PRIMARY_STRATEGY_ID);
const defaultSignalActionMap = buildSignalActionMap(defaultEnabledStrategies);

// syncWalletAccountsToCapital removed — wallet sync is handled by useStoreSync() subscriber in lib/storeSync.js

const baseState = {
  running: true,
  sourceId: 'local-scenario',
  strategyId: DEFAULT_PRIMARY_STRATEGY_ID,
  enabledStrategyIds: defaultEnabledStrategies,
  executionStrategyMode: 'best-enabled',
  executionWalletScope: 'active-only',
  executionMarketScope: 'selected-market',
  scenarioId: 'trend-rally',
  marketKey: '',
  intervalMs: 1200,
  maxAbsUnits: 10,
  slippageBps: 1.2,
  cooldownMs: 5000,
  runtimeMarketKey: '',
  runtimeSeries: [],
  marketRuntimeSeriesByKey: {},
  runtimeEquity: [],
  eventLog: [],
  tradeLog: [],
  walletAccounts: createDefaultWalletAccounts(),
  activeWalletAccountId: MAIN_ACCOUNT_ID,
  lastSignalAction: defaultSignalActionMap[DEFAULT_PRIMARY_STRATEGY_ID] || 'hold',
  lastSignalActionByStrategy: defaultSignalActionMap,
  wallet: createWalletState(),
  backtest: null,
  stepSequence: 0
};

export const useStrategyLabStore = create((set) => ({
  ...baseState,
  setConfig: (patch) => {
    if (!patch || typeof patch !== 'object') return;
    set((state) => ({
      ...(() => {
        const nextStrategyIdRaw = typeof patch.strategyId === 'string' ? patch.strategyId : state.strategyId;
        const nextStrategyId = STRATEGY_IDS.includes(String(nextStrategyIdRaw || '')) ? String(nextStrategyIdRaw) : state.strategyId;
        const patchEnabledIds = Array.isArray(patch.enabledStrategyIds) ? patch.enabledStrategyIds : state.enabledStrategyIds;
        const nextEnabledStrategies = sanitizeEnabledStrategyIds(patchEnabledIds, nextStrategyId || state.strategyId || DEFAULT_PRIMARY_STRATEGY_ID);
        const enabledStrategyIds = sameIdArray(nextEnabledStrategies, state.enabledStrategyIds) ? state.enabledStrategyIds : nextEnabledStrategies;
        const lastSignalActionByStrategy = buildSignalActionMap(enabledStrategyIds, state.lastSignalActionByStrategy);
        return {
          ...state,
          ...patch,
          strategyId: nextStrategyId,
          enabledStrategyIds,
          lastSignalActionByStrategy,
          lastSignalAction: lastSignalActionByStrategy[nextStrategyId] || state.lastSignalAction || 'hold'
        };
      })(),
      walletAccounts:
        typeof patch.maxAbsUnits === 'number' || typeof patch.slippageBps === 'number'
          ? state.walletAccounts.map((account) => ({
              ...account,
              maxAbsUnits: clamp(Math.round(toNum(patch.maxAbsUnits, account.maxAbsUnits)), 1, 80),
              slippageBps: clamp(toNum(patch.slippageBps, account.slippageBps), 0, 60)
            }))
          : state.walletAccounts
    }));
  },
  hardReset: () => {
    set({
      ...baseState,
      walletAccounts: createDefaultWalletAccounts(),
      activeWalletAccountId: MAIN_ACCOUNT_ID,
      wallet: createWalletState(),
      enabledStrategyIds: defaultEnabledStrategies,
      lastSignalActionByStrategy: defaultSignalActionMap,
      lastSignalAction: defaultSignalActionMap[baseState.strategyId] || 'hold'
    });
  },
  resetRuntime: ({ price, preserveBacktest = true } = {}) => {
    set((state) => {
      const walletAccounts = state.walletAccounts.map((account) => ({
        ...account,
        wallet: markWallet(createWalletState(account.startCash), price)
      }));
      const activeWallet = walletAccounts.find((account) => account.id === state.activeWalletAccountId) || walletAccounts[0];
      const wallet = activeWallet ? activeWallet.wallet : markWallet(createWalletState(), price);
      return {
        ...state,
        runtimeSeries: [],
        runtimeMarketKey: '',
        marketRuntimeSeriesByKey: {},
        runtimeEquity: [],
        eventLog: [],
        tradeLog: [],
        walletAccounts,
        lastSignalAction: 'hold',
        lastSignalActionByStrategy: buildSignalActionMap(state.enabledStrategyIds),
        wallet,
        stepSequence: 0,
        backtest: preserveBacktest ? state.backtest : null
      };
    });
  },
  clearBacktest: () =>
    set((state) => ({
      ...state,
      backtest: null
    })),
  setBacktest: (backtest) =>
    set((state) => ({
      ...state,
      backtest
    })),
  addWalletAccount: ({ name = '', startCash = 100000 } = {}) => {
    set((state) => {
      if (state.walletAccounts.length >= MAX_WALLET_ACCOUNTS) return state;
      const account = createWalletAccount({
        id: `paper-${Date.now()}-${state.walletAccounts.length}`,
        name: name || `Paper ${state.walletAccounts.length + 1}`,
        startCash,
        maxAbsUnits: state.maxAbsUnits,
        slippageBps: state.slippageBps,
        enabled: true
      });
      const walletAccounts = [...state.walletAccounts, account];
      const activeWalletAccountId = walletAccounts.some((item) => item.id === state.activeWalletAccountId) ? state.activeWalletAccountId : account.id;
      const activeWallet = walletAccounts.find((item) => item.id === activeWalletAccountId) || account;
      return {
        ...state,
        walletAccounts,
        activeWalletAccountId,
        wallet: activeWallet.wallet
      };
    });
  },
  updateWalletAccount: (accountId, patch = {}) => {
    set((state) => {
      const id = String(accountId || '');
      if (!id) return state;
      return {
        ...state,
        walletAccounts: state.walletAccounts.map((account) => {
          if (account.id !== id) return account;
          const nextName = typeof patch.name === 'string' ? patch.name.slice(0, 32) : account.name;
          const nextEnabled = typeof patch.enabled === 'boolean' ? patch.enabled : account.enabled;
          const nextMaxUnits = clamp(Math.round(toNum(patch.maxAbsUnits, account.maxAbsUnits)), 1, 80);
          const nextSlippage = clamp(toNum(patch.slippageBps, account.slippageBps), 0, 60);
          return {
            ...account,
            name: nextName || account.name,
            enabled: nextEnabled,
            maxAbsUnits: nextMaxUnits,
            slippageBps: nextSlippage
          };
        })
      };
    });
  },
  removeWalletAccount: (accountId) => {
    set((state) => {
      const id = String(accountId || '');
      if (!id) return state;
      const remaining = state.walletAccounts.filter((account) => account.id !== id);
      if (remaining.length === state.walletAccounts.length) return state;
      if (remaining.length === 0) {
        return {
          ...state,
          walletAccounts: [],
          activeWalletAccountId: '',
          wallet: createWalletState()
        };
      }
      const activeWalletAccountId = remaining.some((account) => account.id === state.activeWalletAccountId)
        ? state.activeWalletAccountId
        : remaining[0].id;
      const activeWallet = remaining.find((account) => account.id === activeWalletAccountId) || remaining[0];
      return {
        ...state,
        walletAccounts: remaining,
        activeWalletAccountId,
        wallet: activeWallet.wallet
      };
    });
  },
  clearWalletAccounts: () => {
    set((state) => ({
      ...state,
      walletAccounts: [],
      activeWalletAccountId: '',
      wallet: createWalletState()
    }));
  },
  setExecutionConfig: ({ strategyMode, walletScope, marketScope } = {}) =>
    set((state) => ({
      ...state,
      executionStrategyMode:
        typeof strategyMode === 'string' ? normalizeExecutionStrategyMode(strategyMode) : normalizeExecutionStrategyMode(state.executionStrategyMode),
      executionWalletScope:
        typeof walletScope === 'string' ? normalizeExecutionWalletScope(walletScope) : normalizeExecutionWalletScope(state.executionWalletScope),
      executionMarketScope:
        typeof marketScope === 'string' ? normalizeExecutionMarketScope(marketScope) : normalizeExecutionMarketScope(state.executionMarketScope)
    })),
  setEnabledStrategies: (strategyIds) =>
    set((state) => {
      const nextEnabledStrategies = sanitizeEnabledStrategyIds(strategyIds, state.strategyId || DEFAULT_PRIMARY_STRATEGY_ID);
      const enabledStrategyIds = sameIdArray(nextEnabledStrategies, state.enabledStrategyIds) ? state.enabledStrategyIds : nextEnabledStrategies;
      const strategyId = enabledStrategyIds.includes(state.strategyId) ? state.strategyId : enabledStrategyIds[0];
      const lastSignalActionByStrategy = buildSignalActionMap(enabledStrategyIds, state.lastSignalActionByStrategy);
      return {
        ...state,
        strategyId,
        enabledStrategyIds,
        lastSignalActionByStrategy,
        lastSignalAction: lastSignalActionByStrategy[strategyId] || 'hold'
      };
    }),
  toggleEnabledStrategy: (strategyId) =>
    set((state) => {
      const id = String(strategyId || '');
      if (!id || !STRATEGY_IDS.includes(id)) return state;
      const current = sanitizeEnabledStrategyIds(state.enabledStrategyIds, state.strategyId || DEFAULT_PRIMARY_STRATEGY_ID);
      const hasId = current.includes(id);
      const nextEnabled = hasId ? current.filter((item) => item !== id) : [...current, id];
      const nextEnabledStrategies = sanitizeEnabledStrategyIds(nextEnabled, hasId ? state.strategyId : id);
      const enabledStrategyIds = sameIdArray(nextEnabledStrategies, state.enabledStrategyIds) ? state.enabledStrategyIds : nextEnabledStrategies;
      const nextStrategyId = enabledStrategyIds.includes(state.strategyId) ? state.strategyId : enabledStrategyIds[0];
      const lastSignalActionByStrategy = buildSignalActionMap(enabledStrategyIds, state.lastSignalActionByStrategy);
      return {
        ...state,
        strategyId: nextStrategyId,
        enabledStrategyIds,
        lastSignalActionByStrategy,
        lastSignalAction: lastSignalActionByStrategy[nextStrategyId] || 'hold'
      };
    }),
  enableAllStrategies: () =>
    set((state) => {
      const nextEnabledStrategies = sanitizeEnabledStrategyIds(STRATEGY_IDS, state.strategyId || DEFAULT_PRIMARY_STRATEGY_ID);
      const enabledStrategyIds = sameIdArray(nextEnabledStrategies, state.enabledStrategyIds) ? state.enabledStrategyIds : nextEnabledStrategies;
      const strategyId = enabledStrategyIds.includes(state.strategyId) ? state.strategyId : enabledStrategyIds[0];
      const lastSignalActionByStrategy = buildSignalActionMap(enabledStrategyIds, state.lastSignalActionByStrategy);
      return {
        ...state,
        strategyId,
        enabledStrategyIds,
        lastSignalActionByStrategy,
        lastSignalAction: lastSignalActionByStrategy[strategyId] || 'hold'
      };
    }),
  disableToPrimaryStrategy: () =>
    set((state) => {
      const strategyId = STRATEGY_IDS.includes(state.strategyId) ? state.strategyId : DEFAULT_PRIMARY_STRATEGY_ID;
      const nextEnabledStrategies = sanitizeEnabledStrategyIds([strategyId], strategyId);
      const enabledStrategyIds = sameIdArray(nextEnabledStrategies, state.enabledStrategyIds) ? state.enabledStrategyIds : nextEnabledStrategies;
      const lastSignalActionByStrategy = buildSignalActionMap(enabledStrategyIds, state.lastSignalActionByStrategy);
      return {
        ...state,
        strategyId,
        enabledStrategyIds,
        lastSignalActionByStrategy,
        lastSignalAction: lastSignalActionByStrategy[strategyId] || 'hold'
      };
    }),
  setActiveWalletAccount: (accountId) => {
    set((state) => {
      const id = String(accountId || '');
      if (!id) return state;
      const activeWallet = state.walletAccounts.find((account) => account.id === id);
      if (!activeWallet) return state;
      return {
        ...state,
        activeWalletAccountId: id,
        wallet: activeWallet.wallet
      };
    });
  },
  stepRuntime: ({ point, sourceLabel = '', forceEvent = false, signalRows = [], selectedMarket = null }) =>
    {
      const emitPayloads = [];
      const emitPositionPayloads = [];
      let executedMarketKey = '';
      set((state) => {
        if (!point || !Number.isFinite(Number(point.price))) return state;

        const stepSequence = state.stepSequence + 1;
        const timestamp = Number(point.t) || Date.now();
        const bid = toFiniteOrNull(point?.bid);
        const ask = toFiniteOrNull(point?.ask);
        const depthBids = sanitizeDepthSide(point?.depth?.bids, 'bid');
        const depthAsks = sanitizeDepthSide(point?.depth?.asks, 'ask');
        const normalizedDepth = depthBids.length > 0 || depthAsks.length > 0 ? { bids: depthBids, asks: depthAsks } : null;
        const normalizedPoint = {
          t: timestamp,
          price: Number(point.price),
          spread: Number(point.spread) || 0,
          volume: Number(point.volume) || 0,
          bid,
          ask,
          depth: normalizedDepth
        };

        const runtimeMarketKey = String(selectedMarket?.key || state.marketKey || '');
        const runtimeMarketSymbol = String(selectedMarket?.symbol || '');
        const runtimeMarketAssetClass = String(selectedMarket?.assetClass || '');
        executedMarketKey = runtimeMarketKey;
        const marketRuntimeSeriesByKey = state.marketRuntimeSeriesByKey && typeof state.marketRuntimeSeriesByKey === 'object' ? { ...state.marketRuntimeSeriesByKey } : {};
        const previousRuntimeSeries = runtimeMarketKey ? marketRuntimeSeriesByKey[runtimeMarketKey] || [] : state.runtimeSeries;
        const runtimeSeries = trimTail([...previousRuntimeSeries, normalizedPoint], MAX_RUNTIME_POINTS);
        if (runtimeMarketKey) {
          marketRuntimeSeriesByKey[runtimeMarketKey] = runtimeSeries;
        }
        const normalizedEnabledStrategies = sanitizeEnabledStrategyIds(state.enabledStrategyIds, state.strategyId || DEFAULT_PRIMARY_STRATEGY_ID);
        const enabledStrategyIds = sameIdArray(normalizedEnabledStrategies, state.enabledStrategyIds) ? state.enabledStrategyIds : normalizedEnabledStrategies;
        const strategySignals = enabledStrategyIds.map((strategyId) => ({
          strategyId,
          ...evaluateStrategy({
            strategyId,
            series: runtimeSeries,
            signalRows,
            selectedMarket
          })
        }));
        const primarySignal =
          strategySignals.find((signal) => signal.strategyId === state.strategyId) ||
          strategySignals[0] || {
            strategyId: state.strategyId || DEFAULT_PRIMARY_STRATEGY_ID,
            action: 'hold',
            score: 0,
            stance: 'neutral',
            reason: 'No strategy enabled',
            signalCount: 0,
            triggerKind: 'price'
          };
        const activeSignals = strategySignals.filter((signal) => signal.action !== 'hold');
        const executionStrategyMode = normalizeExecutionStrategyMode(state.executionStrategyMode);
        const executionSignal =
          executionStrategyMode === 'selected-only'
            ? primarySignal
            : activeSignals.length > 0
              ? activeSignals.reduce((best, current) => (Math.abs(Number(current.score) || 0) > Math.abs(Number(best.score) || 0) ? current : best), activeSignals[0])
              : primarySignal;

        const activeWalletSeed =
          state.walletAccounts.find((account) => account.id === state.activeWalletAccountId) ||
          state.walletAccounts.find((account) => account.id === MAIN_ACCOUNT_ID) ||
          state.walletAccounts[0] ||
          null;
        const activeWalletTargetId = String(activeWalletSeed?.id || '');
        const executionWalletScope = normalizeExecutionWalletScope(state.executionWalletScope);
        const executionMarketScope = normalizeExecutionMarketScope(state.executionMarketScope);

        const accountTrades = [];
        const walletAccounts = state.walletAccounts.map((account, accountIndex) => {
          const accountId = String(account.id || '');
          const inExecutionScope = executionWalletScope === 'all-enabled' ? account.enabled : accountId === activeWalletTargetId && account.enabled;
          const accountWallet = account.wallet || createWalletState();
          const heldMarketKey = String(accountWallet.marketKey || '');
          const heldMarketSymbol = String(accountWallet.symbol || '');
          const heldMarketAssetClass = String(accountWallet.assetClass || '');
          const hasOpenUnits = Math.abs(toNum(accountWallet.units, 0)) > 1e-9;
          const hasMarketMismatch = hasOpenUnits && Boolean(heldMarketKey) && Boolean(runtimeMarketKey) && heldMarketKey !== runtimeMarketKey;
          const positionMarket = hasMarketMismatch
            ? {
                key: heldMarketKey,
                symbol: heldMarketSymbol || heldMarketKey,
                assetClass: heldMarketAssetClass || 'unknown'
              }
            : selectedMarket
              ? {
                  key: runtimeMarketKey,
                  symbol: runtimeMarketSymbol,
                  assetClass: runtimeMarketAssetClass
                }
              : null;

          if (!inExecutionScope) {
            const markPrice = hasMarketMismatch ? toNum(accountWallet.markPrice, toNum(accountWallet.avgEntry, normalizedPoint.price)) : normalizedPoint.price;
            const markedWallet = markWallet(accountWallet, markPrice);
            const shouldEmitPositionSnapshot = accountId === activeWalletTargetId || Math.abs(toNum(markedWallet?.units, 0)) > 1e-9;
            if (shouldEmitPositionSnapshot) {
              emitPositionPayloads.push({
                wallet: markedWallet,
                signal: executionSignal,
                point: normalizedPoint,
                strategyId: executionSignal.strategyId,
                sourceId: sourceLabel || state.sourceId,
                action: 'hold',
                reason: account.enabled ? 'wallet out of execution scope' : 'wallet paused',
                market: positionMarket,
                account: {
                  id: account.id,
                  name: account.name
                },
                timestamp: timestamp + accountIndex
              });
            }
            return {
              ...account,
              wallet: markedWallet
            };
          }

          if (hasMarketMismatch) {
            const markPrice = toNum(accountWallet.markPrice, toNum(accountWallet.avgEntry, normalizedPoint.price));
            const markedWallet = markWallet(accountWallet, markPrice);
            emitPositionPayloads.push({
              wallet: markedWallet,
              signal: executionSignal,
              point: normalizedPoint,
              strategyId: executionSignal.strategyId,
              sourceId: sourceLabel || state.sourceId,
              action: 'hold',
              reason: `holding ${heldMarketSymbol || heldMarketKey} while runtime tick is ${runtimeMarketSymbol || runtimeMarketKey}`,
              market: positionMarket,
              account: {
                id: account.id,
                name: account.name
              },
              timestamp: timestamp + accountIndex
            });
            return {
              ...account,
              wallet: markedWallet
            };
          }

          const maxAbsUnits = clamp(Math.round(toNum(account.maxAbsUnits, state.maxAbsUnits)), 1, 80);
          const slippageBps = clamp(toNum(account.slippageBps, state.slippageBps), 0, 60);
          const execution = executeWalletAction({
            wallet: accountWallet,
            action: executionSignal.action,
            point: normalizedPoint,
            timestamp: timestamp + accountIndex,
            reason: executionSignal.reason,
            score: executionSignal.score,
            maxAbsUnits,
            cooldownMs: state.cooldownMs,
            slippageBps
          });

          let nextWallet = markWallet(execution.wallet, normalizedPoint.price);
          if (Math.abs(toNum(nextWallet.units, 0)) > 1e-9) {
            nextWallet = {
              ...nextWallet,
              marketKey: runtimeMarketKey,
              symbol: runtimeMarketSymbol,
              assetClass: runtimeMarketAssetClass
            };
          } else {
            nextWallet = {
              ...nextWallet,
              marketKey: '',
              symbol: '',
              assetClass: ''
            };
          }
          if (execution.trade) {
            const trade = {
              ...execution.trade,
              accountId: account.id,
              accountName: account.name,
              strategyId: executionSignal.strategyId,
              sourceId: sourceLabel || state.sourceId,
              marketKey: runtimeMarketKey,
              symbol: runtimeMarketSymbol,
              assetClass: runtimeMarketAssetClass
            };
            accountTrades.push(trade);
            emitPayloads.push({
              trade,
              wallet: nextWallet,
              signal: executionSignal,
              point: normalizedPoint,
              strategyId: executionSignal.strategyId,
              sourceId: sourceLabel || state.sourceId,
              market: positionMarket,
              account: {
                id: account.id,
                name: account.name
              }
            });
          }

          const shouldEmitPositionSnapshot = accountId === activeWalletTargetId || Boolean(execution.trade) || Math.abs(toNum(nextWallet?.units, 0)) > 1e-9;
          if (shouldEmitPositionSnapshot) {
            emitPositionPayloads.push({
              wallet: nextWallet,
              signal: executionSignal,
              point: normalizedPoint,
              strategyId: executionSignal.strategyId,
              sourceId: sourceLabel || state.sourceId,
              action: execution.trade?.action || executionSignal.action || 'hold',
              reason: execution.trade?.reason || executionSignal.reason || '',
              market: positionMarket,
              account: {
                id: account.id,
                name: account.name
              },
              timestamp: timestamp + accountIndex
            });
          }

          return {
            ...account,
            wallet: nextWallet
          };
        });

        const activeWallet =
          walletAccounts.find((account) => account.id === state.activeWalletAccountId) ||
          walletAccounts.find((account) => account.id === MAIN_ACCOUNT_ID) ||
          walletAccounts[0];
        const primaryWallet = activeWallet ? activeWallet.wallet : createWalletState();

        const runtimeEquity = trimTail([...state.runtimeEquity, primaryWallet.equity], MAX_EQUITY_POINTS);
        const previousSignalMap = state.lastSignalActionByStrategy && typeof state.lastSignalActionByStrategy === 'object' ? state.lastSignalActionByStrategy : {};
        const changedStrategies = strategySignals.filter((signal) => signal.action !== String(previousSignalMap[signal.strategyId] || 'hold'));
        const shouldEmitEvent = forceEvent || changedStrategies.length > 0 || accountTrades.length > 0;
        const tradedAccountIds = [...new Set(accountTrades.map((trade) => String(trade.accountId || '')).filter((id) => Boolean(id)))];
        const tradedAccounts = [...new Set(accountTrades.map((trade) => String(trade.accountName || '').trim()).filter((name) => Boolean(name)))];
        const nextSignalActionMap = buildSignalActionMap(enabledStrategyIds, previousSignalMap);
        for (const signal of strategySignals) {
          nextSignalActionMap[signal.strategyId] = signal.action;
        }

        const eventLog = shouldEmitEvent
          ? trimHead(
              [
                {
                  id: `event:${timestamp}:${stepSequence}`,
                  timestamp,
                  action: executionSignal.action,
                  stance: executionSignal.stance,
                  score: executionSignal.score,
                  reason: executionSignal.reason,
                  price: normalizedPoint.price,
                  spread: normalizedPoint.spread,
                  source: sourceLabel || state.sourceId,
                  traded: accountTrades.length > 0,
                  accountId: tradedAccountIds[0] || '',
                  accountName: tradedAccounts[0] || '',
                  tradedAccountIds,
                  tradedAccounts,
                  signalCount: Number(executionSignal.signalCount) || 0,
                  triggerKind: executionSignal.triggerKind || 'price',
                  strategyId: executionSignal.strategyId,
                  marketKey: runtimeMarketKey,
                  symbol: runtimeMarketSymbol,
                  assetClass: runtimeMarketAssetClass,
                  executionStrategyMode,
                  executionWalletScope,
                  executionMarketScope,
                  enabledStrategies: enabledStrategyIds,
                  changedStrategies: changedStrategies.map((signal) => signal.strategyId)
                },
                ...state.eventLog
              ],
              MAX_EVENTS
            )
          : state.eventLog;

        const tradeLog =
          accountTrades.length > 0 ? trimHead([...accountTrades.sort((a, b) => b.timestamp - a.timestamp), ...state.tradeLog], MAX_TRADES) : state.tradeLog;

        const nextStrategyId = enabledStrategyIds.includes(state.strategyId) ? state.strategyId : enabledStrategyIds[0];

        return {
          ...state,
          runtimeMarketKey,
          runtimeSeries,
          marketRuntimeSeriesByKey,
          runtimeEquity,
          eventLog,
          tradeLog,
          walletAccounts,
          wallet: primaryWallet,
          strategyId: nextStrategyId,
          enabledStrategyIds,
          executionStrategyMode,
          executionWalletScope,
          executionMarketScope,
          lastSignalActionByStrategy: nextSignalActionMap,
          lastSignalAction: nextSignalActionMap[nextStrategyId] || executionSignal.action || 'hold',
          stepSequence
        };
      });

      const nextState = useStrategyLabStore.getState();
      const activeMarketId = executedMarketKey || nextState.runtimeMarketKey || nextState.marketKey || '';
      if (activeMarketId) {
        const tensorPoint = {
          t: toTs(point?.t || Date.now()),
          price: toNum(point?.price, 0),
          spreadBps: toNum(point?.spread, 0),
          volume: toNum(point?.volume, 0),
          strategyId: nextState.strategyId,
          action: nextState.lastSignalAction,
          source: sourceLabel || nextState.sourceId || 'strategy-runtime'
        };
        useCapitalStore.getState().appendTensorSlice({
          marketId: activeMarketId,
          slice: tensorPoint
        });

        const depthBids = sanitizeDepthSide(point?.depth?.bids, 'bid');
        const depthAsks = sanitizeDepthSide(point?.depth?.asks, 'ask');
        if (depthBids.length > 0 || depthAsks.length > 0) {
          const bidPressure = depthBids.reduce((sum, level) => sum + toNum(level?.size, 0), 0);
          const askPressure = depthAsks.reduce((sum, level) => sum + toNum(level?.size, 0), 0);
          const imbalance = bidPressure + askPressure > 0 ? (bidPressure - askPressure) / (bidPressure + askPressure) : 0;
          useCapitalStore.getState().appendMarketImageSlice({
            marketId: activeMarketId,
            slice: {
              t: tensorPoint.t,
              source: 'strategy-runtime-depth',
              aggregate: {
                imbalance,
                bidPressure,
                askPressure
              },
              depth: {
                bids: depthBids,
                asks: depthAsks
              }
            }
          });
        }
      }

      if (emitPayloads.length > 0) {
        const feed = useExecutionFeedStore.getState();
        for (const payload of emitPayloads) {
          feed.emitStrategyExecution(payload);
        }
      }
      if (emitPositionPayloads.length > 0) {
        const feed = useExecutionFeedStore.getState();
        for (const payload of emitPositionPayloads) {
          feed.emitWalletPositionSnapshot(payload);
        }
      }
    }
}));

// Initial wallet sync is handled by useStoreSync() subscriber in lib/storeSync.js
