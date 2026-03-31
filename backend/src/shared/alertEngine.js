/**
 * AlertEngine -- sends notifications on important events.
 *
 * Alert types:
 * - signal.high       -- high severity signal generated
 * - trade.executed    -- trade was executed
 * - risk.stop_loss    -- stop loss triggered
 * - risk.take_profit  -- take profit triggered
 * - risk.daily_limit  -- daily loss limit reached
 * - strategy.restrategy -- auto-restrategy fired
 *
 * Channels:
 * - console (always on)
 * - webhook (configurable URL)
 * - in-app (stored in DB, shown in frontend)
 */

const db = require('../database');
const log = require('./logger');

// Create alerts table
db.exec(`
  CREATE TABLE IF NOT EXISTS alert (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    severity TEXT DEFAULT 'info',
    title TEXT,
    message TEXT,
    data TEXT,
    read INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_alert_type ON alert(type);
  CREATE INDEX IF NOT EXISTS idx_alert_read ON alert(read);
`);

class AlertEngine {
	constructor(opts = {}) {
		this.webhookUrl = opts.webhookUrl || process.env.ALERT_WEBHOOK_URL;
		this.listeners = []; // in-memory subscribers (for WS broadcast)
	}

	async fire(type, severity, title, message, data = {}) {
		// Store in DB
		db.prepare('INSERT INTO alert (type, severity, title, message, data) VALUES (?, ?, ?, ?, ?)')
			.run(type, severity, title, message, JSON.stringify(data));

		// Console
		const logFn = severity === 'critical' || severity === 'error' ? 'error' : severity === 'warning' ? 'warn' : 'info';
		log[logFn]('Alert', `[${type}] ${title}: ${message}`);

		// Webhook
		if (this.webhookUrl) {
			try {
				await fetch(this.webhookUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ type, severity, title, message, data, timestamp: new Date().toISOString() })
				});
			} catch (e) {
				log.error('Alert', 'Webhook failed', e.message);
			}
		}

		// In-memory listeners (for real-time push)
		for (const listener of this.listeners) {
			try {
				listener({ type, severity, title, message, data });
			} catch (_) { /* listener error non-fatal */ }
		}
	}

	onAlert(callback) {
		this.listeners.push(callback);
	}

	getRecent(limit = 50) {
		return db.prepare('SELECT * FROM alert ORDER BY createdAt DESC LIMIT ?').all(limit);
	}

	getUnread() {
		return db.prepare('SELECT * FROM alert WHERE read = 0 ORDER BY createdAt DESC').all();
	}

	markRead(id) {
		db.prepare('UPDATE alert SET read = 1 WHERE id = ?').run(id);
	}

	markAllRead() {
		db.prepare('UPDATE alert SET read = 1 WHERE read = 0').run();
	}

	clearOld(days = 7) {
		db.prepare("DELETE FROM alert WHERE createdAt < datetime('now', '-' || ? || ' days')").run(days);
	}
}

module.exports = new AlertEngine();
