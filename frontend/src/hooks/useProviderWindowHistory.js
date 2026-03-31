import { useEffect, useMemo, useState } from 'react';

export const LIVE_WINDOW_OPTIONS = [
  { key: '5m', label: '5m', ms: 5 * 60 * 1000 },
  { key: '1h', label: '1h', ms: 60 * 60 * 1000 },
  { key: '24h', label: '24h', ms: 24 * 60 * 60 * 1000 }
];

const WINDOW_MS_BY_KEY = LIVE_WINDOW_OPTIONS.reduce((map, option) => {
  map[option.key] = option.ms;
  return map;
}, {});

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toFiniteOrNull = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const resolveWindowMs = (windowKey) => {
  return WINDOW_MS_BY_KEY[windowKey] || WINDOW_MS_BY_KEY['1h'];
};

const normalizeHistoryRows = (rows = [], fallbackProviderId = '', fallbackProviderName = '') => {
  const points = Array.isArray(rows)
    ? rows
        .map((row) => {
          const t = Math.max(0, Math.round(toNum(row?.t || row?.timestamp, Date.now())));
          const price = toFiniteOrNull(row?.price);
          if (price === null || price <= 0) return null;
          return {
            t,
            price,
            spread: toNum(row?.spread, 0),
            volume: toNum(row?.volume, 0),
            bid: toFiniteOrNull(row?.bid),
            ask: toFiniteOrNull(row?.ask),
            providerId: String(row?.providerId || fallbackProviderId || ''),
            providerName: String(row?.providerName || fallbackProviderName || ''),
            source: String(row?.source || 'provider-history')
          };
        })
        .filter((row) => Boolean(row))
    : [];

  points.sort((a, b) => a.t - b.t);

  const deduped = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (last && last.t === point.t) {
      deduped[deduped.length - 1] = point;
      continue;
    }
    deduped.push(point);
  }
  return deduped;
};

export default function useProviderWindowHistory({ provider, fallbackProvider = null, market, windowKey = '1h', enabled = true }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(0);

  const providerId = String(provider?.id || '');
  const providerName = String(provider?.name || '');
  const fallbackProviderId = String(fallbackProvider?.id || '');
  const fallbackProviderName = String(fallbackProvider?.name || '');
  const marketKey = String(market?.key || '');
  const marketSymbol = String(market?.symbol || '');
  const marketAssetClass = String(market?.assetClass || '');
  const hasPrimaryFetcher = Boolean(providerId) && typeof provider?.fetchHistory === 'function';
  const hasFallbackFetcher = Boolean(fallbackProviderId) && typeof fallbackProvider?.fetchHistory === 'function';
  const canFetch = enabled && Boolean(marketKey) && (hasPrimaryFetcher || hasFallbackFetcher);

  useEffect(() => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let active = true;

    if (!canFetch) {
      setRows([]);
      setLoading(false);
      setError('');
      return () => {
        active = false;
      };
    }

    const run = async () => {
      setLoading(true);
      setError('');
      try {
        const baseProvider = hasPrimaryFetcher ? provider : fallbackProvider;
        const baseProviderId = hasPrimaryFetcher ? providerId : fallbackProviderId;
        const baseProviderName = hasPrimaryFetcher ? providerName : fallbackProviderName;
        const requestMarket = {
          key: marketKey,
          symbol: marketSymbol,
          assetClass: marketAssetClass,
          referencePrice: toFiniteOrNull(market?.referencePrice),
          spreadBps: toFiniteOrNull(market?.spreadBps),
          totalVolume: toFiniteOrNull(market?.totalVolume),
          changePct: toFiniteOrNull(market?.changePct)
        };
        const historyRows = await baseProvider.fetchHistory({
          market: requestMarket,
          window: windowKey,
          signal: controller?.signal
        });
        if (!active) return;
        const normalizedPrimaryRows = normalizeHistoryRows(historyRows, baseProviderId, baseProviderName);

        if (
          normalizedPrimaryRows.length === 0 &&
          hasPrimaryFetcher &&
          fallbackProvider &&
          fallbackProviderId &&
          fallbackProviderId !== providerId &&
          typeof fallbackProvider.fetchHistory === 'function'
        ) {
          const fallbackRows = await fallbackProvider.fetchHistory({
            market: requestMarket,
            window: windowKey,
            signal: controller?.signal
          });
          if (!active) return;
          setRows(normalizeHistoryRows(fallbackRows, fallbackProviderId, fallbackProviderName));
        } else {
          setRows(normalizeHistoryRows(historyRows, baseProviderId, baseProviderName));
        }
        setUpdatedAt(Date.now());
      } catch (fetchError) {
        if (!active) return;
        if (controller?.signal?.aborted) return;

        if (
          hasPrimaryFetcher &&
          fallbackProvider &&
          fallbackProviderId &&
          fallbackProviderId !== providerId &&
          typeof fallbackProvider.fetchHistory === 'function'
        ) {
          try {
            const fallbackRows = await fallbackProvider.fetchHistory({
              market: {
                key: marketKey,
                symbol: marketSymbol,
                assetClass: marketAssetClass,
                referencePrice: toFiniteOrNull(market?.referencePrice),
                spreadBps: toFiniteOrNull(market?.spreadBps),
                totalVolume: toFiniteOrNull(market?.totalVolume),
                changePct: toFiniteOrNull(market?.changePct)
              },
              window: windowKey,
              signal: controller?.signal
            });
            if (!active) return;
            setRows(normalizeHistoryRows(fallbackRows, fallbackProviderId, fallbackProviderName));
            setUpdatedAt(Date.now());
            setError('');
            return;
          } catch (fallbackError) {
            if (!active || controller?.signal?.aborted) return;
            setRows([]);
            setError(fallbackError instanceof Error ? fallbackError.message : 'History fetch failed');
            return;
          }
        }

        setRows([]);
        setError(fetchError instanceof Error ? fetchError.message : 'History fetch failed');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    run();

    return () => {
      active = false;
      controller?.abort();
    };
  }, [
    canFetch,
    fallbackProvider,
    fallbackProviderId,
    fallbackProviderName,
    hasFallbackFetcher,
    hasPrimaryFetcher,
    marketAssetClass,
    marketKey,
    marketSymbol,
    provider,
    providerId,
    providerName,
    windowKey
  ]);

  const windowMs = useMemo(() => resolveWindowMs(windowKey), [windowKey]);

  return {
    rows,
    loading,
    error,
    updatedAt,
    providerId,
    providerName,
    windowMs
  };
}
