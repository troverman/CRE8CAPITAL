import { useEffect, useMemo, useState } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import { fmtCompact, fmtInt, fmtNum, fmtTime } from '../lib/format';
import { fetchPositions } from '../lib/capitalApi';
import { Link } from '../lib/router';
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

const positionDirection = (units) => {
  const value = toNum(units, 0);
  if (value > 0) return 'long';
  if (value < 0) return 'short';
  return 'flat';
};

const rowKey = (row) => `${String(row?.accountId || '')}|${String(row?.marketKey || '')}|${String(row?.symbol || '')}`;

export default function PositionListPage({ snapshot }) {
  const [search, setSearch] = useState('');
  const [serverPositions, setServerPositions] = useState([]);
  const walletAccounts = useStrategyLabStore((state) => state.walletAccounts);
  const activeWalletAccountId = useStrategyLabStore((state) => state.activeWalletAccountId);
  const positionEvents = useExecutionFeedStore((state) => state.positionEvents);

  // Fetch real positions from API
  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchPositions();
        setServerPositions(data.items || []);
      } catch (_) {}
    };
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  const latestByPosition = useMemo(() => {
    const map = new Map();
    for (const event of positionEvents) {
      const key = rowKey(event);
      if (!key) continue;
      if (!map.has(key)) map.set(key, event);
    }
    return [...map.values()];
  }, [positionEvents]);

  const openPositions = useMemo(() => {
    return latestByPosition
      .map((event) => {
        const units = toNum(event?.wallet?.units, 0);
        const notional = Math.abs(units) * Math.max(0, toNum(event?.wallet?.markPrice, 0));
        return {
          key: rowKey(event),
          accountId: String(event?.accountId || ''),
          accountName: String(event?.accountName || 'paper'),
          marketKey: String(event?.marketKey || ''),
          symbol: String(event?.symbol || event?.marketKey || '-').toUpperCase(),
          assetClass: String(event?.assetClass || 'unknown'),
          units,
          direction: positionDirection(units),
          cash: toNum(event?.wallet?.cash, 0),
          equity: toNum(event?.wallet?.equity, 0),
          markPrice: toNum(event?.wallet?.markPrice, 0),
          positionNotional: notional,
          strategyId: String(event?.strategyId || '-'),
          reason: String(event?.reason || ''),
          timestamp: toNum(event?.timestamp, 0)
        };
      })
      .filter((row) => Math.abs(row.units) > 1e-9)
      .sort((a, b) => b.positionNotional - a.positionNotional);
  }, [latestByPosition]);

  const filteredPositions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return openPositions;
    return openPositions.filter((row) => {
      return (
        row.symbol.toLowerCase().includes(term) ||
        row.assetClass.toLowerCase().includes(term) ||
        row.accountName.toLowerCase().includes(term) ||
        row.accountId.toLowerCase().includes(term) ||
        row.strategyId.toLowerCase().includes(term)
      );
    });
  }, [openPositions, search]);

  const stats = useMemo(() => {
    const longCount = filteredPositions.filter((row) => row.units > 0).length;
    const shortCount = filteredPositions.filter((row) => row.units < 0).length;
    const notional = filteredPositions.reduce((sum, row) => sum + row.positionNotional, 0);
    const accountsTouched = new Set(filteredPositions.map((row) => row.accountId)).size;
    return {
      longCount,
      shortCount,
      notional,
      accountsTouched
    };
  }, [filteredPositions]);

  const recentPositionEvents = useMemo(() => positionEvents.slice(0, 120), [positionEvents]);

  const activeAccount = useMemo(() => {
    return walletAccounts.find((account) => account.id === activeWalletAccountId) || walletAccounts[0] || null;
  }, [activeWalletAccountId, walletAccounts]);

  const maxNotional = useMemo(() => {
    if (filteredPositions.length === 0) return 1;
    return Math.max(...filteredPositions.map((row) => row.positionNotional), 1);
  }, [filteredPositions]);

  return (
    <section className="page-grid">
      <GlowCard className="list-header-card">
        <div className="section-head">
          <h1>Positions</h1>
          <span>
            {fmtInt(filteredPositions.length)} open / {fmtInt(openPositions.length)} tracked
          </span>
        </div>
        <p className="socket-status-copy">
          Decisions explain why we acted; positions show what is currently held. Active runtime wallet: {activeAccount?.name || '-'}.
        </p>
        <input
          className="filter-input"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search symbol, asset class, account, or strategy"
          aria-label="Search positions"
        />
      </GlowCard>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Open Positions</span>
          <strong>{fmtInt(filteredPositions.length)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Long / Short</span>
          <strong>
            <span className="up">{fmtInt(stats.longCount)}</span> / <span className="down">{fmtInt(stats.shortCount)}</span>
          </strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Total Notional</span>
          <strong>{fmtCompact(stats.notional)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Accounts Touched</span>
          <strong>{fmtInt(stats.accountsTouched)}</strong>
        </GlowCard>
      </div>

      {serverPositions.length > 0 ? (
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Server Positions</h2>
            <span>{fmtInt(serverPositions.length)} from backend</span>
          </div>
          <FlashList
            items={serverPositions}
            height={320}
            itemHeight={78}
            className="tick-flash-list"
            emptyCopy="No server positions."
            keyExtractor={(row) => `server:${row.symbol}`}
            renderItem={(row) => {
              const unrealizedPnl = row.avgEntryPrice > 0 ? ((row.quantity || 0) * ((snapshot?.markets || []).find(m => m.symbol === row.symbol)?.referencePrice || row.avgEntryPrice) - (row.quantity || 0) * row.avgEntryPrice) : 0;
              return (
                <article className="tensor-event-row">
                  <strong className={unrealizedPnl >= 0 ? 'up' : 'down'}>
                    {row.symbol} | {row.side} {fmtNum(row.quantity, 6)}
                  </strong>
                  <p>avg entry {fmtNum(row.avgEntryPrice, 4)} | unrealized P&L <span className={unrealizedPnl >= 0 ? 'up' : 'down'}>{fmtNum(unrealizedPnl, 2)}</span></p>
                  <small>{fmtTime(row.updatedAt)}</small>
                </article>
              );
            }}
          />
        </GlowCard>
      ) : null}

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Open Position Book</h2>
          <span>latest snapshot per account/market</span>
        </div>
        {filteredPositions.length === 0 ? (
          <div className="empty-state">
            <p>No open positions yet. Run strategy runtime or create positions from wallet.</p>
            <Link to="/wallet" className="btn secondary" style={{ marginTop: 12 }}>Open Wallet</Link>
          </div>
        ) : (
          <FlashList
            items={filteredPositions}
            height={520}
            itemHeight={98}
            className="tick-flash-list"
            emptyCopy="No open positions yet."
            keyExtractor={(row) => row.key}
            renderItem={(row) => {
              const pctOfMax = maxNotional > 0 ? (row.positionNotional / maxNotional) * 100 : 0;
              return (
                <article className="tensor-event-row position-row-enhanced">
                  <div className="position-row-head">
                    <strong className={row.units >= 0 ? 'up' : 'down'}>
                      {row.symbol} ({row.assetClass}) | {row.direction} {fmtNum(row.units, 4)}
                    </strong>
                    <span className="position-notional">{fmtNum(row.positionNotional, 2)}</span>
                  </div>
                  <div className="position-bar-track">
                    <div className={`position-bar ${row.units >= 0 ? 'up' : 'down'}`} style={{ width: `${Math.min(pctOfMax, 100)}%` }} />
                  </div>
                  <p>{row.reason || 'position update'}</p>
                  <small>
                    acc{' '}
                    <Link to={`/wallet/${encodeURIComponent(row.accountId)}`} className="inline-link">
                      {row.accountName}
                    </Link>{' '}
                    | strat{' '}
                    <Link to={`/strategy/${encodeURIComponent(row.strategyId)}`} className="inline-link">
                      {row.strategyId}
                    </Link>{' '}
                    | eq {fmtNum(row.equity, 2)} | cash {fmtNum(row.cash, 2)} | mark {fmtNum(row.markPrice, 4)} |{' '}
                    {fmtTime(row.timestamp)}
                  </small>
                </article>
              );
            }}
          />
        )}
      </GlowCard>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Recent Position Events</h2>
          <span>{fmtInt(recentPositionEvents.length)} rows</span>
        </div>
        <FlashList
          items={recentPositionEvents}
          height={360}
          itemHeight={78}
          className="tick-flash-list"
          emptyCopy="No position events yet."
          keyExtractor={(row) => row.id}
          renderItem={(row) => (
            <article className="tensor-event-row">
              <strong className={actionClass(row.action)}>
                {row.action} | {row.symbol || row.marketKey || '-'} | units {fmtNum(row.wallet?.units, 4)}
              </strong>
              <p>{row.reason || 'position update'}</p>
              <small>
                {row.accountName || row.accountId || 'paper'} | {row.strategyId || '-'} | eq {fmtNum(row.wallet?.equity, 2)} | cash {fmtNum(row.wallet?.cash, 2)} |{' '}
                {fmtTime(row.timestamp)}
              </small>
            </article>
          )}
        />
      </GlowCard>
    </section>
  );
}
