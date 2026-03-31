/**
 * SQLite-backed persistence layer for trades, positions, wallet state, signals, and decisions.
 * Same API surface as the previous in-memory version so all callers work unchanged.
 */
const db = require('../database');
const log = require('./logger');

class Persistence {
  constructor() {
    log.info('Persistence', 'SQLite persistence layer initialized');
  }

  // --- Wallet ---
  getWallet() {
    return db.prepare('SELECT * FROM wallet WHERE id = 1').get();
  }

  updateWallet(patch) {
    const w = this.getWallet();
    db.prepare("UPDATE wallet SET cash = ?, equity = ?, totalPnl = ?, tradeCount = ?, winCount = ?, lossCount = ?, updatedAt = datetime('now') WHERE id = 1")
      .run(
        patch.cash ?? w.cash,
        patch.equity ?? w.equity,
        patch.totalPnl ?? w.totalPnl,
        patch.tradeCount ?? w.tradeCount,
        patch.winCount ?? w.winCount,
        patch.lossCount ?? w.lossCount
      );
  }

  // --- Positions ---
  getPositions() {
    return db.prepare('SELECT * FROM position WHERE quantity > 0.00001 ORDER BY symbol').all();
  }

  upsertPosition(symbol, side, quantity, avgEntryPrice) {
    db.prepare("INSERT INTO position (symbol, side, quantity, avgEntryPrice, updatedAt) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(symbol) DO UPDATE SET side = excluded.side, quantity = excluded.quantity, avgEntryPrice = excluded.avgEntryPrice, updatedAt = datetime('now')")
      .run(symbol, side, quantity, avgEntryPrice);
  }

  // --- Trades ---
  saveTrade(trade) {
    db.prepare('INSERT INTO trade (strategyId, symbol, side, quantity, price, fee, slippage, pnl, decisionId, signalId, venue, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        trade.strategyId, trade.symbol, trade.side, trade.quantity, trade.price,
        trade.fee || 0, trade.slippage || 0, trade.pnl || 0,
        trade.decisionId, trade.signalId, trade.venue, trade.status || 'filled'
      );
  }

  getRecentTrades(limit = 50) {
    return db.prepare('SELECT * FROM trade ORDER BY createdAt DESC LIMIT ?').all(limit);
  }

  getTradesByStrategy(strategyId, limit = 50) {
    return db.prepare('SELECT * FROM trade WHERE strategyId = ? ORDER BY createdAt DESC LIMIT ?').all(strategyId, limit);
  }

  // --- Signals (persisted history) ---
  saveSignal(signal) {
    db.prepare('INSERT INTO signal_log (signalId, type, symbol, severity, score, meta) VALUES (?, ?, ?, ?, ?, ?)')
      .run(signal.id, signal.type, signal.symbol, signal.severity, signal.score, JSON.stringify(signal.meta || {}));
  }

  getRecentSignals(limit = 100) {
    return db.prepare('SELECT * FROM signal_log ORDER BY createdAt DESC LIMIT ?').all(limit);
  }

  // --- Decisions (persisted history) ---
  saveDecision(decision) {
    db.prepare('INSERT INTO decision_log (decisionId, strategyId, signalId, action, intent, reason, symbol) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(
        decision.id,
        decision.strategyId,
        decision.signal?.id || decision.signalId,
        decision.action,
        decision.intent,
        decision.reason,
        decision.signal?.symbol || decision.symbol
      );
  }

  getRecentDecisions(limit = 100) {
    return db.prepare('SELECT * FROM decision_log ORDER BY createdAt DESC LIMIT ?').all(limit);
  }

  // --- Ticks (periodic snapshots) ---
  saveTick(tick) {
    db.prepare('INSERT INTO market_tick (symbol, bid, ask, price, volume, provider, venue) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(tick.symbol, tick.bid, tick.ask, tick.price, tick.volume, tick.provider, tick.venue);
  }
}

// Singleton
module.exports = new Persistence();
