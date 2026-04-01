const http = require('node:http');
const { WebSocketServer } = require('ws');
const { runtime } = require('./runtime');
const BacktestEngine = require('./backtest/BacktestEngine');
const HistoryProvider = require('./backtest/HistoryProvider');
const alertEngine = require('./shared/alertEngine');
const db = require('./database');
const log = require('./shared/logger');

const backtestEngine = new BacktestEngine();
const historyProvider = new HistoryProvider();

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const STREAM_INTERVAL_MS = Number(process.env.CAPITAL_STREAM_INTERVAL_MS || 1000);

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type'
};

const sseClients = new Set();
const wsClients = new Set();

const sendJson = (res, statusCode, payload) => {
	res.writeHead(statusCode, {
		'Content-Type': 'application/json; charset=utf-8',
		...corsHeaders
	});
	res.end(JSON.stringify(payload));
};

const readBody = (req) => {
	return new Promise((resolve, reject) => {
		let body = '';
		req.on('data', (chunk) => {
			body += chunk;
			if (body.length > 1024 * 1024) {
				req.destroy();
				reject(new Error('Request body too large'));
			}
		});
		req.on('end', () => {
			if (!body) {
				resolve({});
				return;
			}
			try {
				resolve(JSON.parse(body));
			} catch (error) {
				reject(new Error(`Invalid JSON body: ${error.message}`));
			}
		});
		req.on('error', (error) => reject(error));
	});
};

const numberParam = (value, fallback) => {
	if (value === undefined || value === null || value === '') {
		return fallback;
	}
	const num = Number(value);
	return Number.isFinite(num) ? num : fallback;
};

const writeSseEvent = (res, eventName, payload) => {
	if (eventName) {
		res.write(`event: ${eventName}\n`);
	}
	res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const makeStreamLimits = (searchParams) => {
	return {
		marketLimit: numberParam(searchParams.get('marketLimit'), 150),
		signalLimit: numberParam(searchParams.get('signalLimit'), 120),
		decisionLimit: numberParam(searchParams.get('decisionLimit'), 120),
		feedLimit: numberParam(searchParams.get('feedLimit'), 140)
	};
};

const snapshotForLimits = (limits) => {
	return runtime.getSnapshot({
		marketLimit: limits.marketLimit,
		signalLimit: limits.signalLimit,
		decisionLimit: limits.decisionLimit,
		feedLimit: limits.feedLimit
	});
};

const broadcastSnapshot = () => {
	if (sseClients.size === 0 && wsClients.size === 0) {
		return;
	}

	for (const client of sseClients) {
		try {
			const payload = snapshotForLimits(client.limits);
			writeSseEvent(client.res, 'snapshot', payload);
		} catch (error) {
			client.res.end();
			sseClients.delete(client);
		}
	}

	// Broadcast to WebSocket clients
	if (wsClients.size > 0) {
		const defaultLimits = { marketLimit: 150, signalLimit: 120, decisionLimit: 120, feedLimit: 140 };
		const wsPayload = JSON.stringify({ type: 'snapshot', data: snapshotForLimits(defaultLimits) });
		for (const ws of wsClients) {
			try {
				if (ws.readyState === 1) { // WebSocket.OPEN
					ws.send(wsPayload);
				}
			} catch (_) {
				wsClients.delete(ws);
			}
		}
	}
};

/**
 * Broadcast a specific event (tick, signal, decision, trade) to all WS clients.
 */
const broadcastWsEvent = (type, data) => {
	if (wsClients.size === 0) return;
	const msg = JSON.stringify({ type, data });
	for (const ws of wsClients) {
		try {
			if (ws.readyState === 1) ws.send(msg);
		} catch (_) {
			wsClients.delete(ws);
		}
	}
};

const streamIntervalId = setInterval(() => {
	broadcastSnapshot();
}, STREAM_INTERVAL_MS);
if (typeof streamIntervalId.unref === 'function') {
	streamIntervalId.unref();
}

const api = async (req, res) => {
	if (req.method === 'OPTIONS') {
		return sendJson(res, 204, {});
	}

	const baseUrl = `http://${req.headers.host || `localhost:${PORT}`}`;
	const url = new URL(req.url || '/', baseUrl);

	if (req.method === 'GET' && url.pathname === '/health') {
		const snapshot = runtime.getSnapshot({ marketLimit: 1, signalLimit: 1, decisionLimit: 1, feedLimit: 1 });
		return sendJson(res, 200, {
			status: snapshot.running ? 'ok' : 'degraded',
			service: 'cre8capital-runtime',
			timestamp: new Date().toISOString(),
			running: snapshot.running,
			providerCount: snapshot.providers.length,
			providersConnected: snapshot.providers.filter((provider) => provider.connected).length
		});
	}

	if (req.method === 'GET' && url.pathname === '/api/snapshot') {
		const snapshot = runtime.getSnapshot({
			marketLimit: numberParam(url.searchParams.get('marketLimit'), 150),
			signalLimit: numberParam(url.searchParams.get('signalLimit'), 120),
			decisionLimit: numberParam(url.searchParams.get('decisionLimit'), 120),
			feedLimit: numberParam(url.searchParams.get('feedLimit'), 140)
		});
		return sendJson(res, 200, snapshot);
	}

	if (req.method === 'GET' && url.pathname === '/api/stream') {
		const limits = makeStreamLimits(url.searchParams);
		res.writeHead(200, {
			...corsHeaders,
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		});
		res.write('retry: 2000\n\n');

		const client = { res, limits };
		sseClients.add(client);

		const firstSnapshot = snapshotForLimits(limits);
		writeSseEvent(res, 'snapshot', firstSnapshot);

		req.on('close', () => {
			sseClients.delete(client);
		});
		return;
	}

	if (req.method === 'GET' && url.pathname === '/api/providers') {
		return sendJson(res, 200, { items: runtime.getProviderStatuses() });
	}

	if (req.method === 'GET' && url.pathname === '/api/markets') {
		const items = runtime.getMarkets({
			limit: numberParam(url.searchParams.get('limit'), 120),
			assetClass: url.searchParams.get('assetClass') || undefined
		});
		return sendJson(res, 200, { items, summary: runtime.marketStore.getSummary() });
	}

	if (req.method === 'GET' && url.pathname === '/api/signals') {
		const items = runtime.getSignals({
			limit: numberParam(url.searchParams.get('limit'), 120),
			type: url.searchParams.get('type') || undefined,
			symbol: url.searchParams.get('symbol') || undefined,
			severity: url.searchParams.get('severity') || undefined
		});
		return sendJson(res, 200, {
			items,
			summary: runtime.signalEngine.getSummary()
		});
	}

	if (req.method === 'GET' && url.pathname === '/api/strategies') {
		const customRows = db.prepare('SELECT * FROM strategy ORDER BY createdAt DESC').all();
		runtime.strategyEngine.loadCustomStrategies(customRows);
		return sendJson(res, 200, {
			items: runtime.getStrategies(),
			summary: runtime.strategyEngine.getSummary(),
			positions: runtime.strategyEngine.getPositions()
		});
	}

	if (req.method === 'GET' && url.pathname === '/api/decisions') {
		const items = runtime.getDecisions({
			limit: numberParam(url.searchParams.get('limit'), 120),
			strategyId: url.searchParams.get('strategyId') || undefined,
			symbol: url.searchParams.get('symbol') || undefined
		});
		return sendJson(res, 200, { items });
	}

	if (req.method === 'GET' && url.pathname === '/api/feed') {
		const items = runtime.getFeed({
			limit: numberParam(url.searchParams.get('limit'), 120)
		});
		return sendJson(res, 200, { items });
	}

	if (req.method === 'GET' && url.pathname === '/api/controller') {
		return sendJson(res, 200, runtime.getControllerState());
	}

	if (req.method === 'POST' && url.pathname === '/api/triggers/restrategy') {
		const body = await readBody(req);
		const result = await runtime.triggerRestrategy({
			reason: body.reason,
			source: body.source || 'api'
		});
		return sendJson(res, 202, {
			ok: true,
			...result
		});
	}

	if (req.method === 'POST' && url.pathname === '/api/runtime/start') {
		await runtime.start();
		return sendJson(res, 200, {
			ok: true,
			running: true
		});
	}

	if (req.method === 'POST' && url.pathname === '/api/runtime/stop') {
		await runtime.stop();
		return sendJson(res, 200, {
			ok: true,
			running: false
		});
	}

	if (req.method === 'GET' && url.pathname === '/api/trades') {
		const persistence = require('./shared/persistence');
		const limit = numberParam(url.searchParams.get('limit'), 50);
		const strategyId = url.searchParams.get('strategyId');
		const items = strategyId
			? persistence.getTradesByStrategy(strategyId, limit)
			: persistence.getRecentTrades(limit);
		return sendJson(res, 200, { items });
	}

	if (req.method === 'GET' && url.pathname === '/api/positions') {
		const persistence = require('./shared/persistence');
		return sendJson(res, 200, { items: persistence.getPositions() });
	}

	if (req.method === 'GET' && url.pathname === '/api/wallet') {
		const persistence = require('./shared/persistence');
		return sendJson(res, 200, persistence.getWallet());
	}

	if (req.method === 'GET' && url.pathname === '/api/signals/history') {
		const persistence = require('./shared/persistence');
		const limit = numberParam(url.searchParams.get('limit'), 100);
		return sendJson(res, 200, { items: persistence.getRecentSignals(limit) });
	}

	if (req.method === 'GET' && url.pathname === '/api/decisions/history') {
		const persistence = require('./shared/persistence');
		const limit = numberParam(url.searchParams.get('limit'), 100);
		return sendJson(res, 200, { items: persistence.getRecentDecisions(limit) });
	}

	if (req.method === 'GET' && url.pathname === '/api/execution') {
		return sendJson(res, 200, {
			stats: runtime.executionEngine.getStats(),
			wallet: require('./shared/persistence').getWallet()
		});
	}

	// POST /api/backtest -- run a server-side backtest
	if (req.method === 'POST' && url.pathname === '/api/backtest') {
		try {
			const body = await readBody(req);
			const strategy = body.strategy || { protocol: 'trend-follow' };
			const symbols = body.symbols || ['BTC-USDT'];
			const days = numberParam(body.days, 30);
			const initialCash = numberParam(body.initialCash, 10000);
			const feeRate = numberParam(body.feeRate, 0.001);

			const engine = new BacktestEngine({ initialCash, feeRate, slippageBps: numberParam(body.slippageBps, 5) });
			const history = await historyProvider.getHistory(symbols, days);
			const result = engine.run(strategy, history, { initialCash });

			return sendJson(res, 200, {
				ok: true,
				symbols,
				days,
				strategy: { protocol: strategy.protocol },
				candleCount: history.length,
				...result
			});
		} catch (error) {
			log.error('Backtest', 'backtest failed', error.message);
			return sendJson(res, 500, { error: 'Backtest failed', message: error.message });
		}
	}

	if (req.method === 'GET' && url.pathname === '/api/risk') {
		return sendJson(res, 200, runtime.executionEngine.riskManager.getStatus());
	}

	if (req.method === 'PUT' && url.pathname === '/api/risk') {
		try {
			const body = await readBody(req);
			runtime.executionEngine.riskManager.updateParams(body);
			return sendJson(res, 200, {
				ok: true,
				risk: runtime.executionEngine.riskManager.getStatus()
			});
		} catch (error) {
			return sendJson(res, 400, { error: 'Invalid risk parameters', message: error.message });
		}
	}

	// --- Alert endpoints ---
	if (req.method === 'GET' && url.pathname === '/api/alerts') {
		const limit = numberParam(url.searchParams.get('limit'), 50);
		const items = alertEngine.getRecent(limit);
		const unread = alertEngine.getUnread();
		return sendJson(res, 200, { items, unreadCount: unread.length });
	}

	if (req.method === 'POST' && url.pathname.match(/^\/api\/alerts\/(\d+)\/read$/)) {
		const alertId = Number(url.pathname.match(/^\/api\/alerts\/(\d+)\/read$/)[1]);
		alertEngine.markRead(alertId);
		return sendJson(res, 200, { ok: true });
	}

	if (req.method === 'POST' && url.pathname === '/api/alerts/read-all') {
		alertEngine.markAllRead();
		return sendJson(res, 200, { ok: true });
	}

	// --- Strategy CRUD endpoints ---
	if (req.method === 'POST' && url.pathname === '/api/strategies') {
		try {
			const body = await readBody(req);
			const id = body.id || `custom-${Date.now().toString(36)}`;
			const name = body.name || id;
			const protocol = body.protocol || 'trend-follow';
			const assetClasses = Array.isArray(body.assetClasses) ? body.assetClasses.join(',') : (body.assetClasses || 'crypto');
			const signals = Array.isArray(body.signals) ? body.signals.join(',') : (body.signals || 'momentum-shift');
			const config = typeof body.config === 'string' ? body.config : JSON.stringify(body.config || {});
			const enabled = body.enabled !== false ? 1 : 0;

			db.prepare('INSERT OR REPLACE INTO strategy (id, name, protocol, assetClasses, signals, config, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)')
				.run(id, name, protocol, assetClasses, signals, config, enabled);

			// Reload into engine
			const customRows = db.prepare('SELECT * FROM strategy ORDER BY createdAt DESC').all();
			runtime.strategyEngine.loadCustomStrategies(customRows);

			return sendJson(res, 201, { ok: true, id, name, protocol });
		} catch (error) {
			return sendJson(res, 400, { error: 'Failed to create strategy', message: error.message });
		}
	}

	const strategyPutMatch = req.method === 'PUT' && url.pathname.match(/^\/api\/strategies\/(.+)$/);
	if (strategyPutMatch) {
		try {
			const strategyId = decodeURIComponent(strategyPutMatch[1]);
			const body = await readBody(req);
			const existing = db.prepare('SELECT * FROM strategy WHERE id = ?').get(strategyId);
			if (!existing) return sendJson(res, 404, { error: 'Strategy not found' });
			const name = body.name || existing.name;
			const protocol = body.protocol || existing.protocol;
			const assetClasses = body.assetClasses ? (Array.isArray(body.assetClasses) ? body.assetClasses.join(',') : body.assetClasses) : existing.assetClasses;
			const signals = body.signals ? (Array.isArray(body.signals) ? body.signals.join(',') : body.signals) : existing.signals;
			const config = body.config !== undefined ? (typeof body.config === 'string' ? body.config : JSON.stringify(body.config)) : existing.config;
			const enabled = body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled;

			db.prepare("UPDATE strategy SET name = ?, protocol = ?, assetClasses = ?, signals = ?, config = ?, enabled = ?, updatedAt = datetime('now') WHERE id = ?")
				.run(name, protocol, assetClasses, signals, config, enabled, strategyId);

			return sendJson(res, 200, { ok: true, id: strategyId });
		} catch (error) {
			return sendJson(res, 400, { error: 'Failed to update strategy', message: error.message });
		}
	}

	const strategyDeleteMatch = req.method === 'DELETE' && url.pathname.match(/^\/api\/strategies\/(.+)$/);
	if (strategyDeleteMatch) {
		const strategyId = decodeURIComponent(strategyDeleteMatch[1]);
		db.prepare('DELETE FROM strategy WHERE id = ?').run(strategyId);
		return sendJson(res, 200, { ok: true, id: strategyId });
	}

	const strategyToggleMatch = req.method === 'POST' && url.pathname.match(/^\/api\/strategies\/(.+)\/toggle$/);
	if (strategyToggleMatch) {
		const strategyId = decodeURIComponent(strategyToggleMatch[1]);
		const existing = db.prepare('SELECT * FROM strategy WHERE id = ?').get(strategyId);
		if (existing) {
			const newEnabled = existing.enabled ? 0 : 1;
			db.prepare("UPDATE strategy SET enabled = ?, updatedAt = datetime('now') WHERE id = ?").run(newEnabled, strategyId);
			return sendJson(res, 200, { ok: true, id: strategyId, enabled: !!newEnabled });
		}
		// Toggle built-in strategy in the engine
		const strategies = runtime.strategyEngine.getStrategies();
		const builtIn = strategies.find(s => s.id === strategyId);
		if (builtIn) {
			// Store toggle state for built-in in DB
			const assetClasses = Array.isArray(builtIn.assetClasses) ? builtIn.assetClasses.join(',') : '';
			const signals = Array.isArray(builtIn.signalTypes) ? builtIn.signalTypes.join(',') : '';
			const config = JSON.stringify(builtIn.config || {});
			const newEnabled = builtIn.enabled ? 0 : 1;
			db.prepare('INSERT OR REPLACE INTO strategy (id, name, protocol, assetClasses, signals, config, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)')
				.run(strategyId, builtIn.name, builtIn.protocol, assetClasses, signals, config, newEnabled);
			return sendJson(res, 200, { ok: true, id: strategyId, enabled: !!newEnabled });
		}
		return sendJson(res, 404, { error: 'Strategy not found' });
	}

	return sendJson(res, 404, {
		error: 'Not found',
		availableRoutes: [
			'/health',
			'/api/snapshot',
			'/api/stream',
			'/ws',
			'/api/providers',
			'/api/markets',
			'/api/signals',
			'/api/strategies',
			'/api/decisions',
			'/api/feed',
			'/api/controller',
			'/api/trades',
			'/api/positions',
			'/api/wallet',
			'/api/execution',
			'/api/signals/history',
			'/api/decisions/history',
			'/api/backtest',
			'/api/risk',
			'/api/alerts',
			'/api/triggers/restrategy',
			'/api/runtime/start',
			'/api/runtime/stop'
		]
	});
};

const server = http.createServer((req, res) => {
	api(req, res).catch((error) => {
		sendJson(res, 500, {
			error: 'Internal error',
			message: error.message
		});
	});
});

// --- WebSocket server on /ws path ---
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
	wsClients.add(ws);
	log.info('WebSocket', `client connected (total: ${wsClients.size})`);

	// Send initial snapshot immediately
	try {
		const snapshot = runtime.getSnapshot({ marketLimit: 150, signalLimit: 120, decisionLimit: 120, feedLimit: 140 });
		ws.send(JSON.stringify({ type: 'snapshot', data: snapshot }));
	} catch (_) { /* initial send failure is non-fatal */ }

	ws.on('close', () => {
		wsClients.delete(ws);
		log.debug('WebSocket', `client disconnected (total: ${wsClients.size})`);
	});

	ws.on('error', () => {
		wsClients.delete(ws);
	});

	// Handle incoming commands from frontend
	ws.on('message', async (raw) => {
		try {
			const msg = JSON.parse(String(raw));
			if (msg.type === 'restrategy') {
				const result = await runtime.triggerRestrategy({
					reason: msg.reason || 'manual-ws',
					source: 'websocket'
				});
				ws.send(JSON.stringify({ type: 'restrategy-ack', data: result }));
			} else if (msg.type === 'ping') {
				ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
			}
		} catch (_) { /* invalid message, ignore */ }
	});
});

// Wire execution engine to broadcast trades to WS clients
runtime.executionEngine.onTrade((trade) => {
	broadcastWsEvent('trade', trade);
});

// Wire alert engine to broadcast alerts to WS clients
alertEngine.onAlert((alert) => {
	broadcastWsEvent('alert', alert);
});

server.listen(PORT, HOST, async () => {
	log.info('Server', `listening on http://${HOST}:${PORT} (WS on /ws)`);
	try {
		await runtime.start();
	} catch (error) {
		log.error('Server', 'runtime start failed', error.message);
	}
});

let shuttingDown = false;
const shutdown = async () => {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	clearInterval(streamIntervalId);
	for (const client of sseClients) {
		client.res.end();
	}
	sseClients.clear();
	for (const ws of wsClients) {
		try { ws.close(); } catch (_) {}
	}
	wsClients.clear();
	wss.close();
	try {
		await runtime.stop();
	} catch (error) {
		log.error('Server', 'runtime shutdown failed', error.message);
	}
	server.close(() => {
		process.exit(0);
	});
	setTimeout(() => process.exit(0), 2000).unref();
};

process.on('SIGINT', () => {
	shutdown().catch((error) => {
		log.error('Server', 'SIGINT shutdown failure', error.message);
		process.exit(1);
	});
});
process.on('SIGTERM', () => {
	shutdown().catch((error) => {
		log.error('Server', 'SIGTERM shutdown failure', error.message);
		process.exit(1);
	});
});

module.exports = { server, runtime };
