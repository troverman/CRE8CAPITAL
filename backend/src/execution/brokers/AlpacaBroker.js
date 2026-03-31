/**
 * Alpaca Markets API (paper + live).
 * POST https://paper-api.alpaca.markets/v2/orders (paper)
 * POST https://api.alpaca.markets/v2/orders (live)
 */

class AlpacaBroker {
	constructor(apiKey, secretKey, paper = true) {
		this.baseUrl = paper
			? 'https://paper-api.alpaca.markets'
			: 'https://api.alpaca.markets';
		this.apiKey = apiKey;
		this.secretKey = secretKey;
	}

	async placeOrder(symbol, side, quantity, type = 'market') {
		const res = await fetch(`${this.baseUrl}/v2/orders`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'APCA-API-KEY-ID': this.apiKey,
				'APCA-API-SECRET-KEY': this.secretKey
			},
			body: JSON.stringify({
				symbol,
				side,
				qty: String(quantity),
				type,
				time_in_force: 'day'
			})
		});
		const data = await res.json();
		if (data.code) throw new Error(data.message || 'Alpaca error');
		return {
			id: data.id,
			status: data.status,
			filledQty: parseFloat(data.filled_qty),
			filledPrice: parseFloat(data.filled_avg_price)
		};
	}

	async getPositions() {
		const res = await fetch(`${this.baseUrl}/v2/positions`, {
			headers: {
				'APCA-API-KEY-ID': this.apiKey,
				'APCA-API-SECRET-KEY': this.secretKey
			}
		});
		return res.json();
	}

	async getAccount() {
		const res = await fetch(`${this.baseUrl}/v2/account`, {
			headers: {
				'APCA-API-KEY-ID': this.apiKey,
				'APCA-API-SECRET-KEY': this.secretKey
			}
		});
		return res.json();
	}
}

module.exports = AlpacaBroker;
