import { useMemo } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import { fmtInt, fmtNum, fmtTime } from '../lib/format';
import { buildProviderRows } from '../lib/providerView';
import { STRATEGY_OPTIONS } from '../lib/strategyEngine';
import { Link } from '../lib/router';

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toneClass = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return '';
  return num > 0 ? 'up' : 'down';
};

const isOptionMarket = (market) => {
  const type = String(market?.instrumentType || '').toLowerCase();
  const symbol = String(market?.symbol || '').toUpperCase();
  return type === 'option' || symbol.includes('-C') || symbol.includes('-P') || symbol.includes('CALL') || symbol.includes('PUT');
};

const isFutureMarket = (market) => {
  if (isOptionMarket(market)) return false;
  const type = String(market?.instrumentType || '').toLowerCase();
  const symbol = String(market?.symbol || '').toUpperCase();
  return type === 'future' || symbol.includes('PERP') || symbol.includes('FUT');
};

const isDerivativeMarket = (market) => {
  const assetClass = String(market?.assetClass || '').toLowerCase();
  return assetClass === 'derivative' || isOptionMarket(market) || isFutureMarket(market);
};

export default function DerivativesPage({ snapshot }) {
  const derivativeMarkets = useMemo(() => {
    return [...(snapshot?.markets || [])].filter(isDerivativeMarket).sort((a, b) => toNum(b.totalVolume, 0) - toNum(a.totalVolume, 0));
  }, [snapshot?.markets]);

  const futures = useMemo(() => derivativeMarkets.filter(isFutureMarket), [derivativeMarkets]);
  const options = useMemo(() => derivativeMarkets.filter(isOptionMarket), [derivativeMarkets]);
  const providers = useMemo(() => buildProviderRows(snapshot), [snapshot]);

  const derivativeProviders = useMemo(() => {
    return providers
      .filter((provider) => {
        const scope = String(provider?.scope || '').toLowerCase();
        const label = `${String(provider?.name || '')} ${String(provider?.id || '')}`.toLowerCase();
        return scope === 'futures' || scope === 'options' || scope === 'derivatives' || label.includes('future') || label.includes('option') || label.includes('deribit') || label.includes('cme');
      })
      .slice(0, 64);
  }, [providers]);

  const strategyHooks = useMemo(() => {
    return STRATEGY_OPTIONS.filter((option) => ['funding-carry', 'basis-arb', 'iv-reversion', 'gamma-squeeze'].includes(option.id));
  }, []);

  const avgFundingBps = useMemo(() => {
    if (!futures.length) return 0;
    const sum = futures.reduce((acc, market) => acc + toNum(market.fundingRateBps, 0), 0);
    return sum / futures.length;
  }, [futures]);

  const avgBasisBps = useMemo(() => {
    if (!futures.length) return 0;
    const sum = futures.reduce((acc, market) => acc + toNum(market.basisBps, 0), 0);
    return sum / futures.length;
  }, [futures]);

  const avgIvPct = useMemo(() => {
    if (!options.length) return 0;
    const sum = options.reduce((acc, market) => acc + toNum(market.impliedVolPct, 0), 0);
    return sum / options.length;
  }, [options]);

  const totalOpenInterest = useMemo(() => {
    return derivativeMarkets.reduce((acc, market) => acc + Math.max(0, toNum(market.openInterest, 0)), 0);
  }, [derivativeMarkets]);

  return (
    <section className="page-grid">
      <GlowCard className="list-header-card">
        <div className="section-head">
          <h1>Derivatives</h1>
          <div className="section-actions">
            <Link to="/providers" className="inline-link">
              Provider list
            </Link>
            <Link to="/knowledge" className="inline-link">
              Knowledge
            </Link>
            <Link to="/strategy" className="inline-link">
              Strategy lab
            </Link>
          </div>
        </div>
        <p className="socket-status-copy">
          Futures + options surface for funding, basis, IV, skew, and OI context that can drive derivative-specific strategy decisions.
        </p>
      </GlowCard>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Derivative Markets</span>
          <strong>{fmtInt(derivativeMarkets.length)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Futures</span>
          <strong>{fmtInt(futures.length)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Options</span>
          <strong>{fmtInt(options.length)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Derivative Providers</span>
          <strong>{fmtInt(derivativeProviders.length)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Avg Funding</span>
          <strong className={toneClass(avgFundingBps)}>{fmtNum(avgFundingBps, 2)} bps</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Avg Basis</span>
          <strong className={toneClass(avgBasisBps)}>{fmtNum(avgBasisBps, 2)} bps</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Avg IV</span>
          <strong>{fmtNum(avgIvPct, 2)}%</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Total OI</span>
          <strong>{fmtNum(totalOpenInterest, 0)}</strong>
        </GlowCard>
      </div>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Futures Board</h2>
            <span>{futures.length} markets</span>
          </div>
          <FlashList
            items={futures}
            height={420}
            itemHeight={92}
            className="tick-flash-list"
            emptyCopy="No futures markets available yet."
            keyExtractor={(market) => market.key}
            renderItem={(market, index) => (
              <article className="knowledge-feed-row">
                <div className="section-head">
                  <strong>
                    {index + 1}. {market.symbol}
                  </strong>
                  <Link to={`/market/${encodeURIComponent(market.key)}`} className="inline-link">
                    market
                  </Link>
                </div>
                <p>
                  px {fmtNum(market.referencePrice, 4)} | basis <span className={toneClass(market.basisBps)}>{fmtNum(market.basisBps, 2)} bps</span> | funding{' '}
                  <span className={toneClass(market.fundingRateBps)}>{fmtNum(market.fundingRateBps, 2)} bps</span>
                </p>
                <div className="item-meta">
                  <small>{market.underlying || '-'}</small>
                  <small>{market.expiry || '-'}</small>
                  <small>oi {fmtNum(market.openInterest, 0)}</small>
                  <small className={toneClass(market.openInterestChangePct)}>{fmtNum(market.openInterestChangePct, 2)}%</small>
                  <small>{fmtTime(market.updatedAt)}</small>
                </div>
              </article>
            )}
          />
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Options Board</h2>
            <span>{options.length} contracts</span>
          </div>
          <FlashList
            items={options}
            height={420}
            itemHeight={98}
            className="tick-flash-list"
            emptyCopy="No options contracts available yet."
            keyExtractor={(market) => market.key}
            renderItem={(market, index) => (
              <article className="knowledge-feed-row">
                <div className="section-head">
                  <strong>
                    {index + 1}. {market.symbol}
                  </strong>
                  <Link to={`/market/${encodeURIComponent(market.key)}`} className="inline-link">
                    market
                  </Link>
                </div>
                <p>
                  iv {fmtNum(market.impliedVolPct, 2)}% | skew {fmtNum(market.optionSkewPct, 2)} | p/c {fmtNum(market.putCallRatio, 2)}
                </p>
                <div className="item-meta">
                  <small>
                    {market.optionType || '-'} {market.strike ? `K${fmtNum(market.strike, 0)}` : ''}
                  </small>
                  <small>{market.underlying || '-'}</small>
                  <small>{market.expiry || '-'}</small>
                  <small>delta {fmtNum(market.delta, 3)}</small>
                  <small>gamma {fmtNum(market.gamma, 4)}</small>
                  <small>vega {fmtNum(market.vega, 2)}</small>
                  <small>theta {fmtNum(market.theta, 2)}</small>
                </div>
              </article>
            )}
          />
        </GlowCard>
      </div>

      <div className="two-col">
        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Derivative Providers</h2>
            <span>{derivativeProviders.length} channels</span>
          </div>
          <div className="list-stack">
            {derivativeProviders.map((provider) => (
              <article key={`deriv-provider:${provider.key}`} className="list-item">
                <strong>
                  <Link to={`/provider/${encodeURIComponent(provider.id)}`} className="inline-link">
                    {provider.name}
                  </Link>
                </strong>
                <p>
                  {provider.scope} | {provider.source} | coverage {fmtNum(provider.coveragePct, 1)}%
                </p>
                <div className="item-meta">
                  <small>{provider.id}</small>
                  <small>{provider.channel || 'derivative stream'}</small>
                  <small>{provider.connected ? 'live' : 'watch'}</small>
                  <small>{fmtTime(provider.lastSeenAt)}</small>
                </div>
              </article>
            ))}
            {derivativeProviders.length === 0 ? <p className="action-message">No derivative providers available yet.</p> : null}
          </div>
        </GlowCard>

        <GlowCard className="panel-card">
          <div className="section-head">
            <h2>Derivative Strategy Hooks</h2>
            <span>{strategyHooks.length} options</span>
          </div>
          <div className="list-stack">
            {strategyHooks.map((strategy) => (
              <article key={`deriv-strategy:${strategy.id}`} className="list-item">
                <strong>
                  <Link to={`/strategy/${encodeURIComponent(strategy.id)}`} className="inline-link">
                    {strategy.label}
                  </Link>
                </strong>
                <p>{strategy.description}</p>
                <div className="item-meta">
                  <small>{strategy.id}</small>
                  <Link to="/strategy" className="inline-link">
                    open in strategy lab
                  </Link>
                </div>
              </article>
            ))}
            {strategyHooks.length === 0 ? <p className="action-message">No derivative strategy hooks are configured yet.</p> : null}
          </div>
        </GlowCard>
      </div>
    </section>
  );
}
