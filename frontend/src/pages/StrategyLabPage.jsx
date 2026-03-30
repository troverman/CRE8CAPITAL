import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import LineChart from '../components/LineChart';
import useStrategyLab from '../hooks/useStrategyLab';
import { fmtInt, fmtNum, fmtPct, fmtTime } from '../lib/format';
import { Link } from '../lib/router';

const toneClass = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return '';
  return num > 0 ? 'up' : 'down';
};

const actionClass = (action) => {
  if (action === 'accumulate') return 'up';
  if (action === 'reduce') return 'down';
  return '';
};

export default function StrategyLabPage({ snapshot, historyByMarket }) {
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
    eventLog,
    tradeLog,
    backtest,
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
  const backtestStats = backtest?.stats || {
    pnl: 0,
    returnPct: 0,
    tradeCount: 0,
    winRatePct: 0,
    maxDrawdownPct: 0,
    endEquity: 100000
  };

  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>Strategy Lab</h1>
          <Link to="/markets" className="inline-link">
            Back to markets
          </Link>
        </div>
        <p>Backtesting + realtime strategy simulation with a local fake wallet. Defaults boot into local auto-run so you can test immediately.</p>

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

        <p className="socket-status-copy">
          mode {sourceId} | runtime {running ? 'active' : 'paused'} | market {selectedMarket?.symbol || '-'} | live history{' '}
          {hasLiveHistory ? 'available' : 'limited'}
        </p>
      </GlowCard>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Wallet Equity</span>
          <strong className={toneClass(wallet.equity - 100000)}>{fmtNum(wallet.equity, 2)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Realized PnL</span>
          <strong className={toneClass(wallet.realizedPnl)}>{fmtNum(wallet.realizedPnl, 2)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Unrealized PnL</span>
          <strong className={toneClass(wallet.unrealizedPnl)}>{fmtNum(wallet.unrealizedPnl, 2)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Position</span>
          <strong>{fmtNum(wallet.units, 0)} units</strong>
        </GlowCard>
      </div>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Backtest Return</span>
          <strong className={toneClass(backtestStats.returnPct)}>{fmtPct(backtestStats.returnPct)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Backtest PnL</span>
          <strong className={toneClass(backtestStats.pnl)}>{fmtNum(backtestStats.pnl, 2)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Trade Count</span>
          <strong>{fmtInt(backtestStats.tradeCount)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Win Rate</span>
          <strong>{fmtPct(backtestStats.winRatePct)}</strong>
        </GlowCard>
      </div>

      <GlowCard className="chart-card">
        <LineChart
          title={`Realtime Price - ${selectedMarket?.symbol || 'SIM'}`}
          points={runtimePriceSeries}
          stroke="#63f7c1"
          fillFrom="rgba(58, 227, 171, 0.34)"
          fillTo="rgba(58, 227, 171, 0.03)"
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
                  score {fmtNum(item.score, 2)} | px {fmtNum(item.price, 4)} | spr {fmtNum(item.spread, 2)} bps | {fmtTime(item.timestamp)}
                </small>
              </article>
            )}
          />
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Fake Wallet Trades</h2>
            <span>{tradeLog.length} rows</span>
          </div>
          <FlashList
            items={tradeLog}
            height={320}
            itemHeight={68}
            className="tick-flash-list"
            emptyCopy="No executed trades yet."
            keyExtractor={(trade) => trade.id}
            renderItem={(trade) => (
              <article className="tensor-event-row">
                <strong className={actionClass(trade.action)}>
                  {trade.action} | fill {fmtNum(trade.fillPrice, 4)}
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
    </section>
  );
}
