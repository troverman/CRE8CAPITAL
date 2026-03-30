import { useMemo, useState } from 'react';
import TopNav from './components/TopNav';
import GlowCard from './components/GlowCard';
import useCapitalLive from './hooks/useCapitalLive';
import useMarketHistory from './hooks/useMarketHistory';
import { fmtTime } from './lib/format';
import { usePathname } from './lib/router';
import AssetDetailPage from './pages/AssetDetailPage';
import AssetListPage from './pages/AssetListPage';
import AccountPage from './pages/AccountPage';
import HomePage from './pages/HomePage';
import GraphPage from './pages/GraphPage';
import MarketDetailPage from './pages/MarketDetailPage';
import MarketListPage from './pages/MarketListPage';
import SignalDetailPage from './pages/SignalDetailPage';
import SignalListPage from './pages/SignalListPage';
import StrategyLabPage from './pages/StrategyLabPage';
import StrategyDetailPage from './pages/StrategyDetailPage';
import StrategyListPage from './pages/StrategyListPage';

const parseRoute = (pathname) => {
  const cleanPath = pathname && pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname;
  const routePath = cleanPath || '/';

  if (routePath === '/') return { name: 'home' };
  if (routePath === '/markets') return { name: 'markets' };
  if (routePath === '/assets') return { name: 'assets' };
  if (routePath === '/graph') return { name: 'graph' };
  if (routePath === '/signals') return { name: 'signals' };
  if (routePath === '/strategies') return { name: 'strategies' };
  if (routePath === '/strategy') return { name: 'strategy' };
  if (routePath === '/account' || routePath === '/settings') return { name: 'account' };

  const marketMatch = routePath.match(/^\/market\/(.+)$/);
  if (marketMatch) {
    return { name: 'market', id: decodeURIComponent(marketMatch[1]) };
  }

  const assetMatch = routePath.match(/^\/asset\/(.+)$/);
  if (assetMatch) {
    return { name: 'asset', id: decodeURIComponent(assetMatch[1]) };
  }

  const signalMatch = routePath.match(/^\/signal\/(.+)$/);
  if (signalMatch) {
    return { name: 'signal', id: decodeURIComponent(signalMatch[1]) };
  }

  const strategyDetailMatch = routePath.match(/^\/strategy\/(.+)$/);
  if (strategyDetailMatch) {
    return { name: 'strategy-detail', id: decodeURIComponent(strategyDetailMatch[1]) };
  }

  return { name: 'not-found' };
};

const NotFoundPage = () => {
  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <h1>Route not found</h1>
        <p>Try `/markets`, `/assets`, `/signals`, `/strategies`, `/graph`, `/strategy`, `/account`, `/signal/:id`, or `/strategy/:id`.</p>
      </GlowCard>
    </section>
  );
};

export default function App() {
  const pathname = usePathname();
  const route = useMemo(() => parseRoute(pathname), [pathname]);
  const [restrategyReason, setRestrategyReason] = useState('manual rebalance check');

  const {
    snapshot,
    connected,
    loading,
    syncing,
    transport,
    localFallback,
    lastSyncedAt,
    error,
    restrategyBusy,
    actionMessage,
    refresh,
    triggerRestrategy
  } = useCapitalLive();

  const historyByMarket = useMarketHistory(snapshot.markets, snapshot.now);

  const handleRestrategy = async () => {
    await triggerRestrategy(restrategyReason);
  };

  return (
    <main className="capital-shell">
      <TopNav pathname={pathname} connected={connected} transport={transport} localFallback={localFallback} />

      <section className="shell-meta">
        <span>runtime {connected ? 'online' : localFallback ? 'offline (local fallback)' : 'offline'}</span>
        <span>last sync {fmtTime(lastSyncedAt)}</span>
        <span>{loading ? 'booting...' : `markets ${snapshot.markets.length}`}</span>
      </section>

      {route.name === 'home' ? (
        <HomePage
          snapshot={snapshot}
          connected={connected}
          transport={transport}
          localFallback={localFallback}
          syncing={syncing}
          lastSyncedAt={lastSyncedAt}
          error={error}
          onRefresh={refresh}
          restrategyReason={restrategyReason}
          onRestrategyReasonChange={setRestrategyReason}
          onRestrategy={handleRestrategy}
          restrategyBusy={restrategyBusy}
          actionMessage={actionMessage}
          historyByMarket={historyByMarket}
        />
      ) : null}

      {route.name === 'markets' ? <MarketListPage markets={snapshot.markets} historyByMarket={historyByMarket} /> : null}

      {route.name === 'market' ? (
        <MarketDetailPage marketId={route.id} snapshot={snapshot} historyByMarket={historyByMarket} onRefresh={refresh} syncing={syncing} />
      ) : null}

      {route.name === 'assets' ? <AssetListPage markets={snapshot.markets} /> : null}

      {route.name === 'asset' ? <AssetDetailPage assetId={route.id} markets={snapshot.markets} historyByMarket={historyByMarket} /> : null}

      {route.name === 'signals' ? <SignalListPage snapshot={snapshot} /> : null}

      {route.name === 'signal' ? <SignalDetailPage signalId={route.id} snapshot={snapshot} /> : null}

      {route.name === 'strategies' ? <StrategyListPage snapshot={snapshot} /> : null}

      {route.name === 'strategy-detail' ? <StrategyDetailPage strategyId={route.id} snapshot={snapshot} /> : null}

      {route.name === 'graph' ? <GraphPage snapshot={snapshot} /> : null}

      {route.name === 'strategy' ? <StrategyLabPage snapshot={snapshot} historyByMarket={historyByMarket} /> : null}

      {route.name === 'account' ? <AccountPage /> : null}

      {route.name === 'not-found' ? <NotFoundPage /> : null}
    </main>
  );
}
