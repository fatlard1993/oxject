import ErrorHandler from './ErrorHandler.js';

describe('ErrorHandler', () => {
	const originalIsDev = ErrorHandler.isDevelopment;
	let consoleErrorSpy;
	let consoleWarnSpy;

	afterEach(() => {
		ErrorHandler.isDevelopment = originalIsDev;
		consoleErrorSpy?.mockRestore?.();
		consoleWarnSpy?.mockRestore?.();
	});

	describe('development mode', () => {
		beforeEach(() => {
			ErrorHandler.isDevelopment = true;
			consoleErrorSpy = spyOn(console, 'error');
			consoleWarnSpy = spyOn(console, 'warn');
		});

		test('handleInitializationError logs in dev', () => {
			ErrorHandler.handleInitializationError(new Error('init fail'), {});

			expect(consoleErrorSpy).toHaveBeenCalled();
			expect(consoleErrorSpy.mock.calls[0][0]).toContain('Failed to initialize Oxject');
		});

		test('handleParserError logs in dev', () => {
			ErrorHandler.handleParserError(new Error('parse fail'), {}, 'testKey');

			expect(consoleErrorSpy).toHaveBeenCalled();
			expect(consoleErrorSpy.mock.calls[0][0]).toContain('Parser error');
		});

		test('handleValidationError always throws', () => {
			expect(() => {
				ErrorHandler.handleValidationError('bad type', 'string', 'number');
			}).toThrow(TypeError);

			expect(consoleErrorSpy).toHaveBeenCalled();
		});

		test('handleSetError warns in dev', () => {
			ErrorHandler.handleSetError('key', 42);

			expect(consoleWarnSpy).toHaveBeenCalled();
			expect(consoleWarnSpy.mock.calls[0][0]).toContain('Failed to set property');
		});

		test('handleWarning warns in dev', () => {
			ErrorHandler.handleWarning('test warning');

			expect(consoleWarnSpy).toHaveBeenCalled();
			expect(consoleWarnSpy.mock.calls[0][0]).toContain('test warning');
		});

		test('handleUnsubscribeError logs in dev', () => {
			ErrorHandler.handleUnsubscribeError(new Error('unsub fail'), 'sub-1', 'TestOxject');

			expect(consoleErrorSpy).toHaveBeenCalled();
			expect(consoleErrorSpy.mock.calls[0][0]).toContain('Unsubscribe error');
		});

		test('handleSubscriptionSetupError logs in dev', () => {
			ErrorHandler.handleSubscriptionSetupError(new Error('setup fail'), 'key');

			expect(consoleErrorSpy).toHaveBeenCalled();
			expect(consoleErrorSpy.mock.calls[0][0]).toContain('Failed to set up subscription');
		});
	});

	describe('production mode', () => {
		beforeEach(() => {
			ErrorHandler.isDevelopment = false;
			consoleErrorSpy = spyOn(console, 'error');
			consoleWarnSpy = spyOn(console, 'warn');
		});

		test('handleInitializationError is silent', () => {
			ErrorHandler.handleInitializationError(new Error('init fail'), {});

			expect(consoleErrorSpy).not.toHaveBeenCalled();
		});

		test('handleWarning is silent', () => {
			ErrorHandler.handleWarning('warning');

			expect(consoleWarnSpy).not.toHaveBeenCalled();
		});

		test('handleValidationError still throws', () => {
			expect(() => {
				ErrorHandler.handleValidationError('bad', 'string', 'number');
			}).toThrow(TypeError);
		});

		test('handleSetError is silent', () => {
			ErrorHandler.handleSetError('key', 'val');

			expect(consoleWarnSpy).not.toHaveBeenCalled();
		});
	});
});
