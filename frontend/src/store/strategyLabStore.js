import { create } from 'zustand';
import { createWalletState, executeWalletAction, evaluateStrategy, markWallet } from '../lib/strategyEngine';
import { useExecutionFeedStore } from './executionFeedStore';

const MAX_RUNTIME_POINTS = 480;
const MAX_EQUITY_POINTS = 480;
const MAX_EVENTS = 280;
const MAX_TRADES = 220;

const trimTail = (list, maxLength) => {
  if (list.length <= maxLength) return list;
  return list.slice(list.length - maxLength);
};

const trimHead = (list, maxLength) => {
  if (list.length <= maxLength) return list;
  return list.slice(0, maxLength);
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
      ...patch
    }));
  },
  hardReset: () =>
    set({
      ...baseState,
      wallet: createWalletState()
    }),
  resetRuntime: ({ price, preserveBacktest = true } = {}) =>
    set((state) => {
      const wallet = markWallet(createWalletState(), price);
      return {
        ...state,
        runtimeSeries: [],
        runtimeEquity: [],
        eventLog: [],
        tradeLog: [],
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
  stepRuntime: ({ point, sourceLabel = '', forceEvent = false, signalRows = [], selectedMarket = null }) =>
    {
      let emitPayload = null;
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

        const execution = executeWalletAction({
          wallet: state.wallet,
          action: signal.action,
          point: normalizedPoint,
          timestamp,
          reason: signal.reason,
          score: signal.score,
          maxAbsUnits: state.maxAbsUnits,
          cooldownMs: state.cooldownMs,
          slippageBps: state.slippageBps
        });

        const runtimeEquity = trimTail([...state.runtimeEquity, execution.wallet.equity], MAX_EQUITY_POINTS);
        const changedSignal = signal.action !== state.lastSignalAction;
        const shouldEmitEvent = forceEvent || changedSignal || Boolean(execution.trade);

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
                  traded: Boolean(execution.trade),
                  signalCount: Number(signal.signalCount) || 0,
                  triggerKind: signal.triggerKind || 'price'
                },
                ...state.eventLog
              ],
              MAX_EVENTS
            )
          : state.eventLog;

        const tradeLog = execution.trade ? trimHead([execution.trade, ...state.tradeLog], MAX_TRADES) : state.tradeLog;

        if (execution.trade) {
          emitPayload = {
            trade: execution.trade,
            wallet: execution.wallet,
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
              : null
          };
        }

        return {
          ...state,
          runtimeSeries,
          runtimeEquity,
          eventLog,
          tradeLog,
          wallet: execution.wallet,
          lastSignalAction: signal.action,
          stepSequence
        };
      });

      if (emitPayload) {
        useExecutionFeedStore.getState().emitStrategyExecution(emitPayload);
      }
    }
}));
