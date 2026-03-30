import { Link } from '../lib/router';

const navItems = [
  { to: '/', label: 'Overview' },
  { to: '/markets', label: 'Markets' },
  { to: '/assets', label: 'Assets' }
];

export default function TopNav({ pathname, connected, transport, localFallback }) {
  const normalize = pathname && pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname;
  const path = normalize || '/';
  const isActive = (to) => {
    if (to === '/') return path === '/';
    if (to === '/markets') return path === '/markets' || path.startsWith('/market/');
    if (to === '/assets') return path === '/assets' || path.startsWith('/asset/');
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
