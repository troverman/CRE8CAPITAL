import { create } from 'zustand';
import { createWalletState, executeWalletAction, evaluateStrategy, markWallet } from '../lib/strategyEngine';
import { useExecutionFeedStore } from './executionFeedStore';

const MAX_RUNTIME_POINTS = 480;
const MAX_EQUITY_POINTS = 480;
const MAX_EVENTS = 280;
const MAX_TRADES = 220;
const MAX_WALLET_ACCOUNTS = 12;
const MAIN_ACCOUNT_ID = 'paper-main';

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

const baseState = {
  running: true,
  sourceId: 'local-scenario',
  strategyId: 'tensor-lite',
  scenarioId: 'trend-rally',
  marketKey: '',
  intervalMs: 1200,
  maxAbsUnits: 10,
  slippageBps: 1.2,
  cooldownMs: 5000,
  runtimeSeries: [],
  runtimeEquity: [],
  eventLog: [],
  tradeLog: [],
  walletAccounts: createDefaultWalletAccounts(),
  activeWalletAccountId: MAIN_ACCOUNT_ID,
  lastSignalAction: 'hold',
  wallet: createWalletState(),
  backtest: null,
  stepSequence: 0
};

export const useStrategyLabStore = create((set) => ({
  ...baseState,
  setConfig: (patch) => {
    if (!patch || typeof patch !== 'object') return;
    set((state) => ({
      ...state,
      ...patch,
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
  hardReset: () =>
    set({
      ...baseState,
      walletAccounts: createDefaultWalletAccounts(),
      activeWalletAccountId: MAIN_ACCOUNT_ID,
      wallet: createWalletState()
    }),
  resetRuntime: ({ price, preserveBacktest = true } = {}) =>
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
        runtimeEquity: [],
        eventLog: [],
        tradeLog: [],
        walletAccounts,
        lastSignalAction: 'hold',
        wallet,
        stepSequence: 0,
        backtest: preserveBacktest ? state.backtest : null
      };
    }),
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
  addWalletAccount: ({ name = '', startCash = 100000 } = {}) =>
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
    }),
  updateWalletAccount: (accountId, patch = {}) =>
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
    }),
  removeWalletAccount: (accountId) =>
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
    }),
  clearWalletAccounts: () =>
    set((state) => ({
      ...state,
      walletAccounts: [],
      activeWalletAccountId: '',
      wallet: createWalletState()
    })),
  setActiveWalletAccount: (accountId) =>
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
    }),
  stepRuntime: ({ point, sourceLabel = '', forceEvent = false, signalRows = [], selectedMarket = null }) =>
    {
      const emitPayloads = [];
      set((state) => {
        if (!point || !Number.isFinite(Number(point.price))) return state;

        const stepSequence = state.stepSequence + 1;
        const timestamp = Number(point.t) || Date.now();
        const normalizedPoint = {
          t: timestamp,
          price: Number(point.price),
          spread: Number(point.spread) || 0,
          volume: Number(point.volume) || 0
        };

        const runtimeSeries = trimTail([...state.runtimeSeries, normalizedPoint], MAX_RUNTIME_POINTS);
        const signal = evaluateStrategy({
          strategyId: state.strategyId,
          series: runtimeSeries,
          signalRows,
          selectedMarket
        });

        const accountTrades = [];
        const walletAccounts = state.walletAccounts.map((account, accountIndex) => {
          if (!account.enabled) {
            return {
              ...account,
              wallet: markWallet(account.wallet, normalizedPoint.price)
            };
          }

          const maxAbsUnits = clamp(Math.round(toNum(account.maxAbsUnits, state.maxAbsUnits)), 1, 80);
          const slippageBps = clamp(toNum(account.slippageBps, state.slippageBps), 0, 60);
          const execution = executeWalletAction({
            wallet: account.wallet,
            action: signal.action,
            point: normalizedPoint,
            timestamp: timestamp + accountIndex,
            reason: signal.reason,
            score: signal.score,
            maxAbsUnits,
            cooldownMs: state.cooldownMs,
            slippageBps
          });

          const nextWallet = markWallet(execution.wallet, normalizedPoint.price);
          if (execution.trade) {
            const trade = {
              ...execution.trade,
              accountId: account.id,
              accountName: account.name,
              strategyId: state.strategyId,
              sourceId: sourceLabel || state.sourceId,
              marketKey: selectedMarket?.key || '',
              symbol: selectedMarket?.symbol || '',
              assetClass: selectedMarket?.assetClass || ''
            };
            accountTrades.push(trade);
            emitPayloads.push({
              trade,
              wallet: nextWallet,
              signal,
              point: normalizedPoint,
              strategyId: state.strategyId,
              sourceId: sourceLabel || state.sourceId,
              market: selectedMarket
                ? {
                    key: selectedMarket.key,
                    symbol: selectedMarket.symbol,
                    assetClass: selectedMarket.assetClass
                  }
                : null,
              account: {
                id: account.id,
                name: account.name
              }
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
        const changedSignal = signal.action !== state.lastSignalAction;
        const shouldEmitEvent = forceEvent || changedSignal || accountTrades.length > 0;

        const eventLog = shouldEmitEvent
          ? trimHead(
              [
                {
                  id: `event:${timestamp}:${stepSequence}`,
                  timestamp,
                  action: signal.action,
                  stance: signal.stance,
                  score: signal.score,
                  reason: signal.reason,
                  price: normalizedPoint.price,
                  spread: normalizedPoint.spread,
                  source: sourceLabel || state.sourceId,
                  traded: accountTrades.length > 0,
                  tradedAccounts: accountTrades.map((trade) => trade.accountName),
                  signalCount: Number(signal.signalCount) || 0,
                  triggerKind: signal.triggerKind || 'price'
                },
                ...state.eventLog
              ],
              MAX_EVENTS
            )
          : state.eventLog;

        const tradeLog =
          accountTrades.length > 0 ? trimHead([...accountTrades.sort((a, b) => b.timestamp - a.timestamp), ...state.tradeLog], MAX_TRADES) : state.tradeLog;

        return {
          ...state,
          runtimeSeries,
          runtimeEquity,
          eventLog,
          tradeLog,
          walletAccounts,
          wallet: primaryWallet,
          lastSignalAction: signal.action,
          stepSequence
        };
      });

      if (emitPayloads.length > 0) {
        const feed = useExecutionFeedStore.getState();
        for (const payload of emitPayloads) {
          feed.emitStrategyExecution(payload);
        }
      }
    }
}));
