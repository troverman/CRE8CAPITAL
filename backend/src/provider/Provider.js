const EventEmitter = require('node:events');
const log = require('../shared/logger');

class Provider extends EventEmitter {
	constructor({
		id,
		name,
		assetClass,
		kind = 'external'
	}) {
		super();
		this.id = id;
		this.name = name || id;
		this.assetClass = assetClass || 'unknown';
		this.kind = kind;
		this.connected = false;
		this.lastHeartbeat = null;
		this.lastError = null;
	}

	emitTick(tick) {
		const normalized = {
			providerId: this.id,
			providerName: this.name,
			assetClass: this.assetClass,
			kind: this.kind,
			symbol: tick.symbol || null,
			bid: Number.isFinite(tick.bid) ? tick.bid : null,
			ask: Number.isFinite(tick.ask) ? tick.ask : null,
			price: Number.isFinite(tick.price) ? tick.price : null,
			volume: Number.isFinite(tick.volume) ? tick.volume : null,
			timestamp: tick.timestamp || Date.now(),
			provider: this.id,
			venue: tick.venue || 'UNKNOWN',
			...tick
		};
		this.lastHeartbeat = Date.now();
		this.emit('tick', normalized);
	}

	setConnected(value) {
		this.connected = Boolean(value);
		this.emit('status', this.getStatus());
	}

	setError(error) {
		this.lastError = error ? String(error.message || error) : null;
		if (error) {
			log.error('Provider', `${this.id}: ${this.lastError}`);
		}
		this.emit('status', this.getStatus());
	}

	getStatus() {
		return {
			id: this.id,
			name: this.name,
			assetClass: this.assetClass,
			kind: this.kind,
			connected: this.connected,
			lastHeartbeat: this.lastHeartbeat,
			lastError: this.lastError
		};
	}

	async connect() {
		throw new Error(`${this.id}: connect() not implemented`);
	}

	async disconnect() {
		this.setConnected(false);
	}
}

module.exports = Provider;
