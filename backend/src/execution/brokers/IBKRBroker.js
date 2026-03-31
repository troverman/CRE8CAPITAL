/**
 * Interactive Brokers via Client Portal API.
 * Docs: https://interactivebrokers.github.io/cpwebapi/
 */

class IBKRBroker {
	async placeOrder() {
		throw new Error('IBKR broker not yet implemented');
	}

	async getPositions() {
		throw new Error('Not implemented');
	}

	async getAccount() {
		throw new Error('Not implemented');
	}
}

module.exports = IBKRBroker;
