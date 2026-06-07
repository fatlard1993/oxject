import ErrorHandler from './ErrorHandler.js';

/**
 * Centralized cleanup management with error isolation.
 * Handles resource cleanup with automatic error handling.
 */
export default class CleanupManager {
	constructor() {
		this.cleanupTasks = [];
		this.isDestroyed = false;
	}

	/** Returns a deregister function that removes this task without running it. */
	add(cleanupFn, description = 'cleanup') {
		if (this.isDestroyed) return () => {};

		const task = { fn: cleanupFn, description };
		this.cleanupTasks.push(task);

		return () => {
			const index = this.cleanupTasks.indexOf(task);
			if (index >= 0) this.cleanupTasks.splice(index, 1);
		};
	}

	destroy() {
		if (this.isDestroyed) return;
		this.isDestroyed = true;

		// Snapshot and clear before running; tasks may call deregister(), which
		// splices the array. Iterating a mutating array skips elements.
		const tasks = this.cleanupTasks.slice();
		this.cleanupTasks.length = 0;

		for (const { fn, description } of tasks) {
			try {
				fn();
			} catch (error) {
				ErrorHandler.handleWarning(`Cleanup error (${description}): ${error.message}`);
			}
		}
	}

	get size() {
		return this.cleanupTasks.length;
	}
}
