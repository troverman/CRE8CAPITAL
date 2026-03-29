const http = require('node:http');

const PORT = Number(process.env.PORT || 8787);

const sendJson = (res, statusCode, payload) => {
	res.writeHead(statusCode, {
		'Content-Type': 'application/json; charset=utf-8',
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET,OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type'
	});
	res.end(JSON.stringify(payload));
};

const server = http.createServer((req, res) => {
	if (req.method === 'OPTIONS') {
		return sendJson(res, 204, {});
	}

	const baseUrl = `http://${req.headers.host || `localhost:${PORT}`}`;
	const url = new URL(req.url || '/', baseUrl);

	if (req.method === 'GET' && url.pathname === '/health') {
		return sendJson(res, 200, {
			status: 'ok',
			service: 'cre8capital-backend',
			timestamp: new Date().toISOString()
		});
	}

	if (req.method === 'GET' && url.pathname === '/api/splash') {
		return sendJson(res, 200, {
			site: 'capital.cre8.xyz',
			headline: 'Build with conviction. Scale with clarity.',
			subheadline: 'CRE8 Capital turns strategy, execution, and capital intelligence into one operating rhythm.'
		});
	}

	return sendJson(res, 404, {
		error: 'Not found',
		availableRoutes: ['/health', '/api/splash']
	});
});

server.listen(PORT, () => {
	console.log(`[CRE8 Capital API] listening on http://localhost:${PORT}`);
});
