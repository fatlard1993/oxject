import Oxject from './Oxject.js';
import { derive } from './derive.js';

describe('derive()', () => {
	let state;

	beforeEach(() => {
		state = new Oxject({ x: 1, y: 2, flag: true, a: 'A', b: 'B' });
	});

	afterEach(() => {
		state?.destroy();
	});

	describe('basic derivation', () => {
		test('computes initial value from selector', () => {
			const sum = derive(
				() => [state.x, state.y],
				(x, y) => x + y,
			);
			expect(sum.toJSON()).toBe(3);
			sum.destroy();
		});

		test('combiner receives values in selector array order', () => {
			const d = derive(
				() => [state.x, state.y],
				(x, y) => `${x}/${y}`,
			);
			expect(d.toJSON()).toBe('1/2');
			d.destroy();
		});

		test('updates when a dep changes', () => {
			const sum = derive(
				() => [state.x, state.y],
				(x, y) => x + y,
			);
			state.x = 10;
			expect(sum.toJSON()).toBe(12);
			sum.destroy();
		});

		test('updates for each dep independently', () => {
			const sum = derive(
				() => [state.x, state.y],
				(x, y) => x + y,
			);
			state.y = 100;
			expect(sum.toJSON()).toBe(101);
			state.x = 5;
			expect(sum.toJSON()).toBe(105);
			sum.destroy();
		});

		test('proxy delegates property access to current value', () => {
			const label = derive(
				() => [state.x],
				x => `val:${x}`,
			);
			expect(label.length).toBe(5);
			state.x = 99;
			expect(label.length).toBe(6);
			label.destroy();
		});
	});

	describe('cross-instance derivation', () => {
		test('tracks deps across multiple Oxject instances', () => {
			const user = new Oxject({ firstName: 'Alice', lastName: 'Smith' });
			const auth = new Oxject({ logins: 3 });

			const label = derive(
				() => [user.firstName, user.lastName, auth.logins],
				(first, last, logins) => `${first} ${last} has logged in ${logins} times`,
			);

			expect(label.toJSON()).toBe('Alice Smith has logged in 3 times');

			user.firstName = 'Bob';
			expect(label.toJSON()).toBe('Bob Smith has logged in 3 times');

			auth.logins = 10;
			expect(label.toJSON()).toBe('Bob Smith has logged in 10 times');

			label.destroy();
			user.destroy();
			auth.destroy();
		});
	});

	describe('subscription', () => {
		test('notifies subscribers when a dep changes', () => {
			const callback = mock();
			const sum = derive(
				() => [state.x, state.y],
				(x, y) => x + y,
			);
			const { current } = sum.subscribe(callback);

			expect(current).toBe(3);

			state.x = 10;
			expect(callback).toHaveBeenCalledWith(12);

			state.y = 5;
			expect(callback).toHaveBeenCalledWith(15);

			sum.destroy();
		});

		test('multiple subscribers each receive updates', () => {
			const cb1 = mock();
			const cb2 = mock();
			const sum = derive(
				() => [state.x, state.y],
				(x, y) => x + y,
			);

			sum.subscribe(cb1);
			sum.subscribe(cb2);

			state.x = 5;
			expect(cb1).toHaveBeenCalledWith(7);
			expect(cb2).toHaveBeenCalledWith(7);

			sum.destroy();
		});

		test('unsubscribe stops delivery', () => {
			const callback = mock();
			const sum = derive(
				() => [state.x, state.y],
				(x, y) => x + y,
			);
			const { unsubscribe } = sum.subscribe(callback);

			state.x = 5;
			expect(callback).toHaveBeenCalledTimes(1);

			unsubscribe();
			state.x = 99;
			expect(callback).toHaveBeenCalledTimes(1);

			sum.destroy();
		});

		test('a failing callback does not stop other callbacks', () => {
			const good = mock();
			const bad = mock(() => {
				throw new Error('callback error');
			});
			const sum = derive(
				() => [state.x],
				x => x,
			);

			sum.subscribe(good);
			sum.subscribe(bad);

			expect(() => {
				state.x = 5;
			}).not.toThrow();
			expect(good).toHaveBeenCalledWith(5);
			expect(bad).toHaveBeenCalledWith(5);

			sum.destroy();
		});
	});

	describe('static dependencies', () => {
		test('deps are locked at construction: conditional branch not active on first run is not subscribed', () => {
			// flag=true on construction → state.a is read, state.b is not
			// state.b changes must not trigger
			const callback = mock();
			const d = derive(
				() => [state.flag, state.flag ? state.a : state.b],
				(flag, val) => val,
			);
			d.subscribe(callback);

			state.b = 'changed'; // not a dep, must not fire
			expect(callback).not.toHaveBeenCalled();

			state.a = 'A2'; // is a dep, must fire
			expect(callback).toHaveBeenCalledWith('A2');

			d.destroy();
		});

		test('conditional logic belongs in the combiner, not the selector', () => {
			// All deps declared explicitly; combiner handles the branch
			const callback = mock();
			const d = derive(
				() => [state.flag, state.a, state.b],
				(flag, a, b) => (flag ? a : b),
			);
			d.subscribe(callback);

			state.flag = false;
			expect(callback).toHaveBeenCalledWith('B');

			state.b = 'B2';
			expect(callback).toHaveBeenCalledWith('B2');

			state.a = 'irrelevant-but-subscribed'; // subscribed, fires, combiner picks b anyway
			expect(callback).toHaveBeenCalledTimes(3);

			d.destroy();
		});
	});

	describe('memoize option', () => {
		test('skips notification when result is reference-equal to previous', () => {
			const callback = mock();
			const sign = derive(
				() => [state.x],
				x => (x > 0 ? 'positive' : 'non-positive'),
				{ memoize: true },
			);
			sign.subscribe(callback);

			state.x = 2; // still positive, same string reference
			expect(callback).not.toHaveBeenCalled();

			state.x = -1;
			expect(callback).toHaveBeenCalledWith('non-positive');
			expect(callback).toHaveBeenCalledTimes(1);

			sign.destroy();
		});

		test('still notifies when result changes', () => {
			const callback = mock();
			const doubled = derive(
				() => [state.x],
				x => x * 2,
				{ memoize: true },
			);
			doubled.subscribe(callback);

			state.x = 5;
			expect(callback).toHaveBeenCalledWith(10);

			doubled.destroy();
		});
	});

	describe('batch coalescing', () => {
		test('fires once when two deps change in a single batch', () => {
			const callback = mock();
			const sum = derive(
				() => [state.x, state.y],
				(x, y) => x + y,
			);
			sum.subscribe(callback);

			state.batch(() => {
				state.x = 10;
				state.y = 10;
			});

			expect(callback).toHaveBeenCalledTimes(1);
			expect(callback).toHaveBeenCalledWith(20);

			sum.destroy();
		});

		test('still notifies synchronously for non-batch changes', () => {
			const callback = mock();
			const sum = derive(
				() => [state.x, state.y],
				(x, y) => x + y,
			);
			sum.subscribe(callback);

			state.x = 10;
			expect(callback).toHaveBeenCalledTimes(1);
			expect(callback).toHaveBeenCalledWith(12);

			sum.destroy();
		});

		test('post-batch flush is a no-op if derive is destroyed before the batch ends', () => {
			const callback = mock();
			const sum = derive(
				() => [state.x, state.y],
				(x, y) => x + y,
			);
			sum.subscribe(callback);

			const { unsubscribe } = state.subscribe({
				key: 'x',
				callback: () => sum.destroy(),
			});

			state.batch(() => {
				state.x = 10;
				state.y = 10;
			});

			expect(callback).not.toHaveBeenCalled();
			unsubscribe();
		});
	});

	describe('lifecycle', () => {
		test('isDestroyed is false before destroy', () => {
			const d = derive(
				() => [state.x],
				x => x,
			);
			expect(d.isDestroyed).toBe(false);
			d.destroy();
		});

		test('isDestroyed is true after destroy', () => {
			const d = derive(
				() => [state.x],
				x => x,
			);
			d.destroy();
			expect(d.isDestroyed).toBe(true);
		});

		test('stops updating after destroy', () => {
			const callback = mock();
			const sum = derive(
				() => [state.x, state.y],
				(x, y) => x + y,
			);
			sum.subscribe(callback);
			sum.destroy();

			state.x = 99;
			expect(callback).not.toHaveBeenCalled();
		});

		test('supports Symbol.dispose', () => {
			const d = derive(
				() => [state.x],
				x => x,
			);
			d[Symbol.dispose]();
			expect(d.isDestroyed).toBe(true);
		});

		test('throws when selector has no reactive dependencies', () => {
			expect(() =>
				derive(
					() => [42],
					x => x,
				),
			).toThrow('no reactive dependencies');
		});

		test('survives the source Oxject being destroyed', () => {
			const src = new Oxject({ n: 1 });
			const d = derive(
				() => [src.n],
				n => n * 2,
			);
			src.destroy();
			expect(() => d.destroy()).not.toThrow();
		});
	});

	describe('toBoolean()', () => {
		test('warns when called inside a derive() selector: dep is not tracked', () => {
			const warnSpy = spyOn(console, 'warn');
			const sign = derive(
				() => [state.x],
				x => x > 0,
			);

			// sign.toBoolean() called inside the selector, not tracked as a dep
			// state.y is tracked, but sign is not
			const outer = derive(
				() => [state.y, sign.toBoolean()],
				(y, positive) => `${y}: ${positive}`,
			);

			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('toBoolean()'));

			outer.destroy();
			sign.destroy();
		});

		test('returns correct boolean for truthy derived value', () => {
			const d = derive(
				() => [state.x],
				x => x > 0,
			);
			expect(d.toBoolean()).toBe(true);
			d.destroy();
		});

		test('returns false for falsy derived value', () => {
			const d = derive(
				() => [state.x],
				x => x - 1,
			);
			expect(d.toBoolean()).toBe(false);
			d.destroy();
		});

		test('reflects live changes', () => {
			const d = derive(
				() => [state.x],
				x => x > 0,
			);
			expect(d.toBoolean()).toBe(true);
			state.x = 0;
			expect(d.toBoolean()).toBe(false);
			d.destroy();
		});
	});

	describe('validation', () => {
		test('rejects non-function selector', () => {
			expect(() => derive('not a function', x => x)).toThrow('derive() selector must be a function');
		});

		test('rejects non-function combiner', () => {
			expect(() => derive(() => [state.x], 'not a function')).toThrow('derive() combiner must be a function');
		});
	});

	describe('proxy transparency', () => {
		test('template literal coercion works', () => {
			const label = derive(
				() => [state.x],
				x => `count: ${x}`,
			);
			expect(`${label}`).toBe('count: 1');
			state.x = 7;
			expect(`${label}`).toBe('count: 7');
			label.destroy();
		});

		test('valueOf() returns current value', () => {
			const sum = derive(
				() => [state.x, state.y],
				(x, y) => x + y,
			);
			expect(sum.valueOf()).toBe(3);
			state.x = 10;
			expect(sum.valueOf()).toBe(12);
			sum.destroy();
		});

		test('toString() on null/undefined derived value does not throw', () => {
			const nullD = derive(
				() => [state.x],
				() => null,
			);
			const undefD = derive(
				() => [state.x],
				() => undefined,
			);

			expect(() => nullD.toString()).not.toThrow();
			expect(nullD.toString()).toBe('null');
			expect(() => undefD.toString()).not.toThrow();
			expect(undefD.toString()).toBe('undefined');

			nullD.destroy();
			undefD.destroy();
		});
	});
});
