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
import DerivativesPage from './pages/DerivativesPage';
import HomePage from './pages/HomePage';
import GraphPage from './pages/GraphPage';
import MarketDetailPage from './pages/MarketDetailPage';
import MarketListPage from './pages/MarketListPage';
import DecisionListPage from './pages/DecisionListPage';
import DecisionDetailPage from './pages/DecisionDetailPage';
import SignalDetailPage from './pages/SignalDetailPage';
import SignalListPage from './pages/SignalListPage';
import KnowledgePage from './pages/KnowledgePage';
import OtherPage from './pages/OtherPage';
import ProbabilityLabPage from './pages/ProbabilityLabPage';
import ProviderDetailPage from './pages/ProviderDetailPage';
import ProviderListPage from './pages/ProviderListPage';
import StrategyLabPage from './pages/StrategyLabPage';
import StrategyDetailPage from './pages/StrategyDetailPage';
import StrategyListPage from './pages/StrategyListPage';
import WalletPage from './pages/WalletPage';
import WalletDetailPage from './pages/WalletDetailPage';

const parseRoute = (pathname) => {
  const cleanPath = pathname && pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname;
  const routePath = cleanPath || '/';

  if (routePath === '/') return { name: 'home' };
  if (routePath === '/markets') return { name: 'markets' };
  if (routePath === '/assets') return { name: 'assets' };
  if (routePath === '/derivatives' || routePath === '/deriv') return { name: 'derivatives' };
  if (routePath === '/graph') return { name: 'graph' };
  if (routePath === '/knowledge') return { name: 'knowledge' };
  if (routePath === '/other') return { name: 'other' };
  if (routePath === '/providers') return { name: 'providers' };
  if (routePath === '/signals') return { name: 'signals' };
  if (routePath === '/decisions') return { name: 'decisions' };
  if (routePath === '/probability') return { name: 'probability' };
  if (routePath === '/strategies') return { name: 'strategies' };
  if (routePath === '/strategy') return { name: 'strategy' };
  if (routePath === '/account' || routePath === '/settings') return { name: 'account' };
  if (routePath === '/wallet') return { name: 'wallet' };

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

  const decisionDetailMatch = routePath.match(/^\/decision\/(.+)$/);
  if (decisionDetailMatch) {
    return { name: 'decision-detail', id: decodeURIComponent(decisionDetailMatch[1]) };
  }

  const strategyDetailMatch = routePath.match(/^\/strategy\/(.+)$/);
  if (strategyDetailMatch) {
    return { name: 'strategy-detail', id: decodeURIComponent(strategyDetailMatch[1]) };
  }

  const walletDetailMatch = routePath.match(/^\/wallet\/(.+)$/);
  if (walletDetailMatch) {
    return { name: 'wallet-detail', id: decodeURIComponent(walletDetailMatch[1]) };
  }

  const providerDetailMatch = routePath.match(/^\/provider\/(.+)$/);
  if (providerDetailMatch) {
    return { name: 'provider-detail', id: decodeURIComponent(providerDetailMatch[1]) };
  }

  return { name: 'not-found' };
};

const NotFoundPage = () => {
  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <h1>Route not found</h1>
        <p>
          Try `/markets`, `/assets`, `/other`, `/derivatives`, `/knowledge`, `/providers`, `/signals`, `/decisions`, `/probability`, `/strategies`, `/graph`, `/strategy`, `/account`, `/wallet`,
          `/signal/:id`, `/decision/:id`, `/strategy/:id`, `/wallet/:id`, or `/provider/:id`.
        </p>
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

      {route.name === 'derivatives' ? <DerivativesPage snapshot={snapshot} /> : null}

      {route.name === 'knowledge' ? <KnowledgePage snapshot={snapshot} /> : null}

      {route.name === 'other' ? <OtherPage snapshot={snapshot} /> : null}

      {route.name === 'providers' ? <ProviderListPage snapshot={snapshot} /> : null}

      {route.name === 'provider-detail' ? <ProviderDetailPage providerId={route.id} snapshot={snapshot} /> : null}

      {route.name === 'signals' ? <SignalListPage snapshot={snapshot} /> : null}

      {route.name === 'decisions' ? <DecisionListPage snapshot={snapshot} /> : null}

      {route.name === 'probability' ? <ProbabilityLabPage snapshot={snapshot} historyByMarket={historyByMarket} /> : null}

      {route.name === 'signal' ? <SignalDetailPage signalId={route.id} snapshot={snapshot} /> : null}

      {route.name === 'decision-detail' ? <DecisionDetailPage decisionId={route.id} snapshot={snapshot} /> : null}

      {route.name === 'strategies' ? <StrategyListPage snapshot={snapshot} /> : null}

      {route.name === 'strategy-detail' ? <StrategyDetailPage strategyId={route.id} snapshot={snapshot} /> : null}

      {route.name === 'graph' ? <GraphPage snapshot={snapshot} /> : null}

      {route.name === 'strategy' ? <StrategyLabPage snapshot={snapshot} historyByMarket={historyByMarket} /> : null}

      {route.name === 'account' ? <AccountPage /> : null}

      {route.name === 'wallet' ? <WalletPage snapshot={snapshot} /> : null}

      {route.name === 'wallet-detail' ? <WalletDetailPage walletId={route.id} snapshot={snapshot} /> : null}

      {route.name === 'not-found' ? <NotFoundPage /> : null}
    </main>
  );
}
