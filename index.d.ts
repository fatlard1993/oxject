// ─── Subscription ────────────────────────────────────────────────────────────

/** Returned by `Oxject.subscribe()`. The `id` can be passed to `context.unsubscribe(id)`. */
export type Subscription<R> = {
	unsubscribe: () => void;
	current: R;
	id: string;
};

/** Returned by `derive().subscribe()` and `subscriber().subscribe()`. */
export type SubscriberSubscription<R> = {
	unsubscribe: () => void;
	current: R;
};

/** Returned by `Oxject.subscribe()` on a destroyed instance. */
export type DestroyedSubscription = {
	unsubscribe: () => void;
	current: null;
	id: null;
	isDestroyed: true;
};

/** Returned by `derive().subscribe()` or `subscriber().subscribe()` on a destroyed instance. */
export type DestroyedSubscriberSubscription = {
	unsubscribe: () => void;
	current: null;
	isDestroyed: true;
};

// ─── Oxject ─────────────────────────────────────────────────────────────────

type OxjectAPI<T extends object> = {
	/** The raw state object behind the proxy. */
	readonly target: T;
	readonly __isOxject: true;
	readonly isDestroyed: boolean;

	/**
	 * Create a reactive subscriber for a single property with optional transformation.
	 * Returns a `DeriveInstance` proxy that acts transparently as the (parsed) property value.
	 * Returns null if the context is already destroyed.
	 */
	subscriber<K extends keyof T & string, R = T[K]>(
		key: K,
		parser?: (value: T[K]) => R,
		options?: DeriveOptions,
	): DeriveInstance<R> | null;

	/**
	 * Subscribe to a single property change. Returns an unsubscribe handle and
	 * the current (parsed) value at the time of subscription.
	 */
	subscribe<K extends keyof T & string, R = T[K]>(config: {
		key: K;
		callback: (value: R) => void;
		parser?: (value: T[K]) => R;
	}): Subscription<R> | DestroyedSubscription;

	/**
	 * Subscribe to multiple properties at once. The callback fires when any of
	 * the listed keys changes, receiving an object keyed by property name.
	 * When multiple keys change inside a `batch()`, the callback fires once.
	 * Returns the same `{ unsubscribe, current, id }` shape as single-key subscribe;
	 * the `id` can be passed to `context.unsubscribe(id)`.
	 */
	subscribe<K extends keyof T & string>(config: {
		keys: K[];
		callback: (values: Pick<T, K>) => void;
	}): Subscription<Pick<T, K>> | DestroyedSubscription;

	/** Remove a subscription by the ID returned from subscribe(). */
	unsubscribe(id: string): void;

	/** Low-level escape hatch; prefer subscribe() for managed cleanup. */
	addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	): void;
	removeEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | EventListenerOptions,
	): void;
	dispatchEvent(event: Event): boolean;

	/**
	 * Batch multiple property changes, coalescing all notifications until the
	 * callback completes. Prevents intermediate re-renders when setting several
	 * properties at once. `notify()` calls inside a batch are also deferred and
	 * coalesced; multiple notifies for the same key collapse to one.
	 *
	 * If `fn` throws, all pending changes are rolled back and no subscribers are
	 * notified. The error propagates to the caller; state is left unchanged.
	 */
	batch(fn: () => void): void;

	/**
	 * Defer a batch to the next microtask. All assignments that run inside `fn`
	 * after the microtask fires are coalesced like a synchronous `batch()`.
	 * Returns a Promise that resolves when complete, or rejects (after rollback)
	 * if `fn` throws. No-op (resolves immediately) if already destroyed.
	 */
	batchAsync(fn: () => void): Promise<void>;

	/**
	 * Re-emit the current value of a key without assignment.
	 * Use after mutating a nested object or array in place (e.g. after array.push()).
	 * When called inside a batch(), the notification is deferred and coalesced.
	 *
	 * @example
	 * state.items.push(newItem);
	 * state.notify('items'); // subscribers see the updated array
	 */
	notify(key: keyof T & string): void;

	/** Destroy and clean up all managed subscriptions. */
	destroy(): void;
	[Symbol.dispose](): void;
};

/** An Oxject instance: the state object T merged with the reactive API. */
export type OxjectInstance<T extends object> = T & OxjectAPI<T>;

interface OxjectConstructor {
	new <T extends object>(initialState: T): OxjectInstance<T>;
	isOxject(thing: unknown): thing is OxjectInstance<any>;
}

/**
 * Reactive state container with proxy-based property access.
 * The constructor returns a proxy typed as `T & OxjectAPI<T>` so state
 * properties are directly accessible alongside the reactive methods.
 *
 * @example
 * const state = new Oxject({ count: 0, name: 'Alice' });
 * state.count++;       // triggers subscriptions
 * state.name = 'Bob';  // triggers subscriptions
 */
export declare const Oxject: OxjectConstructor;

// ─── derive ──────────────────────────────────────────────────────────────────

export type DeriveOptions = {
	/**
	 * Skip notifying subscribers when the newly derived value is reference-equal
	 * (`Object.is`) to the previous value.
	 */
	memoize?: boolean;
};

/**
 * A derived reactive value with an explicit dependency list.
 *
 * Proxy transparency:
 *   - Property access, method calls, arithmetic, and comparisons (`>`, `<`) delegate to the value.
 *   - `derived === value`, `typeof derived`, and truthiness of falsy values do NOT work;
 *     use `derived.valueOf()` or `derived.toJSON()` to get the raw value for those cases.
 */
export type DeriveInstance<T> = T & {
	readonly __isDerived: true;
	readonly isDestroyed: boolean;
	subscribe(callback: (value: T) => void): SubscriberSubscription<T> | DestroyedSubscriberSubscription;
	getCurrentValue(): T;
	toJSON(): T;
	valueOf(): T;
	toString(): string;
	/** Evaluate the derived value as a boolean. Prefer over `!!derive(...)`: Proxy objects are always truthy. */
	toBoolean(): boolean;
	destroy(): void;
	[Symbol.dispose](): void;
};

/**
 * Derive a reactive value from an explicit dependency list and a combiner function.
 *
 * `selector` runs once to discover dependencies; any Oxject properties read inside it
 * become static subscriptions. `combiner` receives the selector's return values as
 * positional arguments and produces the derived value.
 *
 * Dependencies are wired once at construction and never re-tracked. Keep conditional
 * logic in the combiner, not the selector.
 *
 * @example
 * const state = new Oxject({ firstName: 'Alice', lastName: 'Smith', logins: 3 });
 * const label = derive(
 *   () => [state.firstName, state.lastName, state.logins],
 *   (first, last, logins) => `${first} ${last} has logged in ${logins} times`,
 * );
 * state.firstName = 'Bob'; // → "Bob Smith has logged in 3 times"
 */
export declare function derive<T extends unknown[], R>(
	selector: () => [...T],
	combiner: (...values: T) => R,
	options?: DeriveOptions,
): DeriveInstance<R>;
