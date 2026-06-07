import TrackingContext from './TrackingContext.js';
import ErrorHandler from './ErrorHandler.js';

const derivedProxies = new WeakSet();

const DERIVE_KEYS = new Set([
	'__isDerived',
	'isDestroyed',
	'subscribe',
	'destroy',
	'toJSON',
	'valueOf',
	'toString',
	'toBoolean',
	'getCurrentValue',
	Symbol.dispose,
]);

class DeriveSubscriber {
	__isDerived = true;

	#subscriberCallbacks = new Set();
	#isDestroyed = false;
	#currentValue = undefined;
	#dirty = false;
	#memoize = false;
	#postBatchScheduled = false;
	#selector;
	#combiner;
	#unsubscribers = [];

	constructor(selector, combiner, options = {}) {
		if (typeof selector !== 'function') {
			ErrorHandler.handleValidationError('derive() selector must be a function', typeof selector, 'function');
		}
		if (typeof combiner !== 'function') {
			ErrorHandler.handleValidationError('derive() combiner must be a function', typeof combiner, 'function');
		}

		this.#selector = selector;
		this.#combiner = combiner;
		this.#memoize = options.memoize ?? false;

		const { value: initialValues, deps, subscriberDeps } = TrackingContext.collect(selector);

		if (deps.size === 0 && subscriberDeps.size === 0) {
			ErrorHandler.handleValidationError(
				'derive() selector has no reactive dependencies; the derived value will never update',
				'non-reactive selector',
				'selector that reads at least one Oxject property or subscriber',
			);
		}

		this.#currentValue = combiner(...initialValues);

		for (const [ctx, keys] of deps) {
			for (const key of keys) {
				try {
					const { unsubscribe } = ctx.subscribe({
						key,
						callback: () => this.#markDirty(ctx),
					});
					this.#unsubscribers.push(unsubscribe);
				} catch (error) {
					ErrorHandler.handleSubscriptionSetupError(error, key, 'derive');
				}
			}
		}

		for (const sub of subscriberDeps) {
			try {
				const { unsubscribe } = sub.subscribe(() => this.#markDirty());
				this.#unsubscribers.push(unsubscribe);
			} catch (error) {
				ErrorHandler.handleSubscriptionSetupError(error, 'subscriber-dep', 'derive');
			}
		}

		return this.#createProxy();
	}

	get isDestroyed() {
		return this.#isDestroyed;
	}

	#createProxy() {
		const self = this;
		const proxy = new Proxy(
			{},
			{
				get(_, key) {
					if (DERIVE_KEYS.has(key)) {
						const value = self[key];
						if (typeof value === 'function') return value.bind(self);
						return value;
					}
					try {
						TrackingContext.current?.trackSubscriber(self);
						const current = self.getCurrentValue();
						if (current === null || current === undefined) return current;
						const value = current[key];
						if (typeof value === 'function') return value.bind(current);
						return value;
					} catch (error) {
						ErrorHandler.handleParserError(error, self, 'combiner', 'property-access');
						return null;
					}
				},
			},
		);
		derivedProxies.add(proxy);
		return proxy;
	}

	#markDirty(sourceCtx) {
		this.#dirty = true;
		if (sourceCtx?.isBatchFlushing) {
			if (!this.#postBatchScheduled) {
				this.#postBatchScheduled = true;
				sourceCtx.scheduleAfterFlush(() => {
					this.#postBatchScheduled = false;
					this.#update();
				});
			}
			return;
		}
		this.#update();
	}

	#update() {
		if (this.#isDestroyed) return;
		if (this.#subscriberCallbacks.size === 0) return;
		if (!this.#dirty) return;
		const prev = this.#currentValue;
		this.#recompute();
		if (this.#memoize && Object.is(this.#currentValue, prev)) return;
		this.#notifySubscribers(this.#currentValue);
	}

	// Selector re-runs without tracking; TrackingContext.current is null outside collect().
	// Deps remain static from construction.
	#recompute() {
		this.#currentValue = this.#combiner(...this.#selector());
		this.#dirty = false;
	}

	getCurrentValue() {
		if (this.#dirty) this.#recompute();
		return this.#currentValue;
	}

	#notifySubscribers(value) {
		if (this.#isDestroyed) return;
		this.#subscriberCallbacks.forEach(callback => {
			try {
				callback(value);
			} catch (error) {
				ErrorHandler.handleWarning(`derive() callback error: ${error.message}`);
			}
		});
	}

	subscribe(callback) {
		if (typeof callback !== 'function') {
			ErrorHandler.handleValidationError('derive() subscribe callback must be a function', typeof callback, 'function');
		}

		if (this.#isDestroyed) {
			ErrorHandler.handleWarning('Cannot subscribe to destroyed derive');
			return {
				unsubscribe: () => ErrorHandler.handleWarning('Unsubscribe called on destroyed derive'),
				current: null,
			};
		}

		this.#subscriberCallbacks.add(callback);

		let current;
		try {
			current = this.getCurrentValue();
		} catch (error) {
			ErrorHandler.handleParserError(error, this, 'combiner', 'initial-subscription');
			current = null;
		}

		return {
			unsubscribe: () => {
				this.#subscriberCallbacks.delete(callback);
			},
			current,
		};
	}

	toJSON() {
		TrackingContext.current?.trackSubscriber(this);
		try {
			return this.getCurrentValue();
		} catch (error) {
			ErrorHandler.handleParserError(error, this, 'combiner', 'toJSON');
			return null;
		}
	}

	valueOf() {
		return this.toJSON();
	}

	toString() {
		try {
			return String(this.getCurrentValue());
		} catch {
			return '';
		}
	}

	toBoolean() {
		if (TrackingContext.current) {
			ErrorHandler.handleWarning(
				'toBoolean() called inside a derive() selector; the result is not tracked as a dependency. Use valueOf() or toJSON() to register this subscriber as a dep.',
			);
		}
		try {
			return Boolean(this.getCurrentValue());
		} catch {
			return false;
		}
	}

	destroy() {
		if (this.#isDestroyed) return;
		this.#isDestroyed = true;
		this.#postBatchScheduled = false;
		this.#subscriberCallbacks.clear();
		for (const unsub of this.#unsubscribers) {
			try {
				unsub();
			} catch {
				/* cleanup */
			}
		}
		this.#unsubscribers = [];
	}

	[Symbol.dispose]() {
		this.destroy();
	}
}

/**
 * Derive a reactive value from an explicit dependency list and a combiner function.
 *
 * `selector` runs once to discover dependencies; any Oxject properties read inside it
 * become static subscriptions. `combiner` receives the selector's return values spread
 * as positional arguments and produces the derived value.
 *
 * Dependencies are wired once at construction and never re-tracked. Conditional branches
 * in the selector are not re-tracked; keep conditional logic in the combiner.
 *
 * @param {() => unknown[]} selector - Returns an array of current dependency values
 * @param {(...values: unknown[]) => unknown} combiner - Derives the output from those values
 * @param {{ memoize?: boolean }} [options]
 * @returns {DeriveSubscriber} Proxy exposing the current derived value
 *
 * @example
 * const state = new Oxject({ firstName: 'Alice', lastName: 'Smith', logins: 3 });
 * const label = derive(
 *   () => [state.firstName, state.lastName, state.logins],
 *   (first, last, logins) => `${first} ${last} has logged in ${logins} times`,
 * );
 * label.subscribe(v => console.log(v));
 * state.firstName = 'Bob'; // → "Bob Smith has logged in 3 times"
 */
export function derive(selector, combiner, options = {}) {
	return new DeriveSubscriber(selector, combiner, options);
}

export function isDerivedProxy(value) {
	return value != null && typeof value === 'object' && derivedProxies.has(value);
}
