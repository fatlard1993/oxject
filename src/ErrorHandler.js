/* eslint-disable no-console */

import { isDev } from './utils.js';

/**
 * Centralized error handling for Oxject and Subscriber classes.
 * Environment-aware logging: verbose in development, silent in production.
 */
export default class ErrorHandler {
	/**
	 * Whether we're in development mode (enables verbose logging).
	 * Initialized from the shared isDev utility; can be overridden in tests.
	 * @type {boolean}
	 */
	static isDevelopment = isDev;

	/**
	 * Handle Oxject initialization errors.
	 * @param {Error} error - The error that occurred
	 * @param {*} target - The target that failed to initialize
	 */
	static handleInitializationError(error, target) {
		const message = `Failed to initialize Oxject with target: ${error.message}`;

		if (this.isDevelopment) {
			console.error(`[Oxject] ${message}`, {
				error: error.message,
				target: typeof target,
				stack: error.stack,
			});
		}
	}

	/**
	 * Handle parser function errors.
	 * @param {Error} error - The error that occurred
	 * @param {object} context - The context where the error occurred
	 * @param {string} key - The property key to parse
	 * @param {string} [operation] - The operation to perform
	 */
	static handleParserError(error, context, key, operation = 'parse') {
		const message = `Parser error in ${operation} for key "${key}": ${error.message}`;

		if (this.isDevelopment) {
			console.error(`[Oxject] ${message}`, {
				error: error.message,
				context: context?.constructor?.name || 'Unknown',
				key,
				operation,
				stack: error.stack,
			});
		}
	}

	/**
	 * Handle validation errors (always throws).
	 * @param {string} message - The validation error message
	 * @param {string} received -
	 * @param {string} expected -
	 * @throws {TypeError} Always throws validation errors
	 */
	static handleValidationError(message, received, expected) {
		const error = new TypeError(`[Oxject] ${message}. Expected ${expected}, received ${received}`);

		if (this.isDevelopment) {
			console.error(error.message, {
				expected,
				received,
				stack: error.stack,
			});
		}

		throw error;
	}

	/**
	 * Handle property set operation failures.
	 * @param {string|symbol} key - The property key that failed to set
	 * @param {*} value - The value that failed to set
	 */
	static handleSetError(key, value) {
		const message = `Failed to set property "${String(key)}" to value of type ${typeof value}`;

		if (this.isDevelopment) {
			console.warn(`[Oxject] ${message}`, {
				key: String(key),
				valueType: typeof value,
			});
		}
	}

	/**
	 * Handle general warnings.
	 * @param {string} message - The warning message
	 */
	static handleWarning(message) {
		if (this.isDevelopment) {
			console.warn(`[Oxject] ${message}`);
		}
	}

	/**
	 * Handle subscription cleanup errors.
	 * @param {Error} error - The error that occurred
	 * @param {string} id - The subscription ID that failed to unsubscribe
	 * @param {string} contextName - The name of the context
	 */
	static handleUnsubscribeError(error, id, contextName = 'Unknown') {
		const message = `Unsubscribe error for subscription "${id}": ${error.message}`;

		if (this.isDevelopment) {
			console.error(`[Oxject] ${message}`, {
				error: error.message,
				context: contextName,
				subscriptionId: id,
				stack: error.stack,
			});
		}
	}

	/**
	 * Handle subscription setup failures.
	 * @param {Error} error - The error that occurred
	 * @param {string} key - The subscription key
	 * @param {string} [contextName] - The name of the context
	 */
	static handleSubscriptionSetupError(error, key, contextName = 'Unknown') {
		const message = `Failed to set up subscription for key "${key}": ${error.message}`;

		if (this.isDevelopment) {
			console.error(`[Oxject] ${message}`, {
				error: error.message,
				context: contextName,
				key,
				stack: error.stack,
			});
		}
	}
}
