import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import LineChart from '../components/LineChart';
import RuntimeExecutionControls from '../components/RuntimeExecutionControls';
import WalletAccountSelectField from '../components/WalletAccountSelectField';
import useStrategyLab from '../hooks/useStrategyLab';
import { fmtInt, fmtNum, fmtPct, fmtTime } from '../lib/format';
import { buildClassicAnalysis } from '../lib/indicators';
import { getStrategyImplementationDetail } from '../lib/strategyEngine';
import {
  buildMarketImageSnapshot,
  buildMarketTensorSnapshot,
  buildPdfBuckets,
  buildTensorPdfFromHistory,
  createPdfPortfolioState,
  markPdfPortfolio,
  PDF_HORIZONS,
  rankMarketsByPdf,
  rankMarketsByTensorPdf,
  simulatePdfPortfolioCycle
} from '../lib/probabilityLab';
import { Link } from '../lib/router';
import { buildStrategyLabSelectionModel } from '../lib/strategyLabSelectors';
import { useExecutionFeedStore } from '../store/executionFeedStore';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toneClass = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return '';
  return num > 0 ? 'up' : 'down';
};

const actionClass = (action) => {
  if (action === 'accumulate' || action === 'buy') return 'up';
  if (action === 'reduce' || action === 'sell') return 'down';
  return '';
};

const buildMarketImageCellStyle = (value, maxAbs) => {
  const safeMax = Math.max(toNum(maxAbs, 0), 0.00001);
  const signed = toNum(value, 0);
  const intensity = clamp(Math.abs(signed) / safeMax, 0, 1);
  const hue = signed >= 0 ? 156 : 352;
  const sat = 48 + intensity * 36;
  const lightA = 8 + intensity * 22;
  const lightB = 6 + intensity * 10;
  const alphaA = 0.22 + intensity * 0.62;
  const borderAlpha = 0.16 + intensity * 0.58;

  return {
    background: `linear-gradient(160deg, hsla(${hue}, ${sat}%, ${lightA}%, ${alphaA}), hsla(${hue}, ${Math.max(24, sat - 16)}%, ${lightB}%, 0.9))`,
    borderColor: `hsla(${hue}, 82%, 72%, ${borderAlpha})`
  };
};

const fmtSigned = (value, digits = 2) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return `${num > 0 ? '+' : ''}${num.toFixed(digits)}`;
};

const findNearestPointIndexByTime = (rows, targetTime) => {
  if (!rows.length) return -1;
  let low = 0;
  let high = rows.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid].t < targetTime) low = mid + 1;
    else high = mid;
  }

  const right = low;
  const left = Math.max(0, right - 1);
  if (right >= rows.length) return rows.length - 1;
  return Math.abs(rows[right].t - targetTime) < Math.abs(rows[left].t - targetTime) ? right : left;
};

const STRATEGY_LAB_TABS = [
  { id: 'runtime', label: 'Runtime' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'solver', label: 'Solver' },
  { id: 'backtest', label: 'Backtest' }
];

const normalizeSeriesToPct = (series = []) => {
  const normalized = Array.isArray(series)
    ? series.map((value) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
      })
    : [];
  const first = normalized.find((value) => value !== null);
  if (!Number.isFinite(first) || Math.abs(first) < 1e-12) return normalized.map(() => null);
  return normalized.map((value) => (value === null ? null : ((value - first) / Math.abs(first)) * 100));
};

const seriesPointCount = (series = []) => {
  if (!Array.isArray(series)) return 0;
  return series.reduce((count, value) => (Number.isFinite(value) ? count + 1 : count), 0);
};

export default function StrategyLabPage({ snapshot, historyByMarket }) {
  const txEvents = useExecutionFeedStore((state) => state.txEvents);
  const positionEvents = useExecutionFeedStore((state) => state.positionEvents);
  const clearExecutionFeed = useExecutionFeedStore((state) => state.clearExecutionFeed);

  const {
    markets,
    selectedMarket,
    running,
    sourceId,
    strategyId,
    enabledStrategyIds,
    executionStrategyMode,
    executionWalletScope,
    scenarioId,
    intervalMs,
    maxAbsUnits,
    slippageBps,
    cooldownMs,
    runtimeSeries,
    runtimeEquity,
    activeExecutionWallet,
    activeExecutionAccount,
    walletAccounts,
    activeWalletAccountId,
    eventLog,
    tradeLog,
    backtest,
    signalRows,
    sourceOptions,
    strategyOptions,
    scenarioOptions,
    hasLiveHistory,
    toggleRunning,
    updateInterval,
    changeSource,
    changeEnabledStrategies,
    toggleStrategyEnabled,
    enableAllStrategies,
    disableToPrimaryStrategy,
    changeScenario,
    changeMarket,
    changeRisk,
    changeExecutionConfig,
    setActiveWalletAccount,
    triggerManual,
    resetSession,
    runBacktestNow
  } = useStrategyLab({
    snapshot,
    historyByMarket
  });

  const runtimePriceSeries = runtimeSeries.map((point) => point.price);
  const runtimeSpreadSeries = runtimeSeries.map((point) => point.spread);
  const backtestEquitySeries = backtest?.equitySeries || [];
  const runtimeClassic = useMemo(() => {
    return buildClassicAnalysis(runtimePriceSeries, {
      fastPeriod: 20,
      slowPeriod: 50,
      emaPeriod: 21,
      bbPeriod: 20,
      bbMultiplier: 2
    });
  }, [runtimePriceSeries]);
  const runtimeTaOverlays = useMemo(() => {
    return [
      {
        key: 'lab-sma-fast',
        label: `SMA${runtimeClassic.periods.fastPeriod}`,
        points: runtimeClassic.series.smaFast,
        stroke: '#98b4ff',
        strokeWidth: 1.5
      },
      {
        key: 'lab-ema',
        label: `EMA${runtimeClassic.periods.emaPeriod}`,
        points: runtimeClassic.series.ema,
        stroke: '#62ffcc',
        strokeWidth: 1.6
      },
      {
        key: 'lab-bb-upper',
        label: `BB Upper ${runtimeClassic.periods.bbPeriod}`,
        points: runtimeClassic.series.bbUpper,
        stroke: '#ffb372',
        strokeWidth: 1.35,
        dasharray: '6 5'
      },
      {
        key: 'lab-bb-lower',
        label: `BB Lower ${runtimeClassic.periods.bbPeriod}`,
        points: runtimeClassic.series.bbLower,
        stroke: '#ff87b1',
        strokeWidth: 1.35,
        dasharray: '6 5'
      }
    ];
  }, [runtimeClassic]);
  const backtestStats = backtest?.stats || {
    pnl: 0,
    returnPct: 0,
    tradeCount: 0,
    winRatePct: 0,
    maxDrawdownPct: 0,
    endEquity: 100000
  };
  const backtestTrades = backtest?.tradeLog || [];
  const backtestSignals = backtest?.signalLog || [];
  const [solverTopN, setSolverTopN] = useState(4);
  const [solverHorizon, setSolverHorizon] = useState(3);
  const [solverMinConfidence, setSolverMinConfidence] = useState(45);
  const [solverFeeBps, setSolverFeeBps] = useState(8);
  const [solverMode, setSolverMode] = useState('tensor');
  const [solverAuto, setSolverAuto] = useState(false);
  const [solverPortfolio, setSolverPortfolio] = useState(() => createPdfPortfolioState({ startCash: 100000 }));
  const [solverOrderLog, setSolverOrderLog] = useState([]);
  const [tensorHistory, setTensorHistory] = useState([]);
  const [labView, setLabView] = useState('runtime');
  const [drilldownAccountId, setDrilldownAccountId] = useState('');
  const tensorHistoryRef = useRef('');
  const enabledStrategySet = useMemo(() => new Set(enabledStrategyIds), [enabledStrategyIds]);

  const selectionModel = useMemo(() => {
    return buildStrategyLabSelectionModel({
      walletAccounts,
      activeWalletAccountId,
      requestedDrilldownAccountId: drilldownAccountId,
      strategyOptions,
      strategyId,
      tradeLog,
      txEvents,
      positionEvents
    });
  }, [activeWalletAccountId, drilldownAccountId, positionEvents, strategyId, strategyOptions, tradeLog, txEvents, walletAccounts]);

  const {
    resolvedDrilldownAccountId,
    selectedDrillAccount,
    enabledAccountCount,
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
  } = selectionModel;

  const runtimeStrategyDetail = useMemo(() => {
    return getStrategyImplementationDetail(strategyId);
  }, [strategyId]);

  const selectedStrategyEventRows = useMemo(() => {
    return eventLog.filter((event) => String(event?.strategyId || '') === String(strategyId || ''));
  }, [eventLog, strategyId]);

  useEffect(() => {
    if (resolvedDrilldownAccountId !== drilldownAccountId) {
      setDrilldownAccountId(resolvedDrilldownAccountId);
    }
  }, [drilldownAccountId, resolvedDrilldownAccountId]);

  const runtimeTradeMarkers = useMemo(() => {
    const timeSeries = runtimeSeries
      .map((point, index) => ({
        index,
        t: Number(point?.t),
        price: Number(point?.price)
      }))
      .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.price));

    if (timeSeries.length < 2 || tradeLog.length === 0) return [];

    const grouped = new Map();
    for (const trade of tradeLog.slice(0, 220)) {
      const timestamp = Number(trade?.timestamp);
      if (!Number.isFinite(timestamp)) continue;
      const nearestIndex = findNearestPointIndexByTime(timeSeries, timestamp);
      if (nearestIndex < 0) continue;

      const nearestPoint = timeSeries[nearestIndex];
      const key = nearestPoint.index;
      const current = grouped.get(key) || {
        index: nearestPoint.index,
        value: nearestPoint.price,
        upCount: 0,
        downCount: 0,
        neutralCount: 0,
        count: 0,
        lastTimestamp: timestamp
      };

      const tone = actionClass(String(trade?.action || '').toLowerCase());
      if (tone === 'up') current.upCount += 1;
      else if (tone === 'down') current.downCount += 1;
      else current.neutralCount += 1;
      current.count += 1;
      if (timestamp > current.lastTimestamp) current.lastTimestamp = timestamp;
      grouped.set(key, current);
    }

    return [...grouped.values()]
      .sort((a, b) => a.index - b.index)
      .slice(-28)
      .map((group) => {
        let tone = 'neutral';
        if (group.upCount > 0 && group.downCount === 0) tone = 'up';
        else if (group.downCount > 0 && group.upCount === 0) tone = 'down';

        const actionLabel = group.upCount > 0 && group.downCount > 0 ? 'mixed trades' : tone === 'up' ? 'accumulate trades' : tone === 'down' ? 'reduce trades' : 'hold trades';

        return {
          key: `trade-flag:${group.index}`,
          index: group.index,
          value: group.value,
          tone,
          count: group.count,
          title: `${actionLabel} x${group.count} @ ${fmtNum(group.value, 4)} | ${fmtTime(group.lastTimestamp)}`
        };
      });
  }, [runtimeSeries, tradeLog]);

  const normalizedRuntimePriceSeries = useMemo(() => normalizeSeriesToPct(runtimePriceSeries), [runtimePriceSeries]);
  const normalizedRuntimeEquitySeries = useMemo(() => normalizeSeriesToPct(runtimeEquity), [runtimeEquity]);
  const normalizedBacktestEquitySeries = useMemo(() => normalizeSeriesToPct(backtestEquitySeries), [backtestEquitySeries]);
  const normalizedSelectedAccountEquitySeries = useMemo(() => normalizeSeriesToPct(selectedAccountEquitySeries), [selectedAccountEquitySeries]);

  const overviewComboBaseSeries = useMemo(() => {
    if (seriesPointCount(normalizedRuntimePriceSeries) >= 2) return normalizedRuntimePriceSeries;
    if (seriesPointCount(normalizedRuntimeEquitySeries) >= 2) return normalizedRuntimeEquitySeries;
    return normalizedSelectedAccountEquitySeries;
  }, [normalizedRuntimeEquitySeries, normalizedRuntimePriceSeries, normalizedSelectedAccountEquitySeries]);

  const overviewComboOverlays = useMemo(() => {
    const overlays = [];
    if (seriesPointCount(normalizedRuntimeEquitySeries) >= 2) {
      overlays.push({
        key: 'overview-runtime-equity',
        label: 'Runtime Equity %',
        points: normalizedRuntimeEquitySeries,
        stroke: '#7ad9ff',
        strokeWidth: 1.8
      });
    }
    if (seriesPointCount(normalizedBacktestEquitySeries) >= 2) {
      overlays.push({
        key: 'overview-backtest-equity',
        label: 'Backtest Equity %',
        points: normalizedBacktestEquitySeries,
        stroke: '#a598ff',
        strokeWidth: 1.5,
        dasharray: '6 5'
      });
    }
    if (seriesPointCount(normalizedSelectedAccountEquitySeries) >= 2) {
      overlays.push({
        key: 'overview-selected-account',
        label: `${selectedDrillAccount?.name || 'Account'} Equity %`,
        points: normalizedSelectedAccountEquitySeries,
        stroke: '#62ffcc',
        strokeWidth: 1.75
      });
    }
    return overlays;
  }, [normalizedBacktestEquitySeries, normalizedRuntimeEquitySeries, normalizedSelectedAccountEquitySeries, selectedDrillAccount?.name]);

  const solverBuckets = useMemo(() => buildPdfBuckets({ minPct: -4.5, maxPct: 4.5, stepPct: 0.25 }), []);

  const solverBaseRankings = useMemo(() => {
    return rankMarketsByPdf({
      markets: snapshot?.markets || [],
      historyByMarket,
      buckets: solverBuckets,
      horizons: PDF_HORIZONS,
      horizon: solverHorizon,
      now: snapshot?.now || Date.now()
    });
  }, [historyByMarket, snapshot?.markets, snapshot?.now, solverBuckets, solverHorizon]);

  const marketTensorSnapshot = useMemo(() => {
    return buildMarketTensorSnapshot({
      markets: snapshot?.markets || [],
      historyByMarket,
      now: snapshot?.now || Date.now(),
      limit: 168
    });
  }, [historyByMarket, snapshot?.markets, snapshot?.now]);

  const marketImageSnapshot = useMemo(() => {
    return buildMarketImageSnapshot({
      markets: snapshot?.markets || [],
      tensorSnapshot: marketTensorSnapshot,
      depthBands: 13
    });
  }, [marketTensorSnapshot, snapshot?.markets]);

  useEffect(() => {
    const timestamp = toNum(marketTensorSnapshot?.timestamp, NaN);
    if (!Number.isFinite(timestamp)) return;
    const nextSignature = `${timestamp}:${toNum(marketTensorSnapshot?.metrics?.tensorDriftPct, 0).toFixed(6)}:${toNum(marketImageSnapshot?.aggregate?.imbalance, 0).toFixed(
      6
    )}`;
    if (tensorHistoryRef.current === nextSignature) return;
    tensorHistoryRef.current = nextSignature;

    setTensorHistory((previous) => {
      const nextRow = {
        timestamp,
        tensorDriftPct: toNum(marketTensorSnapshot?.metrics?.tensorDriftPct, 0),
        breadth: toNum(marketTensorSnapshot?.metrics?.breadth, 0),
        stress: toNum(marketTensorSnapshot?.metrics?.stress, 0),
        imageImbalance: toNum(marketImageSnapshot?.aggregate?.imbalance, 0)
      };
      return [...previous, nextRow].slice(-920);
    });
  }, [marketImageSnapshot?.aggregate?.imbalance, marketTensorSnapshot?.metrics?.breadth, marketTensorSnapshot?.metrics?.stress, marketTensorSnapshot?.metrics?.tensorDriftPct, marketTensorSnapshot?.timestamp]);

  const tensorPdfModel = useMemo(() => {
    return buildTensorPdfFromHistory({
      tensorHistory,
      buckets: solverBuckets,
      horizons: PDF_HORIZONS,
      horizon: solverHorizon,
      marketImage: marketImageSnapshot,
      tensorSnapshot: marketTensorSnapshot
    });
  }, [marketImageSnapshot, marketTensorSnapshot, solverBuckets, solverHorizon, tensorHistory]);

  const tensorSolverRankings = useMemo(() => {
    return rankMarketsByTensorPdf({
      baseRankings: solverBaseRankings,
      tensorSnapshot: marketTensorSnapshot,
      marketImage: marketImageSnapshot,
      tensorPdf: tensorPdfModel
    });
  }, [marketImageSnapshot, marketTensorSnapshot, solverBaseRankings, tensorPdfModel]);

  const solverRankings = useMemo(() => {
    return solverMode === 'tensor' ? tensorSolverRankings : solverBaseRankings;
  }, [solverBaseRankings, solverMode, tensorSolverRankings]);

  const marketImageRows = useMemo(() => {
    const rows = (marketImageSnapshot?.rows || []).slice(0, 16);
    const aggregateRow = {
      key: '__aggregate__',
      symbol: 'ALL',
      assetClass: 'tensor',
      spreadBps: marketTensorSnapshot?.metrics?.averageSpreadBps || 0,
      imbalance: marketImageSnapshot?.aggregate?.imbalance || 0,
      microShiftBps: (marketImageSnapshot?.aggregate?.imbalance || 0) * 100,
      bidPressure: marketImageSnapshot?.aggregate?.bidPressure || 0,
      askPressure: marketImageSnapshot?.aggregate?.askPressure || 0,
      cells: marketImageSnapshot?.aggregate?.cells || []
    };
    return [aggregateRow, ...rows];
  }, [
    marketImageSnapshot?.aggregate?.askPressure,
    marketImageSnapshot?.aggregate?.bidPressure,
    marketImageSnapshot?.aggregate?.cells,
    marketImageSnapshot?.aggregate?.imbalance,
    marketImageSnapshot?.rows,
    marketTensorSnapshot?.metrics?.averageSpreadBps
  ]);

  const marketImageMaxAbs = useMemo(() => {
    let max = 0;
    for (const row of marketImageRows) {
      for (const cell of row.cells || []) {
        max = Math.max(max, Math.abs(toNum(cell, 0)));
      }
    }
    return Math.max(max, 0.00001);
  }, [marketImageRows]);

  const markedSolverPortfolio = useMemo(() => {
    return markPdfPortfolio({
      portfolio: solverPortfolio,
      markets: snapshot?.markets || []
    });
  }, [snapshot?.markets, solverPortfolio]);

  const solverAllocationPreview = useMemo(() => {
    const picks = solverRankings
      .filter((row) => row.recommendation?.action === 'accumulate' && Number(row.confidencePct) >= Number(solverMinConfidence))
      .slice(0, Math.max(1, Number(solverTopN) || 4));

    const scoreRows = picks.map((row) => ({
      ...row,
      weightScore: Math.max(0.001, Number(row.upScore) * (0.6 + Number(row.confidencePct) / 100))
    }));
    const scoreSum = scoreRows.reduce((sum, row) => sum + row.weightScore, 0);
    const equity = Number(markedSolverPortfolio.equity) || 0;

    return scoreRows.map((row) => {
      const weight = row.weightScore / Math.max(scoreSum, 1e-9);
      return {
        ...row,
        weight,
        targetNotional: equity * weight
      };
    });
  }, [markedSolverPortfolio.equity, solverMinConfidence, solverRankings, solverTopN]);

  const runPdfSolverCycle = useCallback(
    (source = 'manual') => {
      const timestamp = Date.now();
      const result = simulatePdfPortfolioCycle({
        portfolio: solverPortfolio,
        rankings: solverRankings,
        markets: snapshot?.markets || [],
        topN: solverTopN,
        minConfidencePct: solverMinConfidence,
        feeBps: solverFeeBps,
        timestamp
      });

      setSolverPortfolio(result.portfolio);
      setSolverOrderLog((previous) => {
        const cycleEvent = {
          id: `pdf-cycle:${timestamp}`,
          kind: 'cycle',
          source,
          mode: solverMode,
          timestamp,
          picks: result.picked.length,
          orders: result.orders.length,
          equityStart: result.equityStart,
          equityEnd: result.equityEnd,
          tensorDriftPct: toNum(marketTensorSnapshot?.metrics?.tensorDriftPct, 0),
          tensorImbalance: toNum(marketImageSnapshot?.aggregate?.imbalance, 0),
          tensorConfidencePct: toNum(tensorPdfModel?.summary?.confidencePct, 0)
        };
        const orderEvents = result.orders.map((order) => ({
          ...order,
          kind: 'order',
          source,
          mode: solverMode
        }));
        return [cycleEvent, ...orderEvents, ...previous].slice(0, 320);
      });
    },
    [marketImageSnapshot?.aggregate?.imbalance, marketTensorSnapshot?.metrics?.tensorDriftPct, snapshot?.markets, solverFeeBps, solverMinConfidence, solverMode, solverPortfolio, solverRankings, solverTopN, tensorPdfModel?.summary?.confidencePct]
  );

  useEffect(() => {
    if (!solverAuto || !running) return undefined;
    const timer = setInterval(() => {
      runPdfSolverCycle('auto');
    }, Math.max(1400, Number(intervalMs) * 2));
    return () => clearInterval(timer);
  }, [intervalMs, runPdfSolverCycle, running, solverAuto]);

  const resetPdfSolver = useCallback(() => {
    setSolverPortfolio(createPdfPortfolioState({ startCash: 100000 }));
    setSolverOrderLog([]);
    setTensorHistory([]);
    tensorHistoryRef.current = '';
  }, []);

  const solverModeLabel = solverMode === 'tensor' ? 'tensor snapshot + market image' : 'baseline PDF';

  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>Strategy Lab</h1>
          <div className="section-actions">
            <Link to="/strategies" className="inline-link">
              Strategies
            </Link>
            <Link to="/decisions" className="inline-link">
              Decisions
            </Link>
            <Link to="/probability" className="inline-link">
              PDF Lab
            </Link>
            <Link to="/markets" className="inline-link">
              Back to markets
            </Link>
          </div>
        </div>
        <p>Backtesting + realtime strategy simulation with multi-account paper execution and linked signal/decision telemetry.</p>
      </GlowCard>

      <div className="strategy-lab-top-grid">
        <GlowCard className="panel-card strategy-lab-control-card">
          <div className="section-head">
            <h2>Control Deck</h2>
            <span>
              Multi strategy only | {fmtInt(enabledStrategyIds.length)} enabled
            </span>
          </div>

          <div className="strategy-control-grid">
            <label className="control-field">
              <span>Source</span>
              <select value={sourceId} onChange={(event) => changeSource(event.target.value)}>
                {sourceOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="control-field">
              <span>Scenario</span>
              <select value={scenarioId} onChange={(event) => changeScenario(event.target.value)} disabled={sourceId !== 'local-scenario'}>
                {scenarioOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="control-field">
              <span>Market</span>
              <select value={selectedMarket?.key || ''} onChange={(event) => changeMarket(event.target.value)}>
                {markets.map((market) => (
                  <option key={market.key} value={market.key}>
                    {market.symbol} ({market.assetClass})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="section-head">
            <h2>Multi Strategy Runtime</h2>
            <span>{fmtInt(enabledStrategyIds.length)} active</span>
          </div>
          <div className="section-actions">
            <button type="button" className="btn secondary" onClick={enableAllStrategies}>
              Enable All
            </button>
            <button type="button" className="btn secondary" onClick={disableToPrimaryStrategy}>
              Primary Only
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => changeEnabledStrategies(strategyOptions.slice(0, 3).map((option) => option.id))}
            >
              Top 3 Preset
            </button>
          </div>
          <div className="strategy-enabled-grid">
            {strategyOptions.map((option) => {
              const checked = enabledStrategySet.has(option.id);
              return (
                <label key={`strategy-enabled:${option.id}`} className={checked ? 'strategy-toggle-chip active' : 'strategy-toggle-chip'}>
                  <input type="checkbox" checked={checked} onChange={() => toggleStrategyEnabled(option.id)} />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
          <RuntimeExecutionControls
            strategyMode={executionStrategyMode}
            walletScope={executionWalletScope}
            onStrategyModeChange={(strategyMode) =>
              changeExecutionConfig({
                strategyMode
              })
            }
            onWalletScopeChange={(walletScope) =>
              changeExecutionConfig({
                walletScope
              })
            }
            summaryPrefix="Runtime evaluates enabled strategies each tick. Engine mode"
          />

          <div className="strategy-risk-grid">
            <label className="control-field">
              <span>Interval (ms)</span>
              <input type="number" min={280} max={5000} step={20} value={intervalMs} onChange={(event) => updateInterval(event.target.value)} />
            </label>
            <label className="control-field">
              <span>Max units</span>
              <input
                type="number"
                min={1}
                max={60}
                step={1}
                value={maxAbsUnits}
                onChange={(event) => changeRisk({ nextMaxAbsUnits: event.target.value, nextSlippageBps: slippageBps, nextCooldownMs: cooldownMs })}
              />
            </label>
            <label className="control-field">
              <span>Slippage (bps)</span>
              <input
                type="number"
                min={0}
                max={40}
                step={0.1}
                value={slippageBps}
                onChange={(event) => changeRisk({ nextMaxAbsUnits: maxAbsUnits, nextSlippageBps: event.target.value, nextCooldownMs: cooldownMs })}
              />
            </label>
            <label className="control-field">
              <span>Cooldown (ms)</span>
              <input
                type="number"
                min={0}
                max={120000}
                step={200}
                value={cooldownMs}
                onChange={(event) => changeRisk({ nextMaxAbsUnits: maxAbsUnits, nextSlippageBps: slippageBps, nextCooldownMs: event.target.value })}
              />
            </label>
          </div>

          <div className="hero-actions">
            <button type="button" className={running ? 'btn secondary' : 'btn primary'} onClick={toggleRunning}>
              {running ? 'Pause Realtime' : 'Start Realtime'}
            </button>
            <button type="button" className="btn secondary" onClick={triggerManual}>
              Manual Trigger
            </button>
            <button type="button" className="btn secondary" onClick={runBacktestNow}>
              Run Backtest
            </button>
            <button type="button" className="btn secondary" onClick={resetSession}>
              Reset Session
            </button>
          </div>

          <div className="strategy-lab-status-row">
            <span className={running ? 'status-pill online' : 'status-pill'}>{running ? 'realtime active' : 'realtime paused'}</span>
            <span className="status-pill">mode {sourceId}</span>
            <span className="status-pill">market {selectedMarket?.symbol || '-'}</span>
            <span className="status-pill">strategy exec {executionStrategyMode}</span>
            <span className="status-pill">wallet exec {executionWalletScope}</span>
            <span className={hasLiveHistory ? 'status-pill online' : 'status-pill'}>history {hasLiveHistory ? 'available' : 'limited'}</span>
          </div>
          <p className="socket-status-copy">{strategyDescription}</p>
        </GlowCard>

        <GlowCard className="panel-card strategy-lab-overview-card">
          <div className="section-head">
            <h2>Session Overview</h2>
            <span>{activeExecutionAccount?.name || 'paper account'}</span>
          </div>
          <div className="strategy-lab-mini-grid">
            <article className="strategy-lab-mini-stat">
              <span>Wallet Equity</span>
              <strong className={toneClass(activeExecutionWallet.equity - 100000)}>{fmtNum(activeExecutionWallet.equity, 2)}</strong>
            </article>
            <article className="strategy-lab-mini-stat">
              <span>Realized PnL</span>
              <strong className={toneClass(activeExecutionWallet.realizedPnl)}>{fmtNum(activeExecutionWallet.realizedPnl, 2)}</strong>
            </article>
            <article className="strategy-lab-mini-stat">
              <span>Unrealized PnL</span>
              <strong className={toneClass(activeExecutionWallet.unrealizedPnl)}>{fmtNum(activeExecutionWallet.unrealizedPnl, 2)}</strong>
            </article>
            <article className="strategy-lab-mini-stat">
              <span>Position</span>
              <strong>{fmtNum(activeExecutionWallet.units, 0)} units</strong>
            </article>
            <article className="strategy-lab-mini-stat">
              <span>Backtest Return</span>
              <strong className={toneClass(backtestStats.returnPct)}>{fmtPct(backtestStats.returnPct)}</strong>
            </article>
            <article className="strategy-lab-mini-stat">
              <span>Backtest PnL</span>
              <strong className={toneClass(backtestStats.pnl)}>{fmtNum(backtestStats.pnl, 2)}</strong>
            </article>
            <article className="strategy-lab-mini-stat">
              <span>Enabled Accounts</span>
              <strong>{fmtInt(enabledAccountCount)}</strong>
            </article>
            <article className="strategy-lab-mini-stat">
              <span>Trigger Events</span>
              <strong>{fmtInt(eventLog.length)}</strong>
            </article>
          </div>
          <p className="socket-status-copy">
            tx feed {fmtInt(txEvents.length)} | position snapshots {fmtInt(positionEvents.length)} | execution rows {fmtInt(tradeLog.length)} | signal inputs{' '}
            {fmtInt(signalRows.length)}
          </p>
          <p className="socket-status-copy">
            active execution account {activeExecutionAccount?.name || '-'} | drilldown account {selectedDrillAccount?.name || '-'} | selected strategy {strategyLabel} |
            enabled set {fmtInt(enabledStrategyIds.length)}
          </p>
        </GlowCard>
      </div>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Lab Views</h2>
          <span>
            {strategyLabel} | {selectedDrillAccount?.name || 'no account selected'}
          </span>
        </div>
        <div className="strategy-lab-tab-row" role="tablist" aria-label="Strategy lab views">
          {STRATEGY_LAB_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={labView === tab.id}
              className={labView === tab.id ? 'strategy-lab-tab active' : 'strategy-lab-tab'}
              onClick={() => setLabView(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {labView === 'runtime' ? (
          <div className="strategy-drill-grid">
            <article className="strategy-drill-card">
              <LineChart
                title={`Runtime Combo (${selectedMarket?.symbol || 'SIM'})`}
                points={overviewComboBaseSeries}
                stroke="#86cbff"
                fillFrom="rgba(125, 198, 255, 0.3)"
                fillTo="rgba(125, 198, 255, 0.02)"
                overlays={overviewComboOverlays}
                unit="%"
              />
            </article>
            <article className="strategy-drill-card">
              <div className="section-head">
                <h2>Runtime Drilldown</h2>
                <span>{fmtInt(walletAccounts.length)} accounts</span>
              </div>
              <div className="strategy-drill-controls">
                <WalletAccountSelectField
                  label="Drill Account"
                  accounts={walletAccounts}
                  value={drilldownAccountId}
                  onChange={setDrilldownAccountId}
                  emptyLabel="No accounts"
                  idPrefix="strategy-lab-overview-account"
                />
              </div>
              <div className="strategy-lab-mini-grid">
                <article className="strategy-lab-mini-stat">
                  <span>Combo Series</span>
                  <strong>{fmtInt(seriesPointCount(overviewComboBaseSeries))} pts</strong>
                </article>
                <article className="strategy-lab-mini-stat">
                  <span>Overlay Series</span>
                  <strong>{fmtInt(overviewComboOverlays.length)}</strong>
                </article>
                <article className="strategy-lab-mini-stat">
                  <span>Selected Account Equity</span>
                  <strong className={toneClass(selectedDrillAccount?.wallet?.equity - (selectedDrillAccount?.startCash || 100000))}>
                    {fmtNum(selectedDrillAccount?.wallet?.equity, 2)}
                  </strong>
                </article>
                <article className="strategy-lab-mini-stat">
                  <span>Selected Account Position</span>
                  <strong>{fmtNum(selectedDrillAccount?.wallet?.units, 0)} units</strong>
                </article>
                <article className="strategy-lab-mini-stat">
                  <span>Strategy Trades</span>
                  <strong>{fmtInt(selectedStrategyTradeRows.length)}</strong>
                </article>
                <article className="strategy-lab-mini-stat">
                  <span>Strategy Win Rate</span>
                  <strong className={toneClass(selectedStrategyWinRate - 50)}>{fmtPct(selectedStrategyWinRate)}</strong>
                </article>
                <article className="strategy-lab-mini-stat">
                  <span>Account TX Events</span>
                  <strong>{fmtInt(selectedAccountTxRows.length)}</strong>
                </article>
                <article className="strategy-lab-mini-stat">
                  <span>Account Position Events</span>
                  <strong>{fmtInt(selectedAccountPositionRows.length)}</strong>
                </article>
              </div>
            </article>
          </div>
        ) : null}

        {labView === 'accounts' ? (
          <>
            <div className="strategy-drill-grid">
              <article className="strategy-drill-card">
                <div className="section-head">
                  <h2>Account Drilldown</h2>
                  <span>{selectedDrillAccount?.name || 'none'}</span>
                </div>
                {selectedDrillAccount ? (
                  <div className="section-actions">
                    <Link to={`/wallet/${encodeURIComponent(selectedDrillAccount.id)}`} className="inline-link">
                      Open Wallet ID Page
                    </Link>
                  </div>
                ) : null}
                <div className="strategy-drill-controls">
                  <WalletAccountSelectField
                    label="Selected Account"
                    accounts={walletAccounts}
                    value={drilldownAccountId}
                    onChange={setDrilldownAccountId}
                    emptyLabel="No accounts"
                    idPrefix="strategy-lab-accounts-account"
                  />
                </div>
                <div className="hero-actions">
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={!selectedDrillAccount}
                    onClick={() => {
                      if (!selectedDrillAccount) return;
                      setActiveWalletAccount(selectedDrillAccount.id);
                    }}
                  >
                    Set Active
                  </button>
                </div>
                <p className="socket-status-copy">Create, delete, and edit paper accounts from Wallet tab. Strategy Lab keeps account drilldown + active selection.</p>
                {selectedDrillAccount ? (
                  <>
                    <div className="strategy-lab-mini-grid">
                      <article className="strategy-lab-mini-stat">
                        <span>Equity</span>
                        <strong className={toneClass(selectedDrillAccount.wallet.equity - selectedDrillAccount.startCash)}>
                          {fmtNum(selectedDrillAccount.wallet.equity, 2)}
                        </strong>
                      </article>
                      <article className="strategy-lab-mini-stat">
                        <span>Cash</span>
                        <strong>{fmtNum(selectedDrillAccount.wallet.cash, 2)}</strong>
                      </article>
                      <article className="strategy-lab-mini-stat">
                        <span>Units</span>
                        <strong>{fmtNum(selectedDrillAccount.wallet.units, 0)}</strong>
                      </article>
                      <article className="strategy-lab-mini-stat">
                        <span>Realized</span>
                        <strong className={toneClass(selectedDrillAccount.wallet.realizedPnl)}>{fmtNum(selectedDrillAccount.wallet.realizedPnl, 2)}</strong>
                      </article>
                    </div>
                    <LineChart
                      title={`${selectedDrillAccount.name} Equity (events)`}
                      points={selectedAccountEquitySeries}
                      stroke="#62ffcc"
                      fillFrom="rgba(73, 224, 182, 0.28)"
                      fillTo="rgba(73, 224, 182, 0.03)"
                    />
                  </>
                ) : (
                  <p className="action-message">No paper account selected. Add one or switch to Overview.</p>
                )}
              </article>

              <article className="strategy-drill-card">
                <div className="section-head">
                  <h2>Account Trades</h2>
                  <span>{fmtInt(selectedAccountTradeRows.length)} rows</span>
                </div>
                <FlashList
                  items={selectedAccountTradeRows}
                  height={300}
                  itemHeight={70}
                  className="tick-flash-list"
                  emptyCopy="No trades for this account yet."
                  keyExtractor={(trade) => trade.id}
                  renderItem={(trade) => (
                    <article className="tensor-event-row">
                      <strong className={actionClass(trade.action)}>
                        {trade.action} | fill {fmtNum(trade.fillPrice, 4)}
                      </strong>
                      <p>{trade.reason || 'strategy execution'}</p>
                      <small>
                        units {fmtNum(trade.unitsAfter, 0)} | realized {fmtNum(trade.realizedDelta, 2)} | {fmtTime(trade.timestamp)}
                      </small>
                    </article>
                  )}
                />
              </article>
            </div>

            <div className="two-col">
              <GlowCard className="panel-card">
                <div className="section-head">
                  <h2>Account TX Feed</h2>
                  <span>{fmtInt(selectedAccountTxRows.length)} rows</span>
                </div>
                <FlashList
                  items={selectedAccountTxRows}
                  height={250}
                  itemHeight={74}
                  className="tick-flash-list"
                  emptyCopy="No tx events for this account yet."
                  keyExtractor={(event) => event.id}
                  renderItem={(event) => (
                    <article className="tensor-event-row">
                      <strong className={actionClass(event.action)}>
                        {event.action} | {event.symbol || '-'}
                      </strong>
                      <p>{event.reason || 'strategy execution'}</p>
                      <small>
                        fill {fmtNum(event.fillPrice, 4)} | delta {fmtNum(event.unitsDelta, 0)} | pnl {fmtNum(event.realizedDelta, 2)} | {fmtTime(event.timestamp)}
                      </small>
                    </article>
                  )}
                />
              </GlowCard>

              <GlowCard className="panel-card">
                <div className="section-head">
                  <h2>Account Positions</h2>
                  <span>{fmtInt(selectedAccountPositionRows.length)} rows</span>
                </div>
                <FlashList
                  items={selectedAccountPositionRows}
                  height={250}
                  itemHeight={74}
                  className="tick-flash-list"
                  emptyCopy="No position snapshots for this account yet."
                  keyExtractor={(event) => event.id}
                  renderItem={(event) => (
                    <article className="tensor-event-row">
                      <strong>{event.symbol || '-'} | units {fmtNum(event.wallet?.units, 0)}</strong>
                      <p>{event.reason || 'position update'}</p>
                      <small>
                        eq {fmtNum(event.wallet?.equity, 2)} | cash {fmtNum(event.wallet?.cash, 2)} | {fmtTime(event.timestamp)}
                      </small>
                    </article>
                  )}
                />
              </GlowCard>
            </div>
          </>
        ) : null}

        {labView === 'strategy' ? (
          <>
            <div className="strategy-drill-grid">
              <article className="strategy-drill-card">
                <div className="section-head">
                  <h2>Selected Strategy</h2>
                  <span>{strategyLabel}</span>
                </div>
                <p className="socket-status-copy">{strategyDescription}</p>
                <p className="socket-status-copy">
                  {runtimeStrategyDetail.runtimePath} | trigger {runtimeStrategyDetail.triggerKind}
                </p>
                <details className="strategy-inline-detail">
                  <summary>View Running Function Detail</summary>
                  <p className="socket-status-copy">{runtimeStrategyDetail.scoreModel}</p>
                  <ul className="strategy-function-list compact">
                    {runtimeStrategyDetail.actionRules.map((rule, index) => (
                      <li key={`runtime-rule:${runtimeStrategyDetail.id}:${index}`}>{rule}</li>
                    ))}
                  </ul>
                  <pre className="strategy-function-code compact">
                    <code>{runtimeStrategyDetail.pseudoCode}</code>
                  </pre>
                  <div className="section-actions">
                    <Link to={`/strategy/${encodeURIComponent(strategyId)}`} className="inline-link">
                      Open full strategy detail
                    </Link>
                  </div>
                </details>
                <div className="strategy-lab-mini-grid">
                  <article className="strategy-lab-mini-stat">
                    <span>Runtime Trigger Events</span>
                    <strong>{fmtInt(selectedStrategyEventRows.length)}</strong>
                  </article>
                  <article className="strategy-lab-mini-stat">
                    <span>Strategy Trades</span>
                    <strong>{fmtInt(selectedStrategyTradeRows.length)}</strong>
                  </article>
                  <article className="strategy-lab-mini-stat">
                    <span>Strategy TX</span>
                    <strong>{fmtInt(selectedStrategyTxRows.length)}</strong>
                  </article>
                  <article className="strategy-lab-mini-stat">
                    <span>Strategy Position Events</span>
                    <strong>{fmtInt(selectedStrategyPositionRows.length)}</strong>
                  </article>
                </div>
                <LineChart
                  title={`Strategy Trace - ${strategyLabel}`}
                  points={runtimePriceSeries}
                  stroke="#63f7c1"
                  fillFrom="rgba(58, 227, 171, 0.3)"
                  fillTo="rgba(58, 227, 171, 0.03)"
                  overlays={runtimeTaOverlays}
                  markers={runtimeTradeMarkers}
                />
              </article>

              <article className="strategy-drill-card">
                <div className="section-head">
                  <h2>Strategy Trigger Tape</h2>
                  <span>{fmtInt(selectedStrategyEventRows.length)} rows</span>
                </div>
                <FlashList
                  items={selectedStrategyEventRows}
                  height={320}
                  itemHeight={74}
                  className="tick-flash-list"
                  emptyCopy="Waiting for strategy trigger events..."
                  keyExtractor={(item) => item.id}
                  renderItem={(item) => (
                    <article className="tensor-event-row">
                      <strong className={actionClass(item.action)}>
                        {item.action} | {item.stance}
                      </strong>
                      <p>{item.reason}</p>
                      <small>
                        {item.triggerKind} | {item.strategyId || '-'} | score {fmtNum(item.score, 2)} | px {fmtNum(item.price, 4)} | {fmtTime(item.timestamp)}
                      </small>
                    </article>
                  )}
                />
              </article>
            </div>

            <div className="two-col">
              <GlowCard className="panel-card">
                <div className="section-head">
                  <h2>Strategy Trades</h2>
                  <span>{fmtInt(selectedStrategyTradeRows.length)} rows</span>
                </div>
                <FlashList
                  items={selectedStrategyTradeRows}
                  height={260}
                  itemHeight={68}
                  className="tick-flash-list"
                  emptyCopy="No strategy trades yet."
                  keyExtractor={(trade) => trade.id}
                  renderItem={(trade) => (
                    <article className="tensor-event-row">
                      <strong className={actionClass(trade.action)}>
                        {(trade.accountName || 'paper')} | {trade.action}
                      </strong>
                      <p>{trade.reason}</p>
                      <small>
                        fill {fmtNum(trade.fillPrice, 4)} | units {fmtNum(trade.unitsAfter, 0)} | realized {fmtNum(trade.realizedDelta, 2)} | {fmtTime(trade.timestamp)}
                      </small>
                    </article>
                  )}
                />
              </GlowCard>

              <GlowCard className="panel-card">
                <div className="section-head">
                  <h2>Strategy TX Feed</h2>
                  <span>{fmtInt(selectedStrategyTxRows.length)} rows</span>
                </div>
                <FlashList
                  items={selectedStrategyTxRows}
                  height={260}
                  itemHeight={74}
                  className="tick-flash-list"
                  emptyCopy="No tx events for this strategy yet."
                  keyExtractor={(event) => event.id}
                  renderItem={(event) => (
                    <article className="tensor-event-row">
                      <strong className={actionClass(event.action)}>
                        {event.accountName || 'paper'} | {event.action} | {event.symbol || '-'}
                      </strong>
                      <p>{event.reason}</p>
                      <small>
                        fill {fmtNum(event.fillPrice, 4)} | delta {fmtNum(event.unitsDelta, 0)} | pnl {fmtNum(event.realizedDelta, 2)} | {fmtTime(event.timestamp)}
                      </small>
                    </article>
                  )}
                />
              </GlowCard>
            </div>
          </>
        ) : null}
      </GlowCard>

      {labView === 'solver' ? (
        <>
      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>PDF Portfolio Solver</h2>
          <span>{solverModeLabel}</span>
        </div>
        <p className="socket-status-copy">
          Whole-market strategy layer: baseline PDF ranking plus a tensor snapshot and market-image orderbook surface that extends through time.
        </p>
        <div className="pdf-solver-control-grid">
          <label className="control-field">
            <span>Ranking Model</span>
            <select value={solverMode} onChange={(event) => setSolverMode(event.target.value)}>
              <option value="tensor">Tensor Snapshot + Market Image</option>
              <option value="pdf">Baseline PDF</option>
            </select>
          </label>
          <label className="control-field">
            <span>Top N Picks</span>
            <input type="number" min={1} max={12} step={1} value={solverTopN} onChange={(event) => setSolverTopN(Math.max(1, Math.min(12, Number(event.target.value) || 4)))} />
          </label>
          <label className="control-field">
            <span>Horizon (delta)</span>
            <select value={solverHorizon} onChange={(event) => setSolverHorizon(Math.max(1, Number(event.target.value) || 3))}>
              {PDF_HORIZONS.map((horizon) => (
                <option key={`solver-h:${horizon}`} value={horizon}>
                  {horizon}
                </option>
              ))}
            </select>
          </label>
          <label className="control-field">
            <span>Min Confidence %</span>
            <input
              type="number"
              min={0}
              max={99}
              step={1}
              value={solverMinConfidence}
              onChange={(event) => setSolverMinConfidence(Math.max(0, Math.min(99, Number(event.target.value) || 0)))}
            />
          </label>
          <label className="control-field">
            <span>Fee (bps)</span>
            <input type="number" min={0} max={60} step={0.5} value={solverFeeBps} onChange={(event) => setSolverFeeBps(Math.max(0, Math.min(60, Number(event.target.value) || 0)))} />
          </label>
        </div>
        <div className="hero-actions">
          <button type="button" className="btn secondary" onClick={() => runPdfSolverCycle('manual')}>
            Run Solver Rebalance
          </button>
          <button type="button" className="btn secondary" onClick={resetPdfSolver}>
            Reset PDF Portfolio
          </button>
          <label className="toggle-label">
            <input type="checkbox" checked={solverAuto} onChange={(event) => setSolverAuto(event.target.checked)} />
            <span>Auto-cycle with realtime</span>
          </label>
        </div>
        <div className="tensor-metrics">
          <article>
            <span>Solver Equity</span>
            <strong className={toneClass(markedSolverPortfolio.equity - 100000)}>{fmtNum(markedSolverPortfolio.equity, 2)}</strong>
          </article>
          <article>
            <span>Solver Cash</span>
            <strong>{fmtNum(markedSolverPortfolio.cash, 2)}</strong>
          </article>
          <article>
            <span>Invested Notional</span>
            <strong>{fmtNum(markedSolverPortfolio.investedNotional, 2)}</strong>
          </article>
          <article>
            <span>Open Holdings</span>
            <strong>{fmtInt(markedSolverPortfolio.markedHoldings?.length || 0)}</strong>
          </article>
          <article>
            <span>Candidate Picks</span>
            <strong>{fmtInt(solverAllocationPreview.length)}</strong>
          </article>
          <article>
            <span>Cycle Count</span>
            <strong>{fmtInt(markedSolverPortfolio.cycle || 0)}</strong>
          </article>
          <article>
            <span>Order Events</span>
            <strong>{fmtInt(solverOrderLog.filter((row) => row.kind === 'order').length)}</strong>
          </article>
          <article>
            <span>Tensor Drift</span>
            <strong className={toneClass(marketTensorSnapshot?.metrics?.tensorDriftPct)}>{fmtSigned(marketTensorSnapshot?.metrics?.tensorDriftPct, 3)}%</strong>
          </article>
          <article>
            <span>Tensor Breadth</span>
            <strong className={toneClass(marketTensorSnapshot?.metrics?.breadth)}>{fmtSigned(marketTensorSnapshot?.metrics?.breadth, 3)}</strong>
          </article>
          <article>
            <span>Image Imbalance</span>
            <strong className={toneClass(marketImageSnapshot?.aggregate?.imbalance)}>{fmtSigned((marketImageSnapshot?.aggregate?.imbalance || 0) * 100, 2)}%</strong>
          </article>
          <article>
            <span>Tensor PDF Confidence</span>
            <strong>{fmtNum(tensorPdfModel?.summary?.confidencePct, 1)}%</strong>
          </article>
          <article>
            <span>Last Update</span>
            <strong>{fmtTime(markedSolverPortfolio.updatedAt)}</strong>
          </article>
        </div>
      </GlowCard>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>{solverMode === 'tensor' ? 'Tensor Allocation Targets' : 'PDF Allocation Targets'}</h2>
            <span>{solverAllocationPreview.length} picks</span>
          </div>
          <div className="list-stack">
            {solverAllocationPreview.map((row, index) => (
              <article key={`solver-pick:${row.key}`} className="list-item">
                <strong>
                  {index + 1}. {row.symbol} ({row.assetClass})
                </strong>
                <p>
                  target weight {fmtPct(row.weight * 100)} | target notional {fmtNum(row.targetNotional, 2)}
                </p>
                <div className="item-meta">
                  <small>up {fmtPct((row.upProb || 0) * 100)}</small>
                  <small>down {fmtPct((row.downProb || 0) * 100)}</small>
                  <small>expected {fmtPct(row.expectedMovePct || 0)}</small>
                  <small>confidence {fmtNum(row.confidencePct, 1)}%</small>
                  {solverMode === 'tensor' ? <small>tensor {fmtSigned(row.tensorScore || 0, 2)}</small> : null}
                  {solverMode === 'tensor' ? <small>connect {fmtSigned(row.connectionScore || 0, 2)}</small> : null}
                </div>
              </article>
            ))}
            {solverAllocationPreview.length === 0 ? <p className="action-message">No qualifying picks at current thresholds.</p> : null}
          </div>
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>PDF Solver Tape</h2>
            <span>{solverOrderLog.length} rows</span>
          </div>
          <FlashList
            items={solverOrderLog}
            height={320}
            itemHeight={74}
            className="tick-flash-list"
            emptyCopy="No solver cycles yet."
            keyExtractor={(item) => item.id}
            renderItem={(item) => {
              if (item.kind === 'cycle') {
                return (
                  <article className="tensor-event-row">
                    <strong>
                      cycle | {item.source} | {item.mode || 'pdf'}
                    </strong>
                    <p>
                      picks {fmtInt(item.picks)} | orders {fmtInt(item.orders)}
                    </p>
                    <small>
                      equity {fmtNum(item.equityStart, 2)} {'->'} {fmtNum(item.equityEnd, 2)} | drift {fmtSigned(item.tensorDriftPct || 0, 3)}% | imbalance{' '}
                      {fmtSigned((item.tensorImbalance || 0) * 100, 2)}% | conf {fmtNum(item.tensorConfidencePct || 0, 1)}% | {fmtTime(item.timestamp)}
                    </small>
                  </article>
                );
              }
              return (
                <article className="tensor-event-row">
                  <strong className={actionClass(item.action)}>
                    {item.action} | {item.symbol} | units {fmtNum(item.units, 4)}
                  </strong>
                  <p>
                    notional {fmtNum(item.notional, 2)} | fee {fmtNum(item.fee, 4)}
                  </p>
                  <small>
                    price {fmtNum(item.price, 4)} | {item.assetClass} | {item.source} | {item.mode || 'pdf'} | {fmtTime(item.timestamp)}
                  </small>
                </article>
              );
            }}
          />
        </GlowCard>
      </div>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Market Tensor Snapshot</h2>
            <span>{fmtTime(marketTensorSnapshot?.timestamp)}</span>
          </div>
          <p className="socket-status-copy">
            Global tensor built from market links, liquidity, spread friction, and momentum flow. Central node and breadth drive the cross-market strategy posture.
          </p>
          <div className="tensor-metrics">
            <article>
              <span>Markets</span>
              <strong>{fmtInt(marketTensorSnapshot?.metrics?.marketCount || 0)}</strong>
            </article>
            <article>
              <span>Nodes</span>
              <strong>{fmtInt(marketTensorSnapshot?.metrics?.nodeCount || 0)}</strong>
            </article>
            <article>
              <span>Edges</span>
              <strong>{fmtInt(marketTensorSnapshot?.metrics?.edgeCount || 0)}</strong>
            </article>
            <article>
              <span>Central Asset</span>
              <strong>{marketTensorSnapshot?.metrics?.centralAsset || '-'}</strong>
            </article>
            <article>
              <span>Tensor Drift</span>
              <strong className={toneClass(marketTensorSnapshot?.metrics?.tensorDriftPct)}>{fmtSigned(marketTensorSnapshot?.metrics?.tensorDriftPct, 3)}%</strong>
            </article>
            <article>
              <span>Breadth</span>
              <strong className={toneClass(marketTensorSnapshot?.metrics?.breadth)}>{fmtSigned(marketTensorSnapshot?.metrics?.breadth, 3)}</strong>
            </article>
            <article>
              <span>Avg Spread</span>
              <strong>{fmtNum(marketTensorSnapshot?.metrics?.averageSpreadBps, 2)} bps</strong>
            </article>
            <article>
              <span>Stress</span>
              <strong>{fmtNum(marketTensorSnapshot?.metrics?.stress, 3)}</strong>
            </article>
            <article>
              <span>Tensor PDF Horizon</span>
              <strong>{fmtInt(tensorPdfModel?.horizon || solverHorizon)}</strong>
            </article>
            <article>
              <span>Tensor PDF Move</span>
              <strong className={toneClass(tensorPdfModel?.summary?.expectedMovePct)}>{fmtSigned(tensorPdfModel?.summary?.expectedMovePct, 3)}%</strong>
            </article>
            <article>
              <span>Tensor PDF Skew</span>
              <strong className={toneClass(tensorPdfModel?.summary?.skew)}>{fmtSigned(tensorPdfModel?.summary?.skew, 3)}</strong>
            </article>
            <article>
              <span>Tensor History</span>
              <strong>{fmtInt(tensorHistory.length)} samples</strong>
            </article>
          </div>
          <div className="list-stack">
            {(marketTensorSnapshot?.nodes || []).slice(0, 10).map((node, index) => (
              <article key={`tensor-node:${node.asset}`} className="list-item">
                <strong>
                  {index + 1}. {node.asset}
                </strong>
                <p>
                  centrality {fmtNum(node.centrality, 3)} | pressure {fmtSigned(node.pressure, 3)} | degree {fmtNum(node.degree, 2)}
                </p>
                <div className="item-meta">
                  <small>edge weight {fmtNum(node.edgeWeight, 2)}</small>
                  <small>volume {fmtNum(node.volume, 0)}</small>
                </div>
              </article>
            ))}
          </div>
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Market Image (Orderbook Object)</h2>
            <span>
              {fmtInt(marketImageRows.length)} rows x {fmtInt(marketImageSnapshot?.bands?.length || 0)} bands
            </span>
          </div>
          <p className="socket-status-copy">
            Signed depth image over the whole market: positive cells imply bid pressure, negative cells imply ask pressure. Aggregate row drives tensor PDF bias.
          </p>
          <div className="pdf-heatmap-scroll">
            <table className="pdf-heatmap-table">
              <thead>
                <tr>
                  <th>Market</th>
                  {(marketImageSnapshot?.bands || []).map((band) => (
                    <th key={`book-band:${band}`}>{fmtSigned(band, 0)} bps</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {marketImageRows.map((row) => (
                  <tr key={`book-row:${row.key}`}>
                    <th>
                      {row.symbol}
                      <span>{row.assetClass}</span>
                    </th>
                    {(row.cells || []).map((cell, cellIndex) => (
                      <td key={`book-cell:${row.key}:${cellIndex}`}>
                        <div
                          className="pdf-heat-cell"
                          style={buildMarketImageCellStyle(cell, marketImageMaxAbs)}
                          title={`${row.symbol} | band ${fmtSigned((marketImageSnapshot?.bands || [])[cellIndex], 0)} bps | pressure ${fmtSigned(cell, 4)} | imbalance ${fmtSigned(
                            (row.imbalance || 0) * 100,
                            2
                          )}%`}
                        >
                          {fmtSigned(cell, 3)}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlowCard>
      </div>
        </>
      ) : null}

      {labView === 'runtime' ? (
        <>
      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Signal Set {'->'} Strategy</h2>
          <span>{signalRows.length} inputs</span>
        </div>
        <div className="list-stack">
          {signalRows.slice(0, 8).map((signal) => (
            <article key={signal.id} className="list-item">
              <strong>
                {signal.type} | {signal.direction || 'neutral'} | {signal.symbol || selectedMarket?.symbol || '-'}
              </strong>
              <p>{signal.message || 'signal input'}</p>
              <div className="item-meta">
                <span className={`severity ${String(signal.severity || 'low').toLowerCase()}`}>{signal.severity || 'low'}</span>
                <small>score {fmtInt(signal.score)}</small>
                <small>{signal.assetClass || selectedMarket?.assetClass || '-'}</small>
                <small>{fmtTime(signal.timestamp)}</small>
              </div>
            </article>
          ))}
          {signalRows.length === 0 ? <p className="action-message">No signal inputs available yet.</p> : null}
        </div>
      </GlowCard>

      <div className="strategy-lab-chart-grid">
        <GlowCard className="chart-card">
          <LineChart
            title={`Realtime Price + Classic TA - ${selectedMarket?.symbol || 'SIM'}`}
            points={runtimePriceSeries}
            stroke="#63f7c1"
            fillFrom="rgba(58, 227, 171, 0.34)"
            fillTo="rgba(58, 227, 171, 0.03)"
            overlays={runtimeTaOverlays}
            markers={runtimeTradeMarkers}
          />
        </GlowCard>

        <GlowCard className="chart-card">
          <LineChart
            title="Realtime Spread (bps)"
            points={runtimeSpreadSeries}
            stroke="#ffad73"
            fillFrom="rgba(255, 155, 94, 0.34)"
            fillTo="rgba(255, 155, 94, 0.02)"
            unit=" bps"
          />
        </GlowCard>

        <GlowCard className="chart-card">
          <LineChart
            title="Fake Wallet Equity Curve"
            points={runtimeEquity}
            stroke="#77dcff"
            fillFrom="rgba(58, 147, 255, 0.33)"
            fillTo="rgba(58, 147, 255, 0.02)"
          />
        </GlowCard>

        <GlowCard className="chart-card">
          <LineChart
            title={`Backtest Equity Curve (${backtest?.sampleSize || 0} points)`}
            points={backtestEquitySeries}
            stroke="#9d92ff"
            fillFrom="rgba(150, 130, 255, 0.3)"
            fillTo="rgba(150, 130, 255, 0.02)"
          />
        </GlowCard>
      </div>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Realtime Triggers</h2>
            <span>{eventLog.length} events</span>
          </div>
          <FlashList
            items={eventLog}
            height={320}
            itemHeight={74}
            className="tick-flash-list"
            emptyCopy="Waiting for strategy trigger events..."
            keyExtractor={(item) => item.id}
            renderItem={(item) => (
              <article className="tensor-event-row">
                <strong className={actionClass(item.action)}>
                  {item.action} | {item.stance}
                </strong>
                <p>{item.reason}</p>
                <small>
                  {item.triggerKind} | strat {item.strategyId || '-'} | sigs {fmtInt(item.signalCount)} | score {fmtNum(item.score, 2)} | px {fmtNum(item.price, 4)} | spr{' '}
                  {fmtNum(item.spread, 2)} bps | {item.tradedAccounts?.length ? `fills ${item.tradedAccounts.join(', ')}` : 'no fills'} | {fmtTime(item.timestamp)}
                </small>
              </article>
            )}
          />
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Execution Tape</h2>
            <span>{tradeLog.length} rows</span>
          </div>
          <FlashList
            items={tradeLog}
            height={320}
            itemHeight={68}
            className="tick-flash-list"
            emptyCopy="No executions yet. Run realtime or trigger manually."
            keyExtractor={(trade) => trade.id}
            renderItem={(trade) => (
              <article className="tensor-event-row">
                <strong className={actionClass(trade.action)}>
                  {(trade.accountName || 'paper')} | {trade.action} | fill {fmtNum(trade.fillPrice, 4)}
                </strong>
                <p>{trade.reason}</p>
                <small>
                  {trade.strategyId || '-'} | units {fmtNum(trade.unitsAfter, 0)} | realized {fmtNum(trade.realizedDelta, 2)} | spread {fmtNum(trade.spreadBps, 2)} bps |{' '}
                  {fmtTime(trade.timestamp)}
                </small>
              </article>
            )}
          />
        </GlowCard>
      </div>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Emitted Wallet TX</h2>
            <div className="section-actions">
              <span>{txEvents.length} events</span>
              <button type="button" className="btn secondary" onClick={clearExecutionFeed}>
                Clear Feed
              </button>
            </div>
          </div>
          <FlashList
            items={txEvents}
            height={320}
            itemHeight={74}
            className="tick-flash-list"
            emptyCopy="No emitted tx events yet. Run realtime or trigger manually."
            keyExtractor={(event) => event.id}
            renderItem={(event) => (
              <article className="tensor-event-row">
                <strong className={actionClass(event.action)}>
                  {event.accountName || 'paper'} | {event.action} | {event.symbol || event.marketKey || '-'}
                </strong>
                <p>{event.reason || 'strategy execution'}</p>
                <small>
                  {event.strategyId} | fill {fmtNum(event.fillPrice, 4)} | delta {fmtNum(event.unitsDelta, 0)} | units {fmtNum(event.unitsAfter, 0)} | pnl{' '}
                  {fmtNum(event.realizedDelta, 2)} | {fmtTime(event.timestamp)}
                </small>
              </article>
            )}
          />
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Emitted Positions</h2>
            <span>{positionEvents.length} snapshots</span>
          </div>
          <FlashList
            items={positionEvents}
            height={320}
            itemHeight={80}
            className="tick-flash-list"
            emptyCopy="No emitted position snapshots yet."
            keyExtractor={(event) => event.id}
            renderItem={(event) => (
              <article className="tensor-event-row">
                <strong className={actionClass(event.action)}>
                  {event.accountName || 'paper'} | {event.symbol || event.marketKey || '-'} | units {fmtNum(event.wallet.units, 0)}
                </strong>
                <p>{event.reason || 'position update'}</p>
                <small>
                  {event.strategyId || '-'} | eq {fmtNum(event.wallet.equity, 2)} | cash {fmtNum(event.wallet.cash, 2)} | mark {fmtNum(event.wallet.markPrice, 4)} | notional{' '}
                  {fmtNum(event.wallet.positionNotional, 2)} | {fmtTime(event.timestamp)}
                </small>
              </article>
            )}
          />
        </GlowCard>
      </div>
        </>
      ) : null}

      {labView === 'backtest' ? (
        <>
      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Backtest Snapshot</h2>
          <span>
            {backtest?.strategyId || strategyId} | {backtest?.sourceId || sourceId}
          </span>
        </div>
        <p className="socket-status-copy">
          sample {fmtInt(backtest?.sampleSize || 0)} | max drawdown {fmtPct(backtestStats.maxDrawdownPct)} | end equity {fmtNum(backtestStats.endEquity, 2)} | run at{' '}
          {fmtTime(backtest?.ranAt)}
        </p>
      </GlowCard>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Backtest Trade Tape</h2>
            <span>{backtestTrades.length} rows</span>
          </div>
          <FlashList
            items={backtestTrades}
            height={300}
            itemHeight={72}
            className="tick-flash-list"
            emptyCopy="No backtest trades on the latest run."
            keyExtractor={(trade) => trade.id}
            renderItem={(trade) => (
              <article className="tensor-event-row">
                <strong className={actionClass(trade.action)}>
                  {trade.action} | fill {fmtNum(trade.fillPrice, 4)}
                </strong>
                <p>{trade.reason || 'backtest execution'}</p>
                <small>
                  units {fmtNum(trade.unitsAfter, 0)} | realized {fmtNum(trade.realizedDelta, 2)} | spread {fmtNum(trade.spreadBps, 2)} bps | {fmtTime(trade.timestamp)}
                </small>
              </article>
            )}
          />
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Backtest Signal Tape</h2>
            <span>{backtestSignals.length} rows</span>
          </div>
          <FlashList
            items={backtestSignals}
            height={300}
            itemHeight={72}
            className="tick-flash-list"
            emptyCopy="No backtest signals on the latest run."
            keyExtractor={(signal) => signal.id}
            renderItem={(signal) => (
              <article className="tensor-event-row">
                <strong className={actionClass(signal.action)}>
                  {signal.action} | {signal.stance}
                </strong>
                <p>{signal.reason}</p>
                <small>
                  score {fmtNum(signal.score, 2)} | px {fmtNum(signal.price, 4)} | sigs {fmtInt(signal.signalCount)} | {fmtTime(signal.timestamp)}
                </small>
              </article>
            )}
          />
        </GlowCard>
      </div>
        </>
      ) : null}
    </section>
  );
}
