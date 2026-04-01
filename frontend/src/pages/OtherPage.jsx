import GlowCard from '../components/GlowCard';
import { fmtInt } from '../lib/format';
import { Link } from '../lib/router';

const buildToolLinks = (snapshot) => {
  const markets = Array.isArray(snapshot?.markets) ? snapshot.markets : [];
  const providers = Array.isArray(snapshot?.providers) ? snapshot.providers : [];
  const signals = Array.isArray(snapshot?.signals) ? snapshot.signals : [];
  const decisions = Array.isArray(snapshot?.decisions) ? snapshot.decisions : [];
  const feed = Array.isArray(snapshot?.feed) ? snapshot.feed : [];
  const strategyCount = Array.isArray(snapshot?.strategies) ? snapshot.strategies.length : 0;

  const derivativeCount = markets.filter((market) => String(market?.assetClass || '').toLowerCase() === 'derivative').length;

  return [
    {
      id: 'backtest',
      label: 'Backtest',
      to: '/backtest',
      description: 'Dedicated backtest surface for strategy runs, equity curves, and full trade/signal replay.',
      meta: `${fmtInt(strategyCount)} strategy templates`
    },
    {
      id: 'probability',
      label: 'Probability Lab',
      to: '/probability',
      description: 'Probability-density heatmaps, bucket painting, and scenario projection tools.',
      meta: `${fmtInt(signals.length)} signals in memory`
    },
    {
      id: 'strategy-lab',
      label: 'Strategy Lab',
      to: '/strategy',
      description: 'Realtime paper execution lab, wallet simulation, and linked tx/position traces.',
      meta: `${fmtInt(decisions.length)} decisions | ${fmtInt(strategyCount)} strategies`
    },
    {
      id: 'graph',
      label: 'Graph',
      to: '/graph',
      description: 'Topology map for market/provider/signal/strategy links and runtime graph exploration.',
      meta: `${fmtInt(markets.length)} markets | ${fmtInt(providers.length)} providers`
    },
    {
      id: 'total-market',
      label: 'Total Market',
      to: '/total-market',
      description: 'Animated tensor view for total market drift, breadth, liquidity, and stress over time.',
      meta: `${fmtInt(markets.length)} markets in tensor scope`
    },
    {
      id: 'exchange',
      label: 'Exchange',
      to: '/exchange',
      description: 'Exchange workspace for passport wiring and future cross-exchange operations.',
      meta: `${fmtInt(providers.length)} provider routes planned`
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
  ];
};

export default function OtherPage({ snapshot }) {
  const links = buildToolLinks(snapshot);

  return (
    <section className="page-grid">
      <GlowCard className="list-header-card">
        <div className="section-head">
          <h1>Tools</h1>
          <span>{links.length} tools</span>
        </div>
        <p className="socket-status-copy">Analysis, simulation, and utility tools for the CRE8 Capital platform.</p>
      </GlowCard>

      <div className="tools-grid">
        {links.map((item) => (
          <Link key={item.id} to={item.to} className="other-link-card">
            <GlowCard className="tool-card">
              <strong>{item.label}</strong>
              <p>{item.description}</p>
              <small>{item.meta}</small>
            </GlowCard>
          </Link>
        ))}
      </div>
    </section>
  );
}
