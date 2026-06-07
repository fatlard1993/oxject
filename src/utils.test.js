import { isDev } from './utils.js';

describe('isDev', () => {
	test('is true when not explicitly in a production environment', () => {
		// test environment has no NODE_ENV=production set
		expect(isDev).toBe(true);
	});

	test('is false when NODE_ENV is production', async () => {
		// isDev is an IIFE evaluated at import time; testing the production branch
		// requires a fresh module load in a subprocess with the env var set
		const proc = Bun.spawn(['bun', '--eval', 'const { isDev } = await import("./src/utils.js"); console.log(isDev)'], {
			env: { ...process.env, NODE_ENV: 'production' },
			cwd: import.meta.dir + '/..',
		});
		const text = await new Response(proc.stdout).text();
		expect(text.trim()).toBe('false');
	});
});
