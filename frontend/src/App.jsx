import { useMemo, useState } from 'react';
import TopNav from './components/TopNav';
import GlowCard from './components/GlowCard';
import useCapitalLive from './hooks/useCapitalLive';
import useMarketHistory from './hooks/useMarketHistory';
import { fmtTime } from './lib/format';
import { usePathname } from './lib/router';
import AssetDetailPage from './pages/AssetDetailPage';
import AssetListPage from './pages/AssetListPage';
import HomePage from './pages/HomePage';
import GraphPage from './pages/GraphPage';
import MarketDetailPage from './pages/MarketDetailPage';
import MarketListPage from './pages/MarketListPage';
import StrategyLabPage from './pages/StrategyLabPage';

const parseRoute = (pathname) => {
  const cleanPath = pathname && pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname;
  const routePath = cleanPath || '/';

  if (routePath === '/') return { name: 'home' };
  if (routePath === '/markets') return { name: 'markets' };
  if (routePath === '/assets') return { name: 'assets' };
  if (routePath === '/graph') return { name: 'graph' };
  if (routePath === '/strategy') return { name: 'strategy' };

  const marketMatch = routePath.match(/^\/market\/(.+)$/);
  if (marketMatch) {
    return { name: 'market', id: decodeURIComponent(marketMatch[1]) };
  }

  const assetMatch = routePath.match(/^\/asset\/(.+)$/);
  if (assetMatch) {
    return { name: 'asset', id: decodeURIComponent(assetMatch[1]) };
  }

  return { name: 'not-found' };
};

const NotFoundPage = () => {
  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <h1>Route not found</h1>
        <p>Try `/markets`, `/market/:id`, `/assets`, `/asset/:id`, `/graph`, or `/strategy`.</p>
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

      {route.name === 'graph' ? <GraphPage snapshot={snapshot} /> : null}

      {route.name === 'strategy' ? <StrategyLabPage snapshot={snapshot} historyByMarket={historyByMarket} /> : null}

      {route.name === 'not-found' ? <NotFoundPage /> : null}
    </main>
  );
}
