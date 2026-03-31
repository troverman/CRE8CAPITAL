import GlowCard from '../components/GlowCard';
import { fmtInt } from '../lib/format';
import { Link } from '../lib/router';

const buildOtherLinks = (snapshot) => {
  const markets = Array.isArray(snapshot?.markets) ? snapshot.markets : [];
  const providers = Array.isArray(snapshot?.providers) ? snapshot.providers : [];
  const signals = Array.isArray(snapshot?.signals) ? snapshot.signals : [];
  const decisions = Array.isArray(snapshot?.decisions) ? snapshot.decisions : [];
  const feed = Array.isArray(snapshot?.feed) ? snapshot.feed : [];
  const strategyCount = Array.isArray(snapshot?.strategies) ? snapshot.strategies.length : 0;

  const derivativeCount = markets.filter((market) => String(market?.assetClass || '').toLowerCase() === 'derivative').length;

  return [
    {
      id: 'graph',
      label: 'Graph',
      to: '/graph',
      description: 'Topology map for market/provider/signal/strategy links and runtime graph exploration.',
      meta: `${fmtInt(markets.length)} markets | ${fmtInt(providers.length)} providers`
    },
    {
      id: 'exchange',
      label: 'Exchange',
      to: '/exchange',
      description: 'Stubbed exchange workspace for passport wiring and future cross-exchange operations.',
      meta: `${fmtInt(providers.length)} provider routes planned`
    },
    {
      id: 'total-market',
      label: 'Total Market Lab',
      to: '/total-market',
      description: 'Experimental animated tensor view for total market drift, breadth, liquidity, and stress over time.',
      meta: `${fmtInt(markets.length)} markets in tensor scope`
    },
    {
      id: 'backtest',
      label: 'Backtest',
      to: '/backtest',
      description: 'Dedicated backtest surface for strategy runs, equity curves, and full trade/signal replay.',
      meta: `${fmtInt(strategyCount)} strategy templates`
    },
    {
      id: 'probability',
      label: 'PDF Lab',
      to: '/probability',
      description: 'Probability-density heatmaps, bucket painting, and scenario projection tools.',
      meta: `${fmtInt(signals.length)} signals in memory`
    },
    {
      id: 'derivatives',
      label: 'Derivatives',
      to: '/derivatives',
      description: 'Futures/options surface with funding, basis, IV, and derivatives strategy context.',
      meta: `${fmtInt(derivativeCount)} derivative markets`
    },
    {
      id: 'knowledge',
      label: 'Knowledge',
      to: '/knowledge',
      description: 'External intel feed and provider influence context for strategy layering.',
      meta: `${fmtInt(feed.length)} feed rows`
    },
    {
      id: 'providers',
      label: 'Providers',
      to: '/providers',
      description: 'Provider catalog, status, and drilldown pages for market/execution data inputs.',
      meta: `${fmtInt(providers.length)} providers`
    },
    {
      id: 'strategy-lab',
      label: 'Strategy Lab',
      to: '/strategy',
      description: 'Realtime paper execution lab, wallet simulation, and linked tx/position traces.',
      meta: `${fmtInt(decisions.length)} decisions | ${fmtInt(strategyCount)} strategies`
    }
  ];
};

export default function OtherPage({ snapshot }) {
  const links = buildOtherLinks(snapshot);

  return (
    <section className="page-grid">
      <GlowCard className="list-header-card">
        <div className="section-head">
          <h1>Other</h1>
          <span>{links.length} utility pages</span>
        </div>
        <p className="socket-status-copy">PDF + derivatives + utility routes moved off primary nav for a cleaner top-level flow.</p>
      </GlowCard>

      <div className="other-grid">
        {links.map((item) => (
          <Link key={item.id} to={item.to} className="other-link-card">
            <GlowCard className="other-card">
              <div className="section-head">
                <strong>{item.label}</strong>
                <span>{item.to}</span>
              </div>
              <p>{item.description}</p>
              <small>{item.meta}</small>
            </GlowCard>
          </Link>
        ))}
      </div>
    </section>
  );
}
