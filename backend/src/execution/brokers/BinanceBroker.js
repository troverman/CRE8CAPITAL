/**
 * Binance spot order execution via REST API.
 * Uses: POST https://api.binance.com/api/v3/order
 * Auth: HMAC-SHA256 signature
 * Requires: BINANCE_API_KEY, BINANCE_SECRET_KEY
 */

class BinanceBroker {
	constructor(apiKey, secretKey) {
		this.apiKey = apiKey;
		this.secretKey = secretKey;
		this.baseUrl = 'https://api.binance.com';
	}

	async placeOrder(symbol, side, quantity, type = 'MARKET') {
		// TODO: implement real Binance order placement
		// 1. Build query string with symbol, side, type, quantity, timestamp
		// 2. Sign with HMAC-SHA256 using secretKey
		// 3. POST to /api/v3/order with X-MBX-APIKEY header
		throw new Error('Binance broker not yet implemented -- use paper mode');
	}

	async getBalance() {
		// TODO: GET /api/v3/account
		throw new Error('Not implemented');
	}

	async getOpenOrders(symbol) {
		// TODO: GET /api/v3/openOrders
		throw new Error('Not implemented');
	}
}

module.exports = BinanceBroker;
