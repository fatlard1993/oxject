import Oxject from './Oxject.js';

describe('subscriber()', () => {
	let context;

	beforeEach(() => {
		context = new Oxject({ value: 'hello', count: 42, items: [1, 2, 3] });
	});

	afterEach(() => {
		context?.destroy();
	});

	describe('validation', () => {
		test('rejects non-string key', () => {
			expect(() => context.subscriber(123)).toThrow('subscriber() key must be a string');
		});

		test('rejects non-function parser', () => {
			expect(() => context.subscriber('value', 'not-a-function')).toThrow('subscriber() parser must be a function');
		});

		test('rejects reserved key', () => {
			expect(() => context.subscriber('set')).toThrow('reserved event name');
		});

		test('returns null on destroyed context', () => {
			context.destroy();
			expect(context.subscriber('value')).toBe(null);
		});
	});

	describe('value access', () => {
		test('provides transparent access to string value', () => {
			const sub = context.subscriber('value');
			expect(sub.toString()).toBe('hello');
			expect(sub.length).toBe(5);
			expect(sub.slice(0, 2)).toBe('he');
			expect(sub.toUpperCase()).toBe('HELLO');
			sub.destroy();
		});

		test('provides transparent access to array value', () => {
			const sub = context.subscriber('items');
			expect(sub.length).toBe(3);
			expect(sub[0]).toBe(1);
			expect(sub.slice(1)).toEqual([2, 3]);
			expect(sub.map(x => x * 2)).toEqual([2, 4, 6]);
			sub.destroy();
		});

		test('provides transparent access to numeric value', () => {
			const sub = context.subscriber('count');
			expect(sub + 8).toBe(50);
			expect(sub.toString()).toBe('42');
			sub.destroy();
		});

		test('updates reactively when context property changes', () => {
			const sub = context.subscriber('value');
			expect(sub.toString()).toBe('hello');
			context.value = 'world';
			expect(sub.toString()).toBe('world');
			sub.destroy();
		});

		test('applies parser to current value', () => {
			const sub = context.subscriber('value', s => s.toUpperCase());
			expect(sub.toString()).toBe('HELLO');
			context.value = 'world';
			expect(sub.toString()).toBe('WORLD');
			sub.destroy();
		});

		test('handles null value without throwing', () => {
			context.value = null;
			const sub = context.subscriber('value');
			expect(sub.toJSON()).toBe(null);
			sub.destroy();
		});
	});

	describe('subscription', () => {
		test('fires callback on change', () => {
			const sub = context.subscriber('value');
			const cb = mock();
			const { unsubscribe, current } = sub.subscribe(cb);

			expect(current).toBe('hello');
			context.value = 'world';
			expect(cb).toHaveBeenCalledWith('world');

			unsubscribe();
			context.value = 'again';
			expect(cb).toHaveBeenCalledTimes(1);
			sub.destroy();
		});

		test('multiple callbacks all receive updates', () => {
			const sub = context.subscriber('value');
			const cb1 = mock();
			const cb2 = mock();

			sub.subscribe(cb1);
			sub.subscribe(cb2);

			context.value = 'world';
			expect(cb1).toHaveBeenCalledWith('world');
			expect(cb2).toHaveBeenCalledWith('world');
			sub.destroy();
		});

		test('__isDerived is true', () => {
			const sub = context.subscriber('value');
			expect(sub.__isDerived).toBe(true);
			sub.destroy();
		});

		test('isDestroyed reflects lifecycle', () => {
			const sub = context.subscriber('value');
			expect(sub.isDestroyed).toBe(false);
			sub.destroy();
			expect(sub.isDestroyed).toBe(true);
		});

		test('supports Symbol.dispose', () => {
			const sub = context.subscriber('value');
			sub[Symbol.dispose]();
			expect(sub.isDestroyed).toBe(true);
		});
	});

	describe('memoize option', () => {
		test('skips notification when output is reference-equal', () => {
			const cb = mock();
			const sub = context.subscriber('count', x => (x > 0 ? 'positive' : 'non-positive'), { memoize: true });
			sub.subscribe(cb);

			context.count = 99;
			expect(cb).not.toHaveBeenCalled();

			context.count = -1;
			expect(cb).toHaveBeenCalledWith('non-positive');
			sub.destroy();
		});
	});

	describe('as initial value', () => {
		test('can be passed as initial value to another Oxject', () => {
			const sub = context.subscriber('value', s => s.toUpperCase());
			const app = new Oxject({ name: sub });

			expect(app.name).toBe('HELLO');
			context.value = 'world';
			expect(app.name).toBe('WORLD');

			app.destroy();
			sub.destroy();
		});
	});

	describe('coercion', () => {
		test('template literal coercion works', () => {
			const sub = context.subscriber('value');
			expect(`${sub}`).toBe('hello');
			context.value = 'world';
			expect(`${sub}`).toBe('world');
			sub.destroy();
		});

		test('toJSON() returns current value', () => {
			const sub = context.subscriber('count');
			expect(sub.toJSON()).toBe(42);
			context.count = 99;
			expect(sub.toJSON()).toBe(99);
			sub.destroy();
		});

		test('toBoolean() evaluates correctly for falsy values', () => {
			context.value = '';
			const sub = context.subscriber('value');
			expect(sub.toBoolean()).toBe(false);
			context.value = 'hello';
			expect(sub.toBoolean()).toBe(true);
			sub.destroy();
		});
	});
});
