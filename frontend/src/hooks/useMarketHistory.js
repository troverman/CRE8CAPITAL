import { useEffect, useState } from 'react';

const MAX_MARKETS_TRACKED = 180;
const MAX_POINTS_PER_MARKET = 180;

const isSamePoint = (a, b) => {
  if (!a || !b) return false;
  return a.t === b.t && a.price === b.price && a.spread === b.spread && a.volume === b.volume;
};

export default function useMarketHistory(markets = [], now = Date.now()) {
  const [historyByMarket, setHistoryByMarket] = useState({});

  useEffect(() => {
    if (!Array.isArray(markets) || markets.length === 0) return;

    setHistoryByMarket((previous) => {
      const rankedMarkets = [...markets]
        .filter((market) => Boolean(market?.key))
        .sort((a, b) => {
          const aScore = (Number(a.totalVolume) || 0) + Math.abs(Number(a.changePct) || 0) * 1000000;
          const bScore = (Number(b.totalVolume) || 0) + Math.abs(Number(b.changePct) || 0) * 1000000;
          return bScore - aScore;
        })
        .slice(0, MAX_MARKETS_TRACKED);

      const allowedKeys = new Set(rankedMarkets.map((market) => market.key));
      const next = {};

      for (const key of allowedKeys) {
        if (previous[key]) {
          next[key] = previous[key];
        }
      }

      for (const market of rankedMarkets) {
        if (!market?.key) continue;
        const price = Number(market.referencePrice);
        if (!Number.isFinite(price)) continue;

        const point = {
          t: Number(market.updatedAt) || Number(now) || Date.now(),
          price,
          spread: Number(market.spreadBps) || 0,
          volume: Number(market.totalVolume) || 0
        };

        const series = next[market.key] ? [...next[market.key]] : [];
        const tail = series[series.length - 1];
        if (!isSamePoint(tail, point)) {
          series.push(point);
          if (series.length > MAX_POINTS_PER_MARKET) {
            series.splice(0, series.length - MAX_POINTS_PER_MARKET);
          }
          next[market.key] = series;
        }
      }

      return next;
    });
  }, [markets, now]);

  return historyByMarket;
}
