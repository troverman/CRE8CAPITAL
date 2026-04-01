import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getExternalSocketProviders, getLocalFallbackProviders } from '../providers';
import { useSocketFeedStore } from '../store/socketFeedStore';

const FALLBACK_DELAY_MS = 2800;

export default function useSocketProviders({ market, enabled }) {
  const providerStateById = useSocketFeedStore((state) => state.providerStateById);
  const seriesByProvider = useSocketFeedStore((state) => state.seriesByProvider);
  const depthByProvider = useSocketFeedStore((state) => state.depthByProvider);
  const recentTicks = useSocketFeedStore((state) => state.recentTicks);
  const resetForMarket = useSocketFeedStore((state) => state.resetForMarket);

  const workerRef = useRef(null);
  const [localFallbackActive, setLocalFallbackActive] = useState(false);

  const marketKey = market?.key || null;
  const currentMarketKeyRef = useRef(marketKey);
  currentMarketKeyRef.current = marketKey;

  useEffect(() => {
    resetForMarket(marketKey);
    setLocalFallbackActive(false);
  }, [marketKey, resetForMarket]);

  useEffect(() => {
    if (typeof Worker === 'undefined') return;

    const worker = new Worker(new URL('../workers/socketFeed.worker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const message = event.data || {};
      if (message.type !== 'snapshot' || !message.payload) return;
      useSocketFeedStore.getState().applyWorkerSnapshot(message.payload);
    };

    return () => {
      worker.terminate();
      if (workerRef.current === worker) {
        workerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({
      type: 'reset',
      marketKey
    });
  }, [marketKey]);

  const pushStatus = useCallback((status) => {
    if (!status?.id) return;
    const worker = workerRef.current;
    if (worker) {
      worker.postMessage({ type: 'status', status });
      return;
    }
    useSocketFeedStore.getState().ingestStatusFallback(status);
  }, []);

  const pushTick = useCallback((tick) => {
    if (!tick?.providerId) return;
    const worker = workerRef.current;
    if (worker) {
      worker.postMessage({ type: 'tick', tick });
      return;
    }
    useSocketFeedStore.getState().ingestTickFallback(tick);
  }, []);

  const pushDepth = useCallback((depth) => {
    if (!depth?.providerId) return;
    const worker = workerRef.current;
    if (worker) {
      worker.postMessage({ type: 'depth', depth });
      return;
    }
    useSocketFeedStore.getState().ingestDepthFallback(depth);
  }, []);

  const externalProviders = useMemo(() => {
    return getExternalSocketProviders().filter((provider) => provider.supportsMarket(market));
  }, [market]);

  const localProviders = useMemo(() => {
    return getLocalFallbackProviders().filter((provider) => provider.supportsMarket(market));
  }, [market]);
  const allProviderModels = useMemo(() => {
    return [...externalProviders, ...localProviders];
  }, [externalProviders, localProviders]);

  useEffect(() => {
    if (!market || !enabled || externalProviders.length === 0) {
      return;
    }

    let alive = true;
    const connections = [];

    for (const provider of externalProviders) {
      pushStatus({
        id: provider.id,
        name: provider.name,
        connected: false,
        error: ''
      });

      const connection = provider.connect({
        market,
        onTick: (tick) => {
          if (!alive) return;
          if (tick.symbol && currentMarketKeyRef.current && !tick.symbol.includes(currentMarketKeyRef.current.split(':')?.[1])) return;
          pushTick(tick);
        },
        onDepth: (depth) => {
          if (!alive) return;
          pushDepth(depth);
        },
        onStatus: (status) => {
          if (!alive) return;
          pushStatus(status);
        }
      });

      if (connection && typeof connection.disconnect === 'function') {
        connections.push({
          disconnect: connection.disconnect
        });
      }
    }

    return () => {
      alive = false;
      for (const connection of connections) {
        connection.disconnect();
      }
    };
  }, [enabled, externalProviders, market, pushDepth, pushStatus, pushTick]);

  const externalConnectedCount = useMemo(() => {
    return externalProviders.filter((provider) => Boolean(providerStateById[provider.id]?.connected)).length;
  }, [externalProviders, providerStateById]);

  useEffect(() => {
    if (!enabled || !market) {
      setLocalFallbackActive(false);
      return;
    }

    if (externalProviders.length === 0) {
      setLocalFallbackActive(true);
      return;
    }

    if (externalConnectedCount > 0) {
      setLocalFallbackActive(false);
      return;
    }

    const timerId = setTimeout(() => {
      setLocalFallbackActive(true);
    }, FALLBACK_DELAY_MS);

    return () => clearTimeout(timerId);
  }, [enabled, externalConnectedCount, externalProviders.length, market]);

  useEffect(() => {
    if (!enabled || !market || !localFallbackActive || localProviders.length === 0) {
      return;
    }

    let alive = true;
    const connections = [];

    // Wait one tick for worker reset to propagate before connecting local providers
    const delayTimer = setTimeout(() => {
      if (!alive) return;

      for (const provider of localProviders) {
        pushStatus({
          id: provider.id,
          name: provider.name,
          connected: false,
          error: ''
        });

        const connection = provider.connect({
          market,
          onTick: (tick) => {
            if (!alive) return;
            if (tick.symbol && currentMarketKeyRef.current && !tick.symbol.includes(currentMarketKeyRef.current.split(':')?.[1])) return;
            pushTick(tick);
          },
          onDepth: (depth) => {
            if (!alive) return;
            pushDepth(depth);
          },
          onStatus: (status) => {
            if (!alive) return;
            pushStatus(status);
          }
        });

        if (connection && typeof connection.disconnect === 'function') {
          connections.push({
            disconnect: connection.disconnect
          });
        }
      }
    }, 50);

    return () => {
      alive = false;
      clearTimeout(delayTimer);
      for (const connection of connections) {
        connection.disconnect();
      }
    };
  }, [enabled, localFallbackActive, localProviders, market, pushDepth, pushStatus, pushTick]);

  const listedProviders = useMemo(() => {
    const includeLocal = localFallbackActive || localProviders.some((provider) => Boolean(providerStateById[provider.id]));
    return includeLocal ? [...externalProviders, ...localProviders] : externalProviders;
  }, [externalProviders, localFallbackActive, localProviders, providerStateById]);

  const providerStates = useMemo(() => {
    return listedProviders.map((provider) => {
      if (!enabled) {
        return {
          id: provider.id,
          name: provider.name,
          connected: false,
          error: '',
          lastTickAt: null,
          price: null,
          bid: null,
          ask: null,
          volume: null,
          guardDrops: 0,
          local: Boolean(provider.isLocalFallback)
        };
      }

      const state = providerStateById[provider.id] || {};
      return {
        id: provider.id,
        name: state.name || provider.name,
        connected: Boolean(state.connected),
        error: state.error || '',
        lastTickAt: state.lastTickAt || null,
        price: state.price ?? null,
        bid: state.bid ?? null,
        ask: state.ask ?? null,
        volume: state.volume ?? null,
        guardDrops: Number(state.guardDrops) || 0,
        local: Boolean(provider.isLocalFallback)
      };
    });
  }, [enabled, listedProviders, providerStateById]);

  const sortedProviders = useMemo(() => {
    return [...providerStates].sort((a, b) => {
      if (a.local === b.local) return 0;
      return a.local ? 1 : -1;
    });
  }, [providerStates]);

  const primaryProvider = sortedProviders.find((provider) => provider.connected) || sortedProviders[0] || null;
  const primarySeries = primaryProvider ? seriesByProvider[primaryProvider.id] || [] : [];
  const primaryDepth = primaryProvider ? depthByProvider[primaryProvider.id] || null : null;
  const providerById = useMemo(() => {
    const map = {};
    for (const provider of allProviderModels) {
      if (!provider?.id) continue;
      map[provider.id] = provider;
    }
    return map;
  }, [allProviderModels]);

  return {
    providerStates: sortedProviders,
    providerById,
    seriesByProvider,
    depthByProvider,
    primaryProvider,
    primarySeries,
    primaryDepth,
    recentTicks,
    localFallbackActive,
    externalProviderCount: externalProviders.length,
    externalConnectedCount
  };
}
