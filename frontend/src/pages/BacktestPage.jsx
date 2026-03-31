import { useEffect, useMemo, useState } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import LineChart from '../components/LineChart';
import useProviderWindowHistory from '../hooks/useProviderWindowHistory';
import { fmtInt, fmtNum, fmtPct, fmtTime } from '../lib/format';
import {
  buildMarketImageSnapshot,
  buildMarketTensorSnapshot,
  buildPdfBuckets,
  buildTensorPdfFromHistory,
  createPdfPortfolioState,
  PDF_HORIZONS,
  rankMarketsByPdf,
  rankMarketsByTensorPdf,
  simulatePdfPortfolioCycle
} from '../lib/probabilityLab';
import { Link } from '../lib/router';
import { buildScenarioSeries, createWalletState, executeWalletAction, markWallet, runBacktest, SCENARIO_OPTIONS, STRATEGY_OPTIONS } from '../lib/strategyEngine';
import { getExternalSocketProviders, getLocalFallbackProviders } from '../providers';

const EMPTY_RESULT = {
  stats: {
    startCash: 0,
    endEquity: 0,
    pnl: 0,
    returnPct: 0,
    maxDrawdownPct: 0,
    tradeCount: 0,
    winRatePct: 0
  },
  equitySeries: [],
  tradeLog: [],
  signalLog: []
};

const BACKTEST_HISTORY_WINDOW_OPTIONS = [
  { key: '5m', label: '5m' },
  { key: '1h', label: '1h' },
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' }
];

const toNum = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const sortMarkets = (markets = []) => {
  return [...markets]
    .filter((market) => market?.key && market?.symbol)
    .sort((a, b) => {
      const aWeight = toNum(a.totalVolume, 0) + Math.abs(toNum(a.changePct, 0)) * 1_000_000;
      const bWeight = toNum(b.totalVolume, 0) + Math.abs(toNum(b.changePct, 0)) * 1_000_000;
      return bWeight - aWeight;
    })
    .slice(0, 96);
};

const normalizeSeriesRows = (rows = [], fallbackSpread = 12) => {
  return rows
    .map((row, index) => {
      const price = toNum(row?.price, NaN);
      if (!Number.isFinite(price) || price <= 0) return null;
      return {
        t: toNum(row?.t, Date.now() + index * 1000),
        price,
        spread: Math.max(0, toNum(row?.spread, fallbackSpread)),
        volume: Math.max(0, toNum(row?.volume, 0))
      };
    })
    .filter((row) => Boolean(row));
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizeAction = (value) => {
  const action = String(value || '').toLowerCase();
  if (action === 'short' || action === 'sell') return 'reduce';
  if (action === 'buy' || action === 'long') return 'accumulate';
  if (action === 'accumulate' || action === 'reduce' || action === 'hold') return action;
  return 'hold';
};

const toStrategyLabel = (strategyId) => {
  const found = STRATEGY_OPTIONS.find((option) => String(option.id) === String(strategyId));
  return found?.label || String(strategyId || 'unknown');
};

const resolveSeriesIndex = (series = [], timestamp = 0) => {
  if (!Array.isArray(series) || series.length === 0) return -1;
  const target = toNum(timestamp, NaN);
  if (!Number.isFinite(target)) return -1;

  let nearestIndex = -1;
  let nearestDelta = Number.POSITIVE_INFINITY;
  for (let index = 0; index < series.length; index += 1) {
    const pointTs = toNum(series[index]?.t, NaN);
    if (!Number.isFinite(pointTs)) continue;
    const delta = Math.abs(pointTs - target);
    if (delta < nearestDelta) {
      nearestDelta = delta;
      nearestIndex = index;
    }
  }
  return nearestIndex;
};

const buildDecisionOutcomeRows = ({ signalLog = [], series = [], strategyId = '', lookaheadSteps = 1 }) => {
  const rows = [];
  const horizon = Math.max(1, Math.round(toNum(lookaheadSteps, 1)));
  const strategyLabel = toStrategyLabel(strategyId);

  for (const signal of Array.isArray(signalLog) ? signalLog : []) {
    const action = normalizeAction(signal?.action);
    if (action === 'hold') continue;
    const signalTs = toNum(signal?.timestamp, 0);
    const fromIndex = resolveSeriesIndex(series, signalTs);
    if (fromIndex < 0) continue;
    const toIndex = fromIndex + horizon;
    if (toIndex >= series.length) continue;

    const fromPrice = toNum(series[fromIndex]?.price, NaN);
    const toPrice = toNum(series[toIndex]?.price, NaN);
    if (!Number.isFinite(fromPrice) || !Number.isFinite(toPrice) || fromPrice <= 0 || toPrice <= 0) continue;

    const movePct = ((toPrice - fromPrice) / Math.max(fromPrice, 1e-9)) * 100;
    const directionalMovePct = action === 'accumulate' ? movePct : -movePct;
    const absMovePct = Math.abs(movePct);
    const correct = directionalMovePct > 0;

    rows.push({
      id: `solver:${strategyId}:${signalTs}:${fromIndex}`,
      strategyId: String(strategyId || ''),
      strategyLabel,
      action,
      score: toNum(signal?.score, 0),
      signalCount: Math.max(0, Math.round(toNum(signal?.signalCount, 0))),
      reason: String(signal?.reason || ''),
      timestamp: signalTs,
      horizon,
      fromIndex,
      toIndex,
      fromPrice,
      toPrice,
      movePct,
      directionalMovePct,
      absMovePct,
      correct
    });
  }

  return rows;
};

const computeHybridScore = ({ mode = 'hybrid', hitRatePct = 0, returnPct = 0, avgDirectionalMovePct = 0, decisions = 0, minDecisions = 8 }) => {
  const sampleWeight = clamp(decisions / Math.max(1, toNum(minDecisions, 8)), 0.1, 1);
  const boundedReturn = clamp(returnPct, -120, 120);
  const boundedEdge = clamp(avgDirectionalMovePct, -5, 5);

  if (mode === 'accuracy') return hitRatePct * sampleWeight;
  if (mode === 'pnl') return boundedReturn * sampleWeight;

  const hybridRaw = hitRatePct * 0.58 + boundedReturn * 0.22 + boundedEdge * 12;
  return hybridRaw * sampleWeight;
};

const calcMaxDrawdownPct = (equitySeries = []) => {
  if (!Array.isArray(equitySeries) || equitySeries.length === 0) return 0;
  let peak = toNum(equitySeries[0], 0);
  let maxDrawdown = 0;
  for (const value of equitySeries) {
    const equity = toNum(value, 0);
    peak = Math.max(peak, equity);
    if (peak <= 0) continue;
    const drawdownPct = ((peak - equity) / peak) * 100;
    maxDrawdown = Math.max(maxDrawdown, drawdownPct);
  }
  return maxDrawdown;
};

const buildDiscreteWindows = ({ series = [], windowSize = 12, windowStep = 12, buildWindow }) => {
  const windows = [];
  const safeSeries = Array.isArray(series) ? series : [];
  const safeWindowSize = Math.max(2, Math.round(toNum(windowSize, 12)));
  const safeWindowStep = Math.max(1, Math.round(toNum(windowStep, safeWindowSize)));
  for (let startIndex = 0; startIndex < safeSeries.length - 1; startIndex += safeWindowStep) {
    const endIndex = Math.min(safeSeries.length - 1, startIndex + safeWindowSize - 1);
    const startPoint = safeSeries[startIndex];
    const endPoint = safeSeries[endIndex];
    const startPrice = Math.max(toNum(startPoint?.price, 0), 1e-9);
    const endPrice = Math.max(toNum(endPoint?.price, 0), 1e-9);
    const movePct = ((endPrice - startPrice) / startPrice) * 100;
    const defaultWindow = {
      id: `window:${startIndex}:${endIndex}`,
      windowIndex: windows.length,
      startIndex,
      endIndex,
      startTs: toNum(startPoint?.t, Date.now()),
      endTs: toNum(endPoint?.t, Date.now()),
      startPrice,
      endPrice,
      movePct
    };
    const built = typeof buildWindow === 'function' ? buildWindow(defaultWindow, windows.length) || {} : {};
    windows.push({
      ...defaultWindow,
      ...built
    });
  }
  return windows;
};

const simulateDiscreteWindowPlan = ({
  series = [],
  windows = [],
  startCash = 100000,
  maxAbsUnits = 8,
  slippageBps = 1.2,
  smoothBlendPct = 0,
  mode = 'long-only',
  tradePrefix = 'solver'
}) => {
  const safeSeries = Array.isArray(series) ? series : [];
  const safeStartCash = Math.max(100, toNum(startCash, 100000));
  const safeMaxUnits = Math.max(1, Math.round(toNum(maxAbsUnits, 8)));
  const safeSlippage = Math.max(0, toNum(slippageBps, 1.2));
  const smoothBlend = clamp(toNum(smoothBlendPct, 0) / 100, 0, 1);
  const shortEnabled = String(mode || 'long-only') === 'long-short';
  const minUnits = shortEnabled ? -safeMaxUnits : 0;
  const planWindows = Array.isArray(windows)
    ? windows.map((window, index) => ({
        ...window,
        windowIndex: Math.max(0, Math.round(toNum(window?.windowIndex, index))),
        discreteTarget: clamp(toNum(window?.discreteTarget, 0), minUnits, safeMaxUnits)
      }))
    : [];

  const windowByStartIndex = new Map(planWindows.map((row) => [row.startIndex, row]));
  let wallet = createWalletState(safeStartCash);
  const tradeLog = [];
  const equitySeries = [];
  const regimeSeries = [];
  const positionSeries = [];

  const applyVirtualRebalance = ({ targetUnits, point, timestamp, reason = '', windowIndex = -1 }) => {
    const price = Math.max(toNum(point?.price, 0), 1e-9);
    const target = clamp(toNum(targetUnits, 0), minUnits, safeMaxUnits);
    const unitsBefore = toNum(wallet?.units, 0);
    const unitsDelta = target - unitsBefore;
    if (Math.abs(unitsDelta) <= 0.001) return;

    const side = unitsDelta > 0 ? 'buy' : 'sell';
    const fillPrice = Math.max(price * (1 + (side === 'buy' ? 1 : -1) * (safeSlippage / 10000)), 1e-9);
    const cashBefore = toNum(wallet?.cash, 0);
    const avgEntryBefore = wallet?.avgEntry === null ? null : toNum(wallet?.avgEntry, null);
    const unitsAfter = unitsBefore + unitsDelta;
    const cashAfter = cashBefore - unitsDelta * fillPrice;

    let realizedDelta = 0;
    const closedQty = Math.min(Math.abs(unitsDelta), Math.abs(unitsBefore));
    if (closedQty > 0 && avgEntryBefore !== null) {
      if (unitsBefore > 0 && unitsDelta < 0) realizedDelta += (fillPrice - avgEntryBefore) * closedQty;
      if (unitsBefore < 0 && unitsDelta > 0) realizedDelta += (avgEntryBefore - fillPrice) * closedQty;
    }

    let avgEntryAfter = avgEntryBefore;
    if (Math.abs(unitsAfter) <= 1e-9) {
      avgEntryAfter = null;
    } else if (unitsBefore === 0 || Math.sign(unitsBefore) !== Math.sign(unitsAfter)) {
      avgEntryAfter = fillPrice;
    } else if (Math.sign(unitsBefore) === Math.sign(unitsDelta)) {
      const previousUnits = Math.abs(unitsBefore);
      const nextUnits = Math.abs(unitsAfter);
      avgEntryAfter = (previousUnits * (avgEntryBefore || fillPrice) + Math.abs(unitsDelta) * fillPrice) / Math.max(nextUnits, 1e-9);
    }

    wallet = {
      ...wallet,
      cash: cashAfter,
      units: unitsAfter,
      avgEntry: avgEntryAfter,
      realizedPnl: toNum(wallet?.realizedPnl, 0) + realizedDelta
    };

    tradeLog.push({
      id: `${tradePrefix}-virtual:${timestamp}:${windowIndex}:${Math.round(fillPrice * 1000)}:${Math.round(Math.abs(unitsDelta) * 1000)}`,
      timestamp,
      action: unitsDelta > 0 ? 'accumulate' : 'reduce',
      unitsDelta,
      unitsAfter,
      fillPrice,
      markPrice: price,
      spreadBps: toNum(point?.spread, 0),
      realizedDelta,
      reason,
      score: Math.abs(unitsDelta),
      windowIndex
    });
  };

  const rebalanceToTarget = ({ point, targetUnits, windowIndex = -1, reason = `${tradePrefix}-window` }) => {
    let guard = 0;
    const target = clamp(toNum(targetUnits, 0), minUnits, safeMaxUnits);
    if (shortEnabled) {
      applyVirtualRebalance({
        targetUnits: target,
        point,
        timestamp: toNum(point?.t, Date.now()),
        reason,
        windowIndex
      });
      return;
    }
    while (guard < 200) {
      const units = toNum(wallet?.units, 0);
      const delta = target - units;
      if (Math.abs(delta) <= 0.001) break;
      const action = delta > 0 ? 'accumulate' : 'reduce';
      const execution = executeWalletAction({
        wallet,
        action,
        point,
        timestamp: toNum(point?.t, Date.now()) + guard,
        reason,
        score: Math.abs(delta),
        maxAbsUnits: safeMaxUnits,
        cooldownMs: 0,
        slippageBps: safeSlippage
      });
      wallet = execution?.wallet || wallet;
      if (!execution?.trade) break;
      tradeLog.push({
        ...execution.trade,
        id: `${tradePrefix}:${execution.trade?.id || `${windowIndex}:${guard}`}`,
        windowIndex
      });
      guard += 1;
    }
  };

  for (let index = 0; index < safeSeries.length; index += 1) {
    const point = safeSeries[index];
    const window = windowByStartIndex.get(index);
    if (window) {
      const currentUnits = toNum(wallet?.units, 0);
      const blendedTarget = clamp(currentUnits + (window.discreteTarget - currentUnits) * (1 - smoothBlend), minUnits, safeMaxUnits);
      window.targetUnits = blendedTarget;
      rebalanceToTarget({
        point,
        targetUnits: blendedTarget,
        windowIndex: window.windowIndex,
        reason: window.reason || `${tradePrefix} window ${window.windowIndex}`
      });
      window.executedUnits = toNum(wallet?.units, 0);
    }

    if (index === safeSeries.length - 1) {
      rebalanceToTarget({
        point,
        targetUnits: 0,
        windowIndex: -1,
        reason: `${tradePrefix} end-of-series flatten`
      });
    }

    wallet = markWallet(wallet, toNum(point?.price, 0));
    equitySeries.push(toNum(wallet?.equity, safeStartCash));
    positionSeries.push(toNum(wallet?.units, 0));
    regimeSeries.push(window ? toNum(window.discreteTarget, 0) : regimeSeries[regimeSeries.length - 1] ?? 0);
  }

  const endEquity = equitySeries[equitySeries.length - 1] || safeStartCash;
  const pnl = endEquity - safeStartCash;
  const returnPct = (pnl / Math.max(safeStartCash, 1e-9)) * 100;

  return {
    stats: {
      startCash: safeStartCash,
      endEquity,
      pnl,
      returnPct,
      maxDrawdownPct: calcMaxDrawdownPct(equitySeries),
      tradeCount: tradeLog.length
    },
    equitySeries,
    tradeLog: tradeLog.slice(-320).reverse(),
    windows: planWindows,
    regimeSeries,
    positionSeries
  };
};

const solveDiscreteWindowOracle = ({
  series = [],
  startCash = 100000,
  maxAbsUnits = 8,
  slippageBps = 1.2,
  windowSize = 12,
  windowStep = 12,
  minMovePct = 0,
  smoothBlendPct = 0,
  mode = 'long-only'
}) => {
  const safeSeries = Array.isArray(series) ? series : [];
  if (safeSeries.length < 3) {
    return {
      stats: {
        startCash,
        endEquity: startCash,
        pnl: 0,
        returnPct: 0,
        maxDrawdownPct: 0,
        tradeCount: 0
      },
      equitySeries: [],
      tradeLog: [],
      windows: [],
      regimeSeries: [],
      positionSeries: []
    };
  }

  const safeMaxUnits = Math.max(1, Math.round(toNum(maxAbsUnits, 8)));
  const safeMinMovePct = Math.max(0, toNum(minMovePct, 0));
  const shortEnabled = String(mode || 'long-only') === 'long-short';

  const windows = buildDiscreteWindows({
    series: safeSeries,
    windowSize,
    windowStep,
    buildWindow: (window) => {
      const discreteTarget = window.movePct > safeMinMovePct ? safeMaxUnits : window.movePct < -safeMinMovePct ? (shortEnabled ? -safeMaxUnits : 0) : 0;
      const action = discreteTarget > 0 ? 'accumulate' : discreteTarget < 0 ? 'short' : 'hold';
      return {
        action,
        discreteTarget,
        reason: `oracle window ${window.windowIndex} move ${window.movePct.toFixed(3)}%`
      };
    }
  });

  return simulateDiscreteWindowPlan({
    series: safeSeries,
    windows,
    startCash,
    maxAbsUnits,
    slippageBps,
    smoothBlendPct,
    mode,
    tradePrefix: 'oracle'
  });
};

const solveDiscreteWindowPdfPolicy = ({
  series = [],
  startCash = 100000,
  maxAbsUnits = 8,
  slippageBps = 1.2,
  windowSize = 12,
  windowStep = 12,
  minMovePct = 0,
  smoothBlendPct = 0,
  mode = 'long-only',
  market = null,
  buckets = []
}) => {
  const safeSeries = Array.isArray(series) ? series : [];
  if (safeSeries.length < 3) {
    return {
      stats: {
        startCash,
        endEquity: startCash,
        pnl: 0,
        returnPct: 0,
        maxDrawdownPct: 0,
        tradeCount: 0
      },
      equitySeries: [],
      tradeLog: [],
      windows: [],
      regimeSeries: [],
      positionSeries: []
    };
  }

  const safeMaxUnits = Math.max(1, Math.round(toNum(maxAbsUnits, 8)));
  const safeMinMovePct = Math.max(0, toNum(minMovePct, 0));
  const shortEnabled = String(mode || 'long-only') === 'long-short';
  const safeWindowStep = Math.max(1, Math.round(toNum(windowStep, 12)));
  const safeBuckets = Array.isArray(buckets) && buckets.length ? buckets : buildPdfBuckets({ minPct: -4.5, maxPct: 4.5, stepPct: 0.25 });
  const marketKey = String(market?.key || 'backtest:pdf-policy');
  const symbol = String(market?.symbol || 'SIMUSDT');
  const assetClass = String(market?.assetClass || 'crypto');

  const windows = buildDiscreteWindows({
    series: safeSeries,
    windowSize,
    windowStep: safeWindowStep,
    buildWindow: (window) => {
      const lookbackStart = Math.max(0, window.startIndex - 240);
      const historySeries = safeSeries.slice(lookbackStart, window.startIndex + 1);
      const recent = historySeries.slice(-32);
      const modelMarket = {
        key: marketKey,
        symbol,
        assetClass,
        referencePrice: window.startPrice,
        spreadBps: Math.max(0.2, toNum(recent[recent.length - 1]?.spread, 12)),
        totalVolume: Math.max(
          1,
          recent.reduce((sum, point) => sum + Math.max(0, toNum(point?.volume, 0)), 0)
        )
      };

      const ranking = rankMarketsByPdf({
        markets: [modelMarket],
        historyByMarket: {
          [marketKey]: historySeries
        },
        buckets: safeBuckets,
        horizon: safeWindowStep
      });
      const modelRow = ranking[0] || null;
      const recommendation = modelRow?.recommendation || {};
      let action = normalizeAction(recommendation.action);
      const expectedMovePct = toNum(modelRow?.expectedMovePct, 0);
      const confidencePct = toNum(modelRow?.confidencePct, 0);
      const upProb = toNum(modelRow?.upProb, 0);
      const downProb = toNum(modelRow?.downProb, 0);
      const skew = toNum(modelRow?.skew, 0);

      if (Math.abs(expectedMovePct) < safeMinMovePct) {
        action = 'hold';
      }

      const discreteTarget = action === 'accumulate' ? safeMaxUnits : action === 'reduce' ? (shortEnabled ? -safeMaxUnits : 0) : 0;
      return {
        action,
        discreteTarget,
        predictedMovePct: expectedMovePct,
        confidencePct,
        upProb,
        downProb,
        skew,
        reason: `pdf h${safeWindowStep} | up ${(upProb * 100).toFixed(1)}% | down ${(downProb * 100).toFixed(1)}% | E[r] ${expectedMovePct.toFixed(3)}%`
      };
    }
  });

  return simulateDiscreteWindowPlan({
    series: safeSeries,
    windows,
    startCash,
    maxAbsUnits,
    slippageBps,
    smoothBlendPct,
    mode,
    tradePrefix: 'pdf-policy'
  });
};

const evaluateWindowAction = ({ action = 'hold', movePct = 0, minMovePct = 0 }) => {
  const normalized = normalizeAction(action);
  const move = toNum(movePct, 0);
  const threshold = Math.max(0, toNum(minMovePct, 0));
  if (normalized === 'accumulate') return move > threshold;
  if (normalized === 'reduce') return move < -threshold;
  return Math.abs(move) <= threshold;
};

const buildWindowComparisonRows = ({ oracleWindows = [], pdfWindows = [], minMovePct = 0 }) => {
  const oracleByStart = new Map((Array.isArray(oracleWindows) ? oracleWindows : []).map((row) => [row.startIndex, row]));
  const pdfByStart = new Map((Array.isArray(pdfWindows) ? pdfWindows : []).map((row) => [row.startIndex, row]));
  const startIndices = new Set([...oracleByStart.keys(), ...pdfByStart.keys()]);
  const rows = [];

  for (const startIndex of startIndices) {
    const oracle = oracleByStart.get(startIndex) || null;
    const pdf = pdfByStart.get(startIndex) || null;
    if (!oracle && !pdf) continue;
    const movePct = toNum(pdf?.movePct, toNum(oracle?.movePct, 0));
    const oracleAction = oracle?.action || (toNum(oracle?.discreteTarget, 0) > 0 ? 'accumulate' : toNum(oracle?.discreteTarget, 0) < 0 ? 'reduce' : 'hold');
    const pdfAction = pdf?.action || (toNum(pdf?.discreteTarget, 0) > 0 ? 'accumulate' : toNum(pdf?.discreteTarget, 0) < 0 ? 'reduce' : 'hold');
    const oracleCorrect = evaluateWindowAction({
      action: oracleAction,
      movePct,
      minMovePct
    });
    const pdfCorrect = evaluateWindowAction({
      action: pdfAction,
      movePct,
      minMovePct
    });

    rows.push({
      id: `window-compare:${startIndex}`,
      startIndex,
      endIndex: Math.max(toNum(pdf?.endIndex, 0), toNum(oracle?.endIndex, 0)),
      timestamp: toNum(pdf?.startTs, toNum(oracle?.startTs, Date.now())),
      movePct,
      oracleAction,
      pdfAction,
      oracleTarget: toNum(oracle?.targetUnits, toNum(oracle?.discreteTarget, 0)),
      pdfTarget: toNum(pdf?.targetUnits, toNum(pdf?.discreteTarget, 0)),
      oracleCorrect,
      pdfCorrect,
      agreement: String(oracleAction) === String(pdfAction),
      expectedMovePct: toNum(pdf?.predictedMovePct, 0),
      confidencePct: toNum(pdf?.confidencePct, 0),
      upProb: toNum(pdf?.upProb, 0),
      downProb: toNum(pdf?.downProb, 0)
    });
  }

  return rows.sort((a, b) => toNum(b.startIndex, 0) - toNum(a.startIndex, 0));
};

export default function BacktestPage({ snapshot, historyByMarket }) {
  const sortedMarkets = useMemo(() => sortMarkets(snapshot?.markets || []), [snapshot?.markets]);
  const [sourceMode, setSourceMode] = useState('live-history');
  const [historyWindowKey, setHistoryWindowKey] = useState('24h');
  const [strategyId, setStrategyId] = useState('tensor-lite');
  const [scenarioId, setScenarioId] = useState('trend-rally');
  const [marketKey, setMarketKey] = useState('');
  const [sampleSize, setSampleSize] = useState(280);
  const [startCash, setStartCash] = useState(100000);
  const [maxAbsUnits, setMaxAbsUnits] = useState(8);
  const [slippageBps, setSlippageBps] = useState(1.2);
  const [runTick, setRunTick] = useState(1);
  const [solverMode, setSolverMode] = useState('hybrid');
  const [solverLookaheadSteps, setSolverLookaheadSteps] = useState(1);
  const [solverTopN, setSolverTopN] = useState(6);
  const [solverMinDecisions, setSolverMinDecisions] = useState(8);
  const [solverActionFilter, setSolverActionFilter] = useState('all');
  const [solverOutcomeFilter, setSolverOutcomeFilter] = useState('all');
  const [solverMinAbsMovePct, setSolverMinAbsMovePct] = useState(0);
  const [solverSortMode, setSolverSortMode] = useState('latest');
  const [solverFeedStrategyId, setSolverFeedStrategyId] = useState('all');
  const [solverStrategyIds, setSolverStrategyIds] = useState(() => STRATEGY_OPTIONS.map((option) => option.id));
  const [totalSolverMode, setTotalSolverMode] = useState('tensor');
  const [totalMarketCount, setTotalMarketCount] = useState(18);
  const [totalStride, setTotalStride] = useState(3);
  const [totalTopN, setTotalTopN] = useState(4);
  const [totalMinConfidence, setTotalMinConfidence] = useState(52);
  const [totalFeeBps, setTotalFeeBps] = useState(8);
  const [totalHorizon, setTotalHorizon] = useState(3);
  const [oracleWindowSize, setOracleWindowSize] = useState(12);
  const [oracleWindowStep, setOracleWindowStep] = useState(12);
  const [oracleMinMovePct, setOracleMinMovePct] = useState(0.15);
  const [oracleSmoothBlendPct, setOracleSmoothBlendPct] = useState(0);
  const [oracleMode, setOracleMode] = useState('long-only');
  const [oracleGraphMarketCount, setOracleGraphMarketCount] = useState(14);

  useEffect(() => {
    if (!sortedMarkets.length) {
      setMarketKey('');
      return;
    }
    if (!marketKey || !sortedMarkets.some((market) => market.key === marketKey)) {
      setMarketKey(sortedMarkets[0].key);
    }
  }, [marketKey, sortedMarkets]);

  useEffect(() => {
    const knownIds = STRATEGY_OPTIONS.map((option) => String(option.id || '')).filter((id) => Boolean(id));
    setSolverStrategyIds((previous) => {
      const prev = Array.isArray(previous) ? previous.map((id) => String(id || '')).filter((id) => Boolean(id)) : [];
      const kept = prev.filter((id) => knownIds.includes(id));
      if (kept.length > 0) return kept;
      return knownIds;
    });
  }, []);

  const selectedMarket = useMemo(() => {
    const found = sortedMarkets.find((market) => market.key === marketKey);
    return (
      found || {
        key: 'sim:backtest',
        symbol: 'SIMUSDT',
        assetClass: 'crypto',
        spreadBps: 14,
        referencePrice: 100
      }
    );
  }, [marketKey, sortedMarkets]);

  const providerCandidates = useMemo(() => {
    const external = getExternalSocketProviders().filter((provider) => provider.supportsMarket(selectedMarket));
    const local = getLocalFallbackProviders().filter((provider) => provider.supportsMarket(selectedMarket));
    return {
      external,
      local,
      primary: external[0] || local[0] || null,
      fallback: local[0] || null
    };
  }, [selectedMarket]);

  const providerWindowHistory = useProviderWindowHistory({
    provider: providerCandidates.primary,
    fallbackProvider: providerCandidates.fallback,
    market: selectedMarket,
    windowKey: historyWindowKey,
    enabled: sourceMode === 'provider-history'
  });

  const liveSeries = useMemo(() => {
    if (!selectedMarket?.key) return [];
    const raw = Array.isArray(historyByMarket?.[selectedMarket.key]) ? historyByMarket[selectedMarket.key] : [];
    const tail = raw.slice(Math.max(0, raw.length - Math.max(64, Math.round(sampleSize))));
    return normalizeSeriesRows(tail, Math.max(2, toNum(selectedMarket.spreadBps, 12)));
  }, [historyByMarket, sampleSize, selectedMarket?.key, selectedMarket?.spreadBps]);

  const scenarioSeries = useMemo(() => {
    const basePrice = Math.max(toNum(selectedMarket?.referencePrice, 100), 0.0001);
    return buildScenarioSeries({
      scenarioId,
      basePrice,
      length: Math.max(64, Math.round(sampleSize)),
      now: toNum(snapshot?.now, Date.now()),
      symbol: selectedMarket?.symbol || 'SIMUSDT'
    });
  }, [sampleSize, scenarioId, selectedMarket?.referencePrice, selectedMarket?.symbol, snapshot?.now]);

  const providerHistorySeries = useMemo(() => {
    const rows = normalizeSeriesRows(providerWindowHistory.rows || [], Math.max(2, toNum(selectedMarket?.spreadBps, 12)));
    const minSamples = Math.max(64, Math.round(toNum(sampleSize, 280)));
    return rows.slice(Math.max(0, rows.length - minSamples));
  }, [providerWindowHistory.rows, sampleSize, selectedMarket?.spreadBps]);
  const providerHistoryProviderName = useMemo(() => {
    return String(providerWindowHistory.rows?.[0]?.providerName || providerWindowHistory.providerName || providerCandidates.primary?.name || '');
  }, [providerCandidates.primary?.name, providerWindowHistory.providerName, providerWindowHistory.rows]);

  const activeSeries = sourceMode === 'scenario' ? scenarioSeries : sourceMode === 'provider-history' ? providerHistorySeries : liveSeries;
  const sourceLabel =
    sourceMode === 'scenario'
      ? `scenario (${scenarioId})`
      : sourceMode === 'provider-history'
        ? `provider history (${providerHistoryProviderName || 'fallback'} ${historyWindowKey})`
        : `live history (${selectedMarket.symbol})`;

  const [ranAt, setRanAt] = useState(Date.now());
  const result = useMemo(() => {
    if (!Array.isArray(activeSeries) || activeSeries.length < 3) return EMPTY_RESULT;
    const signalRows = Array.isArray(snapshot?.signals) ? snapshot.signals : [];
    const response = runBacktest({
      series: activeSeries,
      strategyId,
      signalRows,
      selectedMarket,
      startCash: Math.max(100, toNum(startCash, 100000)),
      maxAbsUnits: Math.max(1, toNum(maxAbsUnits, 8)),
      slippageBps: Math.max(0, toNum(slippageBps, 1.2))
    });
    return response;
  }, [activeSeries, maxAbsUnits, selectedMarket, slippageBps, snapshot?.signals, startCash, strategyId, runTick]);

  useEffect(() => {
    setRanAt(Date.now());
  }, [runTick]);

  const stats = result.stats || EMPTY_RESULT.stats;
  const tradeRows = result.tradeLog || [];
  const signalRows = result.signalLog || [];
  const sourcePriceSeries = activeSeries.map((row) => row.price);
  const solverSelectedIdSet = useMemo(() => new Set(solverStrategyIds.map((id) => String(id || ''))), [solverStrategyIds]);

  const runBacktestNow = () => {
    setRunTick((value) => value + 1);
  };

  const pdfBuckets = useMemo(() => {
    return buildPdfBuckets({
      minPct: -4.5,
      maxPct: 4.5,
      stepPct: 0.25
    });
  }, []);

  const oracleResult = useMemo(() => {
    return solveDiscreteWindowOracle({
      series: activeSeries,
      startCash,
      maxAbsUnits,
      slippageBps,
      windowSize: oracleWindowSize,
      windowStep: oracleWindowStep,
      minMovePct: oracleMinMovePct,
      smoothBlendPct: oracleSmoothBlendPct,
      mode: oracleMode
    });
  }, [activeSeries, maxAbsUnits, oracleMinMovePct, oracleMode, oracleSmoothBlendPct, oracleWindowSize, oracleWindowStep, slippageBps, startCash]);

  const pdfPolicyResult = useMemo(() => {
    return solveDiscreteWindowPdfPolicy({
      series: activeSeries,
      startCash,
      maxAbsUnits,
      slippageBps,
      windowSize: oracleWindowSize,
      windowStep: oracleWindowStep,
      minMovePct: oracleMinMovePct,
      smoothBlendPct: oracleSmoothBlendPct,
      mode: oracleMode,
      market: selectedMarket,
      buckets: pdfBuckets
    });
  }, [activeSeries, maxAbsUnits, oracleMinMovePct, oracleMode, oracleSmoothBlendPct, oracleWindowSize, oracleWindowStep, pdfBuckets, selectedMarket, slippageBps, startCash]);

  const oracleStats = oracleResult?.stats || {
    startCash: Math.max(100, toNum(startCash, 100000)),
    endEquity: Math.max(100, toNum(startCash, 100000)),
    pnl: 0,
    returnPct: 0,
    maxDrawdownPct: 0,
    tradeCount: 0
  };

  const pdfPolicyStats = pdfPolicyResult?.stats || {
    startCash: Math.max(100, toNum(startCash, 100000)),
    endEquity: Math.max(100, toNum(startCash, 100000)),
    pnl: 0,
    returnPct: 0,
    maxDrawdownPct: 0,
    tradeCount: 0
  };

  const oracleWindowRows = useMemo(() => {
    const rows = Array.isArray(oracleResult?.windows) ? oracleResult.windows : [];
    return [...rows].sort((a, b) => Math.abs(toNum(b.movePct, 0)) - Math.abs(toNum(a.movePct, 0))).slice(0, 120);
  }, [oracleResult?.windows]);

  const pdfWindowRows = useMemo(() => {
    const rows = Array.isArray(pdfPolicyResult?.windows) ? pdfPolicyResult.windows : [];
    return [...rows].sort((a, b) => toNum(b.confidencePct, 0) - toNum(a.confidencePct, 0)).slice(0, 120);
  }, [pdfPolicyResult?.windows]);

  const oraclePdfWindowRows = useMemo(() => {
    return buildWindowComparisonRows({
      oracleWindows: oracleResult?.windows || [],
      pdfWindows: pdfPolicyResult?.windows || [],
      minMovePct: oracleMinMovePct
    });
  }, [oracleMinMovePct, oracleResult?.windows, pdfPolicyResult?.windows]);

  const oraclePdfWindowStats = useMemo(() => {
    const rows = oraclePdfWindowRows;
    const total = rows.length;
    if (!total) {
      return {
        totalWindows: 0,
        agreementPct: 0,
        oracleAccuracyPct: 0,
        pdfAccuracyPct: 0,
        pdfVsOracleAccuracyEdgePct: 0,
        avgMoveDiffPct: 0
      };
    }
    const agreementCount = rows.filter((row) => row.agreement).length;
    const oracleCorrectCount = rows.filter((row) => row.oracleCorrect).length;
    const pdfCorrectCount = rows.filter((row) => row.pdfCorrect).length;
    const avgMoveDiffPct = rows.reduce((sum, row) => sum + Math.abs(toNum(row.expectedMovePct, 0) - toNum(row.movePct, 0)), 0) / total;

    return {
      totalWindows: total,
      agreementPct: (agreementCount / total) * 100,
      oracleAccuracyPct: (oracleCorrectCount / total) * 100,
      pdfAccuracyPct: (pdfCorrectCount / total) * 100,
      pdfVsOracleAccuracyEdgePct: ((pdfCorrectCount - oracleCorrectCount) / total) * 100,
      avgMoveDiffPct
    };
  }, [oraclePdfWindowRows]);

  const totalMarketBacktest = useMemo(() => {
    const selectedUniverse = sortedMarkets.slice(0, Math.max(4, Math.min(48, Math.round(toNum(totalMarketCount, 18)))));
    if (selectedUniverse.length < 4) {
      return {
        stats: {
          startCash: Math.max(100, toNum(startCash, 100000)),
          endEquity: Math.max(100, toNum(startCash, 100000)),
          pnl: 0,
          returnPct: 0,
          maxDrawdownPct: 0,
          cycles: 0
        },
        equitySeries: [],
        cycleRows: [],
        selectedMarkets: []
      };
    }

    const safeSample = Math.max(96, Math.round(toNum(sampleSize, 280)));
    const seriesByKey = {};
    let minLength = Number.POSITIVE_INFINITY;
    const selectedMarkets = [];

    for (const market of selectedUniverse) {
      const raw = Array.isArray(historyByMarket?.[market.key]) ? historyByMarket[market.key] : [];
      const normalized = normalizeSeriesRows(raw, Math.max(2, toNum(market?.spreadBps, 12))).slice(-safeSample);
      if (normalized.length < 40) continue;
      seriesByKey[market.key] = normalized;
      minLength = Math.min(minLength, normalized.length);
      selectedMarkets.push(market);
    }

    if (selectedMarkets.length < 4 || !Number.isFinite(minLength) || minLength < 40) {
      return {
        stats: {
          startCash: Math.max(100, toNum(startCash, 100000)),
          endEquity: Math.max(100, toNum(startCash, 100000)),
          pnl: 0,
          returnPct: 0,
          maxDrawdownPct: 0,
          cycles: 0
        },
        equitySeries: [],
        cycleRows: [],
        selectedMarkets
      };
    }

    const warmup = Math.min(minLength - 1, Math.max(30, Math.round(minLength * 0.28)));
    const stepStride = Math.max(1, Math.round(toNum(totalStride, 3)));
    const startPortfolio = createPdfPortfolioState({
      startCash: Math.max(100, toNum(startCash, 100000))
    });
    let portfolio = startPortfolio;
    let tensorHistory = [];
    const cycleRows = [];
    const equitySeries = [];

    for (let stepIndex = warmup; stepIndex < minLength; stepIndex += stepStride) {
      const stepMarkets = selectedMarkets.map((market) => {
        const series = seriesByKey[market.key];
        const point = series[stepIndex];
        const prev = series[Math.max(0, stepIndex - 1)] || point;
        const price = Math.max(toNum(point?.price, market?.referencePrice), 1e-9);
        const prevPrice = Math.max(toNum(prev?.price, price), 1e-9);
        const changePct = ((price - prevPrice) / prevPrice) * 100;
        return {
          ...market,
          referencePrice: price,
          spreadBps: Math.max(0.2, toNum(point?.spread, market?.spreadBps)),
          totalVolume: Math.max(1, toNum(point?.volume, market?.totalVolume)),
          changePct
        };
      });

      const stepHistoryByMarket = {};
      for (const market of selectedMarkets) {
        stepHistoryByMarket[market.key] = seriesByKey[market.key].slice(0, stepIndex + 1);
      }

      const nowTs = toNum(seriesByKey[selectedMarkets[0].key][stepIndex]?.t, Date.now());
      const baseRankings = rankMarketsByPdf({
        markets: stepMarkets,
        historyByMarket: stepHistoryByMarket,
        buckets: pdfBuckets,
        horizon: Math.max(1, Math.round(toNum(totalHorizon, 3))),
        now: nowTs
      });

      let rankings = baseRankings;
      let tensorSnapshot = null;
      let marketImage = null;
      let tensorPdf = null;

      if (totalSolverMode === 'tensor') {
        tensorSnapshot = buildMarketTensorSnapshot({
          markets: stepMarkets,
          historyByMarket: stepHistoryByMarket,
          now: nowTs,
          limit: 160
        });
        marketImage = buildMarketImageSnapshot({
          markets: stepMarkets,
          tensorSnapshot,
          depthBands: 11
        });
        tensorHistory = [
          ...tensorHistory,
          {
            timestamp: nowTs,
            tensorDriftPct: toNum(tensorSnapshot?.metrics?.tensorDriftPct, 0),
            breadth: toNum(tensorSnapshot?.metrics?.breadth, 0),
            stress: Math.max(0, toNum(tensorSnapshot?.metrics?.stress, 0)),
            imageImbalance: toNum(marketImage?.aggregate?.imbalance, 0)
          }
        ].slice(-520);
        tensorPdf = buildTensorPdfFromHistory({
          tensorHistory,
          buckets: pdfBuckets,
          horizon: Math.max(1, Math.round(toNum(totalHorizon, 3))),
          marketImage,
          tensorSnapshot
        });
        rankings = rankMarketsByTensorPdf({
          baseRankings,
          tensorSnapshot,
          marketImage,
          tensorPdf
        });
      }

      const cycle = simulatePdfPortfolioCycle({
        portfolio,
        rankings,
        markets: stepMarkets,
        topN: Math.max(1, Math.round(toNum(totalTopN, 4))),
        minConfidencePct: Math.max(0, Math.min(100, toNum(totalMinConfidence, 52))),
        feeBps: Math.max(0, toNum(totalFeeBps, 8)),
        timestamp: nowTs
      });

      portfolio = cycle.portfolio;
      equitySeries.push(toNum(portfolio?.equity, 0));
      const best = rankings[0] || null;
      cycleRows.push({
        id: `total-cycle:${nowTs}:${stepIndex}`,
        timestamp: nowTs,
        stepIndex,
        picks: cycle?.picked?.length || 0,
        orders: cycle?.orders?.length || 0,
        equityStart: toNum(cycle?.equityStart, 0),
        equityEnd: toNum(cycle?.equityEnd, 0),
        bestSymbol: best?.symbol || '-',
        bestAction: best?.recommendation?.action || '-',
        bestConfidencePct: toNum(best?.confidencePct, 0),
        bestExpectedMovePct: toNum(best?.expectedMovePct, 0),
        tensorDriftPct: toNum(tensorSnapshot?.metrics?.tensorDriftPct, 0),
        aggregateImbalancePct: toNum(marketImage?.aggregate?.imbalance, 0) * 100,
        tensorMovePct: toNum(tensorPdf?.summary?.expectedMovePct, 0),
        tensorSkew: toNum(tensorPdf?.summary?.skew, 0)
      });
    }

    const endEquity = equitySeries[equitySeries.length - 1] || toNum(startPortfolio?.equity, 0);
    const pnl = endEquity - toNum(startPortfolio?.equity, 0);
    const returnPct = (pnl / Math.max(toNum(startPortfolio?.equity, 1), 1e-9)) * 100;

    return {
      stats: {
        startCash: toNum(startPortfolio?.equity, 0),
        endEquity,
        pnl,
        returnPct,
        maxDrawdownPct: calcMaxDrawdownPct(equitySeries),
        cycles: cycleRows.length
      },
      equitySeries,
      cycleRows: cycleRows.slice(-240).reverse(),
      selectedMarkets
    };
  }, [historyByMarket, pdfBuckets, sampleSize, sortedMarkets, startCash, totalFeeBps, totalHorizon, totalMarketCount, totalMinConfidence, totalSolverMode, totalStride, totalTopN]);

  const solverEvaluation = useMemo(() => {
    if (!Array.isArray(activeSeries) || activeSeries.length < 6) {
      return {
        rankings: [],
        decisionRows: []
      };
    }

    const selectedIds = STRATEGY_OPTIONS.map((option) => String(option.id || '')).filter((id) => solverSelectedIdSet.has(id));
    const signalInputRows = Array.isArray(snapshot?.signals) ? snapshot.signals : [];
    const allDecisionRows = [];
    const rankings = [];

    for (const candidateStrategyId of selectedIds) {
      const candidateResult = runBacktest({
        series: activeSeries,
        strategyId: candidateStrategyId,
        signalRows: signalInputRows,
        selectedMarket,
        startCash: Math.max(100, toNum(startCash, 100000)),
        maxAbsUnits: Math.max(1, toNum(maxAbsUnits, 8)),
        slippageBps: Math.max(0, toNum(slippageBps, 1.2))
      });

      const rawDecisionRows = buildDecisionOutcomeRows({
        signalLog: candidateResult?.signalLog || [],
        series: activeSeries,
        strategyId: candidateStrategyId,
        lookaheadSteps: solverLookaheadSteps
      });

      const actionFilteredRows =
        solverActionFilter === 'all' ? rawDecisionRows : rawDecisionRows.filter((row) => String(row.action) === String(solverActionFilter));

      const decisions = actionFilteredRows.length;
      const correctDecisions = actionFilteredRows.filter((row) => row.correct).length;
      const hitRatePct = decisions > 0 ? (correctDecisions / decisions) * 100 : 0;
      const avgDirectionalMovePct =
        decisions > 0 ? actionFilteredRows.reduce((sum, row) => sum + toNum(row.directionalMovePct, 0), 0) / decisions : 0;
      const avgAbsMovePct = decisions > 0 ? actionFilteredRows.reduce((sum, row) => sum + toNum(row.absMovePct, 0), 0) / decisions : 0;
      const returnPct = toNum(candidateResult?.stats?.returnPct, 0);
      const pnl = toNum(candidateResult?.stats?.pnl, 0);
      const tradeCount = Math.max(0, Math.round(toNum(candidateResult?.stats?.tradeCount, 0)));

      const solverScore = computeHybridScore({
        mode: solverMode,
        hitRatePct,
        returnPct,
        avgDirectionalMovePct,
        decisions,
        minDecisions: solverMinDecisions
      });

      const rowPayload = actionFilteredRows.map((row) => ({
        ...row,
        returnPct,
        pnl
      }));
      allDecisionRows.push(...rowPayload);

      rankings.push({
        strategyId: candidateStrategyId,
        strategyLabel: toStrategyLabel(candidateStrategyId),
        decisions,
        correctDecisions,
        hitRatePct,
        avgDirectionalMovePct,
        avgAbsMovePct,
        tradeCount,
        returnPct,
        pnl,
        solverScore
      });
    }

    rankings.sort((a, b) => b.solverScore - a.solverScore);
    return {
      rankings,
      decisionRows: allDecisionRows
    };
  }, [
    activeSeries,
    maxAbsUnits,
    selectedMarket,
    slippageBps,
    snapshot?.signals,
    solverActionFilter,
    solverLookaheadSteps,
    solverMinDecisions,
    solverMode,
    solverSelectedIdSet,
    startCash
  ]);

  const solverRankings = useMemo(() => {
    return solverEvaluation.rankings.filter((row) => row.decisions >= Math.max(1, Math.round(toNum(solverMinDecisions, 8))));
  }, [solverEvaluation.rankings, solverMinDecisions]);

  const solverTopRankings = useMemo(() => {
    return solverRankings.slice(0, Math.max(1, Math.round(toNum(solverTopN, 6))));
  }, [solverRankings, solverTopN]);

  const solverDecisionFeedRows = useMemo(() => {
    let rows = solverEvaluation.decisionRows;
    if (solverFeedStrategyId !== 'all') {
      rows = rows.filter((row) => String(row.strategyId) === String(solverFeedStrategyId));
    }
    if (solverOutcomeFilter === 'correct') {
      rows = rows.filter((row) => row.correct);
    } else if (solverOutcomeFilter === 'missed') {
      rows = rows.filter((row) => !row.correct);
    }

    const minAbsMove = Math.max(0, toNum(solverMinAbsMovePct, 0));
    rows = rows.filter((row) => Math.abs(toNum(row.absMovePct, 0)) >= minAbsMove);

    const sorted = [...rows].sort((a, b) => {
      if (solverSortMode === 'edge') return Math.abs(toNum(b.directionalMovePct, 0)) - Math.abs(toNum(a.directionalMovePct, 0));
      return toNum(b.timestamp, 0) - toNum(a.timestamp, 0);
    });

    return sorted.slice(0, 360);
  }, [solverEvaluation.decisionRows, solverFeedStrategyId, solverMinAbsMovePct, solverOutcomeFilter, solverSortMode]);

  const toggleSolverStrategy = (candidateId) => {
    const id = String(candidateId || '');
    if (!id) return;
    setSolverStrategyIds((previous) => {
      const set = new Set((Array.isArray(previous) ? previous : []).map((value) => String(value || '')).filter((value) => Boolean(value)));
      if (set.has(id)) {
        set.delete(id);
      } else {
        set.add(id);
      }
      const next = [...set];
      return next.length > 0 ? next : [id];
    });
  };

  const oraclePdfGraph = useMemo(() => {
    const marketLimit = Math.max(4, Math.min(32, Math.round(toNum(oracleGraphMarketCount, 14))));
    const selectedUniverse = sortedMarkets.slice(0, marketLimit);
    const rows = [];
    const safeSample = Math.max(96, Math.round(toNum(sampleSize, 280)));

    for (const market of selectedUniverse) {
      const raw = Array.isArray(historyByMarket?.[market.key]) ? historyByMarket[market.key] : [];
      const normalized = normalizeSeriesRows(raw, Math.max(2, toNum(market?.spreadBps, 12))).slice(-safeSample);
      if (normalized.length < 42) continue;

      const oracle = solveDiscreteWindowOracle({
        series: normalized,
        startCash,
        maxAbsUnits,
        slippageBps,
        windowSize: oracleWindowSize,
        windowStep: oracleWindowStep,
        minMovePct: oracleMinMovePct,
        smoothBlendPct: oracleSmoothBlendPct,
        mode: oracleMode
      });

      const pdf = solveDiscreteWindowPdfPolicy({
        series: normalized,
        startCash,
        maxAbsUnits,
        slippageBps,
        windowSize: oracleWindowSize,
        windowStep: oracleWindowStep,
        minMovePct: oracleMinMovePct,
        smoothBlendPct: oracleSmoothBlendPct,
        mode: oracleMode,
        market,
        buckets: pdfBuckets
      });

      const windows = buildWindowComparisonRows({
        oracleWindows: oracle?.windows || [],
        pdfWindows: pdf?.windows || [],
        minMovePct: oracleMinMovePct
      });
      const totalWindows = windows.length;
      const oracleAccuracyPct = totalWindows > 0 ? (windows.filter((window) => window.oracleCorrect).length / totalWindows) * 100 : 0;
      const pdfAccuracyPct = totalWindows > 0 ? (windows.filter((window) => window.pdfCorrect).length / totalWindows) * 100 : 0;

      rows.push({
        id: `oracle-pdf-market:${market.key}`,
        key: market.key,
        symbol: market.symbol,
        assetClass: market.assetClass,
        oracleReturnPct: toNum(oracle?.stats?.returnPct, 0),
        pdfReturnPct: toNum(pdf?.stats?.returnPct, 0),
        oraclePnl: toNum(oracle?.stats?.pnl, 0),
        pdfPnl: toNum(pdf?.stats?.pnl, 0),
        oracleTrades: Math.max(0, Math.round(toNum(oracle?.stats?.tradeCount, 0))),
        pdfTrades: Math.max(0, Math.round(toNum(pdf?.stats?.tradeCount, 0))),
        oracleAccuracyPct,
        pdfAccuracyPct,
        oracleEdgePct: toNum(oracle?.stats?.returnPct, 0) - toNum(pdf?.stats?.returnPct, 0),
        windowCount: totalWindows
      });
    }

    rows.sort((a, b) => b.oracleEdgePct - a.oracleEdgePct);
    return {
      rows,
      oracleSeries: rows.map((row) => row.oracleReturnPct),
      pdfSeries: rows.map((row) => row.pdfReturnPct),
      edgeSeries: rows.map((row) => row.oracleEdgePct),
      labels: rows.map((row) => row.symbol)
    };
  }, [
    historyByMarket,
    maxAbsUnits,
    oracleGraphMarketCount,
    oracleMinMovePct,
    oracleMode,
    oracleSmoothBlendPct,
    oracleWindowSize,
    oracleWindowStep,
    pdfBuckets,
    sampleSize,
    slippageBps,
    sortedMarkets,
    startCash
  ]);

  const oraclePdfGraphStats = useMemo(() => {
    const rows = oraclePdfGraph.rows;
    if (!rows.length) {
      return {
        markets: 0,
        avgOracleReturnPct: 0,
        avgPdfReturnPct: 0,
        avgOracleEdgePct: 0,
        avgOracleAccuracyPct: 0,
        avgPdfAccuracyPct: 0
      };
    }
    const totals = rows.reduce(
      (acc, row) => {
        acc.oracleReturnPct += toNum(row.oracleReturnPct, 0);
        acc.pdfReturnPct += toNum(row.pdfReturnPct, 0);
        acc.oracleEdgePct += toNum(row.oracleEdgePct, 0);
        acc.oracleAccuracyPct += toNum(row.oracleAccuracyPct, 0);
        acc.pdfAccuracyPct += toNum(row.pdfAccuracyPct, 0);
        return acc;
      },
      {
        oracleReturnPct: 0,
        pdfReturnPct: 0,
        oracleEdgePct: 0,
        oracleAccuracyPct: 0,
        pdfAccuracyPct: 0
      }
    );
    const count = rows.length;
    return {
      markets: count,
      avgOracleReturnPct: totals.oracleReturnPct / count,
      avgPdfReturnPct: totals.pdfReturnPct / count,
      avgOracleEdgePct: totals.oracleEdgePct / count,
      avgOracleAccuracyPct: totals.oracleAccuracyPct / count,
      avgPdfAccuracyPct: totals.pdfAccuracyPct / count
    };
  }, [oraclePdfGraph.rows]);

  const totalMarketStats = totalMarketBacktest?.stats || {
    startCash: Math.max(100, toNum(startCash, 100000)),
    endEquity: Math.max(100, toNum(startCash, 100000)),
    pnl: 0,
    returnPct: 0,
    maxDrawdownPct: 0,
    cycles: 0
  };

  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>Backtest Lab</h1>
          <div className="section-actions">
            <Link to="/other" className="inline-link">
              Back to other
            </Link>
            <Link to="/strategy" className="inline-link">
              Strategy lab
            </Link>
          </div>
        </div>
        <p>Dedicated strategy backtest surface for controlled runs, quick parameter sweeps, and separate trade/signal tapes.</p>
      </GlowCard>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Run Controls</h2>
          <span>{sourceLabel}</span>
        </div>
        <div className="strategy-control-grid">
          <label className="control-field">
            <span>Source</span>
            <select value={sourceMode} onChange={(event) => setSourceMode(event.target.value)}>
              <option value="live-history">live-history</option>
              <option value="provider-history">provider-history</option>
              <option value="scenario">scenario</option>
            </select>
          </label>

          <label className="control-field">
            <span>Strategy</span>
            <select value={strategyId} onChange={(event) => setStrategyId(event.target.value)}>
              {STRATEGY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="control-field">
            <span>Market</span>
            <select value={marketKey} onChange={(event) => setMarketKey(event.target.value)} disabled={!sortedMarkets.length}>
              {sortedMarkets.map((market) => (
                <option key={market.key} value={market.key}>
                  {market.symbol} ({market.assetClass})
                </option>
              ))}
            </select>
          </label>

          <label className="control-field">
            <span>Scenario</span>
            <select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)} disabled={sourceMode !== 'scenario'}>
              {SCENARIO_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="control-field">
            <span>History Window</span>
            <select value={historyWindowKey} onChange={(event) => setHistoryWindowKey(event.target.value)} disabled={sourceMode !== 'provider-history'}>
              {BACKTEST_HISTORY_WINDOW_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="strategy-risk-grid">
          <label className="control-field">
            <span>Sample Size</span>
            <input type="number" min={64} max={720} step={8} value={sampleSize} onChange={(event) => setSampleSize(Math.max(64, Math.min(720, Math.round(toNum(event.target.value, 280)))))} />
          </label>

          <label className="control-field">
            <span>Start Cash</span>
            <input type="number" min={100} step={100} value={startCash} onChange={(event) => setStartCash(Math.max(100, toNum(event.target.value, 100000)))} />
          </label>

          <label className="control-field">
            <span>Max Units</span>
            <input type="number" min={1} step={1} value={maxAbsUnits} onChange={(event) => setMaxAbsUnits(Math.max(1, Math.round(toNum(event.target.value, 8))))} />
          </label>

          <label className="control-field">
            <span>Slippage (bps)</span>
            <input type="number" min={0} step={0.1} value={slippageBps} onChange={(event) => setSlippageBps(Math.max(0, toNum(event.target.value, 1.2)))} />
          </label>
        </div>

        <div className="hero-actions">
          <button type="button" className="btn primary" onClick={runBacktestNow}>
            Run Backtest
          </button>
        </div>
        <p className="socket-status-copy">
          sample {fmtInt(activeSeries.length)} | market {selectedMarket.symbol} | last run {fmtTime(ranAt)}
        </p>
        {sourceMode === 'provider-history' ? (
          <p className="socket-status-copy">
            provider {providerHistoryProviderName || 'none'} | window {historyWindowKey} | rows{' '}
            {fmtInt(providerHistorySeries.length)}
            {providerWindowHistory.loading ? ' | loading...' : ''}
            {providerWindowHistory.error ? ` | ${providerWindowHistory.error}` : ''}
          </p>
        ) : null}
      </GlowCard>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Return</span>
          <strong className={stats.returnPct >= 0 ? 'up' : 'down'}>{fmtPct(stats.returnPct)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>PnL</span>
          <strong className={stats.pnl >= 0 ? 'up' : 'down'}>{fmtNum(stats.pnl, 2)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Trades</span>
          <strong>{fmtInt(stats.tradeCount)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Max Drawdown</span>
          <strong className={stats.maxDrawdownPct > 0 ? 'down' : ''}>{fmtPct(stats.maxDrawdownPct)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Oracle Return</span>
          <strong className={oracleStats.returnPct >= 0 ? 'up' : 'down'}>{fmtPct(oracleStats.returnPct)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>PDF Return</span>
          <strong className={pdfPolicyStats.returnPct >= 0 ? 'up' : 'down'}>{fmtPct(pdfPolicyStats.returnPct)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Oracle Edge</span>
          <strong className={oracleStats.returnPct - stats.returnPct >= 0 ? 'up' : 'down'}>{fmtPct(oracleStats.returnPct - stats.returnPct)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>PDF Edge</span>
          <strong className={pdfPolicyStats.returnPct - stats.returnPct >= 0 ? 'up' : 'down'}>{fmtPct(pdfPolicyStats.returnPct - stats.returnPct)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Oracle vs PDF</span>
          <strong className={oracleStats.returnPct - pdfPolicyStats.returnPct >= 0 ? 'up' : 'down'}>{fmtPct(oracleStats.returnPct - pdfPolicyStats.returnPct)}</strong>
        </GlowCard>
      </div>

      <div className="strategy-lab-chart-grid">
        <GlowCard className="chart-card">
          <LineChart
            title={`Backtest Equity Curve (${fmtInt(result.equitySeries?.length || 0)} points)`}
            points={result.equitySeries || []}
            stroke="#9d92ff"
            fillFrom="rgba(150, 130, 255, 0.3)"
            fillTo="rgba(150, 130, 255, 0.02)"
          />
        </GlowCard>

        <GlowCard className="chart-card">
          <LineChart
            title={`Source Price (${sourceLabel})`}
            points={sourcePriceSeries}
            stroke="#72ecff"
            fillFrom="rgba(82, 199, 255, 0.32)"
            fillTo="rgba(82, 199, 255, 0.02)"
          />
        </GlowCard>
      </div>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Discrete Window Oracle</h2>
          <span>
            {fmtInt(oracleResult?.windows?.length || 0)} windows | {fmtInt(oracleStats.tradeCount)} trades
          </span>
        </div>
        <p className="socket-status-copy">
          Formal discrete-window hindsight solver. For each window it computes the best regime target (long-only or long-short), then rebalances and optionally smooths the target transition.
        </p>

        <div className="strategy-control-grid">
          <label className="control-field">
            <span>Oracle Mode</span>
            <select value={oracleMode} onChange={(event) => setOracleMode(event.target.value)}>
              <option value="long-only">long-only</option>
              <option value="long-short">long-short</option>
            </select>
          </label>

          <label className="control-field">
            <span>Window Size (bars)</span>
            <input
              type="number"
              min={2}
              max={120}
              step={1}
              value={oracleWindowSize}
              onChange={(event) => setOracleWindowSize(Math.max(2, Math.min(120, Math.round(toNum(event.target.value, 12)))))}
            />
          </label>

          <label className="control-field">
            <span>Window Step (bars)</span>
            <input
              type="number"
              min={1}
              max={120}
              step={1}
              value={oracleWindowStep}
              onChange={(event) => setOracleWindowStep(Math.max(1, Math.min(120, Math.round(toNum(event.target.value, 12)))))}
            />
          </label>

          <label className="control-field">
            <span>Min Move % (enter)</span>
            <input
              type="number"
              min={0}
              max={10}
              step={0.01}
              value={oracleMinMovePct}
              onChange={(event) => setOracleMinMovePct(Math.max(0, Math.min(10, toNum(event.target.value, 0.15))))}
            />
          </label>

          <label className="control-field">
            <span>Smooth Blend %</span>
            <input
              type="number"
              min={0}
              max={95}
              step={1}
              value={oracleSmoothBlendPct}
              onChange={(event) => setOracleSmoothBlendPct(Math.max(0, Math.min(95, Math.round(toNum(event.target.value, 0)))))}
            />
          </label>
        </div>

        <LineChart
          title={`Oracle vs Strategy Equity (window ${fmtInt(oracleWindowSize)} / step ${fmtInt(oracleWindowStep)})`}
          points={oracleResult?.equitySeries || []}
          stroke="#8dff8a"
          fillFrom="rgba(100, 232, 136, 0.3)"
          fillTo="rgba(100, 232, 136, 0.02)"
          overlays={[
            {
              key: 'pdf-policy-equity',
              label: 'pdf policy equity',
              points: pdfPolicyResult.equitySeries || [],
              stroke: '#72ecff',
              strokeWidth: 1.6
            },
            {
              key: 'oracle-vs-backtest',
              label: 'backtest equity',
              points: result.equitySeries || [],
              stroke: '#9d92ff',
              strokeWidth: 1.6
            }
          ]}
        />

        <LineChart
          title="Window Regime State Trajectory (Discrete -> Smooth)"
          points={oracleResult?.positionSeries || []}
          stroke="#ffce73"
          fillFrom="rgba(255, 194, 94, 0.28)"
          fillTo="rgba(255, 194, 94, 0.02)"
          unit=" u"
          overlays={[
            {
              key: 'oracle-regime-target',
              label: 'discrete regime target',
              points: oracleResult?.regimeSeries || [],
              stroke: '#72ecff',
              strokeWidth: 1.5,
              dasharray: '6 5'
            }
          ]}
        />
      </GlowCard>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Oracle Window Plan</h2>
            <span>{fmtInt(oracleWindowRows.length)} rows</span>
          </div>
          <FlashList
            items={oracleWindowRows}
            height={320}
            itemHeight={74}
            className="tick-flash-list"
            emptyCopy="No window plan rows yet."
            keyExtractor={(row) => row.id}
            renderItem={(row) => (
              <article className="tensor-event-row">
                <strong className={row.discreteTarget > 0 ? 'up' : row.discreteTarget < 0 ? 'down' : ''}>
                  window {fmtInt(row.windowIndex)} | {row.discreteTarget > 0 ? 'accumulate' : row.discreteTarget < 0 ? 'short' : 'hold'} | move {fmtPct(row.movePct)}
                </strong>
                <p>
                  target {fmtNum(row.targetUnits, 2)} / discrete {fmtNum(row.discreteTarget, 2)} units | executed {fmtNum(row.executedUnits, 2)} units
                </p>
                <small>
                  px {fmtNum(row.startPrice, 4)} {'->'} {fmtNum(row.endPrice, 4)} | bars {fmtInt(row.startIndex)}-{fmtInt(row.endIndex)} | {fmtTime(row.startTs)}
                </small>
              </article>
            )}
          />
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Oracle Trade Tape</h2>
            <span>{fmtInt(oracleResult?.tradeLog?.length || 0)} rows</span>
          </div>
          <FlashList
            items={oracleResult?.tradeLog || []}
            height={320}
            itemHeight={72}
            className="tick-flash-list"
            emptyCopy="No oracle trades generated."
            keyExtractor={(trade) => trade.id}
            renderItem={(trade) => (
              <article className="tensor-event-row">
                <strong className={trade.action === 'accumulate' ? 'up' : trade.action === 'reduce' ? 'down' : ''}>
                  {trade.action} | fill {fmtNum(trade.fillPrice, 4)} | window {fmtInt(trade.windowIndex)}
                </strong>
                <p>{trade.reason || 'oracle execution'}</p>
                <small>
                  delta {fmtNum(trade.unitsDelta, 2)} | units {fmtNum(trade.unitsAfter, 2)} | pnl {fmtNum(trade.realizedDelta, 2)} | {fmtTime(trade.timestamp)}
                </small>
              </article>
            )}
          />
        </GlowCard>
      </div>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>PDF Policy Window Solver</h2>
          <span>
            {fmtInt(pdfPolicyResult?.windows?.length || 0)} windows | {fmtInt(pdfPolicyStats.tradeCount)} trades
          </span>
        </div>
        <p className="socket-status-copy">
          Same discrete windows, but targets come from forward PDF policy estimates (no lookahead). This is the live-usable policy baseline against oracle hindsight.
        </p>
        <p className="socket-status-copy">
          window agreement {fmtPct(oraclePdfWindowStats.agreementPct)} | oracle acc {fmtPct(oraclePdfWindowStats.oracleAccuracyPct)} | pdf acc {fmtPct(oraclePdfWindowStats.pdfAccuracyPct)} | pdf-oracle edge{' '}
          {fmtPct(oraclePdfWindowStats.pdfVsOracleAccuracyEdgePct)}
        </p>
      </GlowCard>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>PDF Window Plan</h2>
            <span>{fmtInt(pdfWindowRows.length)} rows</span>
          </div>
          <FlashList
            items={pdfWindowRows}
            height={320}
            itemHeight={76}
            className="tick-flash-list"
            emptyCopy="No PDF window rows yet."
            keyExtractor={(row) => row.id}
            renderItem={(row) => (
              <article className="tensor-event-row">
                <strong className={row.discreteTarget > 0 ? 'up' : row.discreteTarget < 0 ? 'down' : ''}>
                  window {fmtInt(row.windowIndex)} | {row.action} | conf {fmtNum(row.confidencePct, 1)}%
                </strong>
                <p>
                  E[r] {fmtPct(row.predictedMovePct)} | up {fmtPct(row.upProb * 100)} | down {fmtPct(row.downProb * 100)}
                </p>
                <small>
                  target {fmtNum(row.targetUnits, 2)} / discrete {fmtNum(row.discreteTarget, 2)} | px {fmtNum(row.startPrice, 4)} {'->'} {fmtNum(row.endPrice, 4)} | {fmtTime(row.startTs)}
                </small>
              </article>
            )}
          />
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Oracle vs PDF Window Diff</h2>
            <span>{fmtInt(oraclePdfWindowRows.length)} rows</span>
          </div>
          <FlashList
            items={oraclePdfWindowRows}
            height={320}
            itemHeight={84}
            className="tick-flash-list"
            emptyCopy="No oracle/pdf window comparisons yet."
            keyExtractor={(row) => row.id}
            renderItem={(row) => (
              <article className="tensor-event-row">
                <strong className={row.pdfCorrect ? 'up' : 'down'}>
                  w{fmtInt(row.startIndex)}-{fmtInt(row.endIndex)} | oracle {row.oracleAction} | pdf {row.pdfAction} | {row.agreement ? 'agree' : 'diverge'}
                </strong>
                <p>
                  move {fmtPct(row.movePct)} | pdf E[r] {fmtPct(row.expectedMovePct)} | conf {fmtNum(row.confidencePct, 1)}%
                </p>
                <small>
                  oracle {row.oracleCorrect ? 'hit' : 'miss'} | pdf {row.pdfCorrect ? 'hit' : 'miss'} | oracle tgt {fmtNum(row.oracleTarget, 2)} | pdf tgt {fmtNum(row.pdfTarget, 2)} |{' '}
                  {fmtTime(row.timestamp)}
                </small>
              </article>
            )}
          />
        </GlowCard>
      </div>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Cross-Market Oracle/PDF Graph</h2>
          <span>
            {fmtInt(oraclePdfGraphStats.markets)} markets | avg oracle edge {fmtPct(oraclePdfGraphStats.avgOracleEdgePct)}
          </span>
        </div>
        <p className="socket-status-copy">
          Market graph view of the same window solver setup. Oracle is hindsight upper bound; PDF is policy approximation from local history only.
        </p>
        <div className="strategy-control-grid">
          <label className="control-field">
            <span>Market Count</span>
            <input
              type="number"
              min={4}
              max={32}
              step={1}
              value={oracleGraphMarketCount}
              onChange={(event) => setOracleGraphMarketCount(Math.max(4, Math.min(32, Math.round(toNum(event.target.value, 14)))))}
            />
          </label>
          <label className="control-field">
            <span>Avg Oracle Return</span>
            <input disabled value={fmtPct(oraclePdfGraphStats.avgOracleReturnPct)} />
          </label>
          <label className="control-field">
            <span>Avg PDF Return</span>
            <input disabled value={fmtPct(oraclePdfGraphStats.avgPdfReturnPct)} />
          </label>
          <label className="control-field">
            <span>Avg Accuracy (O/P)</span>
            <input disabled value={`${fmtPct(oraclePdfGraphStats.avgOracleAccuracyPct)} / ${fmtPct(oraclePdfGraphStats.avgPdfAccuracyPct)}`} />
          </label>
        </div>
        <LineChart
          title="Per-Market Return Graph (oracle vs pdf)"
          points={oraclePdfGraph.oracleSeries}
          stroke="#8dff8a"
          fillFrom="rgba(100, 232, 136, 0.22)"
          fillTo="rgba(100, 232, 136, 0.02)"
          unit="%"
          overlays={[
            {
              key: 'oracle-pdf-market-returns',
              label: 'pdf return',
              points: oraclePdfGraph.pdfSeries,
              stroke: '#72ecff',
              strokeWidth: 1.6
            },
            {
              key: 'oracle-pdf-market-edge',
              label: 'oracle edge',
              points: oraclePdfGraph.edgeSeries,
              stroke: '#ffd166',
              strokeWidth: 1.4,
              dasharray: '5 4'
            }
          ]}
        />
      </GlowCard>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Cross-Market Oracle/PDF Tape</h2>
          <span>{fmtInt(oraclePdfGraph.rows.length)} rows</span>
        </div>
        <FlashList
          items={oraclePdfGraph.rows}
          height={320}
          itemHeight={84}
          className="tick-flash-list"
          emptyCopy="Need deeper market history to compare across markets."
          keyExtractor={(row) => row.id}
          renderItem={(row) => (
            <article className="tensor-event-row">
              <strong className={row.oracleEdgePct >= 0 ? 'up' : 'down'}>
                {row.symbol} ({row.assetClass}) | oracle {fmtPct(row.oracleReturnPct)} | pdf {fmtPct(row.pdfReturnPct)}
              </strong>
              <p>
                oracle edge {fmtPct(row.oracleEdgePct)} | windows {fmtInt(row.windowCount)} | trades {fmtInt(row.oracleTrades)} / {fmtInt(row.pdfTrades)}
              </p>
              <small>
                acc oracle {fmtPct(row.oracleAccuracyPct)} | acc pdf {fmtPct(row.pdfAccuracyPct)} | pnl {fmtNum(row.oraclePnl, 2)} / {fmtNum(row.pdfPnl, 2)}
              </small>
            </article>
          )}
        />
      </GlowCard>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Total Market Image/PDF Solver Backtest</h2>
          <span>
            {totalSolverMode} | {fmtInt(totalMarketStats.cycles)} cycles | {fmtInt(totalMarketBacktest?.selectedMarkets?.length || 0)} markets
          </span>
        </div>
        <p className="socket-status-copy">
          Cross-market backtest using market image + tensor PDF regime features. This approximates a total-market solver running portfolio cycles over discrete historical steps.
        </p>

        <div className="strategy-control-grid">
          <label className="control-field">
            <span>Solver Engine</span>
            <select value={totalSolverMode} onChange={(event) => setTotalSolverMode(event.target.value)}>
              <option value="tensor">tensor + market-image</option>
              <option value="pdf">pdf only</option>
            </select>
          </label>

          <label className="control-field">
            <span>Markets</span>
            <input
              type="number"
              min={4}
              max={48}
              step={1}
              value={totalMarketCount}
              onChange={(event) => setTotalMarketCount(Math.max(4, Math.min(48, Math.round(toNum(event.target.value, 18)))))}
            />
          </label>

          <label className="control-field">
            <span>Stride (bars)</span>
            <input
              type="number"
              min={1}
              max={30}
              step={1}
              value={totalStride}
              onChange={(event) => setTotalStride(Math.max(1, Math.min(30, Math.round(toNum(event.target.value, 3)))))}
            />
          </label>

          <label className="control-field">
            <span>Horizon</span>
            <select value={totalHorizon} onChange={(event) => setTotalHorizon(Math.max(1, toNum(event.target.value, 3)))}>
              {PDF_HORIZONS.map((horizon) => (
                <option key={`total-h:${horizon}`} value={horizon}>
                  {horizon}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="strategy-control-grid">
          <label className="control-field">
            <span>Top N Picks</span>
            <input type="number" min={1} max={12} step={1} value={totalTopN} onChange={(event) => setTotalTopN(Math.max(1, Math.min(12, Math.round(toNum(event.target.value, 4)))))} />
          </label>

          <label className="control-field">
            <span>Min Confidence %</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={totalMinConfidence}
              onChange={(event) => setTotalMinConfidence(Math.max(0, Math.min(100, Math.round(toNum(event.target.value, 52)))))}
            />
          </label>

          <label className="control-field">
            <span>Fee (bps)</span>
            <input type="number" min={0} max={60} step={0.5} value={totalFeeBps} onChange={(event) => setTotalFeeBps(Math.max(0, Math.min(60, toNum(event.target.value, 8))))} />
          </label>

          <label className="control-field">
            <span>Return / Drawdown</span>
            <input value={`${fmtPct(totalMarketStats.returnPct)} / ${fmtPct(totalMarketStats.maxDrawdownPct)}`} disabled />
          </label>
        </div>

        <LineChart
          title="Total Market Solver Equity"
          points={totalMarketBacktest?.equitySeries || []}
          stroke="#62ffcc"
          fillFrom="rgba(98, 255, 204, 0.3)"
          fillTo="rgba(98, 255, 204, 0.02)"
        />
      </GlowCard>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Total Market Cycle Tape</h2>
          <span>{fmtInt(totalMarketBacktest?.cycleRows?.length || 0)} rows</span>
        </div>
        <FlashList
          items={totalMarketBacktest?.cycleRows || []}
          height={320}
          itemHeight={82}
          className="tick-flash-list"
          emptyCopy="No total market cycles yet (insufficient history depth)."
          keyExtractor={(row) => row.id}
          renderItem={(row) => (
            <article className="tensor-event-row">
              <strong className={row.equityEnd >= row.equityStart ? 'up' : 'down'}>
                cycle {fmtInt(row.stepIndex)} | {row.bestSymbol} | {row.bestAction}
              </strong>
              <p>
                conf {fmtNum(row.bestConfidencePct, 1)}% | expected {fmtPct(row.bestExpectedMovePct)} | picks {fmtInt(row.picks)} | orders {fmtInt(row.orders)}
              </p>
              <small>
                eq {fmtNum(row.equityStart, 2)} {'->'} {fmtNum(row.equityEnd, 2)} | drift {fmtPct(row.tensorDriftPct)} | img {fmtPct(row.aggregateImbalancePct)} | tensor move{' '}
                {fmtPct(row.tensorMovePct)} | skew {fmtNum(row.tensorSkew, 3)} | {fmtTime(row.timestamp)}
              </small>
            </article>
          )}
        />
      </GlowCard>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Decision Hybrid Solver</h2>
          <span>
            {fmtInt(solverTopRankings.length)} ranked | {fmtInt(solverDecisionFeedRows.length)} filtered decisions
          </span>
        </div>
        <p className="socket-status-copy">
          After-the-fact decision scoring across strategies on the same series. Use this to inspect which strategy decisions were most accurate by horizon.
        </p>

        <div className="strategy-control-grid">
          <label className="control-field">
            <span>Solver Mode</span>
            <select value={solverMode} onChange={(event) => setSolverMode(event.target.value)}>
              <option value="hybrid">hybrid (accuracy + pnl + edge)</option>
              <option value="accuracy">accuracy only</option>
              <option value="pnl">pnl only</option>
            </select>
          </label>

          <label className="control-field">
            <span>Lookahead (bars)</span>
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              value={solverLookaheadSteps}
              onChange={(event) => setSolverLookaheadSteps(Math.max(1, Math.min(20, Math.round(toNum(event.target.value, 1)))))}
            />
          </label>

          <label className="control-field">
            <span>Top N Strategies</span>
            <input type="number" min={1} max={21} step={1} value={solverTopN} onChange={(event) => setSolverTopN(Math.max(1, Math.min(21, Math.round(toNum(event.target.value, 6)))))} />
          </label>

          <label className="control-field">
            <span>Min Decisions</span>
            <input
              type="number"
              min={1}
              max={120}
              step={1}
              value={solverMinDecisions}
              onChange={(event) => setSolverMinDecisions(Math.max(1, Math.min(120, Math.round(toNum(event.target.value, 8)))))}
            />
          </label>
        </div>

        <div className="strategy-control-grid">
          <label className="control-field">
            <span>Action Filter</span>
            <select value={solverActionFilter} onChange={(event) => setSolverActionFilter(event.target.value)}>
              <option value="all">all actions</option>
              <option value="accumulate">accumulate only</option>
              <option value="reduce">reduce only</option>
            </select>
          </label>

          <label className="control-field">
            <span>Feed Strategy</span>
            <select value={solverFeedStrategyId} onChange={(event) => setSolverFeedStrategyId(event.target.value)}>
              <option value="all">all strategies</option>
              {STRATEGY_OPTIONS.map((option) => (
                <option key={`solver-feed:${option.id}`} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="control-field">
            <span>Outcome Filter</span>
            <select value={solverOutcomeFilter} onChange={(event) => setSolverOutcomeFilter(event.target.value)}>
              <option value="all">all outcomes</option>
              <option value="correct">correct only</option>
              <option value="missed">missed only</option>
            </select>
          </label>

          <label className="control-field">
            <span>Min Move %</span>
            <input
              type="number"
              min={0}
              max={20}
              step={0.05}
              value={solverMinAbsMovePct}
              onChange={(event) => setSolverMinAbsMovePct(Math.max(0, Math.min(20, toNum(event.target.value, 0))))}
            />
          </label>
        </div>

        <div className="section-actions">
          <button
            type="button"
            className="btn secondary"
            onClick={() => setSolverStrategyIds(STRATEGY_OPTIONS.map((option) => option.id))}
          >
            Select All Strategies
          </button>
          <button type="button" className="btn secondary" onClick={() => setSolverStrategyIds([strategyId])}>
            Current Strategy Only
          </button>
          <button type="button" className="btn secondary" onClick={() => setSolverSortMode((prev) => (prev === 'latest' ? 'edge' : 'latest'))}>
            Sort Feed: {solverSortMode === 'latest' ? 'latest first' : 'edge first'}
          </button>
        </div>

        <div className="strategy-enabled-grid">
          {STRATEGY_OPTIONS.map((option) => {
            const checked = solverSelectedIdSet.has(String(option.id || ''));
            return (
              <label key={`solver-strategy:${option.id}`} className={checked ? 'strategy-toggle-chip active' : 'strategy-toggle-chip'}>
                <input type="checkbox" checked={checked} onChange={() => toggleSolverStrategy(option.id)} />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      </GlowCard>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Best Strategy Decisions</h2>
            <span>{fmtInt(solverTopRankings.length)} rows</span>
          </div>
          <div className="list-stack">
            {solverTopRankings.map((row, index) => (
              <article key={`solver-rank:${row.strategyId}`} className="list-item">
                <strong>
                  {index + 1}. {row.strategyLabel}
                </strong>
                <p>
                  solver score {fmtNum(row.solverScore, 2)} | hit {fmtPct(row.hitRatePct)} | avg edge {fmtPct(row.avgDirectionalMovePct)}
                </p>
                <div className="item-meta">
                  <small>decisions {fmtInt(row.decisions)}</small>
                  <small>correct {fmtInt(row.correctDecisions)}</small>
                  <small>return {fmtPct(row.returnPct)}</small>
                  <small>pnl {fmtNum(row.pnl, 2)}</small>
                  <small>trades {fmtInt(row.tradeCount)}</small>
                  <Link to={`/strategy/${encodeURIComponent(row.strategyId)}`} className="inline-link">
                    open strategy
                  </Link>
                </div>
              </article>
            ))}
            {solverTopRankings.length === 0 ? <p className="action-message">No ranking rows yet. Lower min decisions or broaden selected strategies.</p> : null}
          </div>
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Hybrid Decision Filter Feed</h2>
            <span>{fmtInt(solverDecisionFeedRows.length)} rows</span>
          </div>
          <FlashList
            items={solverDecisionFeedRows}
            height={340}
            itemHeight={80}
            className="tick-flash-list"
            emptyCopy="No decision rows for current filters."
            keyExtractor={(row) => row.id}
            renderItem={(row) => (
              <article className="tensor-event-row">
                <strong className={row.correct ? 'up' : 'down'}>
                  {row.strategyLabel} | {row.action} | {row.correct ? 'correct' : 'missed'}
                </strong>
                <p>{row.reason || 'decision context'}</p>
                <small>
                  dir edge {fmtPct(row.directionalMovePct)} | raw move {fmtPct(row.movePct)} | px {fmtNum(row.fromPrice, 4)} {'->'} {fmtNum(row.toPrice, 4)} | horizon{' '}
                  {fmtInt(row.horizon)} | score {fmtNum(row.score, 2)} | {fmtTime(row.timestamp)}
                </small>
              </article>
            )}
          />
        </GlowCard>
      </div>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Backtest Trade Tape</h2>
            <span>{fmtInt(tradeRows.length)} rows</span>
          </div>
          <FlashList
            items={tradeRows}
            height={320}
            itemHeight={72}
            className="tick-flash-list"
            emptyCopy="No backtest trades generated for this run."
            keyExtractor={(trade) => trade.id}
            renderItem={(trade) => (
              <article className="tensor-event-row">
                <strong className={trade.action === 'accumulate' ? 'up' : trade.action === 'reduce' ? 'down' : ''}>
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
            <span>{fmtInt(signalRows.length)} rows</span>
          </div>
          <FlashList
            items={signalRows}
            height={320}
            itemHeight={72}
            className="tick-flash-list"
            emptyCopy="No backtest signals generated for this run."
            keyExtractor={(signal) => signal.id}
            renderItem={(signal) => (
              <article className="tensor-event-row">
                <strong className={signal.action === 'accumulate' ? 'up' : signal.action === 'reduce' ? 'down' : ''}>
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
    </section>
  );
}
