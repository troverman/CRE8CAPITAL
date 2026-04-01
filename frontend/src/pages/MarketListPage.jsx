import { useMemo, useState } from 'react';
import GlowCard from '../components/GlowCard';
import Sparkline from '../components/Sparkline';
import { fmtCompact, fmtNum, fmtPct } from '../lib/format';
import { Link } from '../lib/router';

const SORT_OPTIONS = [
  { key: 'symbol', label: 'Symbol' },
  { key: 'price', label: 'Price' },
  { key: 'change', label: 'Change' },
  { key: 'volume', label: 'Volume' },
  { key: 'spread', label: 'Spread' },
];

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

export default function MarketListPage({ markets, historyByMarket }) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('volume');
  const [sortAsc, setSortAsc] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let result = markets;
    if (term) {
      result = result.filter((market) => {
        return (
          market.symbol.toLowerCase().includes(term) ||
          market.assetClass.toLowerCase().includes(term) ||
          market.key.toLowerCase().includes(term)
        );
      });
    }
    return result;
  }, [markets, search]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    const dir = sortAsc ? 1 : -1;
    list.sort((a, b) => {
      switch (sortKey) {
        case 'symbol':
          return dir * String(a.symbol || '').localeCompare(String(b.symbol || ''));
        case 'price':
          return dir * (toNum(a.referencePrice) - toNum(b.referencePrice));
        case 'change':
          return dir * (toNum(a.changePct) - toNum(b.changePct));
        case 'volume':
          return dir * (toNum(a.totalVolume) - toNum(b.totalVolume));
        case 'spread':
          return dir * (toNum(a.spreadBps) - toNum(b.spreadBps));
        default:
          return 0;
      }
    });
    return list;
  }, [filtered, sortKey, sortAsc]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  return (
    <section className="page-grid">
      <GlowCard className="list-header-card">
        <div className="section-head">
          <h1>Markets</h1>
          <span>{sorted.length} shown</span>
        </div>
        <input
          className="filter-input"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search symbol, asset class, or key"
          aria-label="Search markets"
        />
        <div className="sort-bar">
          <small className="sort-label">Sort by:</small>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`sort-btn ${sortKey === opt.key ? 'active' : ''}`}
              onClick={() => handleSort(opt.key)}
            >
              {opt.label}
              {sortKey === opt.key ? (
                <span className="sort-arrow">{sortAsc ? ' \u2191' : ' \u2193'}</span>
              ) : null}
            </button>
          ))}
        </div>
      </GlowCard>

      <div className="market-grid">
        {sorted.map((market) => {
          const history = historyByMarket[market.key] || [];
          return (
            <Link key={market.key} to={`/market/${encodeURIComponent(market.key)}`} className="market-card-link">
              <GlowCard className="market-card market-card-hover">
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

      {sorted.length === 0 ? (
        <div className="empty-state">
          <p>{search ? 'No markets match your search.' : 'No markets loaded yet.'}</p>
        </div>
      ) : null}
    </section>
  );
}
