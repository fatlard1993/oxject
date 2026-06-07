export const isDev = (() => {
	try {
		if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') return false;
		if (typeof import.meta !== 'undefined' && import.meta.env?.PROD === true) return false;
		return true;
	} catch {
		return true;
	}
})();

export const genId =
	typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? () => crypto.randomUUID()
		: () => Math.random().toString(36).slice(2, 11) + Math.random().toString(36).slice(2, 11);
