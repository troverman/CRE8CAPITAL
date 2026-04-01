import { create } from 'zustand';
import { useCapitalStore } from './capitalStore';

const MAX_TX_EVENTS = 320;
const MAX_POSITION_EVENTS = 320;

const trimHead = (list, maxLength) => {
  if (list.length <= maxLength) return list;
  return list.slice(0, maxLength);
};

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const emitWindowEvent = (eventName, detail) => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
};

const buildWalletSnapshot = (wallet = {}, pointPrice = 0) => {
  const markPrice = Math.max(toNum(pointPrice, 0), 0);
  const units = toNum(wallet.units, 0);
  return {
    cash: toNum(wallet.cash, 0),
    units,
    avgEntry: wallet.avgEntry === null ? null : toNum(wallet.avgEntry, null),
    realizedPnl: toNum(wallet.realizedPnl, 0),
    unrealizedPnl: toNum(wallet.unrealizedPnl, 0),
    equity: toNum(wallet.equity, 0),
    positionNotional: Math.abs(units) * markPrice,
    markPrice
  };
};

const buildContext = (payload = {}) => {
  const market = payload.market || {};
  const account = payload.account || {};
  return {
    strategyId: String(payload.strategyId || 'unknown'),
    sourceId: String(payload.sourceId || 'runtime'),
    marketKey: String(market.key || ''),
    symbol: String(market.symbol || ''),
    assetClass: String(market.assetClass || ''),
    accountId: String(account.id || ''),
    accountName: String(account.name || '')
  };
};

export const useExecutionFeedStore = create((set) => ({
  txEvents: [],
  positionEvents: [],
  emitStrategyExecution: (payload) => {
    const trade = payload?.trade;
    const wallet = payload?.wallet;
    if (!trade || !wallet) return;

    const timestamp = Math.max(0, Math.round(toNum(trade.timestamp, Date.now())));
    const context = buildContext(payload);
    const pointPrice = toNum(payload?.point?.price, trade.fillPrice);
    const walletSnapshot = buildWalletSnapshot(wallet, pointPrice);

    const txEvent = {
      id: `tx:${timestamp}:${context.accountId || 'account'}:${trade.id || context.strategyId}`,
      timestamp,
      ...context,
      action: trade.action === 'reduce' ? 'reduce' : 'accumulate',
      unitsDelta: toNum(trade.unitsDelta, 0),
      unitsAfter: toNum(trade.unitsAfter, walletSnapshot.units),
      fillPrice: toNum(trade.fillPrice, pointPrice),
      markPrice: toNum(trade.markPrice, pointPrice),
      spreadBps: toNum(trade.spreadBps, payload?.point?.spread || 0),
      realizedDelta: toNum(trade.realizedDelta, 0),
      score: toNum(trade.score, payload?.signal?.score || 0),
      reason: String(trade.reason || payload?.signal?.reason || '')
    };

    const positionEvent = {
      id: `pos:${timestamp}:${context.accountId || 'account'}:${trade.id || context.strategyId}`,
      timestamp,
      ...context,
      action: txEvent.action,
      triggerKind: String(payload?.signal?.triggerKind || 'strategy'),
      signalCount: Math.max(0, Math.round(toNum(payload?.signal?.signalCount, 0))),
      score: toNum(payload?.signal?.score, txEvent.score),
      reason: String(payload?.signal?.reason || txEvent.reason || ''),
      wallet: walletSnapshot
    };

    set((state) => ({
      txEvents: trimHead([txEvent, ...state.txEvents], MAX_TX_EVENTS),
      positionEvents: trimHead([positionEvent, ...state.positionEvents], MAX_POSITION_EVENTS)
    }));

    useCapitalStore.getState().upsertWalletAccounts({
      walletAccounts: [
        {
          id: context.accountId,
          name: context.accountName,
          enabled: true,
          wallet: walletSnapshot
        }
      ],
      activeWalletId: context.accountId
    });
    useCapitalStore.getState().appendWalletTx(txEvent);
    useCapitalStore.getState().appendWalletPosition(positionEvent);

    emitWindowEvent('cre8capital:wallet:tx', txEvent);
    emitWindowEvent('cre8capital:wallet:position', positionEvent);
    emitWindowEvent('cre8capital:wallet:execution', {
      tx: txEvent,
      position: positionEvent
    });
  },
  emitWalletPositionSnapshot: (payload) => {
    const wallet = payload?.wallet;
    if (!wallet) return;

    const context = buildContext(payload);
    // Enrich with latest market price from capitalStore to avoid stale point.price
    const markets = useCapitalStore.getState().entities?.marketsById || {};
    const marketSymbol = context.symbol || '';
    const matchedMarket = marketSymbol
      ? Object.values(markets).find((m) => m.symbol === marketSymbol)
      : null;
    const latestPrice = matchedMarket?.referencePrice || null;
    const pointPrice = toNum(
      latestPrice || payload?.point?.price,
      wallet.markPrice || 0
    );
    const timestamp = Math.max(0, Math.round(toNum(payload?.timestamp, payload?.point?.t || Date.now())));
    const walletSnapshot = buildWalletSnapshot(wallet, pointPrice);
    const actionRaw = String(payload?.action || payload?.signal?.action || 'hold').toLowerCase();
    const action = actionRaw === 'reduce' ? 'reduce' : actionRaw === 'accumulate' ? 'accumulate' : 'hold';

    const positionEvent = {
      id: `pos:${timestamp}:${context.accountId || 'account'}:${context.strategyId}:mark`,
      timestamp,
      ...context,
      action,
      triggerKind: String(payload?.signal?.triggerKind || 'runtime'),
      signalCount: Math.max(0, Math.round(toNum(payload?.signal?.signalCount, 0))),
      score: toNum(payload?.signal?.score, 0),
      reason: String(payload?.reason || payload?.signal?.reason || 'mark update'),
      wallet: walletSnapshot
    };

    set((state) => ({
      ...state,
      positionEvents: trimHead([positionEvent, ...state.positionEvents], MAX_POSITION_EVENTS)
    }));

    useCapitalStore.getState().upsertWalletAccounts({
      walletAccounts: [
        {
          id: context.accountId,
          name: context.accountName,
          enabled: true,
          wallet: walletSnapshot
        }
      ],
      activeWalletId: context.accountId
    });
    useCapitalStore.getState().appendWalletPosition(positionEvent);

    emitWindowEvent('cre8capital:wallet:position', positionEvent);
  },
  clearExecutionFeed: () =>
    set(() => ({
      txEvents: [],
      positionEvents: []
    }))
}));
