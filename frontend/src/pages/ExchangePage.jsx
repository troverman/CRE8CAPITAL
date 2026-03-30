import GlowCard from '../components/GlowCard';
import { fmtInt } from '../lib/format';
import { Link } from '../lib/router';

const deriveExecutionReadyCount = (providers = []) => {
  return providers.filter((provider) => provider?.connected && provider?.execReady).length;
};

export default function ExchangePage({ snapshot }) {
  const providers = Array.isArray(snapshot?.providers) ? snapshot.providers : [];
  const connectedProviders = providers.filter((provider) => provider?.connected).length;
  const exchangeReady = deriveExecutionReadyCount(providers);
  const strategyCount = Array.isArray(snapshot?.strategies) ? snapshot.strategies.length : 0;

  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>Exchange</h1>
          <span>stub</span>
        </div>
        <p>
          Passport-linked exchange ops will live here: account routing, cross-exchange execution controls, and provider-aware strategy deployment.
        </p>
      </GlowCard>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Providers</span>
          <strong>{fmtInt(providers.length)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Connected</span>
          <strong>{fmtInt(connectedProviders)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Exec Ready</span>
          <strong>{fmtInt(exchangeReady)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Strategies</span>
          <strong>{fmtInt(strategyCount)}</strong>
        </GlowCard>
      </div>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Next Wiring</h2>
          <span>coming soon</span>
        </div>
        <ul className="strategy-action-list">
          <li>Passport provider binding for execution permissions and account-level limits.</li>
          <li>Cross-exchange route planner (best venue + slippage-aware split).</li>
          <li>Strategy-to-exchange mapping with guarded live toggle and audit trail.</li>
        </ul>
        <div className="section-actions">
          <Link to="/account" className="btn secondary">
            Open Passport
          </Link>
          <Link to="/providers" className="btn secondary">
            Open Providers
          </Link>
          <Link to="/strategy" className="btn secondary">
            Open Strategy Lab
          </Link>
        </div>
      </GlowCard>
    </section>
  );
}
