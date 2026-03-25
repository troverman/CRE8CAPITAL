// Pipeline: routes { connection, data } through connection.protocol → store
class Pipeline {
	constructor(store = null) {
		this._store = store || ((result) => {
			const preview = JSON.stringify(result).slice(0, 120);
			console.log(`[Pipeline] ${result.connection?.string || '?'} →`, preview);
		});
		this._count = 0;
	}

	async run({ connection, data }) {
		try {
			const result = await connection.protocol(data);
			this._count++;
			await this._store({ ...result, connection });
		} catch (e) {
			console.error(`[Pipeline] error in ${connection?.string}`, e.message);
		}
	}

	get count() { return this._count; }
}

module.exports = Pipeline;
