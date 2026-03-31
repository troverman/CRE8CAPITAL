const { createCapitalRuntime } = require('./runtime');
const log = require('./shared/logger');

const runtime = createCapitalRuntime();

let heartbeatIntervalId = null;

const start = async () => {
	await runtime.start();
	log.info('Init', 'runtime started');

	heartbeatIntervalId = setInterval(() => {
		const snapshot = runtime.getSnapshot({
			marketLimit: 1,
			signalLimit: 1,
			decisionLimit: 1,
			feedLimit: 1
		});
		log.debug('Init', 'heartbeat', {
			ticksProcessed: snapshot.telemetry.ticksProcessed,
			signalsGenerated: snapshot.telemetry.signalsGenerated,
			decisionsGenerated: snapshot.telemetry.decisionsGenerated,
			queueDepth: snapshot.controller.queueDepth,
			providersConnected: snapshot.providers.filter((provider) => provider.connected).length
		});
	}, 30000);
};

let shuttingDown = false;
const shutdown = async () => {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	if (heartbeatIntervalId) {
		clearInterval(heartbeatIntervalId);
		heartbeatIntervalId = null;
	}
	await runtime.stop();
	log.info('Init', 'runtime stopped');
};

start().catch((error) => {
	log.error('Init', 'fatal runtime error', error.message);
	process.exit(1);
});

process.on('SIGINT', () => {
	shutdown()
		.then(() => process.exit(0))
		.catch((error) => {
			log.error('Init', 'shutdown failed', error.message);
			process.exit(1);
		});
});

process.on('SIGTERM', () => {
	shutdown()
		.then(() => process.exit(0))
		.catch((error) => {
			log.error('Init', 'shutdown failed', error.message);
			process.exit(1);
		});
});
