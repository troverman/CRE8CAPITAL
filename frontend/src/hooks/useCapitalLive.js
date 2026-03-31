import { useCallback, useEffect, useRef, useState } from 'react';
import { getSnapshotUrl, getStreamUrl, getWsUrl, restrategyUrl } from '../lib/capitalApi';
import { buildLocalFallbackSnapshot } from '../lib/localSnapshot';
import { useCapitalStore } from '../store/capitalStore';

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
  marketLimit: 360,
  signalLimit: 180,
  decisionLimit: 180,
  feedLimit: 180
};

const SIGNAL_HISTORY_MAX = 960;
const DECISION_HISTORY_MAX = 960;
const FEED_HISTORY_MAX = 420;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const rowTimestamp = (row) => {
  return Math.max(0, toNum(row?.timestamp, toNum(row?.updatedAt, 0)));
};

const rowKey = (row, index, prefix) => {
  const id = String(row?.id || '').trim();
  if (id) return `${prefix}:${id}`;
  const symbol = String(row?.symbol || row?.marketKey || row?.type || row?.strategyName || 'row');
  return `${prefix}:${symbol}:${rowTimestamp(row)}:${index}`;
};

const mergeHistoryRows = (previousRows, incomingRows, maxLength, prefix) => {
  const merged = [];
  const seen = new Set();
  const rows = [...asArray(incomingRows), ...asArray(previousRows)];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || typeof row !== 'object') continue;
    const key = rowKey(row, index, prefix);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  merged.sort((a, b) => rowTimestamp(b) - rowTimestamp(a));
  if (merged.length > maxLength) {
    merged.length = maxLength;
  }
  return merged;
};

const mergeSnapshotWithHistory = (previousSnapshot, incomingSnapshot) => {
  const previous = previousSnapshot && typeof previousSnapshot === 'object' ? previousSnapshot : initialSnapshot;
  const incoming = incomingSnapshot && typeof incomingSnapshot === 'object' ? incomingSnapshot : {};

  const signals = mergeHistoryRows(previous.signals, incoming.signals, SIGNAL_HISTORY_MAX, 'signal');
  const decisions = mergeHistoryRows(previous.decisions, incoming.decisions, DECISION_HISTORY_MAX, 'decision');
  const feed = mergeHistoryRows(previous.feed, incoming.feed, FEED_HISTORY_MAX, 'feed');

  const now = Date.now();
  const signalsFiveMinutes = signals.filter((row) => rowTimestamp(row) >= now - FIVE_MINUTES_MS).length;

  const signalTotal = Math.max(
    toNum(incoming?.signalSummary?.total, 0),
    toNum(incoming?.telemetry?.signalsGenerated, 0),
    toNum(previous?.signalSummary?.total, 0),
    toNum(previous?.telemetry?.signalsGenerated, 0),
    signals.length
  );

  const decisionTotal = Math.max(
    toNum(incoming?.strategySummary?.totalDecisions, 0),
    toNum(incoming?.telemetry?.decisionsGenerated, 0),
    toNum(previous?.strategySummary?.totalDecisions, 0),
    toNum(previous?.telemetry?.decisionsGenerated, 0),
    decisions.length
  );

  return {
    ...previous,
    ...incoming,
    signals,
    decisions,
    feed,
    signalSummary: {
      ...(incoming?.signalSummary || {}),
      total: signalTotal,
      lastFiveMinutes: Math.max(toNum(incoming?.signalSummary?.lastFiveMinutes, 0), signalsFiveMinutes)
    },
    strategySummary: {
      ...(incoming?.strategySummary || {}),
      totalDecisions: decisionTotal
    },
    telemetry: {
      ...(incoming?.telemetry || {}),
      signalsGenerated: Math.max(toNum(incoming?.telemetry?.signalsGenerated, 0), signalTotal),
      decisionsGenerated: Math.max(toNum(incoming?.telemetry?.decisionsGenerated, 0), decisionTotal)
    }
  };
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
  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const pollTimerRef = useRef(null);
  const mountedRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const closeWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
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
      setSnapshot((previous) => mergeSnapshotWithHistory(previous, payload));
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
      setSnapshot((previous) => mergeSnapshotWithHistory(previous, buildLocalFallbackSnapshot(previous)));
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

  const setupSSE = useCallback(() => {
    if (typeof window === 'undefined' || !('EventSource' in window)) {
      startPolling();
      return;
    }

    const eventSource = new EventSource(getStreamUrl(liveLimits));
    streamRef.current = eventSource;
    setTransport('stream');

    const onSnapshot = (event) => {
      const payload = parseEventData(event.data);
      if (!payload || !mountedRef.current) return;
      setSnapshot((previous) => mergeSnapshotWithHistory(previous, payload));
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
  }, [closeStream, startPolling]);

  const setupWebSocket = useCallback(() => {
    if (typeof window === 'undefined' || !('WebSocket' in window)) {
      setupSSE();
      return;
    }

    try {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;
      setTransport('websocket');
      let didFallback = false;

      const fallbackToSSE = (reason) => {
        if (didFallback || !mountedRef.current) return;
        didFallback = true;
        wsRef.current = null;
        setError(reason);
        setupSSE();
      };

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setConnected(true);
        setError('');
        setLoading(false);
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        const msg = parseEventData(event.data);
        if (!msg) return;

        if (msg.type === 'snapshot' && msg.data) {
          setSnapshot((previous) => mergeSnapshotWithHistory(previous, msg.data));
          setConnected(true);
          setLocalFallback(false);
          setError('');
          setLastSyncedAt(Date.now());
          setLoading(false);
        } else if (msg.type === 'trade' && msg.data) {
          setSnapshot((previous) => ({
            ...previous,
            feed: [{ id: msg.data.id, type: 'trade', timestamp: msg.data.timestamp, payload: msg.data }, ...(previous.feed || [])].slice(0, FEED_HISTORY_MAX)
          }));
        }
      };

      ws.onerror = () => {
        fallbackToSSE('WebSocket failed. Falling back to SSE.');
      };

      ws.onclose = () => {
        fallbackToSSE('WebSocket closed. Falling back to SSE.');
      };
    } catch (_) {
      setupSSE();
    }
  }, [closeWs, setupSSE]);

  useEffect(() => {
    mountedRef.current = true;
    loadSnapshot();
    setupWebSocket();

    return () => {
      mountedRef.current = false;
      closeWs();
      closeStream();
      stopPolling();
      if (requestRef.current.controller) {
        requestRef.current.controller.abort();
      }
    };
  }, [closeWs, closeStream, loadSnapshot, setupWebSocket, stopPolling]);

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

  useEffect(() => {
    const markets = Array.isArray(snapshot?.markets) ? snapshot.markets : [];
    const providers = Array.isArray(snapshot?.providers) ? snapshot.providers : [];
    if (markets.length > 0) {
      useCapitalStore.getState().upsertMarkets(markets);
    }
    if (providers.length > 0) {
      useCapitalStore.getState().upsertProviders(providers);
    }
  }, [snapshot?.markets, snapshot?.providers]);

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
