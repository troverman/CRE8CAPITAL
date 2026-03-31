import { useEffect, useMemo } from 'react';
import { useCapitalStore } from '../store/capitalStore';

const MAX_MARKETS_TRACKED = 180;
const MAX_POINTS_PER_MARKET = 180;

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

export default function useMarketHistory(markets = [], now = Date.now()) {
  const marketTicksById = useCapitalStore((state) => state.series.marketTicksById);
  const upsertMarkets = useCapitalStore((state) => state.upsertMarkets);
  const getMarketSeriesRange = useCapitalStore((state) => state.getMarketSeriesRange);

  useEffect(() => {
    if (!Array.isArray(markets) || markets.length === 0) return;
    upsertMarkets(markets, { appendSnapshotTick: true });
  }, [markets, now, upsertMarkets]);

  const rankedMarkets = useMemo(() => {
    if (!Array.isArray(markets) || markets.length === 0) return [];
    return [...markets]
      .filter((market) => Boolean(market?.key))
      .sort((a, b) => {
        const aScore = toNum(a?.totalVolume, 0) + Math.abs(toNum(a?.changePct, 0)) * 1000000;
        const bScore = toNum(b?.totalVolume, 0) + Math.abs(toNum(b?.changePct, 0)) * 1000000;
        return bScore - aScore;
      })
      .slice(0, MAX_MARKETS_TRACKED);
  }, [markets]);

  return useMemo(() => {
    const next = {};
    for (const market of rankedMarkets) {
      const marketId = String(market?.key || '').trim();
      if (!marketId) continue;
      const rows = getMarketSeriesRange({
        marketId,
        limit: MAX_POINTS_PER_MARKET
      });
      next[marketId] = rows.map((row) => ({
        t: toNum(row?.t, Date.now()),
        price: toNum(row?.price, 0),
        spread: toNum(row?.spread, 0),
        volume: toNum(row?.volume, 0),
        bid: toNum(row?.bid, 0),
        ask: toNum(row?.ask, 0)
      }));
    }
    return next;
  }, [getMarketSeriesRange, marketTicksById, rankedMarkets]);
}

