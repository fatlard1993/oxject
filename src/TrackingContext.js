let active = null;

const TrackingContext = {
	get current() {
		return active;
	},

	/**
	 * Run fn(), intercept any Oxject property reads and subscriber value accesses
	 * that occur during execution, and return the value plus both dep sets.
	 * @param {Function} fn
	 * @returns {{ value: *, deps: Map<object, Set<string>>, subscriberDeps: Set<object> }}
	 */
	collect(fn) {
		const deps = new Map(); // Map<context, Set<key>>
		const subscriberDeps = new Set(); // Set<BaseSubscriber>
		const prev = active;

		active = {
			track(context, key) {
				if (typeof key !== 'string') return;
				if (!deps.has(context)) deps.set(context, new Set());
				deps.get(context).add(key);
			},
			trackSubscriber(subscriber) {
				subscriberDeps.add(subscriber);
			},
		};

		let value;
		try {
			value = fn();
		} finally {
			active = prev;
		}

		return { value, deps, subscriberDeps };
	},
};

export default TrackingContext;
