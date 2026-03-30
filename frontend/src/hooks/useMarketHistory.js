import { useEffect, useState } from 'react';

const isSamePoint = (a, b) => {
  if (!a || !b) return false;
  return a.t === b.t && a.price === b.price && a.spread === b.spread && a.volume === b.volume;
};

export default function useMarketHistory(markets = [], now = Date.now()) {
  const [historyByMarket, setHistoryByMarket] = useState({});

  useEffect(() => {
    if (!Array.isArray(markets) || markets.length === 0) return;

    setHistoryByMarket((previous) => {
      const next = { ...previous };

      for (const market of markets) {
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
          if (series.length > 240) {
            series.splice(0, series.length - 240);
          }
          next[market.key] = series;
        }
      }

      return next;
    });
  }, [markets, now]);

  return historyByMarket;
}

