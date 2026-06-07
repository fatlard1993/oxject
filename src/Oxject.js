import ErrorHandler from './ErrorHandler.js';
import CleanupManager from './CleanupManager.js';
import TrackingContext from './TrackingContext.js';
import { derive, isDerivedProxy } from './derive.js';
import { genId } from './utils.js';

const oxjectKeys = new Set([
	'target',
	'__isOxject',
	'isDestroyed',
	'addEventListener',
	'removeEventListener',
	'dispatchEvent',
	'subscriber',
	'subscribe',
	'unsubscribe',
	'notify',
	'destroy',
	'batch',
	'batchAsync',
	Symbol.dispose,
]);

// 'set' is dispatched as the generic "any property changed" event; cannot be a user property
const reservedEventNames = new Set(['set']);

/**
 * Reactive state container with proxy-based property access and automatic event emission.
 * Constructor returns proxy enabling direct property access alongside Oxject methods.
 * @augments EventTarget
 */
export default class Oxject extends EventTarget {
	__isOxject = true;

	#cleanup;
	#subscriptions;
	#notifyDepth = 0;
	#boundMethods = null;
	#batchPending = null;
	#batchOldValues = null;
	#batchFlushing = false;
	#postBatchCallbacks = null;

	static isOxject(thing) {
		return thing != null && typeof thing === 'object' && thing.__isOxject === true;
	}

	/**
	 * Creates reactive state container with proxy-based property access.
	 * @param {object} initialState - Plain object containing initial state properties
	 * @returns {Proxy} Proxy object enabling direct property access and Oxject method calls
	 * @throws {TypeError} When initialState is null, undefined, array, or non-object type
	 */
	constructor(initialState) {
		super();

		if (
			initialState === null ||
			initialState === undefined ||
			typeof initialState !== 'object' ||
			Array.isArray(initialState)
		) {
			let receivedType;
			if (initialState === null) receivedType = 'null';
			else if (Array.isArray(initialState)) receivedType = 'array';
			else receivedType = typeof initialState;

			ErrorHandler.handleValidationError(
				'Oxject requires a plain object as initial state',
				receivedType,
				'plain object',
			);
		}

		const reservedCollisions = Object.keys(initialState).filter(
			key => oxjectKeys.has(key) || reservedEventNames.has(key),
		);
		if (reservedCollisions.length > 0) {
			ErrorHandler.handleValidationError(
				`Oxject initial state contains reserved key(s): ${reservedCollisions.join(', ')}`,
				reservedCollisions.join(', '),
				'non-reserved property names',
			);
		}

		const context = this;
		this.#cleanup = new CleanupManager();
		this.#subscriptions = {};

		try {
			this.target = Object.fromEntries(
				Object.entries(initialState).map(([key, value]) => {
					if (isDerivedProxy(value)) {
						try {
							const { unsubscribe } = value.subscribe(_value => {
								if (!this.#cleanup.isDestroyed) {
									this.proxy[key] = _value;
								}
							});
							this.#cleanup.add(unsubscribe, `subscriber-${key}`);
							value = value.toJSON();
						} catch (error) {
							ErrorHandler.handleParserError(error, this, key, 'subscriber-initialization');
							value = null;
						}
					}

					return [key, value];
				}),
			);
		} catch (error) {
			ErrorHandler.handleInitializationError(error, initialState);
			throw error;
		}

		this.proxy = new Proxy(this.target, {
			get(target, key) {
				if (oxjectKeys.has(key)) {
					const value = context[key];
					if (typeof value === 'function') {
						if (!context.#boundMethods) context.#boundMethods = new Map();
						if (!context.#boundMethods.has(key)) {
							context.#boundMethods.set(key, value.bind(context));
						}
						return context.#boundMethods.get(key);
					}
					return value;
				}
				TrackingContext.current?.track(context, key);
				return Reflect.get(target, key);
			},
			set(target, key, value) {
				if (reservedEventNames.has(key)) {
					ErrorHandler.handleValidationError(
						`"${String(key)}" is a reserved event name and cannot be used as a property`,
						String(key),
						'a non-reserved property name',
					);
				}
				if (oxjectKeys.has(key)) {
					ErrorHandler.handleValidationError(
						`"${String(key)}" is a reserved Oxject key and cannot be assigned as a property`,
						String(key),
						'a non-reserved property name',
					);
				}
				if (Object.is(target[key], value)) return true;
				if (context.#batchPending !== null && !context.#batchOldValues.has(key)) {
					context.#batchOldValues.set(key, {
						existed: Object.prototype.hasOwnProperty.call(target, key),
						value: target[key],
					});
				}
				const result = Reflect.set(target, key, value);
				context.#onSet(key, value, result);
				return result;
			},
		});

		return this.proxy;
	}

	get isDestroyed() {
		return this.#cleanup.isDestroyed;
	}

	/**
	 * Internal batch coordination hook, not part of the public API.
	 * Read by DeriveSubscriber to decide whether to defer downstream notification.
	 * Not accessible through the proxy (not in oxjectKeys).
	 */
	get isBatchFlushing() {
		return this.#batchFlushing;
	}

	/**
	 * Internal batch coordination hook, not part of the public API.
	 * Called by DeriveSubscriber to defer its update until after the current flush completes.
	 * Returns true if deferred; false if no flush is in progress.
	 * Not accessible through the proxy (not in oxjectKeys).
	 */
	scheduleAfterFlush(callback) {
		if (!this.#batchFlushing) return false;
		this.#addPostBatchCallback(callback);
		return true;
	}

	addEventListener(type, listener, options) {
		if (this.isDestroyed) {
			ErrorHandler.handleWarning('Cannot add event listener to destroyed context');
			return;
		}

		const opts = typeof options === 'object' && options !== null ? options : {};
		if (ErrorHandler.isDevelopment && type !== 'set' && type in this.target && !opts.once && !opts.signal) {
			ErrorHandler.handleWarning(
				`oxject.addEventListener('${type}', ...): use oxject.subscribe({ key: '${type}', callback }) for managed cleanup that runs on oxject.destroy(). Use addEventListener only when you need { once }, { signal }, or direct EventTarget interop.`,
			);
		}

		super.addEventListener(type, listener, options);
	}

	/**
	 * Batch multiple property changes, coalescing all notifications until the callback completes.
	 * Prevents intermediate re-renders when setting several properties at once.
	 *
	 * If `fn` throws, all pending changes are discarded and no subscribers are notified.
	 * The error propagates to the caller; state is left unchanged.
	 *
	 * @param {Function} fn - Callback in which all property assignments are batched
	 */
	batch(fn) {
		if (this.isDestroyed) return;
		const alreadyBatching = !!this.#batchPending;
		if (!alreadyBatching) {
			this.#batchPending = new Map();
			this.#batchOldValues = new Map();
		}

		try {
			fn();
		} catch (error) {
			if (!alreadyBatching) {
				for (const [key, { existed, value: oldValue }] of this.#batchOldValues) {
					if (existed) {
						this.target[key] = oldValue;
					} else {
						delete this.target[key];
					}
				}
				this.#batchOldValues = null;
				this.#batchPending = null;
			}
			throw error;
		}

		if (!alreadyBatching) {
			this.#batchOldValues = null;
			const pending = this.#batchPending;
			this.#batchPending = null;
			this.#batchFlushing = true;

			try {
				for (const [key, value] of pending) {
					this.#onSet(key, value, true);
				}
			} finally {
				this.#batchFlushing = false;
				const callbacks = this.#postBatchCallbacks;
				if (callbacks) {
					this.#postBatchCallbacks = null;
					for (const cb of callbacks) {
						try {
							cb();
						} catch (error) {
							ErrorHandler.handleWarning(`Post-batch callback error: ${error.message}`);
						}
					}
				}
			}
		}
	}

	#addPostBatchCallback(cb) {
		if (!this.#postBatchCallbacks) this.#postBatchCallbacks = [];
		this.#postBatchCallbacks.push(cb);
	}

	/**
	 * Defer a batch to the next microtask. Returns a Promise that resolves when the batch
	 * completes, or rejects if fn throws (after state has been rolled back).
	 * No-op (resolves immediately) if the instance is already destroyed.
	 * @param {Function} fn - Callback in which all property assignments are batched
	 * @returns {Promise<void>}
	 */
	batchAsync(fn) {
		if (this.isDestroyed) return Promise.resolve();
		return new Promise((resolve, reject) => {
			queueMicrotask(() => {
				if (this.isDestroyed) {
					resolve();
					return;
				}
				try {
					this.batch(fn);
					resolve();
				} catch (error) {
					reject(error);
				}
			});
		});
	}

	#onSet(key, value, result) {
		if (!result) {
			ErrorHandler.handleSetError(key, value);
			return;
		}

		if (this.isDestroyed) {
			return;
		}

		if (this.#batchPending) {
			this.#batchPending.set(key, value);
			return;
		}

		this.#notifyDepth++;

		try {
			if (this.#notifyDepth > 50) {
				ErrorHandler.handleWarning(
					`Circular dependency detected: property "${String(key)}" exceeded max notification depth`,
				);
				return;
			}

			this.dispatchEvent(new CustomEvent('set', { detail: { key, value } }));
			this.dispatchEvent(new CustomEvent(String(key), { detail: value }));
		} finally {
			this.#notifyDepth--;
		}
	}

	/** Returns null if destroyed. Throws TypeError on invalid key or parser. */
	subscriber(key, parser, options = {}) {
		if (this.isDestroyed) {
			ErrorHandler.handleWarning('Cannot create subscriber on destroyed context');
			return null;
		}

		if (typeof key !== 'string') {
			ErrorHandler.handleValidationError('subscriber() key must be a string', typeof key, 'string');
		}

		if (reservedEventNames.has(key)) {
			ErrorHandler.handleValidationError(
				`"${key}" is a reserved event name and cannot be used as a subscriber key`,
				key,
				'a non-reserved property name',
			);
		}

		if (parser !== null && parser !== undefined && typeof parser !== 'function') {
			ErrorHandler.handleValidationError('subscriber() parser must be a function', typeof parser, 'function');
		}

		const proxy = this.proxy;
		return derive(() => [proxy[key]], parser ?? (v => v), options);
	}

	/** @throws {TypeError} When callback is not a function or key is not a string */
	subscribe({ callback, key, keys, parser = _ => _ }) {
		if (keys !== undefined) {
			return this.#subscribeMulti(keys, callback);
		}

		if (typeof callback !== 'function') {
			ErrorHandler.handleValidationError('Subscribe callback must be a function', typeof callback, 'function');
		}

		if (typeof key !== 'string') {
			ErrorHandler.handleValidationError('Subscribe key must be a string', typeof key, 'string');
		}

		if (reservedEventNames.has(key)) {
			ErrorHandler.handleValidationError(
				`"${key}" is a reserved event name; subscribing to it intercepts generic change notifications, not a property named "${key}"`,
				key,
				'a non-reserved property name',
			);
		}

		if (parser !== null && parser !== undefined && typeof parser !== 'function') {
			ErrorHandler.handleValidationError('Subscribe parser must be a function', typeof parser, 'function');
		}

		if (this.isDestroyed) {
			return this.#createDestroyedSubscription(key);
		}

		const id = genId();
		const subscription = ({ detail }) => {
			try {
				callback(parser(detail));
			} catch (error) {
				ErrorHandler.handleParserError(error, this, key, 'subscription');
				try {
					callback(null);
				} catch (callbackError) {
					ErrorHandler.handleWarning(`Subscription callback failed after parser error: ${callbackError.message}`);
				}
			}
		};

		this.#subscriptions[id] = { key, fn: subscription };

		try {
			super.addEventListener(String(key), subscription);
		} catch (error) {
			delete this.#subscriptions[id];
			ErrorHandler.handleSubscriptionSetupError(error, key, this.constructor.name);
			return {
				unsubscribe: () => ErrorHandler.handleWarning('Unsubscribe called on failed subscription'),
				current: null,
				id: null,
				isDestroyed: true,
			};
		}

		const unsubscribe = () => {
			if (this.#subscriptions[id]) {
				super.removeEventListener(String(key), subscription);
				delete this.#subscriptions[id];
			}
			deregister();
		};

		const deregister = this.#cleanup.add(unsubscribe, `subscription-${key}`);
		this.#subscriptions[id].deregister = deregister;

		return {
			unsubscribe,
			current: this.#getInitialValue(key, parser),
			id,
		};
	}

	#subscribeMulti(keys, callback) {
		if (!Array.isArray(keys) || keys.length === 0) {
			ErrorHandler.handleValidationError(
				'subscribe keys must be a non-empty array',
				Array.isArray(keys) ? 'empty array' : typeof keys,
				'non-empty array',
			);
		}

		if (typeof callback !== 'function') {
			ErrorHandler.handleValidationError('Subscribe callback must be a function', typeof callback, 'function');
		}

		for (const k of keys) {
			if (typeof k !== 'string') {
				ErrorHandler.handleValidationError('Each key must be a string', typeof k, 'string');
			}
			if (reservedEventNames.has(k)) {
				ErrorHandler.handleValidationError(
					`"${k}" is a reserved event name and cannot be used as a subscribe key`,
					k,
					'a non-reserved property name',
				);
			}
		}

		if (this.isDestroyed) {
			const current = {};
			for (const k of keys) current[k] = this.target?.[k] ?? null;
			return { unsubscribe: () => {}, current, isDestroyed: true };
		}

		const proxy = this.proxy;
		const d = derive(
			() => keys.map(k => proxy[k]),
			(...values) => Object.fromEntries(keys.map((k, i) => [k, values[i]])),
		);

		d.subscribe(callback);

		const id = genId();

		const dispose = () => {
			if (!this.#subscriptions[id]) return;
			delete this.#subscriptions[id];
			d.destroy();
			deregister();
		};

		const deregister = this.#cleanup.add(dispose, `multi-subscription-[${keys.join(',')}]`);
		this.#subscriptions[id] = { multiKey: true, dispose };

		return {
			unsubscribe: dispose,
			current: Object.fromEntries(keys.map(k => [k, this.target[k]])),
			id,
		};
	}

	unsubscribe(id) {
		if (!id || !this.#subscriptions[id]) {
			if (id) {
				ErrorHandler.handleWarning(`Attempted to unsubscribe non-existent subscription: ${id}`);
			}
			return;
		}

		try {
			const sub = this.#subscriptions[id];
			if (sub.multiKey) {
				sub.dispose();
			} else {
				const { key, fn, deregister } = sub;
				super.removeEventListener(String(key), fn);
				delete this.#subscriptions[id];
				deregister();
			}
		} catch (error) {
			ErrorHandler.handleUnsubscribeError(error, id, this.constructor.name);
			delete this.#subscriptions[id];
		}
	}

	/** Re-emit without reassignment; use after in-place mutations like push(). */
	notify(key) {
		if (this.isDestroyed) return;
		this.#onSet(key, this.target[key], true);
	}

	#createDestroyedSubscription(key) {
		return {
			unsubscribe: () => ErrorHandler.handleWarning('Unsubscribe called on destroyed context subscription'),
			current: this.target?.[key] ?? null,
			id: null,
			isDestroyed: true,
		};
	}

	#getInitialValue(key, parser) {
		try {
			return parser(this.target[key]);
		} catch (error) {
			ErrorHandler.handleParserError(error, this, key, 'initial-subscription');
			return null;
		}
	}

	/** Listeners added via addEventListener() are NOT removed; caller is responsible. */
	destroy() {
		if (this.#boundMethods) {
			this.#boundMethods.clear();
			this.#boundMethods = null;
		}

		this.#cleanup.destroy();
		this.#subscriptions = {};
	}

	[Symbol.dispose]() {
		this.destroy();
	}
}
