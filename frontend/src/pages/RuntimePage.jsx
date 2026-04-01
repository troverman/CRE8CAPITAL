import { useEffect, useMemo, useState } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import LineChart from '../components/LineChart';
import { TabBar } from '../components/PageLayout';
import WalletAccountSelectField from '../components/WalletAccountSelectField';
import { buildDecisionWalletLinkIndex } from '../lib/decisionWalletLink';
import { buildDecisionRows } from '../lib/decisionView';
import { fmtInt, fmtNum, fmtTime } from '../lib/format';
import { fetchExecution, fetchRisk, fetchAlerts, updateRisk } from '../lib/capitalApi';
import { Link } from '../lib/router';
import { getDisplaySignals, buildSignalStrategyIndex } from '../lib/signalView';
import { selectActiveWalletAccount } from '../lib/strategyLabSelectors';
import { STRATEGY_OPTIONS } from '../lib/strategyEngine';
import { buildStrategyRows, toStrategyKey } from '../lib/strategyView';
import { useExecutionFeedStore } from '../store/executionFeedStore';
import { useStrategyLabStore } from '../store/strategyLabStore';

const RUNTIME_TABS = [
  { id: 'controller', label: 'Controller' },
  { id: 'execution', label: 'Execution' },
  { id: 'risk', label: 'Risk' },
  { id: 'alerts', label: 'Alerts' }
];

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const actionClass = (action) => {
  const value = String(action || '').toLowerCase();
  if (value === 'accumulate' || value === 'buy' || value === 'long') return 'up';
  if (value === 'reduce' || value === 'sell' || value === 'short') return 'down';
  return '';
};

const marketIdentity = (symbol, assetClass) => `${String(symbol || '').toUpperCase()}|${String(assetClass || '').toLowerCase()}`;

const positionKey = (row) => `${String(row?.accountId || '')}|${String(row?.marketKey || '')}|${String(row?.symbol || '')}`;

const resolveNearestIndex = (rows, targetTs) => {
  if (!Array.isArray(rows) || rows.length === 0) return -1;
  const ts = toNum(targetTs, NaN);
  if (!Number.isFinite(ts)) return -1;
  let nearestIndex = -1;
  let nearestDelta = Number.POSITIVE_INFINITY;
  for (let index = 0; index < rows.length; index += 1) {
    const rowTs = toNum(rows[index]?.t, NaN);
    if (!Number.isFinite(rowTs)) continue;
    const delta = Math.abs(rowTs - ts);
    if (delta < nearestDelta) {
      nearestDelta = delta;
      nearestIndex = index;
    }
  }
  return nearestIndex;
};

export default function RuntimePage({ snapshot }) {
  const walletAccounts = useStrategyLabStore((state) => state.walletAccounts);
  const activeWalletAccountId = useStrategyLabStore((state) => state.activeWalletAccountId);
  const setActiveWalletAccount = useStrategyLabStore((state) => state.setActiveWalletAccount);
  const strategyId = useStrategyLabStore((state) => state.strategyId);
  const enabledStrategyIds = useStrategyLabStore((state) => state.enabledStrategyIds);
  const runtimeDecisionEvents = useStrategyLabStore((state) => state.eventLog);

  const txEvents = useExecutionFeedStore((state) => state.txEvents);
  const positionEvents = useExecutionFeedStore((state) => state.positionEvents);

  const [activeTab, setActiveTab] = useState('controller');

  // Fetch execution stats, risk, and alerts from API
  const [executionStats, setExecutionStats] = useState(null);
  const [riskStatus, setRiskStatus] = useState(null);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [riskForm, setRiskForm] = useState({ stopLossPct: '', takeProfitPct: '', maxDailyLossPct: '', maxPositionPct: '', maxOpenPositions: '' });
  const [riskMessage, setRiskMessage] = useState('');
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let retryDelay = 5000;
    let timer;
    let alive = true;

    const load = async () => {
      try {
        const [exec, risk, alerts] = await Promise.all([
          fetchExecution(),
          fetchRisk(),
          fetchAlerts(10)
        ]);
        if (!alive) return;
        setExecutionStats(exec.stats || null);
        setRiskStatus(risk);
        setRecentAlerts(alerts.items || []);
        if (risk && !riskForm.stopLossPct) {
          setRiskForm({
            stopLossPct: String(toNum(risk.stopLossPct, 0) * 100),
            takeProfitPct: String(toNum(risk.takeProfitPct, 0) * 100),
            maxDailyLossPct: String(toNum(risk.maxDailyLossPct, 0) * 100),
            maxPositionPct: String(toNum(risk.maxPositionPct, 0) * 100),
            maxOpenPositions: String(toNum(risk.maxOpenPositions, 10))
          });
        }
        setOffline(false);
        retryDelay = 5000;
        timer = setTimeout(load, 5000);
      } catch (_) {
        if (!alive) return;
        setOffline(true);
        retryDelay = Math.min(retryDelay * 1.5, 30000);
        timer = setTimeout(load, retryDelay);
      }
    };
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  const activeWallet = useMemo(() => {
    return selectActiveWalletAccount(walletAccounts, activeWalletAccountId) || null;
  }, [activeWalletAccountId, walletAccounts]);

  const activeWalletId = activeWallet?.id || '';

  const accountPositionEvents = useMemo(() => {
    if (!activeWalletId) return [];
    return positionEvents.filter((row) => String(row?.accountId || '') === activeWalletId);
  }, [activeWalletId, positionEvents]);

  const accountTxEvents = useMemo(() => {
    if (!activeWalletId) return [];
    return txEvents.filter((row) => String(row?.accountId || '') === activeWalletId);
  }, [activeWalletId, txEvents]);

  const walletEquityTimeline = useMemo(() => {
    const rows = accountPositionEvents
      .map((row) => ({
        t: toNum(row?.timestamp, 0),
        equity: toNum(row?.wallet?.equity, NaN)
      }))
      .filter((row) => row.t > 0 && Number.isFinite(row.equity))
      .sort((a, b) => a.t - b.t);

    if (rows.length === 0) {
      const start = toNum(activeWallet?.startCash, 100000);
      const current = toNum(activeWallet?.wallet?.equity, start);
      const now = Date.now();
      return [
        { t: now - 1, equity: start },
        { t: now, equity: current }
      ];
    }

    const deduped = [];
    for (const row of rows) {
      const last = deduped[deduped.length - 1];
      if (last && last.t === row.t) {
        deduped[deduped.length - 1] = row;
        continue;
      }
      deduped.push(row);
    }

    if (deduped.length === 1) {
      const base = toNum(activeWallet?.startCash, deduped[0].equity);
      return [
        { t: deduped[0].t - 1, equity: base },
        deduped[0]
      ];
    }

    return deduped.slice(-420);
  }, [accountPositionEvents, activeWallet?.startCash, activeWallet?.wallet?.equity]);

  const walletEquitySeries = useMemo(() => walletEquityTimeline.map((row) => row.equity), [walletEquityTimeline]);

  const walletTradeMarkers = useMemo(() => {
    if (!walletEquityTimeline.length || !accountTxEvents.length) return [];
    const markerByIndex = new Map();
    for (const trade of accountTxEvents.slice(0, 320)) {
      const markerIndex = resolveNearestIndex(walletEquityTimeline, trade?.timestamp);
      if (markerIndex < 0) continue;
      const current = markerByIndex.get(markerIndex) || {
        index: markerIndex,
        value: walletEquityTimeline[markerIndex]?.equity,
        tone: actionClass(trade?.action),
        title: `${trade?.action || 'trade'} ${trade?.symbol || trade?.marketKey || '-'}`,
        count: 0
      };
      current.count += 1;
      current.tone = actionClass(trade?.action) || current.tone || '';
      current.title = `${trade?.action || 'trade'} ${trade?.symbol || trade?.marketKey || '-'} @ ${fmtNum(trade?.fillPrice, 4)}`;
      markerByIndex.set(markerIndex, current);
    }
    return [...markerByIndex.values()]
      .sort((a, b) => a.index - b.index)
      .map((marker) => ({
        key: `wallet-trade:${activeWalletId}:${marker.index}`,
        index: marker.index,
        value: marker.value,
        tone: marker.tone,
        title: marker.title,
        count: marker.count
      }));
  }, [accountTxEvents, activeWalletId, walletEquityTimeline]);

  const openPositions = useMemo(() => {
    const latestByKey = new Map();
    for (const event of accountPositionEvents) {
      const key = positionKey(event);
      if (!key || latestByKey.has(key)) continue;
      latestByKey.set(key, event);
    }
    return [...latestByKey.values()]
      .map((event) => {
        const units = toNum(event?.wallet?.units, 0);
        const markPrice = Math.max(0, toNum(event?.wallet?.markPrice, 0));
        const positionNotional = Math.abs(units) * markPrice;
        return {
          key: positionKey(event),
          accountId: String(event?.accountId || ''),
          marketKey: String(event?.marketKey || ''),
          symbol: String(event?.symbol || event?.marketKey || '-').toUpperCase(),
          assetClass: String(event?.assetClass || 'unknown').toLowerCase(),
          strategyId: String(event?.strategyId || ''),
          reason: String(event?.reason || ''),
          units,
          markPrice,
          cash: toNum(event?.wallet?.cash, 0),
          equity: toNum(event?.wallet?.equity, 0),
          positionNotional,
          timestamp: toNum(event?.timestamp, 0)
        };
      })
      .filter((row) => Math.abs(row.units) > 1e-9)
      .sort((a, b) => b.positionNotional - a.positionNotional)
      .slice(0, 48);
  }, [accountPositionEvents]);

  const decisions = useMemo(() => {
    return buildDecisionRows({
      snapshotDecisions: snapshot?.decisions || [],
      runtimeEvents: runtimeDecisionEvents || []
    });
  }, [runtimeDecisionEvents, snapshot?.decisions]);

  const walletLinkByDecisionId = useMemo(() => {
    return buildDecisionWalletLinkIndex({
      decisions,
      walletAccounts,
      txEvents,
      timeWindowMs: 210000
    });
  }, [decisions, txEvents, walletAccounts]);

  const walletDecisions = useMemo(() => {
    if (!activeWalletId) return decisions.slice(0, 48);
    const rows = decisions.filter((row) => {
      const directId = String(row?.accountId || '');
      if (directId && directId === activeWalletId) return true;
      const linked = walletLinkByDecisionId.get(String(row?.id || ''));
      return String(linked?.accountId || '') === activeWalletId;
    });
    return (rows.length > 0 ? rows : decisions).slice(0, 64);
  }, [activeWalletId, decisions, walletLinkByDecisionId]);

  const touchedMarketIdentities = useMemo(() => {
    const set = new Set();
    for (const row of openPositions) {
      set.add(marketIdentity(row.symbol, row.assetClass));
    }
    for (const row of walletDecisions) {
      set.add(marketIdentity(row.symbol, row.assetClass));
    }
    return set;
  }, [openPositions, walletDecisions]);

  const signalRows = useMemo(() => {
    return getDisplaySignals(snapshot, 140);
  }, [snapshot]);

  const signalStrategyIndex = useMemo(() => {
    return buildSignalStrategyIndex(snapshot, signalRows, 3);
  }, [signalRows, snapshot]);

  const walletSignals = useMemo(() => {
    if (touchedMarketIdentities.size === 0) return signalRows.slice(0, 64);
    const rows = signalRows.filter((signal) => touchedMarketIdentities.has(marketIdentity(signal.symbol, signal.assetClass)));
    return (rows.length > 0 ? rows : signalRows).slice(0, 64);
  }, [signalRows, touchedMarketIdentities]);

  const strategyRows = useMemo(() => {
    return buildStrategyRows(snapshot);
  }, [snapshot]);

  const strategyMetaById = useMemo(() => {
    const map = new Map();
    for (const option of STRATEGY_OPTIONS) {
      const id = String(option?.id || '');
      if (!id) continue;
      map.set(id, option);
    }
    return map;
  }, []);

  const strategyRowByKey = useMemo(() => {
    const map = new Map();
    for (const row of strategyRows) {
      map.set(toStrategyKey(row?.id || row?.key), row);
    }
    return map;
  }, [strategyRows]);

  const enabledStrategyRows = useMemo(() => {
    return (Array.isArray(enabledStrategyIds) ? enabledStrategyIds : []).map((enabledId) => {
      const id = String(enabledId || '');
      const key = toStrategyKey(id);
      const statsRow = strategyRowByKey.get(key);
      const option = strategyMetaById.get(id);
      return {
        id,
        label: option?.label || statsRow?.name || id,
        description: option?.description || statsRow?.description || 'No description available yet.',
        decisionCount: toNum(statsRow?.decisionCount, 0),
        marketCount: toNum(statsRow?.marketCount, 0),
        avgScore: toNum(statsRow?.avgScore, 0),
        lastAction: String(statsRow?.lastAction || '-'),
        lastDecisionAt: toNum(statsRow?.lastDecisionAt, 0),
        focus: String(strategyId || '') === id
      };
    });
  }, [enabledStrategyIds, strategyId, strategyMetaById, strategyRowByKey]);

  const runtimeNotional = useMemo(() => {
    return openPositions.reduce((sum, row) => sum + toNum(row.positionNotional, 0), 0);
  }, [openPositions]);

  if (!activeWallet) {
    return (
      <section className="page-grid">
        <GlowCard className="detail-card">
          <h1>Runtime</h1>
          <p>No wallet accounts found yet. Create or enable a paper wallet to start runtime monitoring.</p>
          <div className="section-actions">
            <Link to="/wallet" className="inline-link">
              Open wallet
            </Link>
            <Link to="/strategy" className="inline-link">
              Open strategy lab
            </Link>
          </div>
        </GlowCard>
      </section>
    );
  }

  return (
    <section className="page-grid">
      {offline && (
        <div style={{background: '#1c1917', border: '1px solid #78350f', borderRadius: 8, padding: '8px 16px', marginBottom: 12, color: '#fbbf24', fontSize: 13}}>
          Backend offline — showing cached data. Retrying...
        </div>
      )}
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>Runtime Monitor</h1>
          <div className="section-actions">
            <Link to={`/wallet/${encodeURIComponent(activeWallet.id)}`} className="inline-link">
              wallet:{activeWallet.name}
            </Link>
            <Link to="/strategy" className="inline-link">
              strategy lab
            </Link>
          </div>
        </div>
        <p>Single runtime view for wallet, positions, decisions, selected strategies, and signal context.</p>
        <div className="wallet-action-row">
          <div style={{ minWidth: 260 }}>
            <WalletAccountSelectField
              label="Active Runtime Wallet"
              accounts={walletAccounts}
              value={activeWallet.id}
              onChange={(nextId) => {
                const safeId = String(nextId || '');
                if (!safeId) return;
                setActiveWalletAccount(safeId);
              }}
              emptyLabel="No accounts"
              idPrefix="runtime-wallet"
            />
          </div>
        </div>
      </GlowCard>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Wallet Equity</span>
          <strong>{fmtNum(activeWallet?.wallet?.equity, 2)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Wallet Cash</span>
          <strong>{fmtNum(activeWallet?.wallet?.cash, 2)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Open Positions</span>
          <strong>{fmtInt(openPositions.length)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Open Notional</span>
          <strong>{fmtNum(runtimeNotional, 2)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Selected Strategies</span>
          <strong>{fmtInt(enabledStrategyRows.length)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Scoped Decisions</span>
          <strong>{fmtInt(walletDecisions.length)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Scoped Signals</span>
          <strong>{fmtInt(walletSignals.length)}</strong>
        </GlowCard>
      </div>

      <GlowCard className="panel-card">
        <TabBar tabs={RUNTIME_TABS} active={activeTab} onChange={setActiveTab} />

        {activeTab === 'controller' ? (
          <div className="runtime-tab-content">
            <GlowCard className="chart-card">
              <LineChart
                title={`Wallet Equity (${activeWallet.name})`}
                points={walletEquitySeries}
                stroke="#62ffcc"
                fillFrom="rgba(98, 255, 204, 0.26)"
                fillTo="rgba(98, 255, 204, 0.02)"
                markers={walletTradeMarkers}
              />
            </GlowCard>
            <div className="strategy-function-grid" style={{ marginTop: '0.55rem' }}>
              <article><span>FPS</span><strong>{fmtInt(Math.round(1000 / 5000))} tps</strong></article>
              <article><span>Strategies</span><strong>{fmtInt(enabledStrategyRows.length)}</strong></article>
              <article><span>Decisions</span><strong>{fmtInt(walletDecisions.length)}</strong></article>
              <article><span>Signals</span><strong>{fmtInt(walletSignals.length)}</strong></article>
            </div>
          </div>
        ) : null}

        {activeTab === 'execution' ? (
          <div className="runtime-tab-content">
            {executionStats ? (
              <>
                <div className="section-head">
                  <h2>Execution Engine</h2>
                  <span className={`status-pill ${executionStats.mode === 'live' ? 'online' : ''}`}>{executionStats.mode}</span>
                </div>
                <div className="strategy-function-grid">
                  <article><span>Executed</span><strong>{fmtInt(executionStats.executed)}</strong></article>
                  <article><span>Rejected</span><strong>{fmtInt(executionStats.rejected)}</strong></article>
                  <article><span>Pending</span><strong>{fmtInt(executionStats.pending)}</strong></article>
                  <article><span>Mode</span><strong>{executionStats.mode}</strong></article>
                </div>
              </>
            ) : <p className="action-message">No execution stats available yet.</p>}
          </div>
        ) : null}

        {activeTab === 'risk' ? (
          <div className="runtime-tab-content">
            {riskStatus ? (
              <>
                <div className="section-head">
                  <h2>Risk Manager</h2>
                  <span>live status | daily loss {fmtNum(riskStatus.dailyLoss, 2)}</span>
                </div>
                <div className="risk-edit-grid">
                  <label className="control-field">
                    <span>Stop Loss %</span>
                    <input type="number" min={0} max={100} step={0.1} value={riskForm.stopLossPct} onChange={(e) => setRiskForm((f) => ({ ...f, stopLossPct: e.target.value }))} />
                  </label>
                  <label className="control-field">
                    <span>Take Profit %</span>
                    <input type="number" min={0} max={100} step={0.1} value={riskForm.takeProfitPct} onChange={(e) => setRiskForm((f) => ({ ...f, takeProfitPct: e.target.value }))} />
                  </label>
                  <label className="control-field">
                    <span>Max Daily Loss %</span>
                    <input type="number" min={0} max={100} step={0.1} value={riskForm.maxDailyLossPct} onChange={(e) => setRiskForm((f) => ({ ...f, maxDailyLossPct: e.target.value }))} />
                  </label>
                  <label className="control-field">
                    <span>Max Position %</span>
                    <input type="number" min={0} max={100} step={0.1} value={riskForm.maxPositionPct} onChange={(e) => setRiskForm((f) => ({ ...f, maxPositionPct: e.target.value }))} />
                  </label>
                  <label className="control-field">
                    <span>Max Open Positions</span>
                    <input type="number" min={1} max={100} step={1} value={riskForm.maxOpenPositions} onChange={(e) => setRiskForm((f) => ({ ...f, maxOpenPositions: e.target.value }))} />
                  </label>
                </div>
                <div className="hero-actions" style={{ marginTop: '0.55rem' }}>
                  <button type="button" className="btn primary" onClick={async () => {
                    try {
                      if (typeof updateRisk === 'function') {
                        await updateRisk({
                          stopLossPct: toNum(riskForm.stopLossPct, 0) / 100,
                          takeProfitPct: toNum(riskForm.takeProfitPct, 0) / 100,
                          maxDailyLossPct: toNum(riskForm.maxDailyLossPct, 0) / 100,
                          maxPositionPct: toNum(riskForm.maxPositionPct, 0) / 100,
                          maxOpenPositions: Math.round(toNum(riskForm.maxOpenPositions, 10))
                        });
                      }
                      setRiskMessage('Risk settings updated.');
                    } catch (err) {
                      setRiskMessage(`Update failed: ${err.message}`);
                    }
                  }}>
                    Update Risk Settings
                  </button>
                </div>
                {riskMessage ? <p className="action-message">{riskMessage}</p> : null}
              </>
            ) : <p className="action-message">No risk data available yet.</p>}
          </div>
        ) : null}

        {activeTab === 'alerts' ? (
          <div className="runtime-tab-content">
            <div className="section-head">
              <h2>Recent Alerts</h2>
              <span>{fmtInt(recentAlerts.length)} alerts</span>
            </div>
            <div className="list-stack">
              {recentAlerts.map((alert) => (
                <article key={alert.id} className="list-item">
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                    <span className={`severity-icon ${alert.severity === 'critical' ? 'critical' : alert.severity === 'warning' ? 'warning' : alert.severity === 'info' ? 'info' : 'low'}`}>
                      {alert.severity === 'critical' ? '!' : alert.severity === 'warning' ? 'W' : 'i'}
                    </span>
                    <div>
                      <strong>{alert.title}</strong>
                      <p>{alert.message}</p>
                      <div className="item-meta">
                        <span className={`severity ${alert.severity === 'warning' || alert.severity === 'critical' ? 'high' : ''}`}>{alert.severity}</span>
                        <small>{alert.type}</small>
                        <small>{fmtTime(alert.createdAt)}</small>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
              {recentAlerts.length === 0 ? <p className="action-message">No alerts to display.</p> : null}
            </div>
          </div>
        ) : null}
      </GlowCard>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Selected Strategies</h2>
            <span>{fmtInt(enabledStrategyRows.length)} enabled</span>
          </div>
          <div className="list-stack">
            {enabledStrategyRows.map((strategy) => (
              <article key={strategy.id} className="list-item">
                <strong>
                  <Link to={`/strategy/${encodeURIComponent(strategy.id)}`} className="inline-link">
                    {strategy.label}
                  </Link>{' '}
                  {strategy.focus ? <span className="status-pill online">focus</span> : null}
                </strong>
                <p>{strategy.description}</p>
                <div className="item-meta">
                  <small>decisions {fmtInt(strategy.decisionCount)}</small>
                  <small>markets {fmtInt(strategy.marketCount)}</small>
                  <small>avg score {fmtNum(strategy.avgScore, 2)}</small>
                  <small>last {strategy.lastAction}</small>
                  <small>{fmtTime(strategy.lastDecisionAt)}</small>
                </div>
              </article>
            ))}
            {enabledStrategyRows.length === 0 ? <p className="action-message">No runtime strategies enabled.</p> : null}
          </div>
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Open Positions</h2>
            <span>{fmtInt(openPositions.length)} rows</span>
          </div>
          <FlashList
            items={openPositions}
            height={390}
            itemHeight={84}
            className="tick-flash-list"
            emptyCopy="No open positions for this wallet."
            keyExtractor={(row) => row.key}
            renderItem={(row) => (
              <article className="tensor-event-row">
                <strong className={row.units >= 0 ? 'up' : 'down'}>
                  {row.symbol} ({row.assetClass}) | {row.units >= 0 ? 'long' : 'short'} {fmtNum(row.units, 4)}
                </strong>
                <p>{row.reason || 'position update'}</p>
                <small>
                  strat{' '}
                  <Link to={`/strategy/${encodeURIComponent(row.strategyId || 'unknown')}`} className="inline-link">
                    {row.strategyId || 'unknown'}
                  </Link>{' '}
                  | eq {fmtNum(row.equity, 2)} | cash {fmtNum(row.cash, 2)} | mark {fmtNum(row.markPrice, 4)} | notional {fmtNum(row.positionNotional, 2)} |{' '}
                  {fmtTime(row.timestamp)}
                </small>
              </article>
            )}
          />
        </GlowCard>
      </div>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Decision Feed</h2>
            <span>{fmtInt(walletDecisions.length)} rows</span>
          </div>
          <FlashList
            items={walletDecisions}
            height={420}
            itemHeight={86}
            className="tick-flash-list"
            emptyCopy="No decisions in scope yet."
            keyExtractor={(row, index) => `${row.id}:${index}`}
            renderItem={(row) => {
              const walletLink = walletLinkByDecisionId.get(String(row.id || '')) || null;
              return (
                <article className="tensor-event-row">
                  <strong className={actionClass(row.action)}>
                    <Link to={`/decision/${encodeURIComponent(row.id)}`} className="inline-link">
                      {row.action}
                    </Link>{' '}
                    | {row.symbol} ({row.assetClass})
                  </strong>
                  <p>{row.reason || 'No reason provided'}</p>
                  <small>
                    strat{' '}
                    <Link to={`/strategy/${encodeURIComponent(row.strategyName || 'unknown')}`} className="inline-link">
                      {row.strategyName || 'unknown'}
                    </Link>{' '}
                    | trigger {row.trigger || '-'} | score {fmtNum(row.score, 2)} | wallet {walletLink?.accountName || row.accountName || '-'} | {fmtTime(row.timestamp)}
                  </small>
                </article>
              );
            }}
          />
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Signal Feed</h2>
            <span>{fmtInt(walletSignals.length)} rows</span>
          </div>
          <FlashList
            items={walletSignals}
            height={420}
            itemHeight={86}
            className="tick-flash-list"
            emptyCopy="No signals in scope yet."
            keyExtractor={(row, index) => `${row.id}:${index}`}
            renderItem={(row) => {
              const linkedStrategies = signalStrategyIndex.get(String(row.id || '')) || [];
              return (
                <article className="tensor-event-row">
                  <strong>
                    <Link to={`/signal/${encodeURIComponent(row.id)}`} className="inline-link">
                      {row.type || 'signal'}
                    </Link>{' '}
                    | {row.symbol} ({row.assetClass})
                  </strong>
                  <p>{row.message || '-'}</p>
                  <small>
                    severity {row.severity || 'low'} | score {fmtNum(row.score, 0)} | linked{' '}
                    {linkedStrategies.length > 0
                      ? linkedStrategies.map((item) => item.strategyName).join(', ')
                      : 'none'}{' '}
                    | {fmtTime(row.timestamp)}
                  </small>
                </article>
              );
            }}
          />
        </GlowCard>
      </div>
    </section>
  );
}
