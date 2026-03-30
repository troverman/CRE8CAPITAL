const EventEmitter = require('node:events');

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
