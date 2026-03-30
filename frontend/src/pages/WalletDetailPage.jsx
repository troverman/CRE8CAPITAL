import { useMemo } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import LineChart from '../components/LineChart';
import { fmtInt, fmtNum, fmtTime } from '../lib/format';
import { Link, navigate } from '../lib/router';
import { useExecutionFeedStore } from '../store/executionFeedStore';
import { useStrategyLabStore } from '../store/strategyLabStore';

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const actionClass = (action) => {
  const value = String(action || '').toLowerCase();
  if (value === 'accumulate' || value === 'buy') return 'up';
  if (value === 'reduce' || value === 'sell') return 'down';
  return '';
};

const toneClass = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return '';
  return num > 0 ? 'up' : 'down';
};

const marketIdentity = (symbol, assetClass) => `${String(symbol || '').toUpperCase()}|${String(assetClass || '').toLowerCase()}`;

export default function WalletDetailPage({ walletId, snapshot }) {
  const walletAccounts = useStrategyLabStore((state) => state.walletAccounts);
  const activeWalletAccountId = useStrategyLabStore((state) => state.activeWalletAccountId);
  const setActiveWalletAccount = useStrategyLabStore((state) => state.setActiveWalletAccount);

  const txEvents = useExecutionFeedStore((state) => state.txEvents);
  const positionEvents = useExecutionFeedStore((state) => state.positionEvents);

  const selectedAccount = useMemo(() => {
    const target = String(walletId || '');
    return walletAccounts.find((account) => account.id === target) || walletAccounts.find((account) => account.id === activeWalletAccountId) || walletAccounts[0] || null;
  }, [activeWalletAccountId, walletAccounts, walletId]);

  const selectedAccountId = selectedAccount?.id || '';

  const accountTxEvents = useMemo(() => {
    if (!selectedAccountId) return [];
    return txEvents.filter((event) => event.accountId === selectedAccountId);
  }, [selectedAccountId, txEvents]);

  const accountPositionEvents = useMemo(() => {
    if (!selectedAccountId) return [];
    return positionEvents.filter((event) => event.accountId === selectedAccountId);
  }, [positionEvents, selectedAccountId]);

  const accountEquitySeries = useMemo(() => {
    if (!selectedAccount) return [];
    const sorted = accountPositionEvents.slice().sort((a, b) => toNum(a.timestamp, 0) - toNum(b.timestamp, 0));
    const points = sorted.map((event) => toNum(event?.wallet?.equity, NaN)).filter((value) => Number.isFinite(value)).slice(-360);
    if (points.length >= 2) return points;
    const start = toNum(selectedAccount.startCash, 100000);
    const current = toNum(selectedAccount.wallet?.equity, start);
    return [start, current];
  }, [accountPositionEvents, selectedAccount]);

  const touchedMarketIdentities = useMemo(() => {
    return new Set(accountTxEvents.map((event) => marketIdentity(event.symbol, event.assetClass)));
  }, [accountTxEvents]);

  const relatedDecisions = useMemo(() => {
    const rows = Array.isArray(snapshot?.decisions) ? snapshot.decisions : [];
    if (!touchedMarketIdentities.size) return rows.slice(0, 36);
    return rows
      .filter((decision) => touchedMarketIdentities.has(marketIdentity(decision.symbol, decision.assetClass)))
      .sort((a, b) => toNum(b.timestamp, 0) - toNum(a.timestamp, 0))
      .slice(0, 48);
  }, [snapshot?.decisions, touchedMarketIdentities]);

  const relatedSignals = useMemo(() => {
    const rows = Array.isArray(snapshot?.signals) ? snapshot.signals : [];
    if (!touchedMarketIdentities.size) return rows.slice(0, 36);
    return rows
      .filter((signal) => touchedMarketIdentities.has(marketIdentity(signal.symbol, signal.assetClass)))
      .sort((a, b) => toNum(b.timestamp, 0) - toNum(a.timestamp, 0))
      .slice(0, 48);
  }, [snapshot?.signals, touchedMarketIdentities]);

  if (!selectedAccount) {
    return (
      <section className="page-grid">
        <GlowCard className="detail-card">
          <h1>Wallet Account Not Found</h1>
          <p>No paper accounts are available yet. Add one from the wallet page to start live drilldown.</p>
          <div className="section-actions">
            <Link to="/wallet" className="inline-link">
              Back to wallet
            </Link>
            <Link to="/strategy" className="inline-link">
              Strategy lab
            </Link>
          </div>
        </GlowCard>
      </section>
    );
  }

  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>wallet:{selectedAccount.name}</h1>
          <div className="section-actions">
            <Link to="/wallet" className="inline-link">
              Wallet
            </Link>
            <Link to="/strategy" className="inline-link">
              Strategy Lab
            </Link>
          </div>
        </div>
        <p>Live account drilldown with execution feed, position updates, and linked signal/decision context.</p>
        <div className="wallet-action-row">
          <label className="control-field" style={{ minWidth: 260 }}>
            <span>Account</span>
            <select
              value={selectedAccount.id}
              onChange={(event) => {
                const nextId = String(event.target.value || '');
                if (!nextId) return;
                setActiveWalletAccount(nextId);
                navigate(`/wallet/${encodeURIComponent(nextId)}`);
              }}
            >
              {walletAccounts.map((account) => (
                <option key={`wallet-id:${account.id}`} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              setActiveWalletAccount(selectedAccount.id);
            }}
          >
            Set Active In Strategy Lab
          </button>
        </div>
      </GlowCard>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Equity</span>
          <strong className={toneClass(toNum(selectedAccount.wallet?.equity, 0) - toNum(selectedAccount.startCash, 100000))}>
            {fmtNum(selectedAccount.wallet?.equity, 2)}
          </strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Cash</span>
          <strong>{fmtNum(selectedAccount.wallet?.cash, 2)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Units</span>
          <strong>{fmtNum(selectedAccount.wallet?.units, 4)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Realized PnL</span>
          <strong className={toneClass(selectedAccount.wallet?.realizedPnl)}>{fmtNum(selectedAccount.wallet?.realizedPnl, 2)}</strong>
        </GlowCard>
      </div>

      <GlowCard className="chart-card">
        <LineChart
          title={`Live Equity - ${selectedAccount.name}`}
          points={accountEquitySeries}
          stroke="#62ffcc"
          fillFrom="rgba(98, 255, 204, 0.26)"
          fillTo="rgba(98, 255, 204, 0.02)"
        />
      </GlowCard>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Live Trade Feed</h2>
            <span>{fmtInt(accountTxEvents.length)} rows</span>
          </div>
          <FlashList
            items={accountTxEvents}
            height={340}
            itemHeight={74}
            className="tick-flash-list"
            emptyCopy="No live trades for this account yet."
            keyExtractor={(event) => event.id}
            renderItem={(event) => (
              <article className="tensor-event-row">
                <strong className={actionClass(event.action)}>
                  {event.action} | {event.symbol || event.marketKey || '-'}
                </strong>
                <p>{event.reason || 'strategy execution'}</p>
                <small>
                  fill {fmtNum(event.fillPrice, 4)} | delta {fmtNum(event.unitsDelta, 4)} | units {fmtNum(event.unitsAfter, 4)} | pnl {fmtNum(event.realizedDelta, 2)} |{' '}
                  {fmtTime(event.timestamp)}
                </small>
              </article>
            )}
          />
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Live Position Feed</h2>
            <span>{fmtInt(accountPositionEvents.length)} rows</span>
          </div>
          <FlashList
            items={accountPositionEvents}
            height={340}
            itemHeight={78}
            className="tick-flash-list"
            emptyCopy="No position snapshots for this account yet."
            keyExtractor={(event) => event.id}
            renderItem={(event) => (
              <article className="tensor-event-row">
                <strong className={actionClass(event.action)}>
                  {event.symbol || event.marketKey || '-'} | units {fmtNum(event.wallet?.units, 4)}
                </strong>
                <p>{event.reason || 'position update'}</p>
                <small>
                  eq {fmtNum(event.wallet?.equity, 2)} | cash {fmtNum(event.wallet?.cash, 2)} | mark {fmtNum(event.wallet?.markPrice, 4)} | {fmtTime(event.timestamp)}
                </small>
              </article>
            )}
          />
        </GlowCard>
      </div>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Related Decisions</h2>
            <span>{fmtInt(relatedDecisions.length)} rows</span>
          </div>
          <FlashList
            items={relatedDecisions}
            height={320}
            itemHeight={74}
            className="tick-flash-list"
            emptyCopy="No decision context for this account yet."
            keyExtractor={(item) => String(item.id || `${item.symbol}:${item.timestamp}`)}
            renderItem={(item) => (
              <article className="tensor-event-row">
                <strong className={actionClass(item.action)}>
                  {item.action} | {item.symbol} ({item.assetClass})
                </strong>
                <p>{item.reason || '-'}</p>
                <small>
                  score {fmtNum(item.score, 2)} | trigger {item.trigger || '-'} | {fmtTime(item.timestamp)}
                </small>
              </article>
            )}
          />
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Related Signals</h2>
            <span>{fmtInt(relatedSignals.length)} rows</span>
          </div>
          <FlashList
            items={relatedSignals}
            height={320}
            itemHeight={74}
            className="tick-flash-list"
            emptyCopy="No signal context for this account yet."
            keyExtractor={(item) => String(item.id || `${item.symbol}:${item.timestamp}`)}
            renderItem={(item) => (
              <article className="tensor-event-row">
                <strong>{item.type || 'signal'} | {item.symbol || '-'} ({item.assetClass || 'unknown'})</strong>
                <p>{item.message || '-'}</p>
                <small>
                  score {fmtNum(item.score, 0)} | severity {item.severity || 'low'} | {fmtTime(item.timestamp)}
                </small>
              </article>
            )}
          />
        </GlowCard>
      </div>
    </section>
  );
}
