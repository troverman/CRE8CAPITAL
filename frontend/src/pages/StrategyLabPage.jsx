import { useMemo } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import LineChart from '../components/LineChart';
import useStrategyLab from '../hooks/useStrategyLab';
import { fmtInt, fmtNum, fmtPct, fmtTime } from '../lib/format';
import { buildClassicAnalysis } from '../lib/indicators';
import { Link } from '../lib/router';
import { useExecutionFeedStore } from '../store/executionFeedStore';

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
          title={`Realtime Price + Classic TA - ${selectedMarket?.symbol || 'SIM'}`}
          points={runtimePriceSeries}
          stroke="#63f7c1"
          fillFrom="rgba(58, 227, 171, 0.34)"
          fillTo="rgba(58, 227, 171, 0.03)"
          overlays={runtimeTaOverlays}
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
                  {item.triggerKind} | sigs {fmtInt(item.signalCount)} | score {fmtNum(item.score, 2)} | px {fmtNum(item.price, 4)} | spr{' '}
                  {fmtNum(item.spread, 2)} bps | {fmtTime(item.timestamp)}
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
                  {event.action} | {event.symbol || event.marketKey || '-'}
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
                  {event.symbol || event.marketKey || '-'} | units {fmtNum(event.wallet.units, 0)}
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
    </section>
  );
}
