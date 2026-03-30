import { useCallback, useEffect, useRef, useState } from 'react';
import { getSnapshotUrl, getStreamUrl, restrategyUrl } from '../lib/capitalApi';
import { buildLocalFallbackSnapshot } from '../lib/localSnapshot';

const initialSnapshot = {
  running: false,
  telemetry: {},
  controller: {},
  providers: [],
  markets: [],
  marketSummary: {},
  signals: [],
  signalSummary: {},
  strategies: [],
  strategySummary: {},
  positions: [],
  decisions: [],
  feed: []
};

const parseEventData = (rawData) => {
  try {
    return JSON.parse(rawData);
  } catch (error) {
    return null;
  }
};

const liveLimits = {
  marketLimit: 220,
  signalLimit: 120,
  decisionLimit: 120,
  feedLimit: 140
};

export default function useCapitalLive() {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [connected, setConnected] = useState(false);
  const [localFallback, setLocalFallback] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [transport, setTransport] = useState('boot');
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [error, setError] = useState('');
  const [restrategyBusy, setRestrategyBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState('');

  const requestRef = useRef({ id: 0, controller: null });
  const streamRef = useRef(null);
  const pollTimerRef = useRef(null);
  const mountedRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const closeStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = null;
    }
  }, []);

  const loadSnapshot = useCallback(async () => {
    const requestId = requestRef.current.id + 1;
    requestRef.current.id = requestId;

    if (requestRef.current.controller) {
      requestRef.current.controller.abort();
    }

    const controller = new AbortController();
    requestRef.current.controller = controller;
    setSyncing(true);

    try {
      const response = await fetch(getSnapshotUrl(liveLimits), { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();

      if (!mountedRef.current || requestId !== requestRef.current.id) return;
      setSnapshot(payload);
      setConnected(true);
      setLocalFallback(false);
      setError('');
      setLastSyncedAt(Date.now());
    } catch (loadError) {
      if (loadError.name === 'AbortError') return;
      if (!mountedRef.current || requestId !== requestRef.current.id) return;
      setConnected(false);
      setLocalFallback(true);
      setTransport('local');
      setSnapshot((previous) => buildLocalFallbackSnapshot(previous));
      setError(`Runtime unavailable (${loadError.message || 'snapshot fetch failed'}). Using local fallback feed.`);
      setLastSyncedAt(Date.now());
    } finally {
      if (!mountedRef.current || requestId !== requestRef.current.id) return;
      setSyncing(false);
      setLoading(false);
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    setTransport('polling');
    pollTimerRef.current = setInterval(() => {
      loadSnapshot();
    }, 3000);
  }, [loadSnapshot, stopPolling]);

  useEffect(() => {
    mountedRef.current = true;
    loadSnapshot();

    if (typeof window !== 'undefined' && 'EventSource' in window) {
      const eventSource = new EventSource(getStreamUrl(liveLimits));
      streamRef.current = eventSource;
      setTransport('stream');

      const onSnapshot = (event) => {
        const payload = parseEventData(event.data);
        if (!payload || !mountedRef.current) return;
        setSnapshot(payload);
        setConnected(true);
        setLocalFallback(false);
        setError('');
        setLastSyncedAt(Date.now());
        setLoading(false);
      };

      eventSource.addEventListener('snapshot', onSnapshot);
      eventSource.onerror = () => {
        if (!mountedRef.current) return;
        closeStream();
        setConnected(false);
        setError('Live stream disconnected. Falling back to polling.');
        startPolling();
      };
    } else {
      startPolling();
    }

    return () => {
      mountedRef.current = false;
      closeStream();
      stopPolling();
      if (requestRef.current.controller) {
        requestRef.current.controller.abort();
      }
    };
  }, [closeStream, loadSnapshot, startPolling, stopPolling]);

  const triggerRestrategy = useCallback(
    async (reason) => {
      setRestrategyBusy(true);
      setActionMessage('');
      try {
        const response = await fetch(restrategyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: reason || 'manual rebalance check',
            source: 'capital-dashboard'
          })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        setActionMessage(`Restrategy queued at ${new Date(payload.request?.requestedAt || Date.now()).toLocaleTimeString()}`);
      } catch (triggerError) {
        setActionMessage(`Restrategy failed: ${triggerError.message}`);
      } finally {
        setRestrategyBusy(false);
      }
    },
    []
  );

  return {
    snapshot,
    connected,
    loading,
    syncing,
    transport,
    localFallback,
    lastSyncedAt,
    error,
    restrategyBusy,
    actionMessage,
    refresh: loadSnapshot,
    triggerRestrategy
  };
}
