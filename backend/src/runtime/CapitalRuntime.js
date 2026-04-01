const ControllerInterface = require('../controller/ControllerInterface');
const MultiMarketStore = require('../market/MultiMarketStore');
const SignalEngine = require('../signal/SignalEngine');
const StrategyEngine = require('../strategy/StrategyEngine');
const ExecutionEngine = require('../execution/ExecutionEngine');
const { createProviders } = require('../provider');
const alertEngine = require('../shared/alertEngine');
const log = require('../shared/logger');
const persistence = require('../shared/persistence');

class CapitalRuntime {
	constructor({
		providers,
		maxFeed = 2000,
		tickRate = Number(process.env.CAPITAL_TICK_RATE_MS || 500),
		autoRestrategyCooldownMs = Number(process.env.CAPITAL_AUTO_RESTRATEGY_COOLDOWN_MS || 30000),
		maxQueueDepth = Number(process.env.CAPITAL_MAX_QUEUE_DEPTH || 1800)
	} = {}) {
		this.marketStore = new MultiMarketStore();
		this.signalEngine = new SignalEngine();
		this.strategyEngine = new StrategyEngine();
		this.executionEngine = new ExecutionEngine({
			mode: process.env.CAPITAL_EXECUTION_MODE || 'paper',
			persistence,
			marketStore: this.marketStore,
			maxPositionSize: Number(process.env.CAPITAL_MAX_POSITION_SIZE || 0.1),
			defaultFeeRate: Number(process.env.CAPITAL_FEE_RATE || 0.001),
			slippageBps: Number(process.env.CAPITAL_SLIPPAGE_BPS || 5)
		});
		this.providers = Array.isArray(providers) ? providers : createProviders();
		this.controller = ControllerInterface({
			tickRate,
			scheduleTicks: false
		});
		this.maxFeed = maxFeed;
		this.maxQueueDepth = maxQueueDepth;
		this.autoRestrategyCooldownMs = autoRestrategyCooldownMs;
		this.feed = [];
		this.providerListeners = new Map();
		this.running = false;
		this.startedAt = null;
		this.lastAutoRestrategySignalAt = null;
		this._tickCountBySymbol = new Map();
		this._reconnectTimers = new Map();

		this.telemetry = {
			ticksReceived: 0,
			ticksProcessed: 0,
			signalsGenerated: 0,
			decisionsGenerated: 0,
			restrategyCount: 0,
			actionsDropped: 0,
			lastTickAt: null,
			lastSignalAt: null,
			lastDecisionAt: null,
			lastRestrategyAt: null
		};

		this._registerTriggers();
	}

	_registerTriggers() {
		this.controller.registerTrigger({
			string: 'restrategy',
			fireOnTick: false,
			protocol: async ({ controller, data }) => {
				controller.addToQueue(this._buildRestrategyAction(data || {}));
			}
		});

		this.controller.registerTrigger({
			string: 'restrategy.auto',
			fireOnTick: true,
			priority: 40,
			listener: async () => {
				if (!this.lastAutoRestrategySignalAt) {
					return false;
				}
				const now = Date.now();
				if (now - this.lastAutoRestrategySignalAt > 8000) {
					return false;
				}
				if (this.telemetry.lastRestrategyAt && now - this.telemetry.lastRestrategyAt < this.autoRestrategyCooldownMs) {
					return false;
				}
				return true;
			},
			protocol: async ({ controller }) => {
				controller.addToQueue(this._buildRestrategyAction({
					reason: 'auto-restrategy-high-signal',
					source: 'controller-auto',
					requestedAt: Date.now()
				}));
			}
		});
	}

	_pushFeed(type, payload) {
		const item = {
			id: `feed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			type,
			timestamp: Date.now(),
			payload
		};
		this.feed.push(item);
		if (this.feed.length > this.maxFeed) {
			this.feed = this.feed.slice(this.feed.length - this.maxFeed);
		}
	}

	_buildTickAction(tick) {
		return {
			string: `tick.${tick.providerId}.${tick.symbol}.${tick.timestamp || Date.now()}`,
			priority: 5,
			parameters: { tick },
			action: [
				{
					string: 'market.ingest',
					protocol: async ({ graphData }) => {
						const ingested = this.marketStore.ingestTick(graphData.tick);
						if (!ingested) {
							return { tick: graphData.tick, market: null };
						}
						this.telemetry.ticksProcessed += 1;
						this.telemetry.lastTickAt = ingested.tick.timestamp;
						this._pushFeed('tick', ingested.tick);

						// Persist every 10th tick per symbol
						const sym = ingested.tick.symbol;
						const count = (this._tickCountBySymbol.get(sym) || 0) + 1;
						this._tickCountBySymbol.set(sym, count);
						if (count % 10 === 0) {
							try {
								persistence.saveTick({
									symbol: ingested.tick.symbol,
									bid: ingested.tick.bid,
									ask: ingested.tick.ask,
									price: ingested.tick.price,
									volume: ingested.tick.volume,
									provider: ingested.tick.providerId,
									venue: ingested.tick.venue,
									timestamp: ingested.tick.timestamp
								});
							} catch (_) { /* non-critical */ }
						}

						return ingested;
					}
				},
				{
					string: 'signal.evaluate',
					parameters: { input: { 'market.ingest': true } },
					protocol: async ({ dependencies }) => {
						const ingestResult = dependencies['market.ingest'];
						if (!ingestResult || !ingestResult.tick) {
							return { signals: [] };
						}
						const signals = this.signalEngine.evaluateTick(ingestResult.tick, this.marketStore);
						if (signals.length > 0) {
							this.telemetry.signalsGenerated += signals.length;
							this.telemetry.lastSignalAt = signals[0].timestamp;
							signals.forEach((signal) => {
								this._pushFeed('signal', signal);
								try { persistence.saveSignal(signal); } catch (_) { /* non-critical */ }
							});
							const highSignal = signals.find((signal) => signal.severity === 'high');
							if (highSignal) {
								this.lastAutoRestrategySignalAt = highSignal.timestamp;
								alertEngine.fire(
									'signal.high', 'warning',
									`High severity signal: ${highSignal.type} ${highSignal.symbol}`,
									highSignal.message || `${highSignal.type} ${highSignal.direction} on ${highSignal.symbol}`,
									{ signalId: highSignal.id, symbol: highSignal.symbol, type: highSignal.type, direction: highSignal.direction, score: highSignal.score }
								);
							}
						}
						return { signals };
					}
				},
				{
					string: 'strategy.evaluate',
					parameters: { input: { 'signal.evaluate': true } },
					protocol: async ({ dependencies }) => {
						const signalResult = dependencies['signal.evaluate'] || { signals: [] };
						const decisions = this.strategyEngine.evaluateSignals(signalResult.signals || [], {
							trigger: 'signal'
						});
						if (decisions.length > 0) {
							this.telemetry.decisionsGenerated += decisions.length;
							this.telemetry.lastDecisionAt = decisions[0].timestamp;
							decisions.forEach((decision) => {
								this._pushFeed('strategy-decision', decision);
								try {
									persistence.saveDecision({
										id: decision.id,
										strategyId: decision.strategyId,
										signal: { id: decision.signalId, symbol: decision.symbol },
										action: decision.action,
										intent: decision.intent,
										reason: decision.reason,
										timestamp: decision.timestamp
									});
								} catch (_) { /* non-critical */ }
							});
						}
						return { decisions };
					}
				},
				{
					string: 'execution.run',
					parameters: { input: { 'strategy.evaluate': true } },
					protocol: async ({ dependencies }) => {
						const strategyResult = dependencies['strategy.evaluate'] || { decisions: [] };
						const trades = [];
						for (const decision of strategyResult.decisions || []) {
							try {
								const trade = await this.executionEngine.execute(decision);
								if (trade) {
									trades.push(trade);
									this._pushFeed('trade', trade);
								}
							} catch (err) {
								log.warn('Execution', `execution error for decision ${decision.id}: ${err.message}`);
							}
						}

						// Check stop-loss / take-profit on every tick
						try {
							const stopActions = this.executionEngine.checkStopsTakeProfits();
							for (const action of stopActions) {
								const stopDecision = {
									id: `risk_${action.action}_${action.symbol}_${Date.now()}`,
									strategyId: 'risk-manager',
									symbol: action.symbol,
									action: 'sell',
									intent: action.action,
									reason: action.reason,
									assetClass: 'crypto',
									timestamp: Date.now()
								};
								try {
									const trade = await this.executionEngine.execute(stopDecision);
									if (trade) {
										trades.push(trade);
										this._pushFeed('trade', trade);
										this._pushFeed('risk-action', { ...action, tradeId: trade.id });
										log.info('RiskManager', `${action.action} executed for ${action.symbol}: ${action.reason}`);
										// Fire alert on stop loss / take profit
										alertEngine.fire(
											action.action === 'stop_loss' ? 'risk.stop_loss' : 'risk.take_profit',
											action.action === 'stop_loss' ? 'warning' : 'info',
											`${action.action === 'stop_loss' ? 'Stop Loss' : 'Take Profit'}: ${action.symbol}`,
											action.reason,
											{ symbol: action.symbol, action: action.action, pnlPct: action.pnlPct, tradeId: trade.id }
										);
									}
								} catch (err) {
									log.warn('RiskManager', `failed to execute ${action.action} for ${action.symbol}: ${err.message}`);
								}
							}
						} catch (_) { /* risk check non-critical */ }

						return { trades };
					}
				}
			]
		};
	}

	_buildRestrategyAction(payload) {
		const safePayload = {
			reason: payload.reason || 'manual-restrategy',
			source: payload.source || 'runtime',
			requestedAt: payload.requestedAt || Date.now()
		};
		return {
			string: `restrategy.${safePayload.source}.${safePayload.requestedAt}`,
			priority: 50,
			parameters: safePayload,
			protocol: async ({ params }) => {
				const decisions = this.strategyEngine.restrategy({
					reason: params.reason,
					source: params.source,
					signals: this.signalEngine.getLatestSignals(80)
				});
				this.telemetry.restrategyCount += 1;
				this.telemetry.lastRestrategyAt = Date.now();
				alertEngine.fire(
					'strategy.restrategy', 'info',
					`Restrategy triggered (${params.source})`,
					`Reason: ${params.reason}. Generated ${decisions.length} decisions.`,
					{ reason: params.reason, source: params.source, decisionCount: decisions.length }
				);
				if (decisions.length > 0) {
					this.telemetry.decisionsGenerated += decisions.length;
					this.telemetry.lastDecisionAt = decisions[0].timestamp;
					decisions.forEach((decision) => {
						this._pushFeed('restrategy-decision', decision);
						try {
							persistence.saveDecision({
								id: decision.id,
								strategyId: decision.strategyId,
								signal: { id: decision.signalId, symbol: decision.symbol },
								action: decision.action,
								intent: decision.intent,
								reason: decision.reason,
								timestamp: decision.timestamp
							});
						} catch (_) { /* non-critical */ }
					});
				}
				// Execute decisions through the execution engine
				const trades = [];
				for (const decision of decisions) {
					try {
						const trade = await this.executionEngine.execute(decision);
						if (trade) {
							trades.push(trade);
							this._pushFeed('trade', trade);
						}
					} catch (err) {
						log.warn('Execution', `restrategy execution error for ${decision.id}: ${err.message}`);
					}
				}
				return {
					reason: params.reason,
					source: params.source,
					decisionCount: decisions.length,
					decisions,
					trades
				};
			}
		};
	}

	_attachProvider(provider) {
		const onTick = (tick) => {
			this.telemetry.ticksReceived += 1;
			if (!this.running) {
				return;
			}

			if (this.controller.state.queue.length >= this.maxQueueDepth) {
				const removeCount = Math.max(1, this.controller.state.queue.length - this.maxQueueDepth + 1);
				this.controller.state.queue.splice(0, removeCount);
				this.telemetry.actionsDropped += removeCount;
				this._pushFeed('runtime-warning', {
					message: 'Queue depth exceeded max threshold. Dropped oldest actions.',
					removeCount,
					maxQueueDepth: this.maxQueueDepth
				});
			}

			this.controller.addToQueue(this._buildTickAction(tick));
		};

		const onStatus = (status) => {
			this._pushFeed('provider-status', status);
			// Auto-reconnect on disconnect
			if (!status.connected && this.running && status.lastError) {
				this._scheduleReconnect(provider);
			}
		};

		provider.on('tick', onTick);
		provider.on('status', onStatus);
		this.providerListeners.set(provider.id, { onTick, onStatus });
	}

	_scheduleReconnect(provider, delayMs = 5000) {
		if (this._reconnectTimers.has(provider.id)) {
			return;
		}
		log.warn('Runtime', `scheduling reconnect for ${provider.id} in ${delayMs}ms`);
		const timer = setTimeout(async () => {
			this._reconnectTimers.delete(provider.id);
			if (!this.running) return;
			try {
				await provider.connect();
				log.info('Runtime', `reconnected provider ${provider.id}`);
			} catch (error) {
				log.error('Runtime', `reconnect failed for ${provider.id}`, error.message);
				this._pushFeed('provider-error', { providerId: provider.id, message: error.message });
				this._scheduleReconnect(provider, Math.min(delayMs * 2, 60000));
			}
		}, delayMs);
		this._reconnectTimers.set(provider.id, timer);
	}

	_detachProvider(provider) {
		const listeners = this.providerListeners.get(provider.id);
		if (!listeners) {
			return;
		}
		if (typeof provider.off === 'function') {
			provider.off('tick', listeners.onTick);
			provider.off('status', listeners.onStatus);
		} else if (typeof provider.removeListener === 'function') {
			provider.removeListener('tick', listeners.onTick);
			provider.removeListener('status', listeners.onStatus);
		}
		this.providerListeners.delete(provider.id);
	}

	async start() {
		if (this.running) {
			return;
		}
		this.running = true;
		this.startedAt = Date.now();
		this.controller.start();
		log.info('Runtime', `starting with ${this.providers.length} providers`);
		this._pushFeed('runtime', { message: 'Capital runtime starting', providerCount: this.providers.length });

		for (const provider of this.providers) {
			this._attachProvider(provider);
			try {
				// eslint-disable-next-line no-await-in-loop
				await provider.connect();
				log.info('Runtime', `provider ${provider.id} connected`);
			} catch (error) {
				log.error('Runtime', `provider ${provider.id} failed to connect`, error.message);
				this._pushFeed('provider-error', {
					providerId: provider.id,
					message: error.message
				});
				this._scheduleReconnect(provider);
			}
		}
	}

	async stop() {
		if (!this.running) {
			return;
		}
		this.running = false;
		this.controller.stop();
		// Clear all pending reconnect timers
		for (const timer of this._reconnectTimers.values()) {
			clearTimeout(timer);
		}
		this._reconnectTimers.clear();
		for (const provider of this.providers) {
			this._detachProvider(provider);
			try {
				// eslint-disable-next-line no-await-in-loop
				await provider.disconnect();
			} catch (error) {
				this._pushFeed('provider-error', {
					providerId: provider.id,
					message: error.message
				});
			}
		}
		log.info('Runtime', 'stopped');
		this._pushFeed('runtime', { message: 'Capital runtime stopped' });
	}

	async triggerRestrategy({ reason, source } = {}) {
		const payload = {
			reason: reason || 'manual-restrategy',
			source: source || 'api',
			requestedAt: Date.now()
		};
		await this.controller.eventBus.publish('restrategy', payload);
		return {
			queued: true,
			request: payload
		};
	}

	getProviderStatuses() {
		return this.providers.map((provider) => {
			if (typeof provider.getStatus === 'function') {
				return provider.getStatus();
			}
			return {
				id: provider.id,
				name: provider.name || provider.id,
				assetClass: provider.assetClass || 'unknown',
				kind: provider.kind || 'unknown',
				connected: Boolean(provider.connected)
			};
		});
	}

	getControllerState() {
		const state = this.controller.getState();
		return {
			tick: state.tick,
			tickRate: state.tickRate,
			fps: state.fps,
			queueDepth: state.queue.length,
			triggers: Object.keys(state.trigger),
			processingTick: state.processingTick
		};
	}

	getSnapshot({
		marketLimit = 150,
		signalLimit = 120,
		decisionLimit = 120,
		feedLimit = 140
	} = {}) {
		const marketSummary = this.marketStore.getSummary();
		const signalSummary = this.signalEngine.getSummary();
		const strategySummary = this.strategyEngine.getSummary();
		const executionStats = this.executionEngine.getStats();
		const wallet = persistence.getWallet();

		return {
			running: this.running,
			startedAt: this.startedAt,
			now: Date.now(),
			telemetry: {
				...this.telemetry,
				uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
				execution: executionStats
			},
			controller: this.getControllerState(),
			providers: this.getProviderStatuses(),
			markets: this.marketStore.listMarkets({ limit: marketLimit }),
			marketSummary,
			signals: this.signalEngine.listSignals({ limit: signalLimit }),
			signalSummary,
			strategies: this.strategyEngine.getStrategies(),
			strategySummary,
			positions: this.strategyEngine.getPositions(),
			decisions: this.strategyEngine.listDecisions({ limit: decisionLimit }),
			wallet,
			execution: executionStats,
			feed: this.getFeed({ limit: feedLimit })
		};
	}

	getMarkets(options) {
		return this.marketStore.listMarkets(options || {});
	}

	getSignals(options) {
		return this.signalEngine.listSignals(options || {});
	}

	getStrategies() {
		return this.strategyEngine.getStrategies();
	}

	getDecisions(options) {
		return this.strategyEngine.listDecisions(options || {});
	}

	getFeed({ limit = 120 } = {}) {
		return this.feed.slice(-limit).reverse();
	}
}

module.exports = CapitalRuntime;
