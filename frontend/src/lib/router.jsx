import { useEffect, useState } from 'react';

const NAV_EVENT = 'cre8capital:navigate';

export const getPathname = () => {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname || '/';
};

export const navigate = (to) => {
  if (typeof window === 'undefined') return;
  const currentPath = window.location.pathname || '/';
  if (currentPath === to) return;
  window.history.pushState({}, '', to);
  window.dispatchEvent(new Event(NAV_EVENT));
};

export const usePathname = () => {
  const [pathname, setPathname] = useState(getPathname);

  useEffect(() => {
    const onRoute = () => setPathname(getPathname());
    window.addEventListener('popstate', onRoute);
    window.addEventListener(NAV_EVENT, onRoute);
    return () => {
      window.removeEventListener('popstate', onRoute);
      window.removeEventListener(NAV_EVENT, onRoute);
    };
  }, []);

  return pathname;
};

export const Link = ({ to, className, children, title }) => {
  const onClick = (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };

  return (
    <a href={to} className={className} onClick={onClick} title={title}>
      {children}
    </a>
  );
};

