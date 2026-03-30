const http = require('node:http');
const { runtime } = require('./runtime');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';

const sendJson = (res, statusCode, payload) => {
	res.writeHead(statusCode, {
		'Content-Type': 'application/json; charset=utf-8',
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type'
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

	return sendJson(res, 404, {
		error: 'Not found',
		availableRoutes: [
			'/health',
			'/api/snapshot',
			'/api/providers',
			'/api/markets',
			'/api/signals',
			'/api/strategies',
			'/api/decisions',
			'/api/feed',
			'/api/controller',
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

server.listen(PORT, HOST, async () => {
	console.log(`[CRE8 Capital API] listening on http://${HOST}:${PORT}`);
	try {
		await runtime.start();
	} catch (error) {
		console.error('[CRE8 Capital API] runtime start failed:', error.message);
	}
});

let shuttingDown = false;
const shutdown = async () => {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	try {
		await runtime.stop();
	} catch (error) {
		console.error('[CRE8 Capital API] runtime shutdown failed:', error.message);
	}
	server.close(() => {
		process.exit(0);
	});
	setTimeout(() => process.exit(0), 2000).unref();
};

process.on('SIGINT', () => {
	shutdown().catch((error) => {
		console.error('[CRE8 Capital API] SIGINT shutdown failure:', error.message);
		process.exit(1);
	});
});
process.on('SIGTERM', () => {
	shutdown().catch((error) => {
		console.error('[CRE8 Capital API] SIGTERM shutdown failure:', error.message);
		process.exit(1);
	});
});

module.exports = { server, runtime };
