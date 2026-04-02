import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildScenarioSeries,
  evaluateStrategyQuick,
  runBacktest,
  SCENARIO_OPTIONS,
  selectSignalRowsForMarket,
  SOURCE_OPTIONS,
  STRATEGY_OPTIONS,
  toNum
} from '../lib/strategyEngine';
import { MAX_LIVE_HISTORY, MAX_TENSOR_SERIES } from '../lib/constants';
import { selectActiveWalletAccount } from '../lib/strategyLabSelectors';
import useSocketProviders from './useSocketProviders';
import { useStrategyLabStore } from '../store/strategyLabStore';
import { useStrategyToggleStore } from '../store/strategyToggleStore';

const MIN_INTERVAL_MS = 280;
const MAX_INTERVAL_MS = 5000;
const DEFAULT_INTERVAL_MS = 1200;
const MIN_BACKTEST_POINTS = 60;

const rankMarkets = (markets = []) => {
  return [...markets]
    .filter((market) => Boolean(market?.key))
    .sort((a, b) => {
      const aScore = (Number(a.totalVolume) || 0) + Math.abs(Number(a.changePct) || 0) * 900000;
      const bScore = (Number(b.totalVolume) || 0) + Math.abs(Number(b.changePct) || 0) * 900000;
      return bScore - aScore;
    });
};

const sanitizeSeries = (series = []) => {
  if (!Array.isArray(series)) return [];
  return series
    .map((point) => ({
      t: Number(point?.t) || Date.now(),
      price: Number(point?.price),
      spread: Number(point?.spread) || 0,
      volume: Number(point?.volume) || 0
    }))
    .filter((point) => Number.isFinite(point.price) && point.price > 0);
};

const randBetween = (min, max) => min + Math.random() * (max - min);

const clampInterval = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(num)));
};

export default function useStrategyLab({ snapshot, historyByMarket }) {
  const running = useStrategyLabStore((state) => state.running);
  const sourceId = useStrategyLabStore((state) => state.sourceId);
  const strategyId = useStrategyLabStore((state) => state.strategyId);
  const enabledStrategyIds = useStrategyLabStore((state) => state.enabledStrategyIds);
  const executionStrategyMode = useStrategyLabStore((state) => state.executionStrategyMode);
  const executionWalletScope = useStrategyLabStore((state) => state.executionWalletScope);
  const executionMarketScope = useStrategyLabStore((state) => state.executionMarketScope);
  const scenarioId = useStrategyLabStore((state) => state.scenarioId);
  const marketKey = useStrategyLabStore((state) => state.marketKey);
  const intervalMs = useStrategyLabStore((state) => state.intervalMs);
  const maxAbsUnits = useStrategyLabStore((state) => state.maxAbsUnits);
  const slippageBps = useStrategyLabStore((state) => state.slippageBps);
  const cooldownMs = useStrategyLabStore((state) => state.cooldownMs);
  const runtimeMarketKey = useStrategyLabStore((state) => state.runtimeMarketKey);
  const runtimeSeries = useStrategyLabStore((state) => state.runtimeSeries);
  const runtimeEquity = useStrategyLabStore((state) => state.runtimeEquity);
  const wallet = useStrategyLabStore((state) => state.wallet);
  const walletAccounts = useStrategyLabStore((state) => state.walletAccounts);
  const activeWalletAccountId = useStrategyLabStore((state) => state.activeWalletAccountId);
  const eventLog = useStrategyLabStore((state) => state.eventLog);
  const tradeLog = useStrategyLabStore((state) => state.tradeLog);
  const backtest = useStrategyLabStore((state) => state.backtest);

  const setConfig = useStrategyLabStore((state) => state.setConfig);
  const addWalletAccount = useStrategyLabStore((state) => state.addWalletAccount);
  const updateWalletAccount = useStrategyLabStore((state) => state.updateWalletAccount);
  const removeWalletAccount = useStrategyLabStore((state) => state.removeWalletAccount);
  const clearWalletAccounts = useStrategyLabStore((state) => state.clearWalletAccounts);
  const setExecutionConfig = useStrategyLabStore((state) => state.setExecutionConfig);
  const setEnabledStrategies = useStrategyLabStore((state) => state.setEnabledStrategies);
  const toggleEnabledStrategy = useStrategyLabStore((state) => state.toggleEnabledStrategy);
  const enableAllStrategies = useStrategyLabStore((state) => state.enableAllStrategies);
  const disableToPrimaryStrategy = useStrategyLabStore((state) => state.disableToPrimaryStrategy);
  const setActiveWalletAccount = useStrategyLabStore((state) => state.setActiveWalletAccount);
  const stepRuntime = useStrategyLabStore((state) => state.stepRuntime);
  const resetRuntime = useStrategyLabStore((state) => state.resetRuntime);
  const setBacktest = useStrategyLabStore((state) => state.setBacktest);
  const syncRuntimeFromToggleMap = useStrategyToggleStore((state) => state.syncRuntimeFromToggleMap);
  const syncToggleFromRuntime = useStrategyToggleStore((state) => state.syncFromRuntimeEnabledIds);

  const markets = useMemo(() => rankMarkets(snapshot?.markets || []).slice(0, 180), [snapshot?.markets]);
  const selectedMarket = useMemo(() => {
    if (marketKey) {
      const found = markets.find((market) => market.key === marketKey);
      if (found) return found;
    }
    return markets[0] || null;
  }, [marketKey, markets]);
  const marketsByKey = useMemo(() => {
    const map = new Map();
    for (const market of markets) {
      map.set(String(market.key || ''), market);
    }
    return map;
  }, [markets]);
  const runtimeMarket = useMemo(() => {
    if (!runtimeMarketKey) return selectedMarket;
    return marketsByKey.get(String(runtimeMarketKey)) || selectedMarket || null;
  }, [marketsByKey, runtimeMarketKey, selectedMarket]);

  const supportsSocketProviders = Boolean(selectedMarket) && String(selectedMarket?.assetClass || '').toLowerCase() === 'crypto';
  const socketRuntimeEnabled = sourceId === 'market-feed' && supportsSocketProviders;
  const { primaryProvider, primaryDepth } = useSocketProviders({
    market: selectedMarket,
    enabled: socketRuntimeEnabled
  });

  const liveHistorySeries = useMemo(() => {
    if (!selectedMarket?.key) return [];
    const raw = historyByMarket?.[selectedMarket.key] || [];
    return sanitizeSeries(raw).slice(-MAX_LIVE_HISTORY);
  }, [historyByMarket, selectedMarket?.key]);

  const basePrice = Math.max(
    Number(selectedMarket?.referencePrice) || Number(liveHistorySeries[liveHistorySeries.length - 1]?.price) || 100,
    0.0001
  );

  const scenarioSeries = useMemo(() => {
    return buildScenarioSeries({
      scenarioId,
      basePrice,
      length: MAX_LIVE_HISTORY,
      now: Date.now(),
      symbol: selectedMarket?.symbol || 'SIM'
    });
  }, [basePrice, scenarioId, selectedMarket?.symbol]);

  const liveSignalRows = useMemo(() => {
    return selectSignalRowsForMarket({
      snapshotSignals: snapshot?.signals || [],
      selectedMarket,
      fallbackSeries: liveHistorySeries,
      now: Date.now(),
      maxRows: 12
    });
  }, [liveHistorySeries, selectedMarket, snapshot?.signals]);

  const [marketScores, setMarketScores] = useState([]);
  const cursorRef = useRef(0);
  const scannerCursorRef = useRef(0);

  useEffect(() => {
    if (marketKey) return;
    if (!selectedMarket?.key) return;
    setConfig({ marketKey: selectedMarket.key });
  }, [marketKey, selectedMarket?.key, setConfig]);

  useEffect(() => {
    cursorRef.current = 0;
    resetRuntime({ price: basePrice, preserveBacktest: true });
  }, [resetRuntime, scenarioId, selectedMarket?.key, sourceId, strategyId, enabledStrategyIds]);

  const getHistorySeriesForMarket = useCallback(
    (market) => {
      if (!market?.key) return [];
      if (selectedMarket?.key && market.key === selectedMarket.key) return liveHistorySeries;
      const raw = historyByMarket?.[market.key] || [];
      return sanitizeSeries(raw).slice(-MAX_LIVE_HISTORY);
    },
    [historyByMarket, liveHistorySeries, selectedMarket?.key]
  );

  const scannerCandidateMarkets = useMemo(() => {
    const active = marketScores.filter((row) => row.signalAction !== 'hold');
    const pool = active.length > 0 ? active : marketScores;
    const mapped = pool.map((row) => marketsByKey.get(String(row.key || ''))).filter(Boolean);
    if (mapped.length > 0) return mapped;
    return markets.slice(0, 24);
  }, [marketScores, marketsByKey, markets]);

  const lockExecutionMarketToOpenPosition = useCallback(
    (candidateMarket) => {
      const accountsInScope =
        executionWalletScope === 'all-enabled'
          ? walletAccounts.filter((account) => account?.enabled)
          : walletAccounts.filter((account) => account?.enabled && String(account.id || '') === String(activeWalletAccountId || ''));
      const heldAccount = accountsInScope.find((account) => {
        const walletState = account?.wallet || {};
        const units = Math.abs(toNum(walletState.units, 0));
        return units > 1e-9 && Boolean(String(walletState.marketKey || ''));
      });
      if (!heldAccount) return candidateMarket;
      const heldMarket = marketsByKey.get(String(heldAccount.wallet.marketKey || ''));
      return heldMarket || candidateMarket;
    },
    [activeWalletAccountId, executionWalletScope, marketsByKey, walletAccounts]
  );

  const selectExecutionMarket = useCallback(() => {
    if (!markets.length) return selectedMarket || null;
    let candidate = selectedMarket || markets[0] || null;
    const useScannerScope = sourceId === 'market-feed' && executionMarketScope !== 'selected-market';
    if (useScannerScope) {
      if (executionMarketScope === 'scanner-top') {
        candidate = scannerCandidateMarkets[0] || candidate;
      } else if (executionMarketScope === 'scanner-rotate') {
        const pool = scannerCandidateMarkets.slice(0, Math.max(1, Math.min(16, scannerCandidateMarkets.length)));
        const index = scannerCursorRef.current % Math.max(pool.length, 1);
        scannerCursorRef.current += 1;
        candidate = pool[index] || pool[0] || candidate;
      }
    }
    return lockExecutionMarketToOpenPosition(candidate);
  }, [executionMarketScope, lockExecutionMarketToOpenPosition, markets, scannerCandidateMarkets, selectedMarket, sourceId]);

  const buildMarketFeedPoint = useCallback(
    (market) => {
      if (!market) return null;
      const now = Date.now();
      const state = useStrategyLabStore.getState();
      const marketSeriesByKey = state?.marketRuntimeSeriesByKey && typeof state.marketRuntimeSeriesByKey === 'object' ? state.marketRuntimeSeriesByKey : {};
      const marketSeries = marketSeriesByKey[market.key] || [];
      const historySeries = getHistorySeriesForMarket(market);
      const anchor = Number(historySeries[historySeries.length - 1]?.price) || Number(market.referencePrice) || Number(market.price) || basePrice;
      const previous = Number(marketSeries[marketSeries.length - 1]?.price) || anchor;

      const useProvider = Boolean(selectedMarket?.key) && market.key === selectedMarket.key;
      const providerPrice = useProvider ? Number(primaryProvider?.price) : NaN;
      const providerBid = useProvider ? Number(primaryProvider?.bid) : NaN;
      const providerAsk = useProvider ? Number(primaryProvider?.ask) : NaN;
      const providerVolume = useProvider ? Number(primaryProvider?.volume) : NaN;
      const providerHasPrice = Number.isFinite(providerPrice) && providerPrice > 0;
      const providerHasBidAsk = Number.isFinite(providerBid) && Number.isFinite(providerAsk) && providerBid > 0 && providerAsk > 0;

      let price;
      let bid = null;
      let ask = null;
      let spread;
      let volume;

      if (providerHasPrice) {
        price = providerPrice;
        bid = providerHasBidAsk ? providerBid : null;
        ask = providerHasBidAsk ? providerAsk : null;
        spread = providerHasBidAsk ? ((providerAsk - providerBid) / Math.max(providerPrice, 1e-9)) * 10000 : Math.max(Number(market?.spreadBps) || 8, 0.6);
        volume = Math.max(Number.isFinite(providerVolume) ? providerVolume : Number(market?.totalVolume) || 500000, 1);
      } else {
        const meanPull = (anchor - previous) * randBetween(0.24, 0.42);
        const noise = anchor * randBetween(-0.0013, 0.0013);
        price = Math.max(previous + meanPull + noise, 0.000001);
        const spreadCenter = Math.max(Number(market?.spreadBps) || 8, 0.6);
        spread = Math.max(0.4, spreadCenter + randBetween(-2.1, 2.1));
        const spreadAbs = (price * spread) / 10000;
        bid = Math.max(price - spreadAbs / 2, 0.0000001);
        ask = Math.max(price + spreadAbs / 2, bid + 0.0000001);
        const volumeAnchor = Math.max(Number(market?.totalVolume) || 500000, 1);
        volume = Math.max(volumeAnchor * randBetween(0.0002, 0.0013), 1);
      }

      const depth =
        useProvider && primaryDepth && ((primaryDepth.bids?.length || 0) > 0 || (primaryDepth.asks?.length || 0) > 0)
          ? {
              bids: primaryDepth.bids || [],
              asks: primaryDepth.asks || []
            }
          : null;

      return {
        t: now,
        price,
        spread: Math.max(0, spread),
        volume,
        bid,
        ask,
        depth
      };
    },
    [basePrice, getHistorySeriesForMarket, primaryDepth, primaryProvider?.ask, primaryProvider?.bid, primaryProvider?.price, primaryProvider?.volume, selectedMarket?.key]
  );

  const buildScenarioPoint = useCallback(
    (market) => {
      if (!scenarioSeries.length) return null;
      const now = Date.now();
      const index = cursorRef.current % scenarioSeries.length;
      const previousIndex = index === 0 ? scenarioSeries.length - 1 : index - 1;
      cursorRef.current += 1;
      const seedPoint = scenarioSeries[index];
      const previousSeed = scenarioSeries[previousIndex];
      const targetSeries = getHistorySeriesForMarket(market);
      const targetBase = Number(targetSeries[targetSeries.length - 1]?.price) || Number(market?.referencePrice) || basePrice;
      const seedDriftPct =
        Number(previousSeed?.price) > 0 && Number(seedPoint?.price) > 0
          ? (Number(seedPoint.price) - Number(previousSeed.price)) / Math.max(Number(previousSeed.price), 1e-9)
          : 0;
      return {
        t: now,
        price: Math.max(targetBase * (1 + seedDriftPct), 0.000001),
        spread: Math.max(0, Number(market?.spreadBps) || Number(seedPoint.spread) || 0),
        volume: Math.max(1, Number(market?.totalVolume) * randBetween(0.0001, 0.0008) || Number(seedPoint.volume) || 0)
      };
    },
    [basePrice, getHistorySeriesForMarket, scenarioSeries]
  );

  const stepOnce = useCallback(
    ({ forceEvent = false, sourceLabel = '' } = {}) => {
      const executionMarket = selectExecutionMarket();
      const point = sourceId === 'market-feed' ? buildMarketFeedPoint(executionMarket) : buildScenarioPoint(executionMarket);
      if (!point || !executionMarket) return;
      stepRuntime({
        point,
        forceEvent,
        sourceLabel: sourceLabel || sourceId,
        signalRows: liveSignalRows,
        selectedMarket: executionMarket
      });
    },
    [buildMarketFeedPoint, buildScenarioPoint, liveSignalRows, selectExecutionMarket, sourceId, stepRuntime]
  );

  useEffect(() => {
    if (!running) return undefined;
    const safeInterval = clampInterval(intervalMs);
    const timerId = setInterval(() => {
      stepOnce();
    }, safeInterval);
    return () => clearInterval(timerId);
  }, [intervalMs, running, stepOnce]);

  const runBacktestNow = useCallback(() => {
    const historySeries = liveHistorySeries.slice(-MAX_TENSOR_SERIES);
    const fallbackSeries = scenarioSeries.slice(-MAX_TENSOR_SERIES);
    const dataSeries = sourceId === 'market-feed' && historySeries.length >= MIN_BACKTEST_POINTS ? historySeries : fallbackSeries;
    const result = runBacktest({
      series: dataSeries,
      strategyId,
      signalRows: liveSignalRows,
      selectedMarket,
      startCash: 100000,
      maxAbsUnits,
      slippageBps
    });
    setBacktest({
      ...result,
      strategyId,
      sourceId,
      scenarioId,
      marketKey: selectedMarket?.key || '',
      symbol: selectedMarket?.symbol || 'SIM',
      ranAt: Date.now(),
      sampleSize: dataSeries.length
    });
  }, [
    liveHistorySeries,
    scenarioSeries,
    sourceId,
    strategyId,
    liveSignalRows,
    selectedMarket,
    maxAbsUnits,
    slippageBps,
    setBacktest,
    scenarioId,
    selectedMarket?.key,
    selectedMarket?.symbol
  ]);

  // Explicit backtest trigger key — replaces the old effect that checked
  // `if (backtest) return; runBacktestNow()` which created an infinite loop
  // when resetRuntime nulled out backtest (Effect A) causing Effect B to re-run.
  const [backtestKey, setBacktestKey] = useState(0);

  useEffect(() => {
    setBacktestKey((k) => k + 1);
  }, [selectedMarket?.key, sourceId, strategyId]);

  useEffect(() => {
    if (backtestKey === 0) return; // Skip initial mount
    if (!liveHistorySeries || liveHistorySeries.length < 2) return;
    runBacktestNow();
  }, [backtestKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    syncRuntimeFromToggleMap();
  }, [syncRuntimeFromToggleMap]);

  useEffect(() => {
    syncToggleFromRuntime(enabledStrategyIds);
  }, [enabledStrategyIds, syncToggleFromRuntime]);

  // --- Multi-market scanner ---
  const snapshotRef = useRef(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (!running) {
      setMarketScores([]);
      return undefined;
    }
    const scanMarkets = () => {
      const allMarkets = snapshotRef.current?.markets || [];
      const scores = allMarkets
        .map((market) => {
          const price = Number(market?.referencePrice) || Number(market?.price) || 0;
          if (!price || price <= 0) return null;
          const signal = evaluateStrategyQuick({ price, market, strategyId });
          return {
            key: market.key,
            symbol: market.symbol || market.key,
            assetClass: market.assetClass || '',
            price,
            changePct: toNum(market.changePct, 0),
            totalVolume: toNum(market.totalVolume, 0),
            signalScore: signal.score,
            signalAction: signal.action,
            signalReason: signal.reason,
            signalStance: signal.stance
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.signalScore - a.signalScore);
      setMarketScores(scores);
    };
    scanMarkets();
    const timer = setInterval(scanMarkets, 5000);
    return () => clearInterval(timer);
  }, [running, strategyId]);

  const setRunning = useCallback(
    (nextRunning) => {
      setConfig({ running: Boolean(nextRunning) });
    },
    [setConfig]
  );

  const toggleRunning = useCallback(() => {
    const state = useStrategyLabStore.getState();
    setConfig({ running: !state.running });
  }, [setConfig]);

  const updateInterval = useCallback(
    (value) => {
      setConfig({ intervalMs: clampInterval(value) });
    },
    [setConfig]
  );

  const changeSource = useCallback(
    (nextSourceId) => {
      setConfig({
        sourceId: nextSourceId
      });
    },
    [setConfig]
  );

  const changeStrategy = useCallback(
    (nextStrategyId) => {
      setConfig({
        strategyId: nextStrategyId
      });
      const state = useStrategyLabStore.getState();
      const existing = Array.isArray(state.enabledStrategyIds) ? state.enabledStrategyIds : [];
      if (!existing.includes(nextStrategyId)) {
        setEnabledStrategies([...existing, nextStrategyId]);
      }
    },
    [setConfig, setEnabledStrategies]
  );

  const changeEnabledStrategies = useCallback(
    (nextEnabledIds) => {
      setEnabledStrategies(nextEnabledIds);
    },
    [setEnabledStrategies]
  );

  const toggleStrategyEnabled = useCallback(
    (strategyToggleId) => {
      toggleEnabledStrategy(strategyToggleId);
    },
    [toggleEnabledStrategy]
  );

  const changeScenario = useCallback(
    (nextScenarioId) => {
      setConfig({
        scenarioId: nextScenarioId
      });
    },
    [setConfig]
  );

  const changeMarket = useCallback(
    (nextMarketKey) => {
      setConfig({
        marketKey: nextMarketKey
      });
    },
    [setConfig]
  );

  const changeRisk = useCallback(
    ({ nextMaxAbsUnits, nextSlippageBps, nextCooldownMs }) => {
      setConfig({
        maxAbsUnits: Math.max(1, Math.min(60, Math.round(toNum(nextMaxAbsUnits, maxAbsUnits)))),
        slippageBps: Math.max(0, Math.min(40, toNum(nextSlippageBps, slippageBps))),
        cooldownMs: Math.max(0, Math.min(120000, Math.round(toNum(nextCooldownMs, cooldownMs))))
      });
    },
    [cooldownMs, maxAbsUnits, setConfig, slippageBps]
  );

  const changeExecutionConfig = useCallback(
    ({ strategyMode, walletScope, marketScope } = {}) => {
      setExecutionConfig({
        strategyMode,
        walletScope,
        marketScope
      });
    },
    [setExecutionConfig]
  );

  const triggerManual = useCallback(() => {
    stepOnce({
      forceEvent: true,
      sourceLabel: 'manual-trigger'
    });
  }, [stepOnce]);

  const resetSession = useCallback(() => {
    resetRuntime({ price: basePrice, preserveBacktest: true });
  }, [basePrice, resetRuntime]);

  const activeExecutionAccount = useMemo(() => {
    return selectActiveWalletAccount(walletAccounts, activeWalletAccountId);
  }, [activeWalletAccountId, walletAccounts]);

  const activeExecutionWallet = activeExecutionAccount?.wallet || wallet;

  return {
    markets,
    selectedMarket,
    running,
    sourceId,
    strategyId,
    enabledStrategyIds,
    executionStrategyMode,
    executionWalletScope,
    executionMarketScope,
    scenarioId,
    marketKey: selectedMarket?.key || '',
    runtimeMarket,
    intervalMs: clampInterval(intervalMs),
    maxAbsUnits,
    slippageBps,
    cooldownMs,
    runtimeSeries,
    runtimeEquity,
    wallet,
    activeExecutionWallet,
    walletAccounts,
    activeWalletAccountId,
    activeExecutionAccount,
    eventLog,
    tradeLog,
    backtest,
    signalRows: liveSignalRows,
    sourceOptions: SOURCE_OPTIONS,
    strategyOptions: STRATEGY_OPTIONS,
    scenarioOptions: SCENARIO_OPTIONS,
    hasLiveHistory: liveHistorySeries.length >= MIN_BACKTEST_POINTS,
    setRunning,
    toggleRunning,
    updateInterval,
    changeSource,
    changeStrategy,
    changeEnabledStrategies,
    toggleStrategyEnabled,
    enableAllStrategies,
    disableToPrimaryStrategy,
    changeScenario,
    changeMarket,
    changeRisk,
    changeExecutionConfig,
    addWalletAccount,
    updateWalletAccount,
    removeWalletAccount,
    clearWalletAccounts,
    setActiveWalletAccount,
    triggerManual,
    resetSession,
    runBacktestNow,
    marketScores
  };
}
