import { Link } from '../lib/router';

const navItems = [
  { to: '/', label: 'Overview' },
  { to: '/assets', label: 'Assets' },
  { to: '/markets', label: 'Markets' },
  { to: '/graph', label: 'Graph' },
  { to: '/strategies', label: 'Strategies' },
  { to: '/signals', label: 'Signals' },
  { to: '/decisions', label: 'Decisions' },
  { to: '/wallet', label: 'Wallet' },
  { to: '/account', label: 'Account' }
];

export default function TopNav({ pathname, connected, transport, localFallback }) {
  const normalize = pathname && pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname;
  const path = normalize || '/';
  const isActive = (to) => {
    if (to === '/') return path === '/';
    if (to === '/markets') return path === '/markets' || path.startsWith('/market/');
    if (to === '/signals') return path === '/signals' || path.startsWith('/signal/');
    if (to === '/decisions') return path === '/decisions' || path.startsWith('/decision/');
    if (to === '/strategies') return path === '/strategies' || path.startsWith('/strategy/') || path === '/strategy';
    if (to === '/account') return path === '/account' || path === '/settings';
    if (to === '/wallet') return path === '/wallet' || path.startsWith('/wallet/');
    if (to === '/assets') return path === '/assets' || path.startsWith('/asset/');
    if (to === '/graph') return path === '/graph';
    return path === to;
  };

  return (
    <header className="top-nav">
      <Link to="/" className="brand">
        <span className="brand-mark" />
        <strong>CRE8 Capital</strong>
      </Link>

      <nav className="nav-links" aria-label="Primary">
        {navItems.map((item) => (
          <Link key={item.to} to={item.to} className={isActive(item.to) ? 'nav-link active' : 'nav-link'}>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="live-pill">
        <span className={connected ? 'dot on' : 'dot'} />
        <span>{connected ? `Live ${transport}` : localFallback ? 'Offline (local feed)' : 'Offline'}</span>
      </div>
    </header>
  );
}
