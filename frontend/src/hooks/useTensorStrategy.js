import { useEffect, useMemo, useRef, useState } from 'react';

const MAX_SERIES_POINTS = 320;
const MAX_EVENTS = 72;
const ACTION_COOLDOWN_MS = 12000;
const MAX_POSITION_UNITS = 12;

const asNum = (value, fallback = null) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const avg = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const sum = arr.reduce((s, v) => s + v, 0);
  return sum / arr.length;
};

const sma = (values, length) => {
  if (!Array.isArray(values) || values.length === 0) return null;
  const n = Math.max(1, Math.min(length, values.length));
  const slice = values.slice(values.length - n);
  return avg(slice);
};

const computeMicroFromDepth = (depth, fallbackMid) => {
  const bid = depth?.bids?.[0];
  const ask = depth?.asks?.[0];
  const bidPrice = asNum(bid?.price);
  const askPrice = asNum(ask?.price);
  const bidSize = asNum(bid?.size);
  const askSize = asNum(ask?.size);
  if (bidPrice === null || askPrice === null || bidSize === null || askSize === null) return fallbackMid;

  const total = bidSize + askSize;
  if (total <= 0) return fallbackMid;
  return (bidPrice * askSize + askPrice * bidSize) / total;
};

const computeSpreadBps = (bid, ask, priceFallback) => {
  const bidNum = asNum(bid);
  const askNum = asNum(ask);
  const mid = asNum(priceFallback);
  if (bidNum === null || askNum === null || mid === null || mid <= 0) return null;
  return ((askNum - bidNum) / mid) * 10000;
};

const toSignal = (score, spreadBps) => {
  const spread = asNum(spreadBps, 999);
  const safeSpread = spread <= 35;
  if (score >= 6 && safeSpread) return 'accumulate';
  if (score <= -6 && safeSpread) return 'reduce';
  return 'hold';
};

export default function useTensorStrategy({ market, enabled, providerStates = [], depthByProvider = {} }) {
  const marketKey = market?.key || null;
  const [tensorSeries, setTensorSeries] = useState([]);
  const [strategyEvents, setStrategyEvents] = useState([]);
  const [paper, setPaper] = useState({
    units: 0,
    cash: 0,
    avgEntry: null,
    lastActionAt: 0
  });
  const [sequence, setSequence] = useState(0);
  const lastSignalRef = useRef('hold');

  useEffect(() => {
    setTensorSeries([]);
    setStrategyEvents([]);
    setPaper({
      units: 0,
      cash: 0,
      avgEntry: null,
      lastActionAt: 0
    });
    setSequence(0);
    lastSignalRef.current = 'hold';
  }, [marketKey]);

  const snapshot = useMemo(() => {
    if (!enabled || !market) return null;

    const now = Date.now();
    const rows = [];

    for (const provider of providerStates) {
      const px = asNum(provider.price);
      if (px === null || px <= 0) continue;

      const bid = asNum(provider.bid);
      const ask = asNum(provider.ask);
      const mid = bid !== null && ask !== null ? (bid + ask) / 2 : px;
      const spreadBps = computeSpreadBps(bid, ask, mid);
      const depth = depthByProvider[provider.id] || null;
      const micro = computeMicroFromDepth(depth, mid);
      const topBidSize = asNum(depth?.bids?.[0]?.size, 0);
      const topAskSize = asNum(depth?.asks?.[0]?.size, 0);
      const depthLiquidity = Math.max(0, topBidSize + topAskSize);
      const liquidityWeight = Math.log1p(depthLiquidity + 2);
      const ageSec = Math.max(0, (now - asNum(provider.lastTickAt, now)) / 1000);
      const recencyWeight = Math.exp(-ageSec / 18);
      const spreadPenalty = 1 / (1 + Math.max(0, asNum(spreadBps, 25)) / 24);
      const compositeWeight = Math.max(0.05, liquidityWeight * recencyWeight * spreadPenalty);
      const tensorComponent = 0.55 * mid + 0.45 * micro;

      rows.push({
        providerId: provider.id,
        providerName: provider.name,
        price: px,
        mid,
        micro,
        spreadBps: spreadBps ?? 0,
        weight: compositeWeight
      });
    }

    if (rows.length === 0) {
      const base = asNum(market.referencePrice);
      if (base === null || base <= 0) return null;
      return {
        timestamp: now,
        tensorPrice: base,
        tensorSpreadBps: asNum(market.spreadBps, 0),
        confidence: 0.16,
        components: []
      };
    }

    const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
    const tensorPrice = rows.reduce((sum, row) => sum + row.micro * row.weight, 0) / Math.max(totalWeight, 1e-9);
    const tensorSpreadBps = rows.reduce((sum, row) => sum + row.spreadBps * row.weight, 0) / Math.max(totalWeight, 1e-9);
    const providerCoverage = clamp(rows.length / 4, 0.25, 1);
    const depthCoverage = clamp(rows.filter((row) => row.micro !== row.mid).length / Math.max(rows.length, 1), 0, 1);
    const confidence = clamp((Math.log1p(totalWeight) / 2.6) * 0.7 + providerCoverage * 0.2 + depthCoverage * 0.1, 0, 1);

    const normalizedRows = rows
      .map((row) => ({
        ...row,
        contribution: row.weight / Math.max(totalWeight, 1e-9),
        tensorComponent: row.micro
      }))
      .sort((a, b) => b.contribution - a.contribution);

    return {
      timestamp: now,
      tensorPrice,
      tensorSpreadBps,
      confidence,
      components: normalizedRows
    };
  }, [depthByProvider, enabled, market, providerStates]);

  useEffect(() => {
    if (!enabled || !snapshot || !Number.isFinite(snapshot.tensorPrice)) return;

    setTensorSeries((previous) => {
      const point = {
        t: snapshot.timestamp,
        price: snapshot.tensorPrice,
        spread: snapshot.tensorSpreadBps,
        confidence: snapshot.confidence
      };
      const next = [...previous];
      const tail = next[next.length - 1];
      if (!tail || tail.t !== point.t || tail.price !== point.price) {
        next.push(point);
        if (next.length > MAX_SERIES_POINTS) {
          next.splice(0, next.length - MAX_SERIES_POINTS);
        }
      }
      return next;
    });
  }, [enabled, snapshot]);

  const strategy = useMemo(() => {
    if (!snapshot) {
      return {
        action: 'hold',
        stance: 'neutral',
        score: 0,
        trendBps: 0,
        momentumPct: 0,
        spreadGuard: false,
        reason: 'Tensor engine waiting for data'
      };
    }

    const prices = tensorSeries.map((point) => point.price);
    const short = sma(prices, 8);
    const long = sma(prices, 24);
    const longBack = prices.length > 16 ? prices[prices.length - 16] : prices[0] || snapshot.tensorPrice;
    const momentumPct = ((snapshot.tensorPrice - longBack) / Math.max(longBack || 1e-9, 1e-9)) * 100;
    const trendBps = short !== null && long !== null ? ((short - long) / Math.max(snapshot.tensorPrice, 1e-9)) * 10000 : 0;
    const confidenceBoost = snapshot.confidence * 3.4;
    const spreadPenalty = clamp((snapshot.tensorSpreadBps - 12) / 6, 0, 6);
    const score = trendBps * 0.58 + momentumPct * 8.1 + confidenceBoost - spreadPenalty * 1.35;
    const action = toSignal(score, snapshot.tensorSpreadBps);
    const stance = score > 2 ? 'bullish' : score < -2 ? 'bearish' : 'neutral';
    const spreadGuard = snapshot.tensorSpreadBps > 35;
    const reason = `${stance} tensor drift ${trendBps.toFixed(2)} bps, momentum ${momentumPct.toFixed(2)}%, spread ${snapshot.tensorSpreadBps.toFixed(
      2
    )} bps`;

    return {
      action,
      stance,
      score,
      trendBps,
      momentumPct,
      spreadGuard,
      reason
    };
  }, [snapshot, tensorSeries]);

  useEffect(() => {
    if (!enabled || !snapshot) return;

    const action = strategy.action;
    const now = snapshot.timestamp;
    const changed = action !== lastSignalRef.current;
    lastSignalRef.current = action;
    if (!changed) return;

    setSequence((n) => n + 1);
    setStrategyEvents((previous) => {
      const event = {
        id: `tensor:${marketKey || 'market'}:${now}:${sequence + 1}`,
        action,
        stance: strategy.stance,
        score: strategy.score,
        price: snapshot.tensorPrice,
        spreadBps: snapshot.tensorSpreadBps,
        reason: strategy.reason,
        timestamp: now
      };
      const next = [event, ...previous];
      if (next.length > MAX_EVENTS) {
        next.length = MAX_EVENTS;
      }
      return next;
    });

    if (action === 'hold') return;

    setPaper((previous) => {
      if (now - previous.lastActionAt < ACTION_COOLDOWN_MS) return previous;

      const px = snapshot.tensorPrice;
      const unitsBefore = previous.units;
      const buy = action === 'accumulate';
      const sell = action === 'reduce';

      if (buy && unitsBefore >= MAX_POSITION_UNITS) {
        return {
          ...previous,
          lastActionAt: now
        };
      }
      if (sell && unitsBefore <= -MAX_POSITION_UNITS) {
        return {
          ...previous,
          lastActionAt: now
        };
      }

      const unitsAfter = buy ? unitsBefore + 1 : sell ? unitsBefore - 1 : unitsBefore;
      const cashAfter = buy ? previous.cash - px : sell ? previous.cash + px : previous.cash;
      const avgEntry =
        unitsAfter === 0 ? null : (Math.abs(unitsBefore) * (previous.avgEntry || px) + px) / Math.max(Math.abs(unitsAfter), 1);

      return {
        units: unitsAfter,
        cash: cashAfter,
        avgEntry,
        lastActionAt: now
      };
    });
  }, [enabled, marketKey, sequence, snapshot, strategy]);

  const paperStats = useMemo(() => {
    const px = snapshot?.tensorPrice || 0;
    const markValue = paper.units * px;
    const equity = paper.cash + markValue;
    return {
      ...paper,
      markPrice: px,
      markValue,
      equity
    };
  }, [paper, snapshot?.tensorPrice]);

  return {
    snapshot,
    tensorSeries,
    strategy,
    strategyEvents,
    paper: paperStats
  };
}
