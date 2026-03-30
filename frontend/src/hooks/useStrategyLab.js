import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  buildScenarioSeries,
  runBacktest,
  SCENARIO_OPTIONS,
  selectSignalRowsForMarket,
  SOURCE_OPTIONS,
  STRATEGY_OPTIONS,
  toNum
} from '../lib/strategyEngine';
import { useStrategyLabStore } from '../store/strategyLabStore';

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
  const scenarioId = useStrategyLabStore((state) => state.scenarioId);
  const marketKey = useStrategyLabStore((state) => state.marketKey);
  const intervalMs = useStrategyLabStore((state) => state.intervalMs);
  const maxAbsUnits = useStrategyLabStore((state) => state.maxAbsUnits);
  const slippageBps = useStrategyLabStore((state) => state.slippageBps);
  const cooldownMs = useStrategyLabStore((state) => state.cooldownMs);
  const runtimeSeries = useStrategyLabStore((state) => state.runtimeSeries);
  const runtimeEquity = useStrategyLabStore((state) => state.runtimeEquity);
  const wallet = useStrategyLabStore((state) => state.wallet);
  const eventLog = useStrategyLabStore((state) => state.eventLog);
  const tradeLog = useStrategyLabStore((state) => state.tradeLog);
  const backtest = useStrategyLabStore((state) => state.backtest);

  const setConfig = useStrategyLabStore((state) => state.setConfig);
  const stepRuntime = useStrategyLabStore((state) => state.stepRuntime);
  const resetRuntime = useStrategyLabStore((state) => state.resetRuntime);
  const setBacktest = useStrategyLabStore((state) => state.setBacktest);

  const markets = useMemo(() => rankMarkets(snapshot?.markets || []).slice(0, 180), [snapshot?.markets]);
  const selectedMarket = useMemo(() => {
    if (marketKey) {
      const found = markets.find((market) => market.key === marketKey);
      if (found) return found;
    }
    return markets[0] || null;
  }, [marketKey, markets]);

  const liveHistorySeries = useMemo(() => {
    if (!selectedMarket?.key) return [];
    const raw = historyByMarket?.[selectedMarket.key] || [];
    return sanitizeSeries(raw).slice(-360);
  }, [historyByMarket, selectedMarket?.key]);

  const basePrice = Math.max(
    Number(selectedMarket?.referencePrice) || Number(liveHistorySeries[liveHistorySeries.length - 1]?.price) || 100,
    0.0001
  );

  const scenarioSeries = useMemo(() => {
    return buildScenarioSeries({
      scenarioId,
      basePrice,
      length: 360,
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

  const cursorRef = useRef(0);

  useEffect(() => {
    if (marketKey) return;
    if (!selectedMarket?.key) return;
    setConfig({ marketKey: selectedMarket.key });
  }, [marketKey, selectedMarket?.key, setConfig]);

  useEffect(() => {
    cursorRef.current = 0;
    resetRuntime({ price: basePrice, preserveBacktest: true });
  }, [resetRuntime, scenarioId, selectedMarket?.key, sourceId, strategyId]);

  const buildMarketFeedPoint = useCallback(() => {
    const now = Date.now();
    const state = useStrategyLabStore.getState();
    const anchor = Number(liveHistorySeries[liveHistorySeries.length - 1]?.price) || basePrice;
    const previous = Number(state.runtimeSeries[state.runtimeSeries.length - 1]?.price) || anchor;
    const meanPull = (anchor - previous) * randBetween(0.26, 0.42);
    const noise = anchor * randBetween(-0.0012, 0.0012);
    const price = Math.max(previous + meanPull + noise, 0.000001);
    const spreadCenter = Math.max(Number(selectedMarket?.spreadBps) || 8, 0.6);
    const spread = Math.max(0.4, spreadCenter + randBetween(-2.1, 2.1));
    const volumeAnchor = Math.max(Number(selectedMarket?.totalVolume) || 500000, 1);
    const volume = Math.max(volumeAnchor * randBetween(0.0002, 0.0013), 1);
    return { t: now, price, spread, volume };
  }, [basePrice, liveHistorySeries, selectedMarket?.spreadBps, selectedMarket?.totalVolume]);

  const buildScenarioPoint = useCallback(() => {
    if (!scenarioSeries.length) return null;
    const now = Date.now();
    const index = cursorRef.current % scenarioSeries.length;
    cursorRef.current += 1;
    const seedPoint = scenarioSeries[index];
    return {
      t: now,
      price: Number(seedPoint.price) || basePrice,
      spread: Number(seedPoint.spread) || 0,
      volume: Number(seedPoint.volume) || 0
    };
  }, [basePrice, scenarioSeries]);

  const stepOnce = useCallback(
    ({ forceEvent = false, sourceLabel = '' } = {}) => {
      const point = sourceId === 'market-feed' ? buildMarketFeedPoint() : buildScenarioPoint();
      if (!point) return;
      stepRuntime({
        point,
        forceEvent,
        sourceLabel: sourceLabel || sourceId,
        signalRows: liveSignalRows,
        selectedMarket
      });
    },
    [buildMarketFeedPoint, buildScenarioPoint, liveSignalRows, selectedMarket, sourceId, stepRuntime]
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
    const historySeries = liveHistorySeries.slice(-320);
    const fallbackSeries = scenarioSeries.slice(-320);
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

  useEffect(() => {
    if (backtest) return;
    runBacktestNow();
  }, [backtest, runBacktestNow]);

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
    },
    [setConfig]
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

  const triggerManual = useCallback(() => {
    stepOnce({
      forceEvent: true,
      sourceLabel: 'manual-trigger'
    });
  }, [stepOnce]);

  const resetSession = useCallback(() => {
    resetRuntime({ price: basePrice, preserveBacktest: true });
  }, [basePrice, resetRuntime]);

  return {
    markets,
    selectedMarket,
    running,
    sourceId,
    strategyId,
    scenarioId,
    marketKey: selectedMarket?.key || '',
    intervalMs: clampInterval(intervalMs),
    maxAbsUnits,
    slippageBps,
    cooldownMs,
    runtimeSeries,
    runtimeEquity,
    wallet,
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
    changeScenario,
    changeMarket,
    changeRisk,
    triggerManual,
    resetSession,
    runBacktestNow
  };
}
