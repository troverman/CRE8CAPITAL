import { useEffect, useMemo, useState } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import LineChart from '../components/LineChart';
import { fmtInt, fmtNum, fmtPct, fmtTime } from '../lib/format';
import { Link } from '../lib/router';
import { buildScenarioSeries, createWalletState, executeWalletAction, markWallet, runBacktest, SCENARIO_OPTIONS, STRATEGY_OPTIONS } from '../lib/strategyEngine';

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

const solveDiscreteWindowOracle = ({
  series = [],
  startCash = 100000,
  maxAbsUnits = 8,
  slippageBps = 1.2,
  windowSize = 12,
  windowStep = 12,
  minMovePct = 0,
  smoothBlendPct = 0
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
      windows: []
    };
  }

  const safeStartCash = Math.max(100, toNum(startCash, 100000));
  const safeMaxUnits = Math.max(1, Math.round(toNum(maxAbsUnits, 8)));
  const safeSlippage = Math.max(0, toNum(slippageBps, 1.2));
  const safeWindowSize = Math.max(2, Math.round(toNum(windowSize, 12)));
  const safeWindowStep = Math.max(1, Math.round(toNum(windowStep, safeWindowSize)));
  const safeMinMovePct = Math.max(0, toNum(minMovePct, 0));
  const smoothBlend = clamp(toNum(smoothBlendPct, 0) / 100, 0, 1);

  const windows = [];
  for (let startIndex = 0; startIndex < safeSeries.length - 1; startIndex += safeWindowStep) {
    const endIndex = Math.min(safeSeries.length - 1, startIndex + safeWindowSize - 1);
    const startPoint = safeSeries[startIndex];
    const endPoint = safeSeries[endIndex];
    const startPrice = Math.max(toNum(startPoint?.price, 0), 1e-9);
    const endPrice = Math.max(toNum(endPoint?.price, 0), 1e-9);
    const movePct = ((endPrice - startPrice) / startPrice) * 100;
    const discreteTarget = movePct > safeMinMovePct ? safeMaxUnits : 0;
    const action = discreteTarget > 0 ? 'accumulate' : 'hold';
    windows.push({
      id: `window:${startIndex}:${endIndex}`,
      windowIndex: windows.length,
      startIndex,
      endIndex,
      startTs: toNum(startPoint?.t, Date.now()),
      endTs: toNum(endPoint?.t, Date.now()),
      startPrice,
      endPrice,
      movePct,
      action,
      discreteTarget
    });
  }

  const windowByStartIndex = new Map(windows.map((row) => [row.startIndex, row]));
  let wallet = createWalletState(safeStartCash);
  const tradeLog = [];
  const equitySeries = [];

  const rebalanceToTarget = ({ point, targetUnits, windowIndex = -1, reason = 'oracle-window' }) => {
    let guard = 0;
    const target = clamp(toNum(targetUnits, 0), 0, safeMaxUnits);
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
      const blendedTarget = clamp(currentUnits + (window.discreteTarget - currentUnits) * (1 - smoothBlend), 0, safeMaxUnits);
      window.targetUnits = blendedTarget;
      rebalanceToTarget({
        point,
        targetUnits: blendedTarget,
        windowIndex: window.windowIndex,
        reason: `oracle window ${window.windowIndex} move ${window.movePct.toFixed(3)}%`
      });
      window.executedUnits = toNum(wallet?.units, 0);
    }

    if (index === safeSeries.length - 1) {
      rebalanceToTarget({
        point,
        targetUnits: 0,
        windowIndex: -1,
        reason: 'oracle end-of-series flatten'
      });
    }

    wallet = markWallet(wallet, toNum(point?.price, 0));
    equitySeries.push(toNum(wallet?.equity, safeStartCash));
  }

  const endEquity = equitySeries[equitySeries.length - 1] || safeStartCash;
  const pnl = endEquity - safeStartCash;
  const returnPct = (pnl / Math.max(safeStartCash, 1e-9)) * 100;
  const drawdownPct = calcMaxDrawdownPct(equitySeries);

  return {
    stats: {
      startCash: safeStartCash,
      endEquity,
      pnl,
      returnPct,
      maxDrawdownPct: drawdownPct,
      tradeCount: tradeLog.length
    },
    equitySeries,
    tradeLog: tradeLog.slice(-320).reverse(),
    windows
  };
};

export default function BacktestPage({ snapshot, historyByMarket }) {
  const sortedMarkets = useMemo(() => sortMarkets(snapshot?.markets || []), [snapshot?.markets]);
  const [sourceMode, setSourceMode] = useState('live-history');
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
  const [oracleWindowSize, setOracleWindowSize] = useState(12);
  const [oracleWindowStep, setOracleWindowStep] = useState(12);
  const [oracleMinMovePct, setOracleMinMovePct] = useState(0.15);
  const [oracleSmoothBlendPct, setOracleSmoothBlendPct] = useState(0);

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

  const activeSeries = sourceMode === 'live-history' ? liveSeries : scenarioSeries;
  const sourceLabel = sourceMode === 'live-history' ? `live history (${selectedMarket.symbol})` : `scenario (${scenarioId})`;

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

  const oracleResult = useMemo(() => {
    return solveDiscreteWindowOracle({
      series: activeSeries,
      startCash,
      maxAbsUnits,
      slippageBps,
      windowSize: oracleWindowSize,
      windowStep: oracleWindowStep,
      minMovePct: oracleMinMovePct,
      smoothBlendPct: oracleSmoothBlendPct
    });
  }, [activeSeries, maxAbsUnits, oracleMinMovePct, oracleSmoothBlendPct, oracleWindowSize, oracleWindowStep, slippageBps, startCash]);

  const oracleStats = oracleResult?.stats || {
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
          <span>Oracle Edge</span>
          <strong className={oracleStats.returnPct - stats.returnPct >= 0 ? 'up' : 'down'}>{fmtPct(oracleStats.returnPct - stats.returnPct)}</strong>
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
          Formal discrete-window hindsight solver. For each window it computes the best long-only target, then rebalances and optionally smooths the target transition.
        </p>

        <div className="strategy-control-grid">
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
              key: 'oracle-vs-backtest',
              label: 'backtest equity',
              points: result.equitySeries || [],
              stroke: '#9d92ff',
              strokeWidth: 1.6
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
                <strong className={row.discreteTarget > 0 ? 'up' : ''}>
                  window {fmtInt(row.windowIndex)} | {row.discreteTarget > 0 ? 'accumulate' : 'hold'} | move {fmtPct(row.movePct)}
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
