import { useCallback, useEffect, useMemo, useState } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import LineChart from '../components/LineChart';
import { fmtCompact, fmtInt, fmtNum, fmtPct, fmtTime } from '../lib/format';
import { countEnabledWalletAccounts, selectActiveWalletAccount } from '../lib/strategyLabSelectors';
import { createWalletState, executeWalletAction, markWallet } from '../lib/strategyEngine';
import { buildStrategyRows, toStrategyKey } from '../lib/strategyView';
import { Link } from '../lib/router';
import { useStrategyLabStore } from '../store/strategyLabStore';
import { useStrategyToggleStore } from '../store/strategyToggleStore';

const WALLET_STORAGE_KEY = 'cre8capital.wallet-lab.v1';

const MAX_EQUITY_POINTS = 420;
const MAX_TRADES = 180;
const MAX_PENDING_ORDERS = 180;
const DEFAULT_START_CASH = 100000;

const clamp = (value, min, max) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
};

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const trimTail = (list, maxLength) => {
  if (list.length <= maxLength) return list;
  return list.slice(list.length - maxLength);
};

const trimHead = (list, maxLength) => {
  if (list.length <= maxLength) return list;
  return list.slice(0, maxLength);
};

const randBetween = (min, max) => min + Math.random() * (max - min);

const sideLabel = (action) => (action === 'reduce' ? 'sell' : 'buy');

const shouldLimitOrderFill = (action, limitPrice, livePrice) => {
  const safeLimit = toNum(limitPrice, 0);
  const safeLive = toNum(livePrice, 0);
  if (safeLimit <= 0 || safeLive <= 0) return false;
  if (action === 'reduce') return safeLive >= safeLimit;
  return safeLive <= safeLimit;
};

const createDefaultWalletLab = () => ({
  wallet: createWalletState(DEFAULT_START_CASH),
  assetHoldings: {},
  tradeLog: [],
  pendingOrders: [],
  equityHistory: [],
  selectedMarketKey: '',
  orderSide: 'accumulate',
  limitPrice: '',
  orderUnits: 1,
  maxAbsUnits: 12,
  slippageBps: 1.2,
  note: 'position creator'
});

const sanitizeWalletState = (raw) => {
  const base = createDefaultWalletLab();
  if (!raw || typeof raw !== 'object') return base;

  const sourceWallet = raw.wallet || {};
  const wallet = {
    cash: toNum(sourceWallet.cash, base.wallet.cash),
    units: Math.round(toNum(sourceWallet.units, base.wallet.units)),
    avgEntry: sourceWallet.avgEntry === null ? null : toNum(sourceWallet.avgEntry, null),
    realizedPnl: toNum(sourceWallet.realizedPnl, base.wallet.realizedPnl),
    unrealizedPnl: toNum(sourceWallet.unrealizedPnl, base.wallet.unrealizedPnl),
    equity: toNum(sourceWallet.equity, base.wallet.equity),
    tradeCount: Math.max(0, Math.round(toNum(sourceWallet.tradeCount, base.wallet.tradeCount))),
    winCount: Math.max(0, Math.round(toNum(sourceWallet.winCount, base.wallet.winCount))),
    lossCount: Math.max(0, Math.round(toNum(sourceWallet.lossCount, base.wallet.lossCount))),
    lastActionAt: Math.max(0, Math.round(toNum(sourceWallet.lastActionAt, 0)))
  };

  const tradeLog = Array.isArray(raw.tradeLog)
    ? raw.tradeLog
        .map((trade) => ({
          id: String(trade?.id || `trade:${Date.now()}`),
          timestamp: Math.max(0, Math.round(toNum(trade?.timestamp, Date.now()))),
          marketKey: String(trade?.marketKey || ''),
          symbol: String(trade?.symbol || '').toUpperCase(),
          assetClass: String(trade?.assetClass || 'unknown').toLowerCase(),
          action: trade?.action === 'reduce' ? 'reduce' : 'accumulate',
          unitsDelta: toNum(trade?.unitsDelta, 0),
          unitsAfter: toNum(trade?.unitsAfter, 0),
          fillPrice: toNum(trade?.fillPrice, 0),
          markPrice: toNum(trade?.markPrice, 0),
          spreadBps: toNum(trade?.spreadBps, 0),
          realizedDelta: toNum(trade?.realizedDelta, 0),
          score: toNum(trade?.score, 0),
          reason: String(trade?.reason || '')
        }))
        .filter((trade) => Number.isFinite(trade.fillPrice) && trade.fillPrice > 0)
        .slice(0, MAX_TRADES)
    : [];

  const pendingOrders = Array.isArray(raw.pendingOrders)
    ? raw.pendingOrders
        .map((order) => ({
          id: String(order?.id || `pending:${Date.now()}`),
          createdAt: Math.max(0, Math.round(toNum(order?.createdAt, Date.now()))),
          marketKey: String(order?.marketKey || ''),
          symbol: String(order?.symbol || '').toUpperCase(),
          assetClass: String(order?.assetClass || 'unknown').toLowerCase(),
          action: order?.action === 'reduce' ? 'reduce' : 'accumulate',
          limitPrice: Math.max(0, toNum(order?.limitPrice, 0)),
          requestedUnits: clamp(Math.round(toNum(order?.requestedUnits, 1)), 1, 25),
          remainingUnits: clamp(Math.round(toNum(order?.remainingUnits, toNum(order?.requestedUnits, 1))), 1, 25),
          maxAbsUnits: clamp(Math.round(toNum(order?.maxAbsUnits, base.maxAbsUnits)), 1, 80),
          slippageBps: clamp(toNum(order?.slippageBps, base.slippageBps), 0, 50),
          note: String(order?.note || '')
        }))
        .filter((order) => order.marketKey && order.limitPrice > 0 && order.remainingUnits > 0)
        .slice(0, MAX_PENDING_ORDERS)
    : [];

  const assetHoldings = {};
  if (raw.assetHoldings && typeof raw.assetHoldings === 'object') {
    for (const [marketKey, holding] of Object.entries(raw.assetHoldings)) {
      if (!holding || typeof holding !== 'object') continue;
      const units = toNum(holding.units, 0);
      if (Math.abs(units) <= 1e-9) continue;
      assetHoldings[String(marketKey)] = {
        marketKey: String(marketKey),
        symbol: String(holding.symbol || '').toUpperCase() || String(marketKey).toUpperCase(),
        assetClass: String(holding.assetClass || 'unknown').toLowerCase(),
        units,
        avgEntry: holding.avgEntry === null ? null : toNum(holding.avgEntry, null),
        realizedPnl: toNum(holding.realizedPnl, 0),
        lastPrice: Math.max(0, toNum(holding.lastPrice, 0)),
        updatedAt: Math.max(0, Math.round(toNum(holding.updatedAt, Date.now())))
      };
    }
  }

  const equityHistory = Array.isArray(raw.equityHistory)
    ? raw.equityHistory
        .map((row) => ({
          t: Math.max(0, Math.round(toNum(row?.t, Date.now()))),
          equity: toNum(row?.equity, wallet.equity),
          price: toNum(row?.price, 0)
        }))
        .filter((row) => Number.isFinite(row.equity))
        .slice(-MAX_EQUITY_POINTS)
    : [];

  return {
    wallet,
    assetHoldings,
    tradeLog,
    pendingOrders,
    equityHistory,
    selectedMarketKey: String(raw.selectedMarketKey || ''),
    orderSide: raw.orderSide === 'reduce' ? 'reduce' : 'accumulate',
    limitPrice: raw.limitPrice === '' ? '' : String(raw.limitPrice ?? ''),
    orderUnits: clamp(raw.orderUnits, 1, 25),
    maxAbsUnits: clamp(raw.maxAbsUnits, 1, 80),
    slippageBps: clamp(raw.slippageBps, 0, 50),
    note: String(raw.note || base.note).slice(0, 140)
  };
};

const applyAssetTrade = ({ holdings, trade, market, fallbackPrice, timestamp }) => {
  const next = { ...(holdings || {}) };
  const marketKey = String(market?.key || trade?.marketKey || '');
  if (!marketKey) return next;

  const unitsDelta = toNum(trade?.unitsDelta, 0);
  if (!Number.isFinite(unitsDelta) || Math.abs(unitsDelta) <= 1e-12) return next;
  const fillPrice = Math.max(toNum(trade?.fillPrice, fallbackPrice), 0);
  if (fillPrice <= 0) return next;

  const current = next[marketKey] || {
    marketKey,
    symbol: String(market?.symbol || trade?.symbol || marketKey).toUpperCase(),
    assetClass: String(market?.assetClass || trade?.assetClass || 'unknown').toLowerCase(),
    units: 0,
    avgEntry: null,
    realizedPnl: 0,
    lastPrice: fillPrice,
    updatedAt: Math.max(0, Math.round(toNum(timestamp, Date.now())))
  };

  const unitsBefore = toNum(current.units, 0);
  const unitsAfter = unitsBefore + unitsDelta;
  let avgEntry = current.avgEntry === null ? null : toNum(current.avgEntry, null);
  let realizedPnl = toNum(current.realizedPnl, 0);

  if (unitsBefore === 0) {
    avgEntry = fillPrice;
  } else if (Math.sign(unitsBefore) === Math.sign(unitsDelta)) {
    const prevAbs = Math.abs(unitsBefore);
    const nextAbs = Math.abs(unitsAfter);
    avgEntry = (prevAbs * (avgEntry || fillPrice) + Math.abs(unitsDelta) * fillPrice) / Math.max(nextAbs, 1e-9);
  } else {
    const closedQty = Math.min(Math.abs(unitsDelta), Math.abs(unitsBefore));
    if (avgEntry !== null && closedQty > 0) {
      if (unitsBefore > 0) realizedPnl += (fillPrice - avgEntry) * closedQty;
      else realizedPnl += (avgEntry - fillPrice) * closedQty;
    }

    if (Math.abs(unitsAfter) <= 1e-9) {
      avgEntry = null;
    } else if (Math.sign(unitsAfter) !== Math.sign(unitsBefore)) {
      avgEntry = fillPrice;
    }
  }

  if (Math.abs(unitsAfter) <= 1e-9) {
    delete next[marketKey];
    return next;
  }

  next[marketKey] = {
    marketKey,
    symbol: String(market?.symbol || current.symbol || marketKey).toUpperCase(),
    assetClass: String(market?.assetClass || current.assetClass || 'unknown').toLowerCase(),
    units: unitsAfter,
    avgEntry,
    realizedPnl,
    lastPrice: Math.max(0, toNum(current.lastPrice, fillPrice)),
    updatedAt: Math.max(0, Math.round(toNum(timestamp, Date.now())))
  };
  return next;
};

export default function WalletPage({ snapshot }) {
  const strategyId = useStrategyLabStore((state) => state.strategyId);
  const paperAccounts = useStrategyLabStore((state) => state.walletAccounts);
  const activePaperAccountId = useStrategyLabStore((state) => state.activeWalletAccountId);
  const addPaperAccount = useStrategyLabStore((state) => state.addWalletAccount);
  const updatePaperAccount = useStrategyLabStore((state) => state.updateWalletAccount);
  const removePaperAccount = useStrategyLabStore((state) => state.removeWalletAccount);
  const clearPaperAccounts = useStrategyLabStore((state) => state.clearWalletAccounts);
  const setActivePaperAccount = useStrategyLabStore((state) => state.setActiveWalletAccount);
  const enabledByKey = useStrategyToggleStore((state) => state.enabledByKey);
  const ensureStrategies = useStrategyToggleStore((state) => state.ensureStrategies);
  const setStrategyEnabled = useStrategyToggleStore((state) => state.setStrategyEnabled);

  const rankedMarkets = useMemo(() => {
    const input = Array.isArray(snapshot?.markets) ? snapshot.markets : [];
    return [...input]
      .filter((market) => Boolean(market?.key))
      .sort((a, b) => {
        const aScore = toNum(a.totalVolume, 0) + Math.abs(toNum(a.changePct, 0)) * 1000000;
        const bScore = toNum(b.totalVolume, 0) + Math.abs(toNum(b.changePct, 0)) * 1000000;
        return bScore - aScore;
      })
      .slice(0, 220);
  }, [snapshot?.markets]);

  const strategyRows = useMemo(() => buildStrategyRows(snapshot), [snapshot]);

  useEffect(() => {
    ensureStrategies(strategyRows);
  }, [ensureStrategies, strategyRows]);

  const strategyStatusRows = useMemo(() => {
    return strategyRows
      .map((strategy) => {
        const enabled = typeof enabledByKey?.[strategy.key] === 'boolean' ? enabledByKey[strategy.key] : strategy.enabled !== false;
        return {
          key: strategy.key,
          id: strategy.id,
          name: strategy.name,
          description: strategy.description || '',
          decisionCount: toNum(strategy.decisionCount, 0),
          enabled
        };
      })
      .sort((a, b) => {
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        return String(a.name || a.id).localeCompare(String(b.name || b.id));
      });
  }, [enabledByKey, strategyRows]);

  const activePaperAccount = useMemo(() => {
    return selectActiveWalletAccount(paperAccounts, activePaperAccountId);
  }, [activePaperAccountId, paperAccounts]);

  const activeRuntimeWallet = activePaperAccount?.wallet || null;
  const runtimeEquity = toNum(activeRuntimeWallet?.equity, 0);
  const runtimeRealizedPnl = toNum(activeRuntimeWallet?.realizedPnl, 0);
  const runtimeUnrealizedPnl = toNum(activeRuntimeWallet?.unrealizedPnl, 0);

  const [walletLab, setWalletLab] = useState(createDefaultWalletLab);
  const [message, setMessage] = useState('');
  const [paperName, setPaperName] = useState('');
  const [paperCash, setPaperCash] = useState(100000);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(WALLET_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setWalletLab(sanitizeWalletState(parsed));
    } catch (error) {
      setMessage('Wallet state could not be restored. Starting from defaults.');
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(walletLab));
    } catch (error) {
      setMessage('Wallet state could not be saved locally.');
    }
  }, [walletLab]);

  useEffect(() => {
    if (!rankedMarkets.length) return;
    const selectedExists = rankedMarkets.some((market) => market.key === walletLab.selectedMarketKey);
    if (selectedExists) return;
    setWalletLab((previous) => ({
      ...previous,
      selectedMarketKey: rankedMarkets[0].key
    }));
  }, [rankedMarkets, walletLab.selectedMarketKey]);

  const selectedMarket = useMemo(() => {
    return rankedMarkets.find((market) => market.key === walletLab.selectedMarketKey) || rankedMarkets[0] || null;
  }, [rankedMarkets, walletLab.selectedMarketKey]);

  const marketByKey = useMemo(() => {
    const map = new Map();
    for (const market of rankedMarkets) {
      if (!market?.key) continue;
      map.set(market.key, market);
    }
    return map;
  }, [rankedMarkets]);

  const marketPrice = toNum(selectedMarket?.referencePrice, 0);
  const marketSpread = Math.max(0, toNum(selectedMarket?.spreadBps, 0));
  const marketVolume = Math.max(0, toNum(selectedMarket?.totalVolume, 0));

  useEffect(() => {
    if (!selectedMarket || marketPrice <= 0) return;
    setWalletLab((previous) => {
      const current = String(previous.limitPrice ?? '').trim();
      if (current.length > 0) return previous;
      return {
        ...previous,
        limitPrice: String(Number(marketPrice.toFixed(4)))
      };
    });
  }, [marketPrice, selectedMarket]);

  useEffect(() => {
    if (!selectedMarket || marketPrice <= 0) return;
    const now = toNum(snapshot?.now, Date.now());
    setWalletLab((previous) => {
      const markedWallet = markWallet(previous.wallet, marketPrice);
      const tail = previous.equityHistory[previous.equityHistory.length - 1];
      const nextHoldings = {};
      let holdingsMarketValue = 0;
      let holdingsUnrealized = 0;
      for (const [key, holding] of Object.entries(previous.assetHoldings || {})) {
        const market = marketByKey.get(key);
        const lastPrice = Math.max(0, toNum(market?.referencePrice, holding.lastPrice));
        const units = toNum(holding.units, 0);
        if (Math.abs(units) <= 1e-9) continue;
        const avgEntry = holding?.avgEntry === null ? null : toNum(holding?.avgEntry, null);
        holdingsMarketValue += units * lastPrice;
        if (avgEntry !== null) {
          holdingsUnrealized += units > 0 ? (lastPrice - avgEntry) * Math.abs(units) : (avgEntry - lastPrice) * Math.abs(units);
        }
        nextHoldings[key] = {
          ...holding,
          symbol: String(market?.symbol || holding.symbol || key).toUpperCase(),
          assetClass: String(market?.assetClass || holding.assetClass || 'unknown').toLowerCase(),
          lastPrice,
          updatedAt: now
        };
      }

      const selectedHolding = nextHoldings[selectedMarket.key] || null;
      const selectedHoldingMatchesWallet =
        selectedHolding &&
        Math.abs(toNum(selectedHolding.units, 0) - toNum(markedWallet.units, 0)) <= 1e-8;

      if (!selectedHoldingMatchesWallet && Math.abs(toNum(markedWallet.units, 0)) > 1e-9) {
        const units = toNum(markedWallet.units, 0);
        const avgEntry = markedWallet.avgEntry === null ? null : toNum(markedWallet.avgEntry, null);
        holdingsMarketValue += units * marketPrice;
        if (avgEntry !== null) {
          holdingsUnrealized += units > 0 ? (marketPrice - avgEntry) * Math.abs(units) : (avgEntry - marketPrice) * Math.abs(units);
        }
      }

      const aggregateWallet = {
        ...markedWallet,
        unrealizedPnl: holdingsUnrealized,
        equity: toNum(markedWallet.cash, 0) + holdingsMarketValue
      };

      const shouldAppend = !tail || Math.abs(toNum(tail.price, 0) - marketPrice) > 1e-10 || now - toNum(tail.t, 0) >= 4000;
      const nextHistory = shouldAppend
        ? trimTail(
            [
              ...previous.equityHistory,
              {
                t: now,
                equity: aggregateWallet.equity,
                price: marketPrice
              }
            ],
            MAX_EQUITY_POINTS
          )
        : previous.equityHistory;

      return {
        ...previous,
        wallet: aggregateWallet,
        assetHoldings: nextHoldings,
        equityHistory: nextHistory
      };
    });
  }, [marketByKey, marketPrice, selectedMarket, snapshot?.now]);

  const handleControlChange = (field, value) => {
    setWalletLab((previous) => ({
      ...previous,
      [field]: value
    }));
  };

  const handleAddPaperAccount = () => {
    const safeName = String(paperName || '').trim();
    const safeCash = Math.max(100, Number(paperCash) || 100000);
    addPaperAccount({
      name: safeName || `Paper ${paperAccounts.length + 1}`,
      startCash: safeCash
    });
    setPaperName('');
    setPaperCash(100000);
    setMessage('Paper account added.');
  };

  const fillPositionOrder = useCallback(({ wallet, assetHoldings, order, market, livePrice, liveSpread, liveVolume, timestamp }) => {
    const requestedUnits = clamp(Math.round(toNum(order?.remainingUnits, order?.requestedUnits)), 1, 25);
    const maxAbsUnits = clamp(Math.round(toNum(order?.maxAbsUnits, 12)), 1, 80);
    const slippageBps = clamp(toNum(order?.slippageBps, 1.2), 0, 50);
    const point = {
      price: livePrice,
      spread: liveSpread,
      volume: liveVolume
    };
    const reason = String(order?.note || `position ${sideLabel(order?.action)}`).slice(0, 140);

    let nextWallet = wallet;
    let nextAssetHoldings = { ...(assetHoldings || {}) };
    const trades = [];

    for (let index = 0; index < requestedUnits; index += 1) {
      const execution = executeWalletAction({
        wallet: nextWallet,
        action: order?.action === 'reduce' ? 'reduce' : 'accumulate',
        point,
        timestamp: timestamp + index,
        reason,
        score: 0,
        maxAbsUnits,
        cooldownMs: 0,
        slippageBps
      });
      nextWallet = execution.wallet;
      if (!execution.trade) continue;
      const trade = {
        ...execution.trade,
        marketKey: String(market?.key || order?.marketKey || ''),
        symbol: String(market?.symbol || order?.symbol || market?.key || '').toUpperCase(),
        assetClass: String(market?.assetClass || order?.assetClass || 'unknown').toLowerCase()
      };
      trades.push(trade);
      nextAssetHoldings = applyAssetTrade({
        holdings: nextAssetHoldings,
        trade,
        market,
        fallbackPrice: livePrice,
        timestamp: timestamp + index
      });
    }

    const filledUnits = trades.reduce((sum, trade) => sum + Math.abs(toNum(trade.unitsDelta, 0)), 0);
    const remainingUnits = Math.max(0, requestedUnits - Math.round(filledUnits));

    return {
      wallet: nextWallet,
      assetHoldings: nextAssetHoldings,
      trades,
      remainingUnits
    };
  }, []);

  const handleCreatePosition = useCallback(() => {
    if (!selectedMarket || marketPrice <= 0) {
      setMessage('Select a valid market before creating a position order.');
      return;
    }

    const action = walletLab.orderSide === 'reduce' ? 'reduce' : 'accumulate';
    const limitPrice = Math.max(0, toNum(walletLab.limitPrice, 0));
    if (limitPrice <= 0) {
      setMessage('Set a valid limit price for the position order.');
      return;
    }

    const now = Date.now();
    const order = {
      id: `pending:${selectedMarket.key}:${now}:${Math.floor(Math.random() * 100000)}`,
      createdAt: now,
      marketKey: String(selectedMarket.key),
      symbol: String(selectedMarket.symbol || selectedMarket.key).toUpperCase(),
      assetClass: String(selectedMarket.assetClass || 'unknown').toLowerCase(),
      action,
      limitPrice,
      requestedUnits: clamp(Math.round(toNum(walletLab.orderUnits, 1)), 1, 25),
      remainingUnits: clamp(Math.round(toNum(walletLab.orderUnits, 1)), 1, 25),
      maxAbsUnits: clamp(Math.round(toNum(walletLab.maxAbsUnits, 12)), 1, 80),
      slippageBps: clamp(toNum(walletLab.slippageBps, 1.2), 0, 50),
      note: String(walletLab.note || `${sideLabel(action)} ${selectedMarket.symbol}`).slice(0, 140)
    };

    let immediateFills = 0;
    let queuedUnits = order.remainingUnits;

    setWalletLab((previous) => {
      const shouldFillNow = shouldLimitOrderFill(order.action, order.limitPrice, marketPrice);
      if (!shouldFillNow) {
        return {
          ...previous,
          pendingOrders: trimHead([order, ...(previous.pendingOrders || [])], MAX_PENDING_ORDERS)
        };
      }

      const fillResult = fillPositionOrder({
        wallet: previous.wallet,
        assetHoldings: previous.assetHoldings || {},
        order,
        market: selectedMarket,
        livePrice: marketPrice,
        liveSpread: marketSpread,
        liveVolume: marketVolume,
        timestamp: now
      });

      immediateFills = fillResult.trades.length;
      queuedUnits = fillResult.remainingUnits;

      const nextPendingOrders =
        fillResult.remainingUnits > 0
          ? trimHead([{ ...order, remainingUnits: fillResult.remainingUnits }, ...(previous.pendingOrders || [])], MAX_PENDING_ORDERS)
          : previous.pendingOrders || [];

      const nextHistory = trimTail(
        [
          ...previous.equityHistory,
          {
            t: now,
            equity: fillResult.wallet.equity,
            price: marketPrice
          }
        ],
        MAX_EQUITY_POINTS
      );

      return {
        ...previous,
        wallet: fillResult.wallet,
        assetHoldings: fillResult.assetHoldings,
        pendingOrders: nextPendingOrders,
        tradeLog: trimHead([...fillResult.trades.reverse(), ...previous.tradeLog], MAX_TRADES),
        equityHistory: nextHistory
      };
    });

    if (immediateFills > 0 && queuedUnits <= 0) {
      setMessage(`${sideLabel(action)} filled ${fmtInt(immediateFills)} unit${immediateFills === 1 ? '' : 's'} on ${selectedMarket.symbol}.`);
      return;
    }
    if (immediateFills > 0 && queuedUnits > 0) {
      setMessage(
        `${sideLabel(action)} partially filled (${fmtInt(immediateFills)} units). ${fmtInt(queuedUnits)} unit${queuedUnits === 1 ? '' : 's'} queued at ${fmtNum(
          limitPrice,
          4
        )}.`
      );
      return;
    }
    setMessage(
      `${sideLabel(action)} queued: ${fmtInt(order.remainingUnits)} unit${order.remainingUnits === 1 ? '' : 's'} @ ${fmtNum(limitPrice, 4)} on ${selectedMarket.symbol}.`
    );
  }, [fillPositionOrder, marketPrice, marketSpread, marketVolume, selectedMarket, walletLab.limitPrice, walletLab.maxAbsUnits, walletLab.note, walletLab.orderSide, walletLab.orderUnits, walletLab.slippageBps]);

  const handleReset = () => {
    const startCash = DEFAULT_START_CASH;
    const baseWallet = markWallet(createWalletState(startCash), marketPrice > 0 ? marketPrice : startCash);
    setWalletLab((previous) => ({
      ...createDefaultWalletLab(),
      selectedMarketKey: previous.selectedMarketKey,
      wallet: baseWallet,
      equityHistory:
        marketPrice > 0
          ? [
              {
                t: Date.now(),
                equity: baseWallet.equity,
                price: marketPrice
              }
            ]
          : []
    }));
    setMessage('Wallet lab reset to defaults.');
  };

  const handleGenerateRandomPortfolio = useCallback(() => {
    const marketPool = rankedMarkets.filter((market) => toNum(market?.referencePrice, 0) > 0).slice(0, 72);
    if (marketPool.length < 2) {
      setMessage('Not enough market price data to generate a random paper portfolio yet.');
      return;
    }

    const targetPickCount = Math.min(marketPool.length, Math.max(3, Math.floor(randBetween(3, 9))));
    const usedIndexes = new Set();
    const pickedMarkets = [];
    while (pickedMarkets.length < targetPickCount && usedIndexes.size < marketPool.length) {
      const index = Math.floor(Math.random() * marketPool.length);
      if (usedIndexes.has(index)) continue;
      usedIndexes.add(index);
      pickedMarkets.push(marketPool[index]);
    }

    const now = Date.now();
    let generatedCount = 0;
    let generatedEquity = 0;
    setWalletLab((previous) => {
      const startEquity = Math.max(1000, toNum(previous.wallet?.equity, DEFAULT_START_CASH));
      const investRatio = randBetween(0.42, 0.82);
      const investBudget = startEquity * investRatio;
      const rawWeights = pickedMarkets.map(() => randBetween(0.25, 1.35));
      const weightSum = rawWeights.reduce((sum, weight) => sum + weight, 0);

      const nextHoldings = {};
      const generatedTrades = [];
      let investedCost = 0;
      let holdingsUnrealized = 0;
      let holdingsMarketValue = 0;

      pickedMarkets.forEach((market, index) => {
        const marketKey = String(market?.key || '');
        const symbol = String(market?.symbol || marketKey || 'MARKET').toUpperCase();
        const assetClass = String(market?.assetClass || 'unknown').toLowerCase();
        const markPrice = Math.max(0, toNum(market?.referencePrice, 0));
        if (!marketKey || markPrice <= 0) return;

        const weight = rawWeights[index] / Math.max(weightSum, 1e-9);
        const targetCost = investBudget * weight;
        const entryDrift = randBetween(-0.02, 0.025);
        const avgEntry = markPrice * (1 - entryDrift);
        const units = Math.max(0.000001, targetCost / Math.max(avgEntry, 1e-9));
        const cost = units * avgEntry;
        const marketValue = units * markPrice;
        const unrealized = (markPrice - avgEntry) * units;

        investedCost += cost;
        holdingsUnrealized += unrealized;
        holdingsMarketValue += marketValue;

        nextHoldings[marketKey] = {
          marketKey,
          symbol,
          assetClass,
          units,
          avgEntry,
          realizedPnl: 0,
          lastPrice: markPrice,
          updatedAt: now
        };

        generatedTrades.push({
          id: `seed:${marketKey}:${now}:${index}`,
          timestamp: now - index * 250,
          marketKey,
          symbol,
          assetClass,
          action: 'accumulate',
          unitsDelta: units,
          unitsAfter: units,
          fillPrice: avgEntry,
          markPrice,
          spreadBps: toNum(market?.spreadBps, 0),
          realizedDelta: 0,
          score: 0,
          reason: 'seeded random portfolio'
        });
      });

      generatedCount = Object.keys(nextHoldings).length;
      if (generatedCount === 0) return previous;

      const remainingCash = Math.max(0, startEquity - investedCost);
      const aggregateEquity = remainingCash + holdingsMarketValue;
      generatedEquity = aggregateEquity;
      const historyPrice = marketPrice > 0 ? marketPrice : Math.max(0.0001, toNum(pickedMarkets[0]?.referencePrice, 1));
      const nextHistory = trimTail(
        [
          ...previous.equityHistory,
          {
            t: now,
            equity: aggregateEquity,
            price: historyPrice
          }
        ],
        MAX_EQUITY_POINTS
      );

      return {
        ...previous,
        selectedMarketKey: previous.selectedMarketKey || String(pickedMarkets[0]?.key || ''),
        pendingOrders: [],
        wallet: {
          ...previous.wallet,
          cash: remainingCash,
          units: 0,
          avgEntry: null,
          realizedPnl: 0,
          unrealizedPnl: holdingsUnrealized,
          equity: aggregateEquity,
          tradeCount: generatedTrades.length,
          winCount: 0,
          lossCount: 0,
          lastActionAt: now
        },
        assetHoldings: nextHoldings,
        tradeLog: generatedTrades,
        equityHistory: nextHistory
      };
    });

    if (generatedCount > 0) {
      setMessage(`Generated random paper portfolio: ${fmtInt(generatedCount)} assets | equity ${fmtNum(generatedEquity, 2)}.`);
    } else {
      setMessage('Random portfolio generation skipped because no valid market prices were available.');
    }
  }, [marketPrice, rankedMarkets]);

  useEffect(() => {
    if (!marketByKey.size) return;

    const now = Date.now();
    let filledOrders = 0;
    let filledTrades = 0;

    setWalletLab((previous) => {
      const pendingOrders = Array.isArray(previous.pendingOrders) ? previous.pendingOrders : [];
      if (!pendingOrders.length) return previous;

      let nextWallet = previous.wallet;
      let nextAssetHoldings = { ...(previous.assetHoldings || {}) };
      const nextPendingOrders = [];
      const newTrades = [];

      for (const order of pendingOrders) {
        const market = marketByKey.get(order.marketKey);
        const livePrice = Math.max(0, toNum(market?.referencePrice, 0));
        const liveSpread = Math.max(0, toNum(market?.spreadBps, 0));
        const liveVolume = Math.max(0, toNum(market?.totalVolume, 0));

        if (!market || livePrice <= 0 || !shouldLimitOrderFill(order.action, order.limitPrice, livePrice)) {
          nextPendingOrders.push(order);
          continue;
        }

        const fillResult = fillPositionOrder({
          wallet: nextWallet,
          assetHoldings: nextAssetHoldings,
          order,
          market,
          livePrice,
          liveSpread,
          liveVolume,
          timestamp: now + newTrades.length
        });

        nextWallet = fillResult.wallet;
        nextAssetHoldings = fillResult.assetHoldings;

        if (fillResult.trades.length > 0) {
          filledOrders += 1;
          filledTrades += fillResult.trades.length;
          newTrades.push(...fillResult.trades);
        }

        if (fillResult.remainingUnits > 0) {
          nextPendingOrders.push({
            ...order,
            remainingUnits: fillResult.remainingUnits
          });
        }
      }

      if (!newTrades.length && nextPendingOrders.length === pendingOrders.length) {
        return previous;
      }

      const historyPrice = marketPrice > 0 ? marketPrice : Math.max(0, toNum(marketByKey.get(previous.selectedMarketKey)?.referencePrice, 0));
      const nextHistory =
        newTrades.length > 0
          ? trimTail(
              [
                ...previous.equityHistory,
                {
                  t: now,
                  equity: nextWallet.equity,
                  price: historyPrice
                }
              ],
              MAX_EQUITY_POINTS
            )
          : previous.equityHistory;

      return {
        ...previous,
        wallet: nextWallet,
        assetHoldings: nextAssetHoldings,
        pendingOrders: nextPendingOrders,
        tradeLog: newTrades.length ? trimHead([...newTrades.reverse(), ...previous.tradeLog], MAX_TRADES) : previous.tradeLog,
        equityHistory: nextHistory
      };
    });

    if (filledTrades > 0) {
      setMessage(`Live fill: ${fmtInt(filledTrades)} trade${filledTrades === 1 ? '' : 's'} across ${fmtInt(filledOrders)} queued order${filledOrders === 1 ? '' : 's'}.`);
    }
  }, [fillPositionOrder, marketByKey, marketPrice, snapshot?.now]);

  const cancelPendingOrder = useCallback((orderId) => {
    setWalletLab((previous) => ({
      ...previous,
      pendingOrders: (previous.pendingOrders || []).filter((order) => order.id !== orderId)
    }));
    setMessage('Pending order canceled.');
  }, []);

  const clearPendingOrders = useCallback(() => {
    setWalletLab((previous) => ({
      ...previous,
      pendingOrders: []
    }));
    setMessage('All pending orders cleared.');
  }, []);

  const openHoldings = useMemo(() => {
    const rows = [];
    for (const [key, holding] of Object.entries(walletLab.assetHoldings || {})) {
      const units = toNum(holding?.units, 0);
      if (Math.abs(units) <= 1e-9) continue;
      const market = marketByKey.get(key);
      const markPrice = Math.max(0, toNum(market?.referencePrice, holding?.lastPrice));
      const avgEntry = holding?.avgEntry === null ? null : toNum(holding?.avgEntry, null);
      const notional = Math.abs(units) * markPrice;
      const unrealized =
        avgEntry === null
          ? 0
          : units > 0
            ? (markPrice - avgEntry) * Math.abs(units)
            : (avgEntry - markPrice) * Math.abs(units);
      rows.push({
        marketKey: key,
        symbol: String(market?.symbol || holding?.symbol || key).toUpperCase(),
        assetClass: String(market?.assetClass || holding?.assetClass || 'unknown').toLowerCase(),
        units,
        avgEntry,
        markPrice,
        notional,
        unrealized,
        updatedAt: toNum(holding?.updatedAt, snapshot?.now || Date.now())
      });
    }
    return rows.sort((a, b) => b.notional - a.notional);
  }, [marketByKey, snapshot?.now, walletLab.assetHoldings]);

  const enabledPaperCount = useMemo(() => {
    return countEnabledWalletAccounts(paperAccounts);
  }, [paperAccounts]);

  const enabledStrategyCount = useMemo(() => {
    return strategyStatusRows.filter((strategy) => strategy.enabled).length;
  }, [strategyStatusRows]);
  const activeStrategyRows = useMemo(() => {
    return strategyStatusRows.filter((strategy) => strategy.enabled);
  }, [strategyStatusRows]);

  const equitySeries = walletLab.equityHistory.map((row) => row.equity);
  const pendingOrders = Array.isArray(walletLab.pendingOrders) ? walletLab.pendingOrders : [];
  const openNotional = openHoldings.reduce((sum, holding) => sum + holding.notional, 0);
  const winRate = walletLab.wallet.tradeCount > 0 ? (walletLab.wallet.winCount / Math.max(walletLab.wallet.tradeCount, 1)) * 100 : 0;

  return (
    <section className="page-grid">
      <GlowCard className="detail-card">
        <div className="section-head">
          <h1>Wallet Lab</h1>
          <div className="section-actions">
            <Link to="/account" className="inline-link">
              Account Passport
            </Link>
            <Link to="/strategy" className="inline-link">
              Strategy Lab
            </Link>
          </div>
        </div>
        <p>
          Runtime paper accounts power live strategy execution. Position Creator below is a local sandbox for manual order testing.
        </p>
      </GlowCard>

      <div className="detail-stat-grid">
        <GlowCard className="stat-card">
          <span>Active Runtime Equity</span>
          <strong className={runtimeEquity >= toNum(activePaperAccount?.startCash, DEFAULT_START_CASH) ? 'up' : 'down'}>{fmtNum(runtimeEquity, 2)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Runtime Realized PnL</span>
          <strong className={runtimeRealizedPnl >= 0 ? 'up' : 'down'}>{fmtNum(runtimeRealizedPnl, 2)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Runtime Unrealized PnL</span>
          <strong className={runtimeUnrealizedPnl >= 0 ? 'up' : 'down'}>{fmtNum(runtimeUnrealizedPnl, 2)}</strong>
        </GlowCard>
        <GlowCard className="stat-card">
          <span>Open Notional</span>
          <strong>{fmtCompact(openNotional)}</strong>
        </GlowCard>
      </div>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Strategy Runtime Sync</h2>
          <span>
            {fmtInt(enabledStrategyCount)} / {fmtInt(strategyStatusRows.length)} enabled
          </span>
        </div>
        <div className="wallet-active-runtime-row">
          <label className="control-field">
            <span>Active Runtime Wallet</span>
            <select
              value={activePaperAccount?.id || ''}
              disabled={paperAccounts.length === 0}
              onChange={(event) => {
                if (!event.target.value) return;
                setActivePaperAccount(event.target.value);
                setMessage(`Active runtime wallet set to ${paperAccounts.find((account) => account.id === event.target.value)?.name || event.target.value}.`);
              }}
            >
              {paperAccounts.length === 0 ? <option value="">No paper accounts</option> : null}
              {paperAccounts.map((account) => (
                <option key={`runtime-wallet:${account.id}`} value={account.id}>
                  {account.name} ({account.enabled ? 'enabled' : 'paused'})
                </option>
              ))}
            </select>
          </label>
          <div className="wallet-active-runtime-actions">
            {activePaperAccount?.id ? (
              <Link to={`/wallet/${encodeURIComponent(activePaperAccount.id)}`} className="btn secondary">
                Open Active Wallet ID
              </Link>
            ) : (
              <span className="action-message">No paper wallet available yet.</span>
            )}
          </div>
        </div>
        <p className="socket-status-copy">
          This panel only controls strategy activation for runtime. Trade/equity detail lives on Wallet ID, Strategy, and Decision pages.
        </p>
        <div className="section-actions">
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              for (const strategy of strategyStatusRows) {
                setStrategyEnabled(strategy.key, true);
              }
              setMessage(`Enabled all ${fmtInt(strategyStatusRows.length)} strategies.`);
            }}
            disabled={strategyStatusRows.length === 0}
          >
            Enable All Strategies
          </button>
        </div>
        <div className="list-stack">
          {strategyStatusRows.map((strategy) => {
            const selected = toStrategyKey(strategy.id) === toStrategyKey(strategyId);
            return (
              <article key={`wallet-strategy:${strategy.key}`} className="list-item">
                <strong>
                  <Link to={`/strategy/${encodeURIComponent(strategy.id || strategy.name || strategy.key)}`} className="inline-link">
                    {strategy.name}
                  </Link>
                  {selected ? ' | focus' : ''}
                </strong>
                <p>{strategy.description || 'No description available yet.'}</p>
                <div className="section-actions">
                  <span className={strategy.enabled ? 'status-pill online' : 'status-pill'}>{strategy.enabled ? 'enabled' : 'disabled'}</span>
                  <button
                    type="button"
                    className={strategy.enabled ? 'btn secondary' : 'btn primary'}
                    onClick={() => {
                      setStrategyEnabled(strategy.key, !strategy.enabled);
                      setMessage(`${strategy.enabled ? 'Disabled' : 'Enabled'} ${strategy.name}.`);
                    }}
                  >
                    {strategy.enabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </article>
            );
          })}
          {strategyStatusRows.length === 0 ? <p className="action-message">No strategies detected yet.</p> : null}
          {activeStrategyRows.length > 0 ? (
            <p className="socket-status-copy">Active strategies: {activeStrategyRows.map((strategy) => strategy.name).join(', ')}</p>
          ) : (
            <p className="socket-status-copy">No active strategies yet. Enable at least one strategy for runtime.</p>
          )}
        </div>
      </GlowCard>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Paper Accounts</h2>
          <span>
            {fmtInt(enabledPaperCount)} enabled / {fmtInt(paperAccounts.length)} total
          </span>
        </div>
        <div className="strategy-account-create">
          <label className="control-field">
            <span>Account Name</span>
            <input value={paperName} onChange={(event) => setPaperName(event.target.value)} placeholder="Paper Alpha" maxLength={32} />
          </label>
          <label className="control-field">
            <span>Start Cash</span>
            <input type="number" min={100} step={100} value={paperCash} onChange={(event) => setPaperCash(Math.max(100, Number(event.target.value) || 100000))} />
          </label>
          <div className="hero-actions">
            <button type="button" className="btn secondary" onClick={handleAddPaperAccount}>
              Add Account
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={paperAccounts.length === 0}
              onClick={() => {
                clearPaperAccounts();
                setMessage('All paper accounts removed.');
              }}
            >
              Delete All Accounts
            </button>
          </div>
        </div>
        <div className="strategy-account-grid">
          {paperAccounts.map((account) => (
            <article key={account.id} className={account.id === activePaperAccountId ? 'strategy-account-card active' : 'strategy-account-card'}>
              <div className="strategy-account-head">
                <strong>{account.name}</strong>
                <span className={account.enabled ? 'status-pill online' : 'status-pill'}>{account.enabled ? 'enabled' : 'paused'}</span>
              </div>
              <div className="section-actions">
                {account.id === activePaperAccountId ? (
                  <span className="status-pill online">active runtime wallet</span>
                ) : (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => {
                      setActivePaperAccount(account.id);
                      setMessage(`Active runtime wallet set to ${account.name}.`);
                    }}
                  >
                    Set Active
                  </button>
                )}
                <Link to={`/wallet/${encodeURIComponent(account.id)}`} className="inline-link">
                  Open Wallet ID
                </Link>
              </div>
              <div className="strategy-account-metrics">
                <small>eq {fmtNum(account.wallet.equity, 2)}</small>
                <small>cash {fmtNum(account.wallet.cash, 2)}</small>
                <small>units {fmtNum(account.wallet.units, 4)}</small>
              </div>
              <div className="strategy-account-controls">
                <label className="control-field">
                  <span>Max Units</span>
                  <input
                    type="number"
                    min={1}
                    max={80}
                    step={1}
                    value={account.maxAbsUnits}
                    onChange={(event) => updatePaperAccount(account.id, { maxAbsUnits: event.target.value })}
                  />
                </label>
                <label className="control-field">
                  <span>Slippage</span>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    step={0.1}
                    value={account.slippageBps}
                    onChange={(event) => updatePaperAccount(account.id, { slippageBps: event.target.value })}
                  />
                </label>
              </div>
              <div className="strategy-account-actions">
                <label className="toggle-label">
                  <input type="checkbox" checked={account.enabled} onChange={(event) => updatePaperAccount(account.id, { enabled: event.target.checked })} />
                  <span>Allow execution</span>
                </label>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    removePaperAccount(account.id);
                    setMessage(`Removed ${account.name}.`);
                  }}
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
          {paperAccounts.length === 0 ? <p className="action-message">No paper accounts. Add one to resume strategy-lab account execution.</p> : null}
        </div>
      </GlowCard>

      <GlowCard className="panel-card wallet-control-card">
        <div className="section-head">
          <h2>Position Creator (Local Sandbox)</h2>
          <span>{selectedMarket ? selectedMarket.symbol : 'no market selected'}</span>
        </div>
        <div className="wallet-control-grid">
          <label className="control-field">
            <span>Market</span>
            <select value={walletLab.selectedMarketKey} onChange={(event) => handleControlChange('selectedMarketKey', event.target.value)}>
              {rankedMarkets.map((market) => (
                <option key={market.key} value={market.key}>
                  {market.symbol} ({market.assetClass})
                </option>
              ))}
            </select>
          </label>
          <label className="control-field">
            <span>Side</span>
            <select value={walletLab.orderSide} onChange={(event) => handleControlChange('orderSide', event.target.value === 'reduce' ? 'reduce' : 'accumulate')}>
              <option value="accumulate">Buy / Accumulate</option>
              <option value="reduce">Sell / Reduce</option>
            </select>
          </label>
          <label className="control-field">
            <span>Units</span>
            <input
              type="number"
              min={1}
              max={25}
              step={1}
              value={walletLab.orderUnits}
              onChange={(event) => handleControlChange('orderUnits', clamp(Math.round(toNum(event.target.value, 1)), 1, 25))}
            />
          </label>
          <label className="control-field">
            <span>Limit Price</span>
            <input
              type="number"
              min={0.00000001}
              step="any"
              value={walletLab.limitPrice}
              onChange={(event) => handleControlChange('limitPrice', event.target.value)}
              placeholder={marketPrice > 0 ? `${fmtNum(marketPrice, 4)}` : '0.0000'}
            />
          </label>
          <label className="control-field">
            <span>Max Abs Units</span>
            <input type="number" min={1} max={80} step={1} value={walletLab.maxAbsUnits} onChange={(event) => handleControlChange('maxAbsUnits', clamp(event.target.value, 1, 80))} />
          </label>
          <label className="control-field">
            <span>Slippage (bps)</span>
            <input type="number" min={0} max={50} step={0.1} value={walletLab.slippageBps} onChange={(event) => handleControlChange('slippageBps', clamp(event.target.value, 0, 50))} />
          </label>
        </div>
        <label className="control-field">
          <span>Reason</span>
          <input value={walletLab.note} maxLength={140} onChange={(event) => handleControlChange('note', event.target.value)} placeholder="position order note" />
        </label>
        <div className="wallet-action-row">
          <button type="button" className="btn primary" onClick={handleCreatePosition}>
            Create Position Order
          </button>
          <button type="button" className="btn secondary" onClick={handleGenerateRandomPortfolio}>
            Generate Portfolio
          </button>
          <button type="button" className="btn secondary" onClick={handleReset}>
            Reset Wallet
          </button>
        </div>
        <p className="socket-status-copy">
          live {fmtNum(marketPrice, 4)} | spread {fmtNum(marketSpread, 2)} bps | vol {fmtCompact(marketVolume)} | pending {fmtInt(pendingOrders.length)} | trades {fmtInt(walletLab.wallet.tradeCount)} |
          {' '}win rate {fmtPct(winRate)}
        </p>
        <div className="section-head">
          <h2>Pending Position Orders</h2>
          <div className="section-actions">
            <span>{fmtInt(pendingOrders.length)} queued</span>
            <button type="button" className="btn secondary" disabled={pendingOrders.length === 0} onClick={clearPendingOrders}>
              Clear Pending
            </button>
          </div>
        </div>
        <div className="list-stack">
          {pendingOrders.slice(0, 10).map((order) => (
            <article key={order.id} className="list-item">
              <strong className={order.action === 'reduce' ? 'down' : 'up'}>
                {sideLabel(order.action)} | {order.symbol} | {fmtInt(order.remainingUnits)} / {fmtInt(order.requestedUnits)} units
              </strong>
              <p>limit {fmtNum(order.limitPrice, 4)} | live {fmtNum(toNum(marketByKey.get(order.marketKey)?.referencePrice, 0), 4)} | max units {fmtInt(order.maxAbsUnits)}</p>
              <div className="item-meta">
                <small>{order.note || 'position order'}</small>
                <small>{fmtTime(order.createdAt)}</small>
                <button type="button" className="btn secondary" onClick={() => cancelPendingOrder(order.id)}>
                  Cancel
                </button>
              </div>
            </article>
          ))}
          {pendingOrders.length === 0 ? <p className="action-message">No queued orders. Create one with a limit price and it will fill when live price crosses.</p> : null}
        </div>
      </GlowCard>

      <GlowCard className="chart-card">
        <LineChart
          title={`Equity Curve (Paper) - ${selectedMarket?.symbol || 'N/A'}`}
          points={equitySeries}
          stroke="#62ffcc"
          fillFrom="rgba(98, 255, 204, 0.28)"
          fillTo="rgba(98, 255, 204, 0.02)"
        />
      </GlowCard>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Held Assets</h2>
          <span>{openHoldings.length} open positions</span>
        </div>
        <div className="list-stack">
          {openHoldings.map((holding) => (
            <article key={`holding:${holding.marketKey}`} className="list-item wallet-holding-item">
              <div className="wallet-holding-head">
                <strong>
                  {holding.symbol} ({holding.assetClass})
                </strong>
                <span className={holding.units >= 0 ? 'status-pill up' : 'status-pill down'}>{holding.units >= 0 ? 'long' : 'short'}</span>
              </div>
              <div className="item-meta">
                <small>units {fmtNum(holding.units, 4)}</small>
                <small>avg {holding.avgEntry === null ? '-' : fmtNum(holding.avgEntry, 4)}</small>
                <small>mark {fmtNum(holding.markPrice, 4)}</small>
                <small>notional {fmtNum(holding.notional, 2)}</small>
                <small className={holding.unrealized >= 0 ? 'up' : 'down'}>uPnL {fmtNum(holding.unrealized, 2)}</small>
                <small>{fmtTime(holding.updatedAt)}</small>
              </div>
            </article>
          ))}
          {openHoldings.length === 0 ? <p className="action-message">No open assets yet. Use Position Creator to place limit orders.</p> : null}
        </div>
      </GlowCard>

      <GlowCard className="panel-card">
        <div className="section-head">
          <h2>Recent Trades</h2>
          <span>{walletLab.tradeLog.length} rows</span>
        </div>
        <div className="list-stack">
          {walletLab.tradeLog.map((trade) => (
            <article key={trade.id} className="list-item wallet-trade-item">
              <div className="wallet-trade-head">
                <strong className={trade.action === 'accumulate' ? 'up' : 'down'}>
                  {trade.action === 'accumulate' ? 'buy' : 'sell'} {trade.symbol ? `| ${trade.symbol}` : ''}
                </strong>
                <small>{fmtTime(trade.timestamp)}</small>
              </div>
              <p>{trade.reason || 'manual trade'}</p>
              <div className="item-meta">
                <small>fill {fmtNum(trade.fillPrice, 4)}</small>
                <small>mark {fmtNum(trade.markPrice, 4)}</small>
                <small>spread {fmtNum(trade.spreadBps, 2)} bps</small>
                <small>units {fmtNum(trade.unitsAfter, 4)}</small>
                <small className={trade.realizedDelta >= 0 ? 'up' : 'down'}>realized {fmtNum(trade.realizedDelta, 2)}</small>
              </div>
            </article>
          ))}
          {walletLab.tradeLog.length === 0 ? <p className="action-message">No paper trades yet. Create a position order and wait for live fill.</p> : null}
        </div>
      </GlowCard>

      {message ? (
        <GlowCard className="panel-card">
          <p className="action-message">{message}</p>
        </GlowCard>
      ) : null}
    </section>
  );
}
