import { useEffect, useMemo, useState } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import LineChart from '../components/LineChart';
import { fmtInt, fmtNum, fmtPct, fmtTime } from '../lib/format';
import { Link } from '../lib/router';
import { buildScenarioSeries, runBacktest, SCENARIO_OPTIONS, STRATEGY_OPTIONS } from '../lib/strategyEngine';

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

  useEffect(() => {
    if (!sortedMarkets.length) {
      setMarketKey('');
      return;
    }
    if (!marketKey || !sortedMarkets.some((market) => market.key === marketKey)) {
      setMarketKey(sortedMarkets[0].key);
    }
  }, [marketKey, sortedMarkets]);

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

  const runBacktestNow = () => {
    setRunTick((value) => value + 1);
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
