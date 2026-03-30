const Provider = require('./Provider');
const CCXTProvider = require('./CCXTProvider');
const BinanceProvider = require('./BinanceProvider');
const StooqProvider = require('./StooqProvider');
const SyntheticProvider = require('./SyntheticProvider');

const parseBoolean = (value, fallback) => {
	if (value === undefined || value === null || value === '') {
		return fallback;
	}
	return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const createProviders = (config = {}) => {
	const providers = [];
	const useSynthetic = config.useSynthetic !== false;
	const enableStooq = config.enableStooq !== undefined
		? Boolean(config.enableStooq)
		: parseBoolean(process.env.CAPITAL_ENABLE_STOOQ, true);
	const enableCCXT = config.enableCCXT !== undefined
		? Boolean(config.enableCCXT)
		: parseBoolean(process.env.CAPITAL_ENABLE_CCXT, false);
	const enableBinanceWs = config.enableBinanceWs !== undefined
		? Boolean(config.enableBinanceWs)
		: parseBoolean(process.env.CAPITAL_ENABLE_BINANCE_WS, false);

	if (useSynthetic) {
		providers.push(
			new SyntheticProvider({
				id: 'synthetic.crypto',
				name: 'Synthetic Crypto',
				assetClass: 'crypto',
				venue: 'SIM-CRYPTO',
				symbols: ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'],
				startingPrices: {
					'BTC-USDT': 68250,
					'ETH-USDT': 3510,
					'SOL-USDT': 168
				},
				intervalMs: 2500,
				volatility: 0.01
			}),
			new SyntheticProvider({
				id: 'synthetic.equity',
				name: 'Synthetic Equities',
				assetClass: 'equity',
				venue: 'SIM-EQ',
				symbols: ['AAPL.US', 'MSFT.US', 'NVDA.US', 'SPY.US'],
				startingPrices: {
					'AAPL.US': 210,
					'MSFT.US': 430,
					'NVDA.US': 975,
					'SPY.US': 530
				},
				intervalMs: 3000,
				volatility: 0.004
			})
		);
	}

	if (enableStooq) {
		providers.push(new StooqProvider({
			id: 'stooq.equities',
			name: 'Stooq Equities',
			symbols: ['aapl.us', 'msft.us', 'nvda.us', 'spy.us'],
			intervalMs: 45000
		}));
	}

	if (enableCCXT) {
		providers.push(new CCXTProvider({
			exchangeId: process.env.CAPITAL_CCXT_EXCHANGE || 'binanceus',
			symbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
			intervalMs: Number(process.env.CAPITAL_CCXT_INTERVAL_MS || 15000)
		}));
	}

	if (enableBinanceWs) {
		providers.push(new BinanceProvider({
			symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
		}));
	}

	return providers;
};

module.exports = {
	Provider,
	CCXTProvider,
	BinanceProvider,
	StooqProvider,
	SyntheticProvider,
	createProviders
};
