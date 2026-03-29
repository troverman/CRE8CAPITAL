const http = require('node:http');

const PORT = Number(process.env.PORT || 8787);

const ideas = [
	{
		id: 'idea-1',
		asset: 'AI Infrastructure Basket',
		theme: 'Compute and data center exposure',
		confidence: 89,
		allocation: '14%',
		horizon: '6 months',
		status: 'ready'
	},
	{
		id: 'idea-2',
		asset: 'Treasury Yield Ladder',
		theme: 'Cash efficiency and downside insulation',
		confidence: 82,
		allocation: '18%',
		horizon: '12 months',
		status: 'review'
	},
	{
		id: 'idea-3',
		asset: 'Energy Transition Pair',
		theme: 'Hedge commodity spikes with growth upside',
		confidence: 77,
		allocation: '8%',
		horizon: '9 months',
		status: 'simulating'
	}
];

const workflows = [
	{
		id: 'wf-1',
		name: 'Weekly Idea Engine',
		trigger: 'Every Monday at 07:00',
		nextRun: 'Mon 07:00',
		owner: 'Agent Stack',
		mode: 'agentic',
		progress: 68
	},
	{
		id: 'wf-2',
		name: 'Capital Allocation Review',
		trigger: 'Drawdown > 3%',
		nextRun: 'Event driven',
		owner: 'CFO + Agent',
		mode: 'hybrid',
		progress: 43
	},
	{
		id: 'wf-3',
		name: 'Profit Lock Rotation',
		trigger: 'Take-profit threshold reached',
		nextRun: 'Live monitor',
		owner: 'Execution Agent',
		mode: 'agentic',
		progress: 91
	}
];

const tasks = [
	{
		id: 'task-1',
		title: 'Validate top 3 AI basket entries against liquidity floor',
		assignee: 'Capital Agent',
		due: 'Today 16:30',
		status: 'in-progress'
	},
	{
		id: 'task-2',
		title: 'Approve treasury ladder rebalance',
		assignee: 'Finance Lead',
		due: 'Today 18:00',
		status: 'awaiting-review'
	},
	{
		id: 'task-3',
		title: 'Publish strategy memo to investor room',
		assignee: 'Ops Team',
		due: 'Tomorrow 09:00',
		status: 'queued'
	}
];

const guardrails = [
	{ id: 'gr-1', label: 'Max Single-Asset Exposure', value: 17, limit: 20 },
	{ id: 'gr-2', label: 'Cash Reserve Floor', value: 26, limit: 18 },
	{ id: 'gr-3', label: 'Monthly Risk Budget', value: 62, limit: 75 }
];

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
			headline: 'Capital automation for bold operators',
			subheadline: 'Turn market signals into action-ready investment workflows.'
		});
	}

	if (req.method === 'GET' && url.pathname === '/api/ideas') {
		return sendJson(res, 200, { items: ideas });
	}

	if (req.method === 'GET' && url.pathname === '/api/workflows') {
		return sendJson(res, 200, { items: workflows });
	}

	if (req.method === 'GET' && url.pathname === '/api/tasks') {
		return sendJson(res, 200, { items: tasks });
	}

	if (req.method === 'GET' && url.pathname === '/api/guardrails') {
		return sendJson(res, 200, { items: guardrails });
	}

	return sendJson(res, 404, {
		error: 'Not found',
		availableRoutes: [
			'/health',
			'/api/splash',
			'/api/ideas',
			'/api/workflows',
			'/api/tasks',
			'/api/guardrails'
		]
	});
});

server.listen(PORT, () => {
	console.log(`[CRE8 Capital API] listening on http://localhost:${PORT}`);
});
