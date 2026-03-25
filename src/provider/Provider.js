// Base provider — manages lifecycle of a data source
class Provider {
	constructor({ id }) {
		this.id = id;
		this._handlers = {};
		this._connected = false;
	}

	on(event, handler) {
		if (!this._handlers[event]) this._handlers[event] = [];
		this._handlers[event].push(handler);
		return this;
	}

	emit(event, data) {
		for (const h of this._handlers[event] || []) h(data);
	}

	async connect() {
		throw new Error(`${this.id}: connect() not implemented`);
	}

	async disconnect() {
		this._connected = false;
	}
}

module.exports = Provider;
