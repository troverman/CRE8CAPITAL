const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dir = path.join(__dirname, '..', 'data', 'sql');
fs.mkdirSync(dir, { recursive: true });

const dbPath = process.env.NODE_ENV === 'production' ? ':memory:' : path.join(dir, 'cre8capital.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS trade (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategyId TEXT,
    symbol TEXT,
    side TEXT,
    quantity REAL,
    price REAL,
    fee REAL DEFAULT 0,
    slippage REAL DEFAULT 0,
    pnl REAL,
    decisionId TEXT,
    signalId TEXT,
    venue TEXT,
    status TEXT DEFAULT 'filled',
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS position (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT UNIQUE,
    side TEXT DEFAULT 'long',
    quantity REAL DEFAULT 0,
    avgEntryPrice REAL DEFAULT 0,
    unrealizedPnl REAL DEFAULT 0,
    realizedPnl REAL DEFAULT 0,
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS wallet (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT DEFAULT 'default',
    cash REAL DEFAULT 10000,
    equity REAL DEFAULT 10000,
    totalPnl REAL DEFAULT 0,
    tradeCount INTEGER DEFAULT 0,
    winCount INTEGER DEFAULT 0,
    lossCount INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS snapshot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    data TEXT,
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS signal_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signalId TEXT,
    type TEXT,
    symbol TEXT,
    severity TEXT,
    score REAL,
    meta TEXT,
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS decision_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    decisionId TEXT,
    strategyId TEXT,
    signalId TEXT,
    action TEXT,
    intent TEXT,
    reason TEXT,
    symbol TEXT,
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS market_tick (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT,
    bid REAL,
    ask REAL,
    price REAL,
    volume REAL,
    provider TEXT,
    venue TEXT,
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS strategy (
    id TEXT PRIMARY KEY,
    name TEXT,
    protocol TEXT,
    assetClasses TEXT,
    signals TEXT,
    config TEXT,
    enabled INTEGER DEFAULT 1,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_trade_symbol ON trade(symbol);
  CREATE INDEX IF NOT EXISTS idx_trade_strategy ON trade(strategyId);
  CREATE INDEX IF NOT EXISTS idx_position_symbol ON position(symbol);
  CREATE INDEX IF NOT EXISTS idx_signal_log_type ON signal_log(type);
  CREATE INDEX IF NOT EXISTS idx_decision_log_strategy ON decision_log(strategyId);
  CREATE INDEX IF NOT EXISTS idx_market_tick_symbol ON market_tick(symbol);
`);

// Seed default wallet if none exists
if (!db.prepare('SELECT id FROM wallet LIMIT 1').get()) {
  db.prepare('INSERT INTO wallet (name, cash, equity) VALUES (?, ?, ?)').run('default', 10000, 10000);
}

module.exports = db;
