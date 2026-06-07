import Oxject from './Oxject.js';

describe('Oxject', () => {
	let context;

	beforeEach(() => {
		context = new Oxject({ x: 'hello', y: 42, z: [1, 2, 3] });
	});

	afterEach(() => {
		context?.destroy();
	});

	describe('initialization', () => {
		test('initializes with valid plain object', () => {
			expect(context.x).toBe('hello');
			expect(context.y).toBe(42);
			expect(context.z).toEqual([1, 2, 3]);
		});

		test('rejects invalid initial states with the correct received type', () => {
			expect(() => new Oxject(null)).toThrow('received null');
			expect(() => new Oxject(undefined)).toThrow('received undefined');
			expect(() => new Oxject('string')).toThrow('received string');
			expect(() => new Oxject([1, 2, 3])).toThrow('received array');
		});

		test('rejects initial state with reserved keys', () => {
			expect(() => new Oxject({ subscribe: true })).toThrow('reserved key');
			expect(() => new Oxject({ destroy: false, notify: null })).toThrow('reserved key');
			expect(() => new Oxject({ batch: [] })).toThrow('reserved key');
		});

		test('rejects "set" as an initial key: it is the generic change event name', () => {
			expect(() => new Oxject({ set: 'anything' })).toThrow('reserved key');
		});

		test('exposes __isOxject flag through the proxy', () => {
			expect(context.__isOxject).toBe(true);
		});

		test('Oxject.isOxject identifies instances correctly', () => {
			expect(Oxject.isOxject(context)).toBe(true);
			expect(Oxject.isOxject({})).toBe(false);
			expect(Oxject.isOxject(null)).toBe(false);
			expect(Oxject.isOxject('string')).toBe(false);
			// duck-type check: a spoofed flag also passes (intentional)
			expect(Oxject.isOxject({ __isOxject: true })).toBe(true);
		});

		test('treats a duck-typed { __isDerived: true } object as a plain value, not a reactive subscriber', () => {
			const impostor = {
				__isDerived: true,
				subscribe: () => ({ unsubscribe: () => {}, current: 'spoofed' }),
				toJSON: () => 'spoofed',
			};
			const state = new Oxject({ x: impostor });
			expect(state.x).toBe(impostor);
			state.destroy();
		});

		test('handles subscriber properties in initial state', () => {
			const sourceContext = new Oxject({ value: 10 });
			const derivedContext = new Oxject({
				doubled: sourceContext.subscriber('value', v => v * 2),
			});

			expect(derivedContext.doubled).toBe(20);

			sourceContext.value = 5;
			expect(derivedContext.doubled).toBe(10);

			derivedContext.destroy();
			sourceContext.destroy();
		});
	});

	describe('reactivity system', () => {
		test('skips notification when value is unchanged (Object.is equality)', () => {
			const callback = mock();
			context.subscribe({ key: 'y', callback });

			context.y = 42; // same as initial
			expect(callback).not.toHaveBeenCalled();

			context.y = 43;
			expect(callback).toHaveBeenCalledTimes(1);
			expect(callback).toHaveBeenCalledWith(43);
		});

		test('skips notification for NaN-to-NaN assignment', () => {
			const state = new Oxject({ n: NaN });
			const callback = mock();
			state.subscribe({ key: 'n', callback });

			state.n = NaN;
			expect(callback).not.toHaveBeenCalled();
			state.destroy();
		});

		test('rejects "set" as a runtime property assignment', () => {
			expect(() => {
				context.set = 'anything';
			}).toThrow();
		});

		test('rejects writes to reserved Oxject API keys at runtime', () => {
			expect(() => {
				context.subscribe = 'not-a-function';
			}).toThrow('reserved');
			expect(() => {
				context.destroy = null;
			}).toThrow('reserved');
			expect(() => {
				context.notify = false;
			}).toThrow('reserved');
			expect(() => {
				context.batch = () => {};
			}).toThrow('reserved');
		});

		test('emits events on property changes', () => {
			const setHandler = mock();
			const xHandler = mock();

			context.addEventListener('set', setHandler);
			context.addEventListener('x', xHandler);

			context.x = 'world';

			expect(setHandler).toHaveBeenCalledWith(expect.objectContaining({ detail: { key: 'x', value: 'world' } }));
			expect(xHandler).toHaveBeenCalledWith(expect.objectContaining({ detail: 'world' }));
		});

		test('removeEventListener stops delivery of subsequent events', () => {
			const handler = mock();
			context.addEventListener('x', handler);

			context.x = 'first';
			expect(handler).toHaveBeenCalledTimes(1);

			context.removeEventListener('x', handler);
			context.x = 'second';
			expect(handler).toHaveBeenCalledTimes(1);
		});

		test('dispatchEvent fires registered listeners', () => {
			const handler = mock();
			context.addEventListener('custom', handler);
			context.dispatchEvent(new CustomEvent('custom', { detail: 'payload' }));
			expect(handler).toHaveBeenCalledWith(expect.objectContaining({ detail: 'payload' }));
		});
	});

	describe('subscription system', () => {
		test('manages manual subscriptions', () => {
			const callback = mock();
			const parser = mock(value => value.toUpperCase());

			const { unsubscribe, current, id } = context.subscribe({
				key: 'x',
				callback,
				parser,
			});

			expect(current).toBe('HELLO');
			expect(typeof id).toBe('string');
			expect(parser).toHaveBeenCalledWith('hello');

			context.x = 'world';
			expect(callback).toHaveBeenCalledWith('WORLD');

			unsubscribe();
			context.x = 'again';
			expect(callback).toHaveBeenCalledTimes(1);
		});

		test('validates subscription parameters', () => {
			expect(() => context.subscribe({ key: 'x', callback: 'not-function' })).toThrow();
			expect(() => context.subscribe({ key: 123, callback: () => {} })).toThrow();
		});

		test('rejects "set" as a subscribe key: it is the generic change event', () => {
			expect(() => context.subscribe({ key: 'set', callback: () => {} })).toThrow('reserved event name');
		});

		test('rejects "set" as a subscriber key', () => {
			expect(() => context.subscriber('set')).toThrow('reserved event name');
		});

		test('handles unsubscribe by id', () => {
			const callback = mock();
			const { id } = context.subscribe({ key: 'x', callback });

			context.unsubscribe(id);
			context.x = 'world';
			expect(callback).not.toHaveBeenCalled();
		});
	});

	describe('subscriber factory', () => {
		test('returns null when called on a destroyed context', () => {
			context.destroy();
			expect(context.subscriber('x')).toBe(null);
		});

		test('creates subscribers with parser', () => {
			const upper = context.subscriber('x', s => s.toUpperCase());

			expect(upper.toString()).toBe('HELLO');

			context.x = 'world';
			expect(upper.toString()).toBe('WORLD');

			upper.destroy();
		});

		test('supports memoized parsers', () => {
			const parser = mock(s => s.toUpperCase());
			const upper = context.subscriber('x', parser, { memoize: true });

			upper.toString();
			upper.toString();
			expect(parser).toHaveBeenCalledTimes(1);

			context.x = 'world';
			upper.toString();
			expect(parser).toHaveBeenCalledTimes(2);

			upper.destroy();
		});
	});

	describe('batching', () => {
		test('coalesces notifications within batch', () => {
			const callback = mock();
			context.subscribe({ key: 'x', callback });
			context.subscribe({ key: 'y', callback });

			context.batch(() => {
				context.x = 'a';
				context.y = 99;
			});

			expect(callback).toHaveBeenCalledTimes(2);
		});

		test('handles nested batch calls', () => {
			const callback = mock();
			context.subscribe({ key: 'x', callback });

			context.batch(() => {
				context.batch(() => {
					context.x = 'inner';
				});
				context.x = 'outer';
			});

			expect(callback).toHaveBeenCalledTimes(1);
			expect(context.x).toBe('outer');
		});

		describe('error rollback', () => {
			test('discards all pending changes and notifies no subscribers when fn throws', () => {
				const callback = mock();
				context.subscribe({ key: 'x', callback });
				context.subscribe({ key: 'y', callback });

				expect(() => {
					context.batch(() => {
						context.x = 'changed';
						context.y = 99;
						throw new Error('oops');
					});
				}).toThrow('oops');

				expect(context.x).toBe('hello');
				expect(context.y).toBe(42);
				expect(callback).not.toHaveBeenCalled();
			});

			test('outer batch discards all changes when an inner error propagates', () => {
				const callback = mock();
				context.subscribe({ key: 'x', callback });

				expect(() => {
					context.batch(() => {
						context.x = 'changed';
						context.batch(() => {
							throw new Error('inner');
						});
					});
				}).toThrow('inner');

				expect(context.x).toBe('hello');
				expect(callback).not.toHaveBeenCalled();
			});

			test('deletes new keys added in a failing batch: does not leave them as undefined', () => {
				expect(() => {
					context.batch(() => {
						context.brand = 'new';
						throw new Error('oops');
					});
				}).toThrow('oops');

				expect('brand' in context.target).toBe(false);
				expect(context.brand).toBeUndefined();
			});

			test('restores the pre-batch value when a key is set multiple times before throw', () => {
				expect(() => {
					context.batch(() => {
						context.x = 'first';
						context.x = 'second';
						throw new Error('oops');
					});
				}).toThrow('oops');

				expect(context.x).toBe('hello');
			});

			test('notify inside a failing batch does not prevent rollback', () => {
				const callback = mock();
				context.subscribe({ key: 'z', callback });

				expect(() => {
					context.batch(() => {
						context.z = [99];
						context.notify('z');
						throw new Error('oops');
					});
				}).toThrow('oops');

				expect(context.z).toEqual([1, 2, 3]);
				expect(callback).not.toHaveBeenCalled();
			});
		});
	});

	describe('lifecycle', () => {
		test('marks as destroyed after destroy()', () => {
			expect(context.isDestroyed).toBe(false);
			context.destroy();
			expect(context.isDestroyed).toBe(true);
		});

		test('supports Symbol.dispose', () => {
			const disposable = new Oxject({ x: 1 });
			disposable[Symbol.dispose]();
			expect(disposable.isDestroyed).toBe(true);
		});

		test('prevents event listeners on destroyed context', () => {
			context.destroy();
			expect(() => context.addEventListener('x', () => {})).not.toThrow();
		});

		test('returns destroyed subscription when already destroyed', () => {
			context.destroy();
			const result = context.subscribe({ key: 'x', callback: () => {} });
			expect(result.isDestroyed).toBe(true);
			expect(result.id).toBe(null);
		});
	});

	describe('notify', () => {
		test('triggers subscriptions without reassignment', () => {
			const callback = mock();
			context.subscribe({ key: 'z', callback });

			context.z.push(4);
			expect(callback).not.toHaveBeenCalled();

			context.notify('z');
			expect(callback).toHaveBeenCalledWith([1, 2, 3, 4]);
		});

		test('passes the current value at notification time', () => {
			const callback = mock();
			context.subscribe({ key: 'y', callback });

			context.target.y = 99;
			context.notify('y');
			expect(callback).toHaveBeenCalledWith(99);
		});

		test('fires callback with null for a key with no value', () => {
			// CustomEvent normalizes undefined detail to null per WebIDL
			const callback = mock();
			context.subscribe({ key: 'ghost', callback });
			context.notify('ghost');
			expect(callback).toHaveBeenCalledWith(null);
		});

		test('is deferred and coalesced when called inside a batch', () => {
			const callback = mock();
			context.subscribe({ key: 'z', callback });

			context.batch(() => {
				context.z.push(4);
				context.notify('z');
				context.z.push(5);
				context.notify('z');
			});

			// batch coalesces by key; fires once with the final state
			expect(callback).toHaveBeenCalledTimes(1);
			expect(callback).toHaveBeenCalledWith([1, 2, 3, 4, 5]);
		});

		test('is a no-op on destroyed context', () => {
			context.destroy();
			expect(() => context.notify('x')).not.toThrow();
		});

		test('bypasses skip-if-same: fires even when the reference is unchanged', () => {
			const callback = mock();
			context.subscribe({ key: 'z', callback });

			// same reference, mutated in place; direct assignment would skip, notify() must not
			context.z.push(99);
			context.notify('z');
			expect(callback).toHaveBeenCalledTimes(1);
			expect(callback).toHaveBeenCalledWith([1, 2, 3, 99]);
		});
	});

	describe('multi-key subscribe', () => {
		test('fires when any of the subscribed keys changes', () => {
			const callback = mock();
			context.subscribe({ keys: ['x', 'y'], callback });

			context.x = 'changed';
			expect(callback).toHaveBeenCalledWith({ x: 'changed', y: 42 });

			context.y = 99;
			expect(callback).toHaveBeenCalledWith({ x: 'changed', y: 99 });
		});

		test('returns an id that can be passed to context.unsubscribe()', () => {
			const callback = mock();
			const { id, unsubscribe } = context.subscribe({
				keys: ['x', 'y'],
				callback,
			});

			expect(typeof id).toBe('string');
			expect(id.length).toBeGreaterThan(0);

			context.unsubscribe(id);
			context.x = 'after';
			expect(callback).not.toHaveBeenCalled();

			unsubscribe(); // idempotent, should not throw
		});

		test('current returns an object with all key values at subscription time', () => {
			const { current } = context.subscribe({
				keys: ['x', 'y'],
				callback: () => {},
			});
			expect(current).toEqual({ x: 'hello', y: 42 });
		});

		test('unsubscribe stops all notifications', () => {
			const callback = mock();
			const { unsubscribe } = context.subscribe({ keys: ['x', 'y'], callback });

			context.x = 'a';
			expect(callback).toHaveBeenCalledTimes(1);

			unsubscribe();
			context.x = 'b';
			context.y = 0;
			expect(callback).toHaveBeenCalledTimes(1);
		});

		test('coalesces when both keys change in a batch', () => {
			const callback = mock();
			context.subscribe({ keys: ['x', 'y'], callback });

			context.batch(() => {
				context.x = 'batched';
				context.y = 100;
			});

			expect(callback).toHaveBeenCalledTimes(1);
			expect(callback).toHaveBeenCalledWith({ x: 'batched', y: 100 });
		});

		test('fires separately for non-batched changes', () => {
			const callback = mock();
			context.subscribe({ keys: ['x', 'y'], callback });

			context.x = 'first';
			context.y = 0;
			expect(callback).toHaveBeenCalledTimes(2);
		});

		test('does not fire after unsubscribe even if a batch was in progress', async () => {
			const callback = mock();
			const { unsubscribe } = context.subscribe({ keys: ['x', 'y'], callback });

			context.batchAsync(() => {
				context.x = 'deferred';
				context.y = 99;
			});
			unsubscribe();

			await Promise.resolve();
			expect(callback).not.toHaveBeenCalled();
		});

		test('returns destroyed result when context is already destroyed', () => {
			context.destroy();
			const result = context.subscribe({
				keys: ['x', 'y'],
				callback: () => {},
			});
			expect(result.isDestroyed).toBe(true);
		});

		test('rejects empty keys array', () => {
			expect(() => context.subscribe({ keys: [], callback: () => {} })).toThrow('non-empty array');
		});

		test('rejects non-array keys', () => {
			expect(() => context.subscribe({ keys: 'x', callback: () => {} })).toThrow('non-empty array');
		});

		test('rejects non-function callback', () => {
			expect(() => context.subscribe({ keys: ['x'], callback: 'not-a-function' })).toThrow();
		});

		test('rejects "set" in the keys array', () => {
			expect(() => context.subscribe({ keys: ['x', 'set'], callback: () => {} })).toThrow('reserved event name');
		});

		test('does not fire for keys not in the subscription', () => {
			const callback = mock();
			context.subscribe({ keys: ['x'], callback });

			context.z = [99];
			expect(callback).not.toHaveBeenCalled();

			context.x = 'yes';
			expect(callback).toHaveBeenCalledTimes(1);
		});
	});

	describe('batchAsync', () => {
		test('defers mutations to the next microtask and coalesces them', async () => {
			const callback = mock();
			context.subscribe({ key: 'x', callback });
			context.subscribe({ key: 'y', callback });

			expect(callback).not.toHaveBeenCalled();

			await context.batchAsync(() => {
				context.x = 'async-x';
				context.y = 99;
			});

			expect(callback).toHaveBeenCalledTimes(2);
			expect(context.x).toBe('async-x');
			expect(context.y).toBe(99);
		});

		test('is a no-op when the instance is destroyed before the microtask fires', async () => {
			const callback = mock();
			context.subscribe({ key: 'x', callback });

			context.batchAsync(() => {
				context.x = 'should-not-fire';
			});
			context.destroy();

			await Promise.resolve();

			expect(callback).not.toHaveBeenCalled();
		});

		test('is a no-op when called on an already-destroyed instance', () => {
			context.destroy();
			expect(() => context.batchAsync(() => {})).not.toThrow();
		});

		test('rolls back state and rejects with the thrown error when fn throws', async () => {
			const callback = mock();
			context.subscribe({ key: 'x', callback });
			context.subscribe({ key: 'y', callback });

			await expect(
				context.batchAsync(() => {
					context.x = 'changed';
					context.y = 99;
					throw new Error('async-oops');
				}),
			).rejects.toThrow('async-oops');

			expect(context.x).toBe('hello');
			expect(context.y).toBe(42);
			expect(callback).not.toHaveBeenCalled();
		});
	});

	describe('edge cases', () => {
		test('depth guard stops circular subscriptions without throwing', () => {
			const warnSpy = spyOn(console, 'warn');
			const a = new Oxject({ x: 0 });
			const b = new Oxject({ y: 0 });

			a.subscribe({
				key: 'x',
				callback: v => {
					b.y = v + 1;
				},
			});
			b.subscribe({
				key: 'y',
				callback: v => {
					a.x = v + 1;
				},
			});

			expect(() => {
				a.x = 1;
			}).not.toThrow();
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Circular dependency'));

			a.destroy();
			b.destroy();
		});

		test('destroying source Oxject before dependent does not throw', () => {
			const user = new Oxject({ name: 'Alice' });
			const app = new Oxject({ userName: user.subscriber('name') });

			user.destroy();
			expect(() => app.destroy()).not.toThrow();
			expect(app.isDestroyed).toBe(true);
		});

		test('batch does not capture mutations that run after an async boundary', async () => {
			const callback = mock();
			context.subscribe({ key: 'x', callback });

			context.batch(() => {
				context.x = 'sync';
				// mutation scheduled after the batch's sync return; not captured
				Promise.resolve().then(() => {
					context.x = 'async';
				});
			});

			// batch flushed synchronously; 'sync' has fired
			expect(callback).toHaveBeenCalledTimes(1);
			expect(callback.mock.calls[0][0]).toBe('sync');

			await Promise.resolve();

			// 'async' fired immediately when the microtask ran, not deferred
			expect(callback).toHaveBeenCalledTimes(2);
			expect(callback.mock.calls[1][0]).toBe('async');
		});
	});
});
