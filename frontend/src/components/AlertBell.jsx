import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAlerts, markAlertRead, markAllAlertsRead } from '../lib/capitalApi';

const POLL_INTERVAL_MS = 10000;
const MAX_ALERTS = 20;

const severityColor = (severity) => {
  if (severity === 'critical') return '#ef4444';
  if (severity === 'error') return '#f97316';
  if (severity === 'warning') return '#eab308';
  return '#3b82f6';
};

const timeAgo = (dateStr) => {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr + 'Z').getTime();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
};

export default function AlertBell() {
  const [alerts, setAlerts] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const pollRef = useRef(null);
  const dropdownRef = useRef(null);

  const loadAlerts = useCallback(async () => {
    try {
      const data = await fetchAlerts(MAX_ALERTS);
      setAlerts(data.items || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (_) {
      // Non-critical: backend might be offline
    }
  }, []);

  useEffect(() => {
    loadAlerts();
    pollRef.current = setInterval(loadAlerts, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadAlerts]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleMarkAllRead = async () => {
    try {
      await markAllAlertsRead();
      setAlerts((prev) => prev.map((a) => ({ ...a, read: 1 })));
      setUnreadCount(0);
    } catch (_) {}
  };

  const handleMarkRead = async (id) => {
    try {
      await markAlertRead(id);
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, read: 1 } : a)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (_) {}
  };

  return (
    <div className="alert-bell-container" ref={dropdownRef}>
      <button
        type="button"
        className="alert-bell-btn"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={`Alerts: ${unreadCount} unread`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 ? <span className="alert-bell-badge">{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
      </button>

      {open ? (
        <div className="alert-bell-dropdown">
          <div className="alert-bell-header">
            <strong>Alerts</strong>
            {unreadCount > 0 ? (
              <button type="button" className="alert-bell-mark-all" onClick={handleMarkAllRead}>
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="alert-bell-list">
            {alerts.length === 0 ? (
              <p className="alert-bell-empty">No alerts yet.</p>
            ) : (
              alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`alert-bell-item ${alert.read ? '' : 'unread'}`}
                  onClick={() => !alert.read && handleMarkRead(alert.id)}
                >
                  <span className="alert-bell-dot" style={{ background: severityColor(alert.severity) }} />
                  <div className="alert-bell-content">
                    <strong>{alert.title}</strong>
                    <p>{alert.message}</p>
                    <small>{timeAgo(alert.createdAt)} | {alert.type}</small>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
