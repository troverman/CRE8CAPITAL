import { useCallback, useEffect, useMemo, useState } from 'react';
import { getExternalSocketProviders, getLocalFallbackProviders } from '../providers';

const MAX_POINTS = 240;
const FALLBACK_DELAY_MS = 2800;

const toNum = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const toFiniteOrNull = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export default function useSocketProviders({ market, enabled }) {
  const [providerStateById, setProviderStateById] = useState({});
  const [seriesByProvider, setSeriesByProvider] = useState({});
  const [localFallbackActive, setLocalFallbackActive] = useState(false);

  useEffect(() => {
    setProviderStateById({});
    setSeriesByProvider({});
    setLocalFallbackActive(false);
  }, [market?.key]);

  const externalProviders = useMemo(() => {
    return getExternalSocketProviders().filter((provider) => provider.supportsMarket(market));
  }, [market]);

  const localProviders = useMemo(() => {
    return getLocalFallbackProviders().filter((provider) => provider.supportsMarket(market));
  }, [market]);

  const setProviderStatus = useCallback((status) => {
    const id = status.id;
    setProviderStateById((previous) => {
      const current = previous[id] || {};
      return {
        ...previous,
        [id]: {
          id,
          name: status.name || current.name,
          connected: Boolean(status.connected),
          error: status.error || '',
          lastTickAt: current.lastTickAt || null,
          price: current.price || null,
          bid: current.bid || null,
          ask: current.ask || null,
          volume: current.volume || null
        }
      };
    });
  }, []);

  const onTick = useCallback((tick) => {
    if (!tick?.providerId) return;

    const point = {
      t: Number(tick.timestamp) || Date.now(),
      price: toNum(tick.price),
      spread:
        toFiniteOrNull(tick.bid) !== null && toFiniteOrNull(tick.ask) !== null
          ? ((toNum(tick.ask) - toNum(tick.bid)) / Math.max(toNum(tick.price), 1e-9)) * 10000
          : 0,
      volume: toNum(tick.volume)
    };

    setSeriesByProvider((previous) => {
      const next = { ...previous };
      const key = tick.providerId;
      const series = next[key] ? [...next[key]] : [];
      const tail = series[series.length - 1];
      if (!tail || tail.t !== point.t || tail.price !== point.price) {
        series.push(point);
        if (series.length > MAX_POINTS) {
          series.splice(0, series.length - MAX_POINTS);
        }
        next[key] = series;
      }
      return next;
    });

    setProviderStateById((previous) => {
      const current = previous[tick.providerId] || {};
      return {
        ...previous,
        [tick.providerId]: {
          ...current,
          id: tick.providerId,
          name: tick.providerName || current.name,
          connected: true,
          error: '',
          lastTickAt: point.t,
          price: tick.price,
          bid: tick.bid,
          ask: tick.ask,
          volume: tick.volume
        }
      };
    });
  }, []);

  useEffect(() => {
    if (!market || !enabled || externalProviders.length === 0) {
      return;
    }

    let alive = true;
    const connections = [];

    for (const provider of externalProviders) {
      setProviderStatus({
        id: provider.id,
        name: provider.name,
        connected: false,
        error: ''
      });

      const connection = provider.connect({
        market,
        onTick: (tick) => {
          if (!alive) return;
          onTick(tick);
        },
        onStatus: (status) => {
          if (!alive) return;
          setProviderStatus(status);
        }
      });

      if (connection && typeof connection.disconnect === 'function') {
        connections.push(connection);
      }
    }

    return () => {
      alive = false;
      for (const connection of connections) {
        connection.disconnect();
      }
    };
  }, [enabled, externalProviders, market, onTick, setProviderStatus]);

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

    for (const provider of localProviders) {
      const connection = provider.connect({
        market,
        onTick: (tick) => {
          if (!alive) return;
          onTick(tick);
        },
        onStatus: (status) => {
          if (!alive) return;
          setProviderStatus(status);
        }
      });
      if (connection && typeof connection.disconnect === 'function') {
        connections.push(connection);
      }
    }

    return () => {
      alive = false;
      for (const connection of connections) {
        connection.disconnect();
      }
    };
  }, [enabled, localFallbackActive, localProviders, market, onTick, setProviderStatus]);

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
          local: Boolean(provider.isLocalFallback)
        };
      }

      const state = providerStateById[provider.id] || {};
      return {
        id: provider.id,
        name: provider.name,
        connected: Boolean(state.connected),
        error: state.error || '',
        lastTickAt: state.lastTickAt || null,
        price: state.price ?? null,
        bid: state.bid ?? null,
        ask: state.ask ?? null,
        volume: state.volume ?? null,
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

  return {
    providerStates: sortedProviders,
    seriesByProvider,
    primaryProvider,
    primarySeries,
    localFallbackActive,
    externalProviderCount: externalProviders.length,
    externalConnectedCount
  };
}

