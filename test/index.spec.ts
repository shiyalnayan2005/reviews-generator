import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { beforeEach, describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import worker from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function resetWebhookTables(): Promise<void> {
	await env.DB.prepare(`DROP TABLE IF EXISTS reviews`).run();
	await env.DB.prepare(`DROP TABLE IF EXISTS products`).run();
	await env.DB.prepare(`
		CREATE TABLE products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			asin TEXT UNIQUE NOT NULL,
			title TEXT,
			handle TEXT,
			upc_code TEXT,
			rating REAL,
			total_reviews INTEGER,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP
		)
	`).run();
	await env.DB.prepare(`
		CREATE TABLE reviews (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			asin TEXT NOT NULL,
			reviewer_name TEXT,
			email TEXT,
			rating REAL,
			title TEXT,
			body TEXT,
			ai_title TEXT DEFAULT '',
			ai_body TEXT DEFAULT '',
			ai_status TEXT DEFAULT 'pending',
			created_at TEXT DEFAULT CURRENT_TIMESTAMP
		)
	`).run();
}

describe('Reviews Generator Worker', () => {
	beforeEach(async () => {
		await resetWebhookTables();
	});

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
		const line = JSON.stringify({
			input: `TEST-${Date.now()}`,
			result: {
				name: 'Test Product',
				product_information: { upc: ' 123456789012 ' },
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

	it('does not insert duplicate reviews for the same ASIN and title', async () => {
		const asin = `DUP-${Date.now()}`;
		const line = JSON.stringify({
			input: asin,
			result: {
				name: 'Duplicate Test Product',
				product_information: { upc: ' 998877665544 ' },
				average_rating: 4.5,
				total_reviews: 1,
				reviews: [{ username: 'Tester', title: 'Great\n5.0 out of 5 stars', review: 'Works well' }],
			},
		});
		const body = zipSync({ 'products.jsonl': strToU8(`${line}\n${line}\n`) });
		const request = new IncomingRequest('http://example.com/webhook/products', {
			method: 'POST',
			headers: { 'Content-Type': 'application/zip' },
			body,
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const reviewCount = await env.DB.prepare(`SELECT COUNT(*) as total FROM reviews WHERE asin = ?`).bind(asin).first<{ total: number }>();
		const review = await env.DB.prepare(`SELECT rating, title FROM reviews WHERE asin = ?`).bind(asin).first<{ rating: number; title: string }>();
		const product = await env.DB.prepare(`SELECT upc_code FROM products WHERE asin = ?`).bind(asin).first<{ upc_code: string }>();

		expect(reviewCount?.total).toBe(1);
		expect(review?.rating).toBe(1);
		expect(review?.title).toBe('Great');
		expect(product?.upc_code).toBe('998877665544');
	});
});
