import { useEffect, useMemo, useState } from 'react';
import { getSocketProviders } from '../providers';

const MAX_POINTS = 240;

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

  useEffect(() => {
    setProviderStateById({});
    setSeriesByProvider({});
  }, [market?.key]);

  const candidateProviders = useMemo(() => {
    return getSocketProviders().filter((provider) => provider.supportsMarket(market));
  }, [market]);

  useEffect(() => {
    if (!market || !enabled || candidateProviders.length === 0) {
      return;
    }

    let alive = true;
    const connections = [];

    const onStatus = (status) => {
      if (!alive) return;
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
    };

    const onTick = (tick) => {
      if (!alive || !tick?.providerId) return;
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
    };

    for (const provider of candidateProviders) {
      onStatus({ id: provider.id, name: provider.name, connected: false, error: '' });
      const connection = provider.connect({
        market,
        onTick,
        onStatus
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
  }, [candidateProviders, enabled, market]);

  const providerStates = useMemo(() => {
    return candidateProviders.map((provider) => {
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
          volume: null
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
        volume: state.volume ?? null
      };
    });
  }, [candidateProviders, enabled, providerStateById]);

  const primaryProvider = providerStates.find((provider) => provider.connected) || providerStates[0] || null;
  const primarySeries = primaryProvider ? seriesByProvider[primaryProvider.id] || [] : [];

  return {
    providerStates,
    seriesByProvider,
    primaryProvider,
    primarySeries
  };
}
