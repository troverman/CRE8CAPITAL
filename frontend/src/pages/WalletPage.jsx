import { useCallback, useEffect, useMemo, useState } from 'react';
import FlashList from '../components/FlashList';
import GlowCard from '../components/GlowCard';
import LineChart from '../components/LineChart';
import { fmtCompact, fmtInt, fmtNum, fmtPct, fmtTime } from '../lib/format';
import { countEnabledWalletAccounts, filterRowsByAccountId, selectActiveWalletAccount } from '../lib/strategyLabSelectors';
import { createWalletState, executeWalletAction, markWallet } from '../lib/strategyEngine';
import { buildStrategyRows, toStrategyKey } from '../lib/strategyView';
import { Link } from '../lib/router';
import { useExecutionFeedStore } from '../store/executionFeedStore';
import { useStrategyLabStore } from '../store/strategyLabStore';
import { useStrategyToggleStore } from '../store/strategyToggleStore';

const WALLET_STORAGE_KEY = 'cre8capital.wallet-lab.v1';
const PASSPORT_STORAGE_KEY = 'cre8capital.account-passport.v1';

const MAX_EQUITY_POINTS = 420;
const MAX_TRADES = 180;
const DEFAULT_START_CASH = 100000;
const RUNTIME_SYNC_TABS = [
  { id: 'summary', label: 'Summary' },
  { id: 'strategies', label: 'Strategies' },
  { id: 'trades', label: 'Trades' }
];

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

const createDefaultWalletLab = () => ({
  wallet: createWalletState(DEFAULT_START_CASH),
  assetHoldings: {},
  tradeLog: [],
  equityHistory: [],
  selectedMarketKey: '',
  orderUnits: 1,
  maxAbsUnits: 12,
  slippageBps: 1.2,
  note: 'manual wallet test'
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
    equityHistory,
    selectedMarketKey: String(raw.selectedMarketKey || ''),
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

const readPassportSummary = () => {
  const base = {
    linkedProviders: 0,
    validatedProviders: 0,
    liveReadyProviders: 0,
    externalActionsEnabled: false,
    executionMode: 'paper',
    profileName: 'CRE8 Operator'
  };

  try {
    const raw = window.localStorage.getItem(PASSPORT_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    const providers = Array.isArray(parsed?.providers) ? parsed.providers : [];
    const validated = providers.filter((provider) => provider?.status === 'validated').length;
    const liveReady = providers.filter((provider) => provider?.status === 'validated' && provider?.testnet === false && provider?.permissions?.trade).length;
    return {
      linkedProviders: providers.length,
      validatedProviders: validated,
      liveReadyProviders: liveReady,
      externalActionsEnabled: Boolean(parsed?.externalActionsEnabled),
      executionMode: String(parsed?.executionMode || 'paper'),
      profileName: String(parsed?.profileName || 'CRE8 Operator')
    };
  } catch (error) {
    return base;
  }
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
  const txEvents = useExecutionFeedStore((state) => state.txEvents);
  const enabledByKey = useStrategyToggleStore((state) => state.enabledByKey);
  const ensureStrategies = useStrategyToggleStore((state) => state.ensureStrategies);

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

  const activeRuntimeTxEvents = useMemo(() => {
    if (!activePaperAccount?.id) return txEvents.slice(0, 180);
    return filterRowsByAccountId(txEvents, activePaperAccount.id).slice(0, 180);
  }, [activePaperAccount?.id, txEvents]);

  const selectedStrategyStatus = useMemo(() => {
    const key = toStrategyKey(strategyId);
    return strategyStatusRows.find((strategy) => strategy.key === key) || null;
  }, [strategyId, strategyStatusRows]);

  const selectedStrategyRuntimeTxEvents = useMemo(() => {
    const key = toStrategyKey(strategyId);
    if (!key) return activeRuntimeTxEvents.slice(0, 180);
    return activeRuntimeTxEvents.filter((event) => toStrategyKey(event.strategyId) === key).slice(0, 180);
  }, [activeRuntimeTxEvents, strategyId]);

  const activeRuntimeWallet = activePaperAccount?.wallet || null;
  const runtimeEquity = toNum(activeRuntimeWallet?.equity, 0);
  const runtimeCash = toNum(activeRuntimeWallet?.cash, 0);
  const runtimeUnits = toNum(activeRuntimeWallet?.units, 0);
  const runtimeRealizedPnl = toNum(activeRuntimeWallet?.realizedPnl, 0);
  const runtimeUnrealizedPnl = toNum(activeRuntimeWallet?.unrealizedPnl, 0);

  const [walletLab, setWalletLab] = useState(createDefaultWalletLab);
  const [passportSummary, setPassportSummary] = useState(() => readPassportSummary());
  const [message, setMessage] = useState('');
  const [paperName, setPaperName] = useState('');
  const [paperCash, setPaperCash] = useState(100000);
  const [runtimeSyncTab, setRuntimeSyncTab] = useState('summary');
  const [runtimeTradeScope, setRuntimeTradeScope] = useState('selected');

  const runtimeTradeRows = useMemo(() => {
    return runtimeTradeScope === 'all' ? activeRuntimeTxEvents : selectedStrategyRuntimeTxEvents;
  }, [activeRuntimeTxEvents, runtimeTradeScope, selectedStrategyRuntimeTxEvents]);

  const latestRuntimeTrade = runtimeTradeRows[0] || null;

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
    setPassportSummary(readPassportSummary());
  }, []);

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

  const executeManual = useCallback(
    (action) => {
      if (!selectedMarket || marketPrice <= 0) {
        setMessage('Select a valid market before submitting manual wallet actions.');
        return;
      }

      const now = Date.now();
      const point = {
        price: marketPrice,
        spread: marketSpread,
        volume: marketVolume
      };

      const requestedUnits = clamp(walletLab.orderUnits, 1, 25);
      const maxAbsUnits = clamp(walletLab.maxAbsUnits, 1, 80);
      const slippageBps = clamp(walletLab.slippageBps, 0, 50);
      const reason = String(walletLab.note || `manual ${action}`).slice(0, 140);

      let fills = 0;
      setWalletLab((previous) => {
        let wallet = previous.wallet;
        const trades = [];
        let assetHoldings = { ...(previous.assetHoldings || {}) };

        for (let index = 0; index < requestedUnits; index += 1) {
          const execution = executeWalletAction({
            wallet,
            action,
            point,
            timestamp: now + index,
            reason,
            score: 0,
            maxAbsUnits,
            cooldownMs: 0,
            slippageBps
          });
          wallet = execution.wallet;
          if (execution.trade) {
            const trade = {
              ...execution.trade,
              marketKey: String(selectedMarket.key),
              symbol: String(selectedMarket.symbol || selectedMarket.key).toUpperCase(),
              assetClass: String(selectedMarket.assetClass || 'unknown').toLowerCase()
            };
            trades.push(trade);
            assetHoldings = applyAssetTrade({
              holdings: assetHoldings,
              trade,
              market: selectedMarket,
              fallbackPrice: marketPrice,
              timestamp: now + index
            });
          }
        }

        fills = trades.length;
        const nextHistory = trimTail(
          [
            ...previous.equityHistory,
            {
              t: now,
              equity: wallet.equity,
              price: marketPrice
            }
          ],
          MAX_EQUITY_POINTS
        );

        return {
          ...previous,
          wallet,
          assetHoldings,
          tradeLog: trimHead([...trades.reverse(), ...previous.tradeLog], MAX_TRADES),
          equityHistory: nextHistory
        };
      });

      setMessage(
        fills > 0
          ? `${action === 'accumulate' ? 'Buy' : 'Sell'} filled ${fmtInt(fills)} unit${fills === 1 ? '' : 's'} on ${selectedMarket.symbol}.`
          : 'No fill produced. Max-units guard may be reached.'
      );
    },
    [marketPrice, marketSpread, marketVolume, selectedMarket, walletLab.maxAbsUnits, walletLab.note, walletLab.orderUnits, walletLab.slippageBps]
  );

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

  const refreshPassportSummary = () => {
    setPassportSummary(readPassportSummary());
    setMessage('Passport summary refreshed from account settings.');
  };

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

  const equitySeries = walletLab.equityHistory.map((row) => row.equity);
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
          Local-only paper wallet for testing manual actions and strategy behavior. External execution wiring is coming soon through passport-linked providers.
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
          <span>{fmtInt(activeRuntimeTxEvents.length)} account trades</span>
        </div>
        <p className="socket-status-copy">
          Active wallet {activePaperAccount?.name || '-'} ({activePaperAccount?.enabled ? 'enabled' : 'paused'}) | strategy focus{' '}
          {selectedStrategyStatus?.name || strategyId || '-'} ({selectedStrategyStatus?.enabled === false ? 'disabled' : 'enabled'})
        </p>
        <div className="strategy-lab-tab-row" role="tablist" aria-label="Runtime sync views">
          {RUNTIME_SYNC_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={runtimeSyncTab === tab.id}
              className={runtimeSyncTab === tab.id ? 'strategy-lab-tab active' : 'strategy-lab-tab'}
              onClick={() => setRuntimeSyncTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {runtimeSyncTab === 'summary' ? (
          <div className="list-stack">
            <div className="tensor-metrics">
              <article>
                <span>Enabled Strategies</span>
                <strong>
                  {fmtInt(enabledStrategyCount)} / {fmtInt(strategyStatusRows.length)}
                </strong>
              </article>
              <article>
                <span>Enabled Wallets</span>
                <strong>
                  {fmtInt(enabledPaperCount)} / {fmtInt(paperAccounts.length)}
                </strong>
              </article>
              <article>
                <span>Runtime Equity</span>
                <strong>{fmtNum(runtimeEquity, 2)}</strong>
              </article>
              <article>
                <span>Runtime Cash</span>
                <strong>{fmtNum(runtimeCash, 2)}</strong>
              </article>
              <article>
                <span>Runtime Units</span>
                <strong>{fmtNum(runtimeUnits, 4)}</strong>
              </article>
              <article>
                <span>Latest Runtime Fill</span>
                <strong>{fmtTime(activeRuntimeTxEvents[0]?.timestamp)}</strong>
              </article>
            </div>
            <div className="item-meta">
              <small>
                active wallet:{' '}
                {activePaperAccount?.id ? (
                  <Link to={`/wallet/${encodeURIComponent(activePaperAccount.id)}`} className="inline-link">
                    {activePaperAccount.name || activePaperAccount.id}
                  </Link>
                ) : (
                  '-'
                )}
              </small>
              <small>
                strategy:{' '}
                <Link to={`/strategy/${encodeURIComponent(selectedStrategyStatus?.id || strategyId || 'tensor-lite')}`} className="inline-link">
                  {selectedStrategyStatus?.name || strategyId || 'tensor-lite'}
                </Link>
              </small>
              <small>
                trade scope {runtimeTradeScope === 'all' ? 'all strategies' : 'selected strategy'} ({fmtInt(runtimeTradeRows.length)} rows)
              </small>
            </div>
            {latestRuntimeTrade ? (
              <article className="list-item">
                <strong className={latestRuntimeTrade.action === 'accumulate' ? 'up' : latestRuntimeTrade.action === 'reduce' ? 'down' : ''}>
                  latest {latestRuntimeTrade.action} | {latestRuntimeTrade.symbol || latestRuntimeTrade.marketKey || '-'} | {latestRuntimeTrade.strategyId}
                </strong>
                <p>{latestRuntimeTrade.reason || 'strategy execution'}</p>
                <div className="item-meta">
                  <small>fill {fmtNum(latestRuntimeTrade.fillPrice, 4)}</small>
                  <small>delta {fmtNum(latestRuntimeTrade.unitsDelta, 4)}</small>
                  <small>units {fmtNum(latestRuntimeTrade.unitsAfter, 4)}</small>
                  <small>pnl {fmtNum(latestRuntimeTrade.realizedDelta, 2)}</small>
                  <small>{fmtTime(latestRuntimeTrade.timestamp)}</small>
                </div>
              </article>
            ) : (
              <p className="action-message">No runtime fills yet for the active wallet.</p>
            )}
          </div>
        ) : null}

        {runtimeSyncTab === 'strategies' ? (
          <div className="list-stack">
            <div className="section-head">
              <h2>Strategy Runtime Map</h2>
              <span>{fmtInt(strategyStatusRows.length)} total</span>
            </div>
            <p className="socket-status-copy">
              This list is status-only in wallet view. Configure strategy enable/disable in Strategy Lab, then use Trades tab here to verify live fills.
            </p>
            {strategyStatusRows.map((strategy) => {
              const selected = toStrategyKey(strategy.id) === toStrategyKey(strategyId);
              return (
                <article key={`wallet-strategy:${strategy.key}`} className="list-item">
                  <strong>
                    {selected ? (
                      <span>
                        {strategy.name} | selected focus
                      </span>
                    ) : (
                      <Link to={`/strategy/${encodeURIComponent(strategy.id || strategy.name || strategy.key)}`} className="inline-link">
                        {strategy.name}
                      </Link>
                    )}
                  </strong>
                  <p>{strategy.description || 'No description available yet.'}</p>
                  <div className="item-meta">
                    <small>id {strategy.id || strategy.key}</small>
                    <small>{strategy.enabled ? 'enabled' : 'disabled'}</small>
                    <small>decisions {fmtInt(strategy.decisionCount || 0)}</small>
                  </div>
                </article>
              );
            })}
            {strategyStatusRows.length === 0 ? <p className="action-message">No strategies detected yet.</p> : null}
          </div>
        ) : null}

        {runtimeSyncTab === 'trades' ? (
          <>
            <div className="section-head">
              <h2>Live Runtime Trades</h2>
              <span>{fmtInt(runtimeTradeRows.length)} rows</span>
            </div>
            <div className="hero-actions">
              <button
                type="button"
                className={runtimeTradeScope === 'selected' ? 'btn primary' : 'btn secondary'}
                onClick={() => setRuntimeTradeScope('selected')}
              >
                Selected Strategy
              </button>
              <button
                type="button"
                className={runtimeTradeScope === 'all' ? 'btn primary' : 'btn secondary'}
                onClick={() => setRuntimeTradeScope('all')}
              >
                All Strategies
              </button>
            </div>
            <p className="socket-status-copy">
              scope {runtimeTradeScope === 'selected' ? selectedStrategyStatus?.name || strategyId || '-' : 'all enabled strategies'} | wallet{' '}
              {activePaperAccount?.name || '-'}
            </p>
            <FlashList
              items={runtimeTradeRows}
              height={330}
              itemHeight={74}
              className="tick-flash-list"
              emptyCopy={runtimeTradeScope === 'selected' ? 'No runtime trades for the selected strategy yet.' : 'No runtime trades for the active wallet yet.'}
              keyExtractor={(event) => event.id}
              renderItem={(event) => (
                <article className="tensor-event-row">
                  <strong className={event.action === 'accumulate' ? 'up' : event.action === 'reduce' ? 'down' : ''}>
                    {event.accountName || 'paper'} | {event.action} | {event.symbol || event.marketKey || '-'}
                  </strong>
                  <p>{event.reason || 'strategy execution'}</p>
                  <small>
                    {event.strategyId} | fill {fmtNum(event.fillPrice, 4)} | delta {fmtNum(event.unitsDelta, 4)} | units {fmtNum(event.unitsAfter, 4)} | pnl{' '}
                    {fmtNum(event.realizedDelta, 2)} | {fmtTime(event.timestamp)}
                  </small>
                </article>
              )}
            />
          </>
        ) : null}
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
                <label className="toggle-label">
                  <input type="checkbox" checked={account.id === activePaperAccountId} onChange={() => setActivePaperAccount(account.id)} />
                  <span>{account.name}</span>
                </label>
                <span className={account.enabled ? 'status-pill online' : 'status-pill'}>{account.enabled ? 'enabled' : 'paused'}</span>
              </div>
              <div className="section-actions">
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

      <div className="wallet-grid">
        <GlowCard className="panel-card wallet-control-card">
          <div className="section-head">
            <h2>Manual Paper Actions</h2>
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
              <span>Order Units</span>
              <input
                type="number"
                min={1}
                max={25}
                step={1}
                value={walletLab.orderUnits}
                onChange={(event) => handleControlChange('orderUnits', clamp(event.target.value, 1, 25))}
              />
            </label>
            <label className="control-field">
              <span>Max Abs Units</span>
              <input
                type="number"
                min={1}
                max={80}
                step={1}
                value={walletLab.maxAbsUnits}
                onChange={(event) => handleControlChange('maxAbsUnits', clamp(event.target.value, 1, 80))}
              />
            </label>
            <label className="control-field">
              <span>Slippage (bps)</span>
              <input
                type="number"
                min={0}
                max={50}
                step={0.1}
                value={walletLab.slippageBps}
                onChange={(event) => handleControlChange('slippageBps', clamp(event.target.value, 0, 50))}
              />
            </label>
          </div>
          <label className="control-field">
            <span>Reason</span>
            <input value={walletLab.note} maxLength={140} onChange={(event) => handleControlChange('note', event.target.value)} placeholder="manual wallet test" />
          </label>
          <div className="wallet-action-row">
            <button type="button" className="btn primary" onClick={() => executeManual('accumulate')}>
              Buy
            </button>
            <button type="button" className="btn secondary" onClick={() => executeManual('reduce')}>
              Sell
            </button>
            <button type="button" className="btn secondary" onClick={handleGenerateRandomPortfolio}>
              Generate Portfolio
            </button>
            <button type="button" className="btn secondary" onClick={handleReset}>
              Reset Wallet
            </button>
          </div>
          <p className="socket-status-copy">
            px {fmtNum(marketPrice, 4)} | spread {fmtNum(marketSpread, 2)} bps | vol {fmtCompact(marketVolume)} | trades {fmtInt(walletLab.wallet.tradeCount)} | win rate{' '}
            {fmtPct(winRate)}
          </p>
        </GlowCard>

        <GlowCard className="panel-card wallet-passport-card">
          <div className="section-head">
            <h2>Passport Integration</h2>
            <span>coming soon</span>
          </div>
          <p className="socket-status-copy">
            Profile {passportSummary.profileName} | mode {passportSummary.executionMode} | external actions{' '}
            {passportSummary.externalActionsEnabled ? 'enabled' : 'disabled'}
          </p>
          <div className="wallet-passport-metrics">
            <article>
              <span>Linked</span>
              <strong>{fmtInt(passportSummary.linkedProviders)}</strong>
            </article>
            <article>
              <span>Validated</span>
              <strong>{fmtInt(passportSummary.validatedProviders)}</strong>
            </article>
            <article>
              <span>Live Ready</span>
              <strong>{fmtInt(passportSummary.liveReadyProviders)}</strong>
            </article>
          </div>
          <p className="socket-status-copy">
            Next step: route wallet actions through provider guards once passport links are validated and runtime worker approvals are active.
          </p>
          <div className="wallet-action-row">
            <button type="button" className="btn secondary" onClick={refreshPassportSummary}>
              Refresh Passport
            </button>
            <Link className="btn secondary" to="/account">
              Open Account
            </Link>
          </div>
        </GlowCard>
      </div>

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
          {openHoldings.length === 0 ? <p className="action-message">No open assets. Submit Buy/Sell actions to create holdings.</p> : null}
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
          {walletLab.tradeLog.length === 0 ? <p className="action-message">No paper trades yet. Use Buy/Sell above to test execution flow.</p> : null}
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
