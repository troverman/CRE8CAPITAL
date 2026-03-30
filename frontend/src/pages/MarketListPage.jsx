import { useMemo, useState } from 'react';
import GlowCard from '../components/GlowCard';
import Sparkline from '../components/Sparkline';
import { fmtCompact, fmtNum, fmtPct } from '../lib/format';
import { Link } from '../lib/router';

export default function MarketListPage({ markets, historyByMarket }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return markets;
    return markets.filter((market) => {
      return (
        market.symbol.toLowerCase().includes(term) ||
        market.assetClass.toLowerCase().includes(term) ||
        market.key.toLowerCase().includes(term)
      );
    });
  }, [markets, search]);

  return (
    <section className="page-grid">
      <GlowCard className="list-header-card">
        <div className="section-head">
          <h1>Markets</h1>
          <span>{filtered.length} shown</span>
        </div>
        <input
          className="filter-input"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search symbol, asset class, or key"
          aria-label="Search markets"
        />
      </GlowCard>

      <div className="market-grid">
        {filtered.map((market) => {
          const history = historyByMarket[market.key] || [];
          return (
            <Link key={market.key} to={`/market/${encodeURIComponent(market.key)}`} className="market-card-link">
              <GlowCard className="market-card">
                <div className="market-head">
                  <strong>{market.symbol}</strong>
                  <span>{market.assetClass}</span>
                </div>
                <div className="market-metrics">
                  <span>{fmtNum(market.referencePrice, 4)}</span>
                  <span className={Number(market.changePct) >= 0 ? 'up' : 'down'}>{fmtPct(market.changePct)}</span>
                </div>
                <Sparkline data={history.map((point) => point.price)} />
                <div className="market-foot">
                  <small>spread {fmtNum(market.spreadBps, 1)} bps</small>
                  <small>vol {fmtCompact(market.totalVolume)}</small>
                </div>
              </GlowCard>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

