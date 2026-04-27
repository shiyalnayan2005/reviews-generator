import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import worker from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Reviews Generator Worker', () => {
	it('serves dashboard HTML on root path', async () => {
		const request = new IncomingRequest('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.headers.get('Content-Type')).toBe('text/html');
		const text = await response.text();
		expect(text).toContain('Reviews Generator Dashboard');
	});

	it('returns 404 for unknown routes', async () => {
		const request = new IncomingRequest('http://example.com/unknown');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
	});

	it('handles ASIN API requests', async () => {
		const request = new IncomingRequest('http://example.com/api/asin?brand=happimess');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.headers.get('Content-Type')).toBe('text/plain');
		// Should return ASIN list or error for invalid brand
	});

	it('handles invalid brand in ASIN request', async () => {
		const request = new IncomingRequest('http://example.com/api/asin?brand=invalid');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error.code).toBe('VALIDATION_ERROR');
	});

	it('processes zipped JSONL webhook payloads once', async () => {
		await env.DB.prepare(`
			CREATE TABLE IF NOT EXISTS products (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				asin TEXT UNIQUE NOT NULL,
				title TEXT,
				rating REAL,
				total_reviews INTEGER,
				created_at TEXT DEFAULT CURRENT_TIMESTAMP
			)
		`).run();
		await env.DB.prepare(`
			CREATE TABLE IF NOT EXISTS reviews (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				asin TEXT NOT NULL,
				reviewer_name TEXT,
				rating REAL,
				title TEXT,
				body TEXT,
				ai_title TEXT DEFAULT '',
				ai_body TEXT DEFAULT '',
				ai_status TEXT DEFAULT 'pending',
				created_at TEXT DEFAULT CURRENT_TIMESTAMP
			)
		`).run();

		const line = JSON.stringify({
			input: `TEST-${Date.now()}`,
			result: {
				name: 'Test Product',
				average_rating: 4.5,
				total_reviews: 1,
				reviews: [{ username: 'Tester', stars: 5, title: 'Great', review: 'Works well' }],
			},
		});
		const body = zipSync({ 'products.jsonl': strToU8(`${line}\n`) });
		const request = new IncomingRequest('http://example.com/webhook/products', {
			method: 'POST',
			headers: { 'Content-Type': 'application/zip' },
			body,
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toMatchObject({ success: true, processed: 1, total: 1 });
	});
});
