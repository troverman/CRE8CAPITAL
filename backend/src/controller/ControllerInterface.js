const createEventBus = () => {
	const subscribers = {};

	return {
		subscribe: (eventName, callback) => {
			if (!subscribers[eventName]) {
				subscribers[eventName] = [];
			}
			subscribers[eventName].push(callback);
		},
		publish: async (eventName, data) => {
			const listeners = subscribers[eventName] || [];
			for (const callback of listeners) {
				// eslint-disable-next-line no-await-in-loop
				await callback(data);
			}
		}
	};
};

const ControllerInterface = (initState = {}) => {
	const Interface = {
		eventBus: createEventBus(),
		state: {
			tick: 0,
			tickRate: 500,
			fps: 0,
			scheduleTicks: false,
			queue: [],
			trigger: {},
			budget: {},
			processingTick: false,
			lastTime: Date.now(),
			nextTickTimeoutId: null,
			periodicEventIntervalId: null,
			...initState
		},

		addToQueue: (action) => {
			const queuedAction = { ...action };
			if (!queuedAction.string) {
				queuedAction.string = `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			}
			queuedAction.status = {
				state: 'pending',
				result: Array.isArray(queuedAction.action) ? {} : undefined,
				startTime: null,
				endTime: null
			};
			Interface.state.queue.push(queuedAction);
			if (Interface.state.scheduleTicks) {
				Interface.scheduleNextTick();
			}
			return queuedAction;
		},

		registerTrigger: (trigger) => {
			Interface.state.trigger[trigger.string] = trigger;
			Interface.eventBus.subscribe(trigger.string, async (data) => {
				try {
					if (!trigger.listener || await trigger.listener({ controller: Interface, data })) {
						await trigger.protocol({ controller: Interface, data });
						if (Interface.state.scheduleTicks) {
							Interface.scheduleNextTick();
						}
					}
				} catch (error) {
					console.error(`[Controller] event trigger \"${trigger.string}\" failed:`, error.message);
				}
			});
		},

		processGraph: async ({ nodes, parameters, parentActionStatus }) => {
			const statusMap = parentActionStatus.result || {};
			parentActionStatus.result = statusMap;

			nodes.forEach((node) => {
				if (!node.string) {
					node.string = `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
				}
				if (!statusMap[node.string]) {
					statusMap[node.string] = {
						state: 'pending',
						result: null,
						startTime: null,
						endTime: null
					};
				}
			});

			const allNodeStrings = new Set(nodes.map((node) => node.string));
			let queue = nodes.filter((node) => statusMap[node.string].state === 'pending');
			let iteration = 0;
			const maxIterations = nodes.length * nodes.length + nodes.length + 1;

			while (queue.length > 0 && iteration++ <= maxIterations) {
				const runnable = [];
				const waiting = [];

				for (const node of queue) {
					if (statusMap[node.string].state !== 'pending') {
						continue;
					}
					const dependencies = Object.keys(node.parameters?.input || {});
					const ready = dependencies.every((dependencyName) => {
						if (!allNodeStrings.has(dependencyName)) {
							return false;
						}
						return statusMap[dependencyName]?.state === 'completed';
					});

					if (ready) {
						runnable.push(node);
					} else {
						waiting.push(node);
					}
				}

				if (runnable.length === 0) {
					waiting.forEach((node) => {
						if (statusMap[node.string].state === 'pending') {
							statusMap[node.string].state = 'failed';
							statusMap[node.string].error = { message: 'Graph stalled. Dependencies were not met.' };
							statusMap[node.string].endTime = Date.now();
						}
					});
					throw new Error('Graph stalled');
				}

				await Promise.all(runnable.map(async (node) => {
					const nodeStatus = statusMap[node.string];
					nodeStatus.state = 'running';
					nodeStatus.startTime = Date.now();

					try {
						const dependencies = {};
						for (const dependencyName of Object.keys(node.parameters?.input || {})) {
							dependencies[dependencyName] = statusMap[dependencyName].result;
						}

						const payload = {
							params: node.parameters || {},
							dependencies,
							graphData: parameters,
							controller: Interface
						};

						if (Array.isArray(node.action)) {
							nodeStatus.result = await Interface.processGraph({
								nodes: node.action,
								parameters: payload,
								parentActionStatus: nodeStatus
							});
						} else if (typeof node.protocol === 'function') {
							nodeStatus.result = await node.protocol(payload);
						} else {
							throw new Error(`Invalid node protocol for ${node.string}`);
						}

						nodeStatus.state = 'completed';
					} catch (error) {
						nodeStatus.state = 'failed';
						nodeStatus.error = { message: error.message };
						const enrichedError = new Error(`Graph node ${node.string}: ${error.message}`);
						enrichedError.nodeString = node.string;
						throw enrichedError;
					} finally {
						nodeStatus.endTime = Date.now();
					}
				}));

				queue = waiting.filter((node) => statusMap[node.string].state === 'pending');
			}

			return statusMap;
		},

		tick: async (data = {}) => {
			if (Interface.state.processingTick) {
				return;
			}
			Interface.state.processingTick = true;

			try {
				const now = Date.now();
				Interface.state.tick += 1;
				Interface.state.fps = Math.round(1000 / Math.max(1, now - Interface.state.lastTime));
				Interface.state.lastTime = now;

				for (const [triggerName, trigger] of Object.entries(Interface.state.trigger)) {
					if (trigger.fireOnTick === false) {
						continue;
					}
					try {
						// eslint-disable-next-line no-await-in-loop
						const shouldRun = !trigger.listener || await trigger.listener({ controller: Interface, data });
						if (shouldRun) {
							Interface.addToQueue({
								string: trigger.string,
								priority: trigger.priority || 0,
								parameters: data,
								protocol: trigger.protocol,
								action: trigger.action
							});
						}
					} catch (error) {
						console.error(`[Controller] tick trigger \"${triggerName}\" failed:`, error.message);
					}
				}

				const dueActions = Interface.state.queue
					.filter((action) => action.status?.state === 'pending' && (!action.date || action.date <= now))
					.sort((a, b) => (a.date || 0) - (b.date || 0) || (b.priority || 0) - (a.priority || 0));

				for (const action of dueActions) {
					const actionBudget = Interface.state.budget[action.string];
					if (actionBudget !== undefined) {
						if (actionBudget <= 0) {
							continue;
						}
						Interface.state.budget[action.string] = actionBudget - 1;
					}

					action.status.state = 'running';
					action.status.startTime = Date.now();
					action.status.endTime = null;

					try {
						if (Array.isArray(action.action)) {
							action.status.result = await Interface.processGraph({
								nodes: action.action,
								parameters: action.parameters || {},
								parentActionStatus: action.status
							});
						} else if (typeof action.protocol === 'function') {
							action.status.result = await action.protocol({
								params: action.parameters || {},
								controller: Interface
							});
						} else {
							throw new Error(`Invalid action type for ${action.string}`);
						}
						action.status.state = 'completed';
					} catch (error) {
						action.status.state = 'failed';
						action.status.error = {
							message: error.message,
							nodeString: error.nodeString
						};
					} finally {
						action.status.endTime = Date.now();
					}
				}

				Interface.state.queue = Interface.state.queue.filter((action) => action.status?.state === 'pending');

				if (Interface.state.scheduleTicks) {
					Interface.scheduleNextTick();
				}
			} finally {
				Interface.state.processingTick = false;
			}
		},

		scheduleNextTick: () => {
			if (Interface.state.nextTickTimeoutId) {
				clearTimeout(Interface.state.nextTickTimeoutId);
				Interface.state.nextTickTimeoutId = null;
			}
			const now = Date.now();
			const nextAction = Interface.state.queue
				.filter((action) => action.date && action.date > now)
				.sort((a, b) => a.date - b.date)[0];
			const delay = nextAction ? Math.max(10, nextAction.date - now) : 1000;
			Interface.state.nextTickTimeoutId = setTimeout(async () => {
				await Interface.tick();
			}, delay);
		},

		start: () => {
			if (Interface.state.periodicEventIntervalId) {
				return;
			}
			if (Interface.state.scheduleTicks) {
				Interface.scheduleNextTick();
			}
			Interface.state.periodicEventIntervalId = setInterval(async () => {
				if (!Interface.state.scheduleTicks) {
					await Interface.tick({});
				}
				await Interface.eventBus.publish('timeTick', { controller: Interface });
			}, Interface.state.tickRate);
		},

		stop: () => {
			if (Interface.state.nextTickTimeoutId) {
				clearTimeout(Interface.state.nextTickTimeoutId);
				Interface.state.nextTickTimeoutId = null;
			}
			if (Interface.state.periodicEventIntervalId) {
				clearInterval(Interface.state.periodicEventIntervalId);
				Interface.state.periodicEventIntervalId = null;
			}
		},

		getState: () => ({ ...Interface.state })
	};

	return Interface;
};

module.exports = ControllerInterface;
