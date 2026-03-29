const { CCXTProvider, BinanceProvider } = require('./provider');
const Pipeline = require('./pipeline/Pipeline');
const Exchange    = require('./connection/Exchange');
const Market      = require('./connection/Market');
const Position    = require('./connection/Position');
const Transaction = require('./connection/Transaction');

const Init = async () => {
	console.log('[CAPITAL] init');

	const pipeline = new Pipeline();

	// --- CCXT REST polling ---
	const ccxt = new CCXTProvider({
		exchangeId:  'binanceus',
		marketLimit: 5,      // bump to 35 for stress test
		interval:    60000
	});

	ccxt.on('exchange', data => pipeline.run({ connection: Exchange,    data }));
	ccxt.on('market',   data => pipeline.run({ connection: Market,      data }));
	ccxt.on('position', data => pipeline.run({ connection: Position,    data }));
	ccxt.on('trade',    data => pipeline.run({ connection: Transaction, data }));

	await ccxt.connect();

	// --- Binance WebSocket ---
	const binance = new BinanceProvider({ symbols: ['BTCUSDT'] });

	binance.on('depth', ({ symbol, depth }) => {
		pipeline.run({ connection: Position, data: {
			string: `binance.ws.${symbol}`,
			symbol,
			bids: depth.bids,
			asks: depth.asks
		}});
	});

	await binance.connect();

	// heartbeat
	setInterval(() => {
		const mb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
		console.log(`[CAPITAL] events: ${pipeline.count}  heap: ${mb}MB`);
	}, 30000);
};

Init().catch(e => {
	console.error('[CAPITAL] fatal:', e.message);
	process.exit(1);
});
