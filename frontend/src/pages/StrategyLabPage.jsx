import { useCallback, useEffect, useMemo, useState } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import LineChart from '../components/LineChart';
import useStrategyLab from '../hooks/useStrategyLab';
import { fmtInt, fmtNum, fmtPct, fmtTime } from '../lib/format';
import { buildClassicAnalysis } from '../lib/indicators';
import { buildPdfBuckets, createPdfPortfolioState, markPdfPortfolio, PDF_HORIZONS, rankMarketsByPdf, simulatePdfPortfolioCycle } from '../lib/probabilityLab';
import { Link } from '../lib/router';
import { useExecutionFeedStore } from '../store/executionFeedStore';

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
  { id: 'overview', label: 'Overview' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'strategy', label: 'Strategy' }
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
    scenarioId,
    intervalMs,
    maxAbsUnits,
    slippageBps,
    cooldownMs,
    runtimeSeries,
    runtimeEquity,
    wallet,
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
    changeStrategy,
    changeScenario,
    changeMarket,
    changeRisk,
    addWalletAccount,
    updateWalletAccount,
    removeWalletAccount,
    clearWalletAccounts,
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
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountCash, setNewAccountCash] = useState(100000);
  const [solverTopN, setSolverTopN] = useState(4);
  const [solverHorizon, setSolverHorizon] = useState(3);
  const [solverMinConfidence, setSolverMinConfidence] = useState(45);
  const [solverFeeBps, setSolverFeeBps] = useState(8);
  const [solverAuto, setSolverAuto] = useState(false);
  const [solverPortfolio, setSolverPortfolio] = useState(() => createPdfPortfolioState({ startCash: 100000 }));
  const [solverOrderLog, setSolverOrderLog] = useState([]);
  const [labView, setLabView] = useState('overview');
  const [drilldownAccountId, setDrilldownAccountId] = useState('');

  const handleAddAccount = () => {
    const safeName = String(newAccountName || '').trim();
    const safeCash = Math.max(100, Number(newAccountCash) || 100000);
    addWalletAccount({
      name: safeName || `Paper ${walletAccounts.length + 1}`,
      startCash: safeCash
    });
    setNewAccountName('');
    setNewAccountCash(100000);
  };

  const activeAccount = useMemo(() => {
    return walletAccounts.find((account) => account.id === activeWalletAccountId) || walletAccounts[0] || null;
  }, [activeWalletAccountId, walletAccounts]);

  useEffect(() => {
    if (walletAccounts.length === 0) {
      if (drilldownAccountId) setDrilldownAccountId('');
      return;
    }
    if (drilldownAccountId && walletAccounts.some((account) => account.id === drilldownAccountId)) return;
    if (activeWalletAccountId && walletAccounts.some((account) => account.id === activeWalletAccountId)) {
      setDrilldownAccountId(activeWalletAccountId);
      return;
    }
    setDrilldownAccountId(walletAccounts[0].id);
  }, [activeWalletAccountId, drilldownAccountId, walletAccounts]);

  const selectedDrillAccount = useMemo(() => {
    if (!drilldownAccountId) return null;
    return walletAccounts.find((account) => account.id === drilldownAccountId) || null;
  }, [drilldownAccountId, walletAccounts]);

  const enabledAccountCount = useMemo(() => {
    return walletAccounts.filter((account) => account.enabled).length;
  }, [walletAccounts]);

  const strategyMeta = useMemo(() => {
    return strategyOptions.find((option) => option.id === strategyId) || null;
  }, [strategyId, strategyOptions]);

  const strategyLabel = strategyMeta?.label || strategyId;
  const strategyDescription = strategyMeta?.description || 'No description available yet.';

  const selectedAccountTradeRows = useMemo(() => {
    if (!selectedDrillAccount) return [];
    return tradeLog.filter((trade) => trade.accountId === selectedDrillAccount.id);
  }, [selectedDrillAccount, tradeLog]);

  const selectedAccountTxRows = useMemo(() => {
    if (!selectedDrillAccount) return [];
    return txEvents.filter((row) => row.accountId === selectedDrillAccount.id);
  }, [selectedDrillAccount, txEvents]);

  const selectedAccountPositionRows = useMemo(() => {
    if (!selectedDrillAccount) return [];
    return positionEvents.filter((row) => row.accountId === selectedDrillAccount.id);
  }, [positionEvents, selectedDrillAccount]);

  const selectedAccountEquitySeries = useMemo(() => {
    if (!selectedDrillAccount) return [];
    const points = selectedAccountPositionRows
      .slice()
      .sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0))
      .map((row) => Number(row?.wallet?.equity))
      .filter((value) => Number.isFinite(value))
      .slice(-320);
    if (points.length >= 2) return points;
    const start = Number(selectedDrillAccount.startCash) || 100000;
    const current = Number(selectedDrillAccount.wallet?.equity);
    const safeCurrent = Number.isFinite(current) ? current : start;
    return [start, safeCurrent];
  }, [selectedAccountPositionRows, selectedDrillAccount]);

  const selectedStrategyTradeRows = useMemo(() => {
    return tradeLog.filter((trade) => String(trade.strategyId || strategyId) === strategyId);
  }, [strategyId, tradeLog]);

  const selectedStrategyTxRows = useMemo(() => {
    return txEvents.filter((event) => String(event.strategyId || '') === strategyId);
  }, [strategyId, txEvents]);

  const selectedStrategyPositionRows = useMemo(() => {
    return positionEvents.filter((event) => String(event.strategyId || '') === strategyId);
  }, [positionEvents, strategyId]);

  const selectedStrategyWinRate = useMemo(() => {
    if (!selectedStrategyTradeRows.length) return 0;
    const wins = selectedStrategyTradeRows.filter((trade) => Number(trade.realizedDelta) > 0).length;
    return (wins / selectedStrategyTradeRows.length) * 100;
  }, [selectedStrategyTradeRows]);

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

  const solverRankings = useMemo(() => {
    return rankMarketsByPdf({
      markets: snapshot?.markets || [],
      historyByMarket,
      buckets: solverBuckets,
      horizons: PDF_HORIZONS,
      horizon: solverHorizon,
      now: snapshot?.now || Date.now()
    });
  }, [historyByMarket, snapshot?.markets, snapshot?.now, solverBuckets, solverHorizon]);

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
          timestamp,
          picks: result.picked.length,
          orders: result.orders.length,
          equityStart: result.equityStart,
          equityEnd: result.equityEnd
        };
        const orderEvents = result.orders.map((order) => ({
          ...order,
          kind: 'order',
          source
        }));
        return [cycleEvent, ...orderEvents, ...previous].slice(0, 320);
      });
    },
    [snapshot?.markets, solverFeeBps, solverMinConfidence, solverPortfolio, solverRankings, solverTopN]
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
  }, []);

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
            <span>{strategyLabel}</span>
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
              <span>Strategy</span>
              <select value={strategyId} onChange={(event) => changeStrategy(event.target.value)}>
                {strategyOptions.map((option) => (
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
            <span className={hasLiveHistory ? 'status-pill online' : 'status-pill'}>history {hasLiveHistory ? 'available' : 'limited'}</span>
          </div>
          <p className="socket-status-copy">{strategyDescription}</p>
        </GlowCard>

        <GlowCard className="panel-card strategy-lab-overview-card">
          <div className="section-head">
            <h2>Session Overview</h2>
            <span>{activeAccount?.name || 'paper account'}</span>
          </div>
          <div className="strategy-lab-mini-grid">
            <article className="strategy-lab-mini-stat">
              <span>Wallet Equity</span>
              <strong className={toneClass(wallet.equity - 100000)}>{fmtNum(wallet.equity, 2)}</strong>
            </article>
            <article className="strategy-lab-mini-stat">
              <span>Realized PnL</span>
              <strong className={toneClass(wallet.realizedPnl)}>{fmtNum(wallet.realizedPnl, 2)}</strong>
            </article>
            <article className="strategy-lab-mini-stat">
              <span>Unrealized PnL</span>
              <strong className={toneClass(wallet.unrealizedPnl)}>{fmtNum(wallet.unrealizedPnl, 2)}</strong>
            </article>
            <article className="strategy-lab-mini-stat">
              <span>Position</span>
              <strong>{fmtNum(wallet.units, 0)} units</strong>
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

        {labView === 'overview' ? (
          <div className="strategy-drill-grid">
            <article className="strategy-drill-card">
              <LineChart
                title={`Overview Combo (${selectedMarket?.symbol || 'SIM'})`}
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
                <h2>Overview Drilldown</h2>
                <span>{fmtInt(walletAccounts.length)} accounts</span>
              </div>
              <div className="strategy-drill-controls">
                <label className="control-field">
                  <span>Drill Account</span>
                  <select value={drilldownAccountId} onChange={(event) => setDrilldownAccountId(event.target.value)} disabled={walletAccounts.length === 0}>
                    {walletAccounts.length === 0 ? (
                      <option value="">No accounts</option>
                    ) : (
                      walletAccounts.map((account) => (
                        <option key={`drill:${account.id}`} value={account.id}>
                          {account.name}
                        </option>
                      ))
                    )}
                  </select>
                </label>
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
                <div className="strategy-drill-controls">
                  <label className="control-field">
                    <span>Selected Account</span>
                    <select value={drilldownAccountId} onChange={(event) => setDrilldownAccountId(event.target.value)} disabled={walletAccounts.length === 0}>
                      {walletAccounts.length === 0 ? (
                        <option value="">No accounts</option>
                      ) : (
                        walletAccounts.map((account) => (
                          <option key={`account-drill:${account.id}`} value={account.id}>
                            {account.name}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
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
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={!selectedDrillAccount}
                    onClick={() => {
                      if (!selectedDrillAccount) return;
                      removeWalletAccount(selectedDrillAccount.id);
                    }}
                  >
                    Remove Selected
                  </button>
                  <button type="button" className="btn secondary" disabled={walletAccounts.length === 0} onClick={clearWalletAccounts}>
                    Delete All Accounts
                  </button>
                </div>
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
                <div className="strategy-lab-mini-grid">
                  <article className="strategy-lab-mini-stat">
                    <span>Runtime Trigger Events</span>
                    <strong>{fmtInt(eventLog.length)}</strong>
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
                  <span>{fmtInt(eventLog.length)} rows</span>
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
                        {item.triggerKind} | score {fmtNum(item.score, 2)} | px {fmtNum(item.price, 4)} | {fmtTime(item.timestamp)}
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

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>PDF Portfolio Solver</h2>
          <span>multimarket top-N rebalance simulation</span>
        </div>
        <p className="socket-status-copy">
          Legacy-style portfolio solver over probability density rankings. Runs weighted allocation into strongest positive-PDF markets and rebalances each cycle.
        </p>
        <div className="pdf-solver-control-grid">
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
            Run PDF Rebalance
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
            <span>Last Update</span>
            <strong>{fmtTime(markedSolverPortfolio.updatedAt)}</strong>
          </article>
        </div>
      </GlowCard>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>PDF Allocation Targets</h2>
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
                    <strong>cycle | {item.source}</strong>
                    <p>
                      picks {fmtInt(item.picks)} | orders {fmtInt(item.orders)}
                    </p>
                    <small>
                      equity {fmtNum(item.equityStart, 2)} -> {fmtNum(item.equityEnd, 2)} | {fmtTime(item.timestamp)}
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
                    price {fmtNum(item.price, 4)} | {item.assetClass} | {item.source} | {fmtTime(item.timestamp)}
                  </small>
                </article>
              );
            }}
          />
        </GlowCard>
      </div>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Fake Accounts</h2>
          <span>{walletAccounts.length} active profiles</span>
        </div>
        <div className="strategy-account-create">
          <label className="control-field">
            <span>Account Name</span>
            <input value={newAccountName} onChange={(event) => setNewAccountName(event.target.value)} placeholder="Paper Alpha" maxLength={32} />
          </label>
          <label className="control-field">
            <span>Start Cash</span>
            <input type="number" min={100} step={100} value={newAccountCash} onChange={(event) => setNewAccountCash(Math.max(100, Number(event.target.value) || 100000))} />
          </label>
          <div className="hero-actions">
            <button type="button" className="btn secondary" onClick={handleAddAccount}>
              Add Account
            </button>
            <button type="button" className="btn secondary" disabled={walletAccounts.length === 0} onClick={clearWalletAccounts}>
              Delete All Accounts
            </button>
          </div>
        </div>
        <div className="strategy-account-grid">
          {walletAccounts.map((account) => (
            <article key={account.id} className={account.id === activeWalletAccountId ? 'strategy-account-card active' : 'strategy-account-card'}>
              <div className="strategy-account-head">
                <label className="toggle-label">
                  <input type="checkbox" checked={account.id === activeWalletAccountId} onChange={() => setActiveWalletAccount(account.id)} />
                  <span>{account.name}</span>
                </label>
                <span className={account.enabled ? 'status-pill online' : 'status-pill'}>{account.enabled ? 'enabled' : 'paused'}</span>
              </div>
              <div className="strategy-account-metrics">
                <small>eq {fmtNum(account.wallet.equity, 2)}</small>
                <small>cash {fmtNum(account.wallet.cash, 2)}</small>
                <small>units {fmtNum(account.wallet.units, 0)}</small>
              </div>
              <div className="strategy-account-controls">
                <label className="control-field">
                  <span>Max Units</span>
                  <input
                    type="number"
                    min={1}
                    max={80}
                    step={1}
                    value={account.maxAbsUnits}
                    onChange={(event) => updateWalletAccount(account.id, { maxAbsUnits: event.target.value })}
                  />
                </label>
                <label className="control-field">
                  <span>Slippage</span>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    step={0.1}
                    value={account.slippageBps}
                    onChange={(event) => updateWalletAccount(account.id, { slippageBps: event.target.value })}
                  />
                </label>
              </div>
              <div className="strategy-account-actions">
                <label className="toggle-label">
                  <input type="checkbox" checked={account.enabled} onChange={(event) => updateWalletAccount(account.id, { enabled: event.target.checked })} />
                  <span>Allow execution</span>
                </label>
                <button type="button" className="btn secondary" onClick={() => removeWalletAccount(account.id)}>
                  Remove
                </button>
              </div>
            </article>
          ))}
          {walletAccounts.length === 0 ? <p className="action-message">No paper accounts. Add a new account to resume paper execution.</p> : null}
        </div>
      </GlowCard>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Signal Set -> Strategy</h2>
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
                  {item.triggerKind} | sigs {fmtInt(item.signalCount)} | score {fmtNum(item.score, 2)} | px {fmtNum(item.price, 4)} | spr{' '}
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
                  units {fmtNum(trade.unitsAfter, 0)} | realized {fmtNum(trade.realizedDelta, 2)} | spread {fmtNum(trade.spreadBps, 2)} bps |{' '}
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
                  eq {fmtNum(event.wallet.equity, 2)} | cash {fmtNum(event.wallet.cash, 2)} | mark {fmtNum(event.wallet.markPrice, 4)} | notional{' '}
                  {fmtNum(event.wallet.positionNotional, 2)} | {fmtTime(event.timestamp)}
                </small>
              </article>
            )}
          />
        </GlowCard>
      </div>

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
    </section>
  );
}
