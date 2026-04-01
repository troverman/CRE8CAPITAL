import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '../lib/router';
import AlertBell from './AlertBell';

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/markets', label: 'Markets' },
  {
    label: 'Trading',
    children: [
      { to: '/strategies', label: 'Strategies' },
      { to: '/signals', label: 'Signals' },
      { to: '/decisions', label: 'Decisions' },
      { to: '/positions', label: 'Positions' },
      { to: '/wallet', label: 'Wallet' },
    ],
  },
  {
    label: 'Lab',
    children: [
      { to: '/backtest', label: 'Backtest' },
      { to: '/probability', label: 'Probability' },
      { to: '/strategy', label: 'Strategy Lab' },
      { to: '/graph', label: 'Graph' },
      { to: '/total-market', label: 'Total Market' },
    ],
  },
  {
    label: 'System',
    children: [
      { to: '/runtime', label: 'Runtime' },
      { to: '/providers', label: 'Providers' },
      { to: '/exchange', label: 'Exchange' },
      { to: '/knowledge', label: 'Knowledge' },
      { to: '/account', label: 'Account' },
    ],
  },
];

const isChildActive = (children, path) => {
  if (!children) return false;
  return children.some((child) => {
    if (child.to === '/strategies') return path === '/strategies' || path.startsWith('/strategy/') || path === '/strategy/create';
    if (child.to === '/signals') return path === '/signals' || path.startsWith('/signal/');
    if (child.to === '/decisions') return path === '/decisions' || path.startsWith('/decision/');
    if (child.to === '/positions') return path === '/positions';
    if (child.to === '/wallet') return path === '/wallet' || path.startsWith('/wallet/');
    if (child.to === '/strategy') return path === '/strategy';
    if (child.to === '/providers') return path === '/providers' || path.startsWith('/provider/');
    if (child.to === '/account') return path === '/account' || path === '/settings';
    return path === child.to;
  });
};

const isLinkActive = (to, path) => {
  if (to === '/') return path === '/';
  if (to === '/markets') return path === '/markets' || path.startsWith('/market/');
  if (to === '/strategies') return path === '/strategies' || path.startsWith('/strategy/') || path === '/strategy/create';
  if (to === '/signals') return path === '/signals' || path.startsWith('/signal/');
  if (to === '/decisions') return path === '/decisions' || path.startsWith('/decision/');
  if (to === '/wallet') return path === '/wallet' || path.startsWith('/wallet/');
  if (to === '/providers') return path === '/providers' || path.startsWith('/provider/');
  if (to === '/account') return path === '/account' || path === '/settings';
  return path === to;
};

export default function TopNav({ pathname, connected, transport, localFallback }) {
  const normalize = pathname && pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname;
  const path = normalize || '/';

  const [openDropdown, setOpenDropdown] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef(null);

  const closeAll = useCallback(() => {
    setOpenDropdown(null);
    setMobileOpen(false);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (navRef.current && !navRef.current.contains(e.target)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Close on route change
  useEffect(() => {
    closeAll();
  }, [pathname, closeAll]);

  const toggleDropdown = (label) => {
    setOpenDropdown((prev) => (prev === label ? null : label));
  };

  return (
    <header className="top-nav" ref={navRef}>
      <div className="nav-brand-row">
        <Link to="/" className="brand">
          <span className="brand-mark" />
          <strong>CRE8 Capital</strong>
        </Link>
        <button
          type="button"
          className="hamburger-btn"
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-label="Toggle navigation"
        >
          <span className={`hamburger-icon ${mobileOpen ? 'open' : ''}`} />
        </button>
      </div>

      <nav className={`nav-links ${mobileOpen ? 'open' : ''}`} aria-label="Primary">
        {NAV.map((item) => {
          if (item.to) {
            // Simple link
            return (
              <Link
                key={item.label}
                to={item.to}
                className={isLinkActive(item.to, path) ? 'nav-link active' : 'nav-link'}
              >
                {item.label}
              </Link>
            );
          }

          // Dropdown
          const isOpen = openDropdown === item.label;
          const parentActive = isChildActive(item.children, path);

          return (
            <div
              key={item.label}
              className="nav-dropdown"
              onMouseEnter={() => {
                if (window.innerWidth > 768) setOpenDropdown(item.label);
              }}
              onMouseLeave={() => {
                if (window.innerWidth > 768) setOpenDropdown(null);
              }}
            >
              <button
                type="button"
                className={`nav-link nav-dropdown-trigger ${parentActive ? 'active' : ''}`}
                onClick={() => toggleDropdown(item.label)}
                aria-expanded={isOpen}
              >
                {item.label}
                <svg className="dropdown-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 4L5 6.5L7.5 4" />
                </svg>
              </button>
              {isOpen ? (
                <div className="nav-dropdown-menu">
                  {item.children.map((child) => (
                    <Link
                      key={child.to}
                      to={child.to}
                      className={isLinkActive(child.to, path) ? 'nav-dropdown-item active' : 'nav-dropdown-item'}
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="nav-right">
        <AlertBell />
        <div className="live-pill">
          <span className={connected ? 'dot on' : 'dot'} />
          <span>{connected ? `Live ${transport}` : localFallback ? 'Offline (local feed)' : 'Offline'}</span>
        </div>
      </div>
    </header>
  );
}
