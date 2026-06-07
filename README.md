# oxject

Reactive state built on the platform's own `EventTarget`. Oxject's notification infrastructure is the DOM's: `AbortSignal` cleanup, `{ once }` listeners, and typed event channels work because the platform already knows how. Property access and assignment look like a plain object, with no special setter syntax, no `.value` unwrapping, no compile step.

Zero dependencies. Works in any environment that has `EventTarget` and `Proxy`: browsers, Node, Bun, Deno, workers.

```js
import { Oxject } from '@vanilla-bean/oxject';

const state = new Oxject({ count: 0, name: 'Alice' });

state.subscribe({
	key: 'count',
	callback: n => console.log('count is', n),
});

state.count++; // → "count is 1"
state.name = 'Bob'; // (count subscription doesn't fire)
```

**The name:** `oxject` is a portmanteau of `Proxy` (pr**ox**y) and `object` (ob**ject**). The core mechanism is a Proxy over a plain object — the name encodes that directly.

## Install

```sh
npm install @vanilla-bean/oxject
# or
bun add @vanilla-bean/oxject
```

---

## Foundation

Every `Oxject` instance **is** an `EventTarget`, not wrapped in one, not delegating to one.

Most reactive libraries implement their own notification infrastructure in userland: a custom scheduler, a custom subscriber list, a custom cleanup mechanism. Oxject's notification infrastructure **is the platform's**. That means you get the full DOM event model at no extra cost:

```js
const state = new Oxject({ user: null, theme: 'light' });

// AbortSignal: tie listener lifetime to a component or request lifecycle
const controller = new AbortController();
state.addEventListener('user', ({ detail }) => renderUser(detail), {
	signal: controller.signal,
});
controller.abort(); // listener removed; no bookkeeping required

// once: fire-and-forget initialization
state.addEventListener('user', ({ detail }) => analytics.identify(detail?.id), {
	once: true,
});

// audit log: every property change in one listener
state.addEventListener('set', ({ detail: { key, value } }) => {
	auditLog.push({ key, value, ts: Date.now() });
});

// event bus: an Oxject with no initial state is a typed event channel
const bus = new Oxject({});
bus.addEventListener('userUpdated', ({ detail }) => refreshUser(detail.id));
bus.userUpdated = { id: 1, data: { name: 'Bob' } };
```

Property changes dispatch two events:

- A key-specific `CustomEvent` with `{ detail: value }`, used by `subscribe()` and `subscriber()`
- A generic `'set'` event with `{ detail: { key, value } }`, fired on any property change

`subscribe()` is the right default: it registers cleanup automatically and runs it on `destroy()`. `addEventListener()` is the right reach when you need `{ once }`, `{ signal }`, or direct interop with anything that speaks the platform event model.

**`'set'` is reserved.** It cannot be used as a property name, a `subscribe()` key, or a `subscriber()` key; it's the event type for the generic change notification.

Assignments that don't change the value (`Object.is` equality) are skipped; subscribers don't fire and the `'set'` event is not dispatched. `notify()` bypasses this check intentionally: it exists for in-place mutations where the reference is the same but the content changed.

**High-frequency state:** every assignment dispatches two events. For state that changes faster than subscribers can meaningfully react, like 60fps animation or continuous pointer tracking, keep that data in a plain variable and pull from Oxject only at render flush time.

---

## Core concepts

### Oxject

The constructor takes a plain object and returns a `Proxy`. The proxy looks and behaves like the object. You assign and read properties directly, but every assignment notifies subscribers.

```js
const state = new Oxject({ loading: false, items: [] });

state.loading = true; // notifies subscribers
state.items = []; // notifies subscribers
state.newKey = 'val'; // new properties work too
```

The constructor rejects `null`, arrays, strings, and other non-plain-object types. It throws immediately on invalid input.

**`instanceof Oxject` returns `false`.** The constructor returns the proxy, not the instance. The proxy is what intercepts assignment and triggers subscriptions; returning it directly is what makes `state.count++` work without any special syntax.

### subscribe

Callback-based subscription to a single property. Returns an unsubscribe handle and the current value at subscription time.

```js
const { unsubscribe, current, id } = state.subscribe({
	key: 'items',
	callback: items => render(items),
	parser: items => items.filter(x => x.active), // optional transform
});

// current is the parsed value at subscription time
// unsubscribe() removes the listener
// id can also be passed to state.unsubscribe(id)
```

**Watching multiple keys:** fires when any of the listed keys changes, receives all current values as a keyed object. When both keys change inside a `batch()`, the callback fires once.

```js
const { unsubscribe, current } = state.subscribe({
	keys: ['user', 'loading'],
	callback: ({ user, loading }) => render(user, loading),
});
// current → { user: ..., loading: ... }
```

### subscriber

Where `subscribe()` delivers changes to a callback, `subscriber()` gives you a live handle that acts like the value itself: read its properties, call its methods, use it in template literals, all without unwrapping.

```js
const state = new Oxject({ name: 'Alice' });
const upper = state.subscriber('name', s => s.toUpperCase());

upper.length; // string property, reads from current value
upper.slice(0, 3); // string method, bound to current value
`${upper}`; // "ALICE"

state.name = 'Bob';
`${upper}`; // "BOB", always live
```

See [Reactive value transparency](#reactive-value-transparency) for what works and what doesn't.

### batch

Coalesces all property assignments inside the callback into a single notification per subscriber. Use when setting multiple properties that together represent one logical state change.

```js
state.batch(() => {
	state.users = newUsers;
	state.loading = false;
	state.lastUpdated = Date.now();
});
// subscribers fire once each, after all three assignments
```

Nested `batch()` calls are safe; the outer batch wins.

**If `fn` throws, all pending changes are rolled back and no subscribers are notified.** The error propagates to the caller; state is left exactly as it was before the batch started.

```js
try {
	state.batch(() => {
		state.users = newUsers;
		state.loading = false;
		throw new Error('something failed');
	});
} catch (e) {
	// state.users and state.loading are unchanged
	// no subscribers were notified
}
```

`notify()` calls inside a `batch()` are also deferred and coalesced; if you notify the same key twice, only one notification fires after the batch completes with the value at flush time.

```js
state.batch(() => {
	state.items.push(a);
	state.notify('items');
	state.items.push(b);
	state.notify('items'); // coalesced; subscribers fire once with both items
});
```

### batchAsync

Schedules `fn` to run as a batch on the next microtask. Use it to defer a set of related mutations out of the current call stack.

```js
await state.batchAsync(() => {
	state.loading = false;
	state.user = fetchedUser;
});
```

`batchAsync()` returns a `Promise<void>` that resolves when the batch completes. If `fn` throws, state is rolled back the same way as synchronous `batch()` and the returned Promise rejects with the error. Await the return value to catch it:

```js
try {
	await state.batchAsync(() => {
		state.users = newUsers;
		state.loading = false;
	});
} catch (e) {
	// state.users and state.loading are unchanged
}
```

`batchAsync()` resolves immediately and is a no-op if the instance is already destroyed.

### notify

Re-emits the current value of a key without reassignment. Use this after in-place mutations like `push`, `splice`, or direct property writes on a nested object.

```js
state.items.push(newItem); // in-place mutation, does NOT trigger subscriptions
state.notify('items'); // now subscribers see the updated array

state.target.count = 99; // bypass the proxy, does NOT trigger
state.notify('count'); // re-emit manually
```

**This is the right tool for in-place mutations.** Reassigning (`state.items = [...state.items]`) also works but creates a new array every time; use `notify()` when you want the mutation without the allocation.

### destroy

Removes all managed subscriptions and prevents further notifications. `Symbol.dispose` is also supported for `using` declarations.

```js
state.destroy();
state.isDestroyed; // true

// or
using state = new Oxject({ count: 0 });
// automatically destroyed when leaving scope
```

Subscriptions added via `subscribe()` are removed automatically. Listeners added directly via `addEventListener()` are the caller's responsibility.

---

## derive

The selector declares what to watch. The combiner says what to do with it. Those two concerns stay separate: the dep list is readable code, not a runtime artifact.

```js
import { Oxject, derive } from '@vanilla-bean/oxject';

const state = new Oxject({ x: 1, y: 2 });

const sum = derive(
	() => [state.x, state.y],
	(x, y) => x + y,
);

sum.subscribe(v => console.log('sum', v));

state.x = 10; // → "sum 12"
```

Multi-source derivation: just list every dep in the selector regardless of which instance it comes from:

```js
const user = new Oxject({ firstName: 'Alice', lastName: 'Smith' });
const auth = new Oxject({ logins: 3 });

const label = derive(
	() => [user.firstName, user.lastName, auth.logins],
	(first, last, logins) => `${first} ${last} has logged in ${logins} times`,
);

user.firstName = 'Bob'; // → "Bob Smith has logged in 3 times"
auth.logins = 10; // → "Bob Smith has logged in 10 times"
```

`derive` returns a transparent proxy: property access, method calls, and coercions delegate to the current derived value. The same escape hatches (`toBoolean()`, `toJSON()`, `valueOf()`) apply for identity checks and truthiness.

**Static dependencies.** The selector runs once at construction to wire subscriptions. On each dep change the selector re-runs to read fresh values, but the subscription set never changes. Conditional branches in the selector are not re-tracked: only deps read on the first run are ever subscribed. Keep conditional logic in the combiner, not the selector:

```js
// declare all deps; conditional logic belongs in the combiner
const label = derive(
	() => [state.useMetric, state.km, state.miles],
	(useMetric, km, miles) => (useMetric ? `${km} km` : `${miles} mi`),
);

// only state.km or state.miles is subscribed at construction, not both
const label = derive(
	() => [state.useMetric ? state.km : state.miles],
	val => String(val),
);
```

**A selector with no reactive dependencies throws.** If the selector doesn't read any Oxject property or subscriber, the derivation can never update; `derive()` throws a `TypeError` immediately at construction rather than silently creating a permanently frozen value.

**Options:** `memoize`: skips notification when the new value is `Object.is`-equal to the previous one.

**Batch coalescing:** When multiple deps change inside a `batch()`, derive re-runs the selector and combiner once after the batch completes.

**Cleanup:** Call `destroy()` (or use a `using` declaration) when the derivation is no longer needed.

### Chaining derive values

Reading a `derive` result inside another `derive` selector tracks it as a dependency. Use `.valueOf()` or `.toJSON()`: both return the current value and register the dep. `.toBoolean()` returns a boolean but does not register; avoid it inside selectors.

```js
const state = new Oxject({ x: 2 });

const doubled = derive(
	() => [state.x],
	x => x * 2,
);
const quadrupled = derive(
	() => [doubled.valueOf()],
	d => d * 2,
);

quadrupled.subscribe(v => console.log(v));

state.x = 5; // → 20
```

**Don't mix dependency levels.** If `c` depends on derive `a`, don't also list `a`'s source properties in `c`'s selector. Chains propagate correctly because construction order equals notification order; you can't reference `a` before it exists, so `a`'s subscriptions always register first. Mixing levels breaks that: `c` recomputes once with a stale `a`, then again correctly when `a` notifies.

```js
// Avoid: c reaches past a to grab state.x directly
const a = derive(
	() => [state.x],
	x => x * 2,
);
const c = derive(
	() => [a.valueOf(), state.x],
	(av, x) => av + x,
);

// Fix option 1: expose what c needs from a
const a = derive(
	() => [state.x],
	x => ({ doubled: x * 2, raw: x }),
);
const c = derive(
	() => [a.valueOf()],
	({ doubled, raw }) => doubled + raw,
);

// Fix option 2: bypass a entirely if c doesn't actually need the intermediate
const c = derive(
	() => [state.x],
	x => x * 2 + x,
);
```

Needing to mix levels is a sign that the upstream derive isn't exposing enough, or that the intermediate layer isn't needed.

---

## Nested Oxject: opt-in deep reactivity

Oxject is **shallow by default**. Writing to `state.user.name` goes through the plain object at `state.user`, not through a proxy; it won't trigger anything. Deep reactivity by default is expensive and produces its own class of subtle bugs (destructuring loses reactivity, class instances break, arrays need special handling).

The opt-in is to nest Oxject instances by passing subscribers as initial values:

```js
const user = new Oxject({ name: 'Alice', role: 'admin' });
const ui = new Oxject({ theme: 'light' });

const app = new Oxject({
	userName: user.subscriber('name'),
	theme: ui.subscriber('theme'),
});

user.name = 'Bob'; // app.userName updates automatically
ui.theme = 'dark'; // app.theme updates automatically
```

When a reactive value (`subscriber()` or `derive()` result) is passed as an initial value, Oxject subscribes to it automatically and keeps the property in sync. The parent cleans up that subscription on `destroy()`.

This is explicit reactive composition: you declare which properties cross layer boundaries at construction time. Nothing propagates silently; only what you wire up gets connected. That makes multi-layer graphs predictable: a change deep in one instance can't trigger subscriptions in another unless you explicitly connected them.

Multi-level hierarchies compose the same way:

```js
const auth = new Oxject({ userId: null });
const prefs = new Oxject({ theme: 'light' });

const session = new Oxject({
	userId: auth.subscriber('userId'),
	theme: prefs.subscriber('theme'),
});

const app = new Oxject({
	label: session.subscriber('userId', id => (id ? `User ${id}` : 'Guest')),
	isDark: session.subscriber('theme', t => t === 'dark'),
});

auth.userId = 42; // → app.label  becomes 'User 42'
prefs.theme = 'dark'; // → app.isDark becomes true
```

`derive` integrates naturally at any level: pass subscriber values from nested instances directly in the selector:

```js
const greeting = derive(
	() => [app.isDark.valueOf(), app.label.valueOf()],
	(isDark, label) => `${isDark ? '🌙' : '☀️'} Hello, ${label}`,
);
// greeting.toJSON() → "🌙 Hello, User 42"
```

---

## Reactive value transparency

Both `subscriber()` and `derive()` return a `Proxy` that delegates to the current value without unwrapping: property access, method calls, template literals, and arithmetic all work directly. For identity checks, `typeof`, or truthiness on falsy values, the escape hatches below apply.

**What works:**

```js
const upper = state.subscriber('name', s => s.toUpperCase());

upper.length; // number, reads from underlying string
upper.slice(0, 3); // method call, bound to underlying string
`${upper}`; // toString() coercion, works
upper + ''; // string coercion, works
upper > 'A'; // comparison, works via coercion
upper.toJSON(); // explicit: returns the raw current value
upper.toBoolean(); // explicit boolean, use instead of !!upper
```

**What doesn't work:**

```js
upper === 'ALICE'    // false, proxy identity ≠ value identity
typeof upper         // 'object', always, regardless of the value's type
!!falsySub           // true, Proxy objects are always truthy, even when wrapping false/0/''
if (falsySub) {...}  // always enters the branch
```

These are fundamental JS Proxy constraints, not fixable without language changes. The proxy model does not allow trapping `typeof` or `===`.

**Use the explicit escape hatches when identity, `typeof`, or truthiness matter:**

```js
upper.toBoolean(); // Boolean(currentValue), the right way to check truthiness
upper.toJSON(); // the raw current value, for ===, typeof, or passing to non-proxy code
upper.valueOf(); // same as toJSON()

typeof upper.toJSON(); // 'string'
upper.toJSON() === 'ALICE'; // true
if (falsySub.toBoolean()) {
} // correct truthiness check
```

---

## API reference

### `new Oxject(initialState)`

Returns a proxy typed as `initialState & OxjectAPI`. Throws `TypeError` for non-plain-object input.

| Method / property | Description |
| --- | --- |
| `state.{key} = value` | Assign and notify subscribers |
| `state.subscribe({ key, callback, parser? })` | Returns `{ unsubscribe, current, id }` |
| `state.subscribe({ keys, callback })` | Multi-key: fires when any listed key changes; callback receives `{ key: value, ... }` |
| `state.unsubscribe(id)` | Remove subscription by ID |
| `state.subscriber(key, parser?, options?)` | Returns a reactive `derive` proxy for a single property. Returns `null` if context is destroyed. Throws `TypeError` on invalid input. |
| `state.batch(fn)` | Coalesce notifications across multiple assignments. If `fn` throws, all pending changes roll back and no subscribers are notified. |
| `state.batchAsync(fn)` | Schedule `fn` to run as a batch on the next microtask. Returns `Promise<void>`; rejects (after rollback) if `fn` throws. |
| `state.notify(key)` | Re-emit current value without assignment |
| `state.addEventListener(type, listener, options?)` | Low-level escape hatch; supports `{ once }`, `{ signal }`. Caller manages removal. Prefer `subscribe()` for automatic cleanup. `'set'` fires on any property change with `{ detail: { key, value } }`. |
| `state.target` | The raw object behind the proxy |
| `state.isDestroyed` | `boolean` |
| `state.destroy()` | Clean up all managed subscriptions |
| `state[Symbol.dispose]()` | Same as `destroy()` |

### `derive(selector, combiner, options?)`

| Method / property                                  | Description                                                  |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `derive(() => [a, b], (a, b) => ...)`              | Returns a reactive proxy for the derived value               |
| `derive(() => [...], combiner, { memoize: true })` | Skip notification when new value `Object.is`-equals previous |
| `d.subscribe(callback)`                            | Returns `{ unsubscribe, current }`                           |
| `d.getCurrentValue()`                              | Current derived value                                        |
| `d.toJSON()` / `d.valueOf()`                       | Same as `getCurrentValue()`                                  |
| `d.toBoolean()`                                    | `Boolean(getCurrentValue())`                                 |
| `d.isDestroyed`                                    | `boolean`                                                    |
| `d.destroy()`                                      | Clean up all dependency subscriptions                        |
| `d[Symbol.dispose]()`                              | Same as `destroy()`                                          |

---

## Error handling

Parser errors in `subscribe()` are isolated: a throwing parser causes the callback to receive `null` and logs in development, without crashing the application or disrupting other subscriptions. A parser passed to `subscriber()` or `derive()` that throws on construction propagates immediately, since that is a programming error rather than a runtime data failure.

Cleanup errors are isolated; if one subscription's cleanup throws, the rest still run.

Errors and warnings are logged with context unless you are explicitly in a production environment (`NODE_ENV=production` or `import.meta.env.PROD = true`). Production bundlers like Vite set this automatically; for Node/Bun/Deno, set `NODE_ENV=production` in your production environment to silence logging.

---

## Real-world examples

### Shopping cart

```js
import { Oxject, derive } from '@vanilla-bean/oxject';

const cart = new Oxject({
	items: [],
	discountCode: '',
	shippingMethod: 'standard',
});

const summary = derive(
	() => [cart.items, cart.discountCode, cart.shippingMethod],
	(items, discountCode, shippingMethod) => {
		const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
		const discount = discountCode === 'SAVE10' ? subtotal * 0.1 : 0;
		const shippingCost = shippingMethod === 'express' ? 15 : 5;
		return {
			itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
			subtotal,
			discount,
			total: subtotal - discount + shippingCost,
		};
	},
);

const cartActions = {
	addItem(product, quantity = 1) {
		const existing = cart.items.find(item => item.id === product.id);
		if (existing) {
			existing.quantity += quantity;
			cart.notify('items'); // in-place mutation, does NOT trigger on its own
		} else {
			cart.items = [...cart.items, { ...product, quantity }];
		}
	},
	removeItem(id) {
		cart.items = cart.items.filter(item => item.id !== id);
	},
};

summary.subscribe(({ total, itemCount }) => {
	document.querySelector('.cart-total').textContent = `$${total.toFixed(2)}`;
	document.querySelector('.item-count').textContent = itemCount;
});
```

### Form validation

```js
import { Oxject, derive } from '@vanilla-bean/oxject';

const form = new Oxject({
	email: '',
	password: '',
	confirmPassword: '',
	terms: false,
});

// Per-field subscribers for inline error messages
const emailValid = form.subscriber('email', e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
const passwordValid = form.subscriber('password', p => p.length >= 8 && /[A-Z]/.test(p) && /[0-9]/.test(p));

// Combined validity: .valueOf() extracts the current value AND registers each subscriber as a dep
const formValid = derive(
	() => [emailValid.valueOf(), passwordValid.valueOf(), form.password, form.confirmPassword, form.terms],
	(emailOk, passwordOk, pass, confirm, terms) => emailOk && passwordOk && pass === confirm && pass.length > 0 && terms,
);

formValid.subscribe(valid => {
	document.querySelector('#submit-btn').disabled = !valid;
});
```

### Web Component integration

Because Oxject is an EventTarget, it composes naturally with Web Components and any other platform-native lifecycle.

```js
class UserCard extends HTMLElement {
	#state = new Oxject({ name: '', role: '', online: false });
	#controller = new AbortController();

	connectedCallback() {
		const { signal } = this.#controller;

		// Listeners tied to element lifetime, no manual cleanup needed
		this.#state.addEventListener(
			'name',
			({ detail }) => {
				this.shadowRoot.querySelector('.name').textContent = detail;
			},
			{ signal },
		);

		this.#state.addEventListener(
			'online',
			({ detail }) => {
				this.classList.toggle('online', detail);
			},
			{ signal },
		);

		// Bubble every state change as a DOM event
		this.#state.addEventListener(
			'set',
			({ detail: { key, value } }) => {
				this.dispatchEvent(
					new CustomEvent('state-change', {
						detail: { key, value },
						bubbles: true,
					}),
				);
			},
			{ signal },
		);
	}

	disconnectedCallback() {
		this.#controller.abort(); // removes all listeners at once
		this.#state.destroy();
	}

	set user({ name, role, online }) {
		this.#state.batch(() => {
			this.#state.name = name;
			this.#state.role = role;
			this.#state.online = online;
		});
	}
}
```

---

## When Oxject fits

Reach for Oxject when:

- **You're already in an event-driven environment:** Web Components, workers, service workers, Deno, or any code that already speaks `EventTarget`. Oxject integrates natively; no adapter layer required.
- **You want `AbortSignal`-managed listener lifetime:** `controller.abort()` removes all listeners tied to that signal at once, without touching the state object.
- **You need a typed event bus:** `new Oxject({})` is a zero-setup, strongly typed publish/subscribe channel that works in any environment.
- **Reactive state that travels:** the same instance works in a browser, a Node service, a worker, or a Deno script without adaptation or environment-specific shims.
- **You want composable reactive graphs:** nest Oxject instances by passing subscribers as initial values. You control exactly which properties flow across layer boundaries; nothing propagates silently. No accidental deep observation, no broken class instances, no lost reactivity when you destructure.
- **You want derivations with an auditable dep graph:** `derive` keeps the dep list in the selector and the logic in the combiner. What a derivation watches is readable code, not a runtime artifact. No hidden tracking, no dependency that only appears when a particular branch runs.

Look elsewhere when:

- **Automatic deep observation:** if your data model is deeply nested and you want every property at every level to be reactive without declaring what connects to what, Oxject's explicit wiring will feel like overhead.
- **Per-component, framework-integrated subscriptions:** if your use case demands ultra-granular subscriptions tightly coupled to a framework's rendering cycle, you'll want something built specifically for that model.
- **Framework-native state:** if you're inside an ecosystem with strong conventions around state and first-party devtools to match, the native solution will integrate more smoothly. Oxject can bridge in via `subscribe()`, but you'll write the glue.
- **Async-scheduled batching:** if you need cross-frame coalescing of updates from many independent sources, a library with a built-in async scheduler will serve you better. Oxject's `batch()` and `batchAsync()` are synchronous-first.
