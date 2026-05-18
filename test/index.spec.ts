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
	await env.DB.prepare(
		`
		CREATE TABLE products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			asin TEXT NOT NULL,
			brand_name TEXT NOT NULL,
			title TEXT,
			handle TEXT,
			upc_code TEXT,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(asin, brand_name)
		)
	`,
	).run();
	await env.DB.prepare(
		`
		CREATE TABLE reviews (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			asin TEXT NOT NULL,
			brand_name TEXT NOT NULL,
			reviewer_name TEXT,
			email TEXT,
			rating REAL,
			title TEXT,
			date TEXT,
			body TEXT,
			ai_title TEXT DEFAULT '',
			ai_body TEXT DEFAULT '',
			ai_status TEXT DEFAULT 'pending',
			created_at TEXT DEFAULT CURRENT_TIMESTAMP
		)
	`,
	).run();
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
		expect([200, 500]).toContain(response.status);
		// Should return an ASIN list when network is available, or a scrape error in isolated tests.
	});

	it('requires brand in webhook requests', async () => {
		const request = new IncomingRequest('http://example.com/webhook/products', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ payloads: [] }),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(400);
		const data = await response.json<any>();
		expect(data.error.message).toBe('brand is required');
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
				reviews: [{ username: 'Tester', stars: 5, title: 'Great', review: 'Works well', date: 'Reviewed in the United States on January 25, 2026' }],
			},
		});
		const body = zipSync({ 'products.jsonl': strToU8(`${line}\n`) });
		const request = new IncomingRequest('http://example.com/webhook/products?brand=happimess', {
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
				reviews: [{ username: 'Tester', title: 'Great\n5.0 out of 5 stars', review: 'Works well', date: 'Reviewed in the United States on January 25, 2026' }],
			},
		});
		const body = zipSync({ 'products.jsonl': strToU8(`${line}\n${line}\n`) });
		const request = new IncomingRequest('http://example.com/webhook/products?brand=happimess', {
			method: 'POST',
			headers: { 'Content-Type': 'application/zip' },
			body,
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const reviewCount = await env.DB.prepare(`SELECT COUNT(*) as total FROM reviews WHERE asin = ?`).bind(asin).first<{ total: number }>();
		const review = await env.DB.prepare(`SELECT rating, title, date FROM reviews WHERE asin = ?`)
			.bind(asin)
			.first<{ rating: number; title: string; date: string }>();
		const product = await env.DB.prepare(`SELECT upc_code FROM products WHERE asin = ?`).bind(asin).first<{ upc_code: string }>();

		expect(reviewCount?.total).toBe(1);
		expect(review?.rating).toBe(1);
		expect(review?.title).toBe('Great');
		expect(review?.date).toBe('01/25/2026');
		expect(product?.upc_code).toBe('998877665544');
	});

	it('bulk imports products and reports invalid rows without stopping', async () => {
		const asin = `BULK-P-${Date.now()}`;
		const request = new IncomingRequest('http://example.com/api/products/bulk?brand=happimess', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				products: [
					{ asin, title: 'Bulk Product', upc_code: '111222333444', handle: 'bulk-product' },
					{ asin: '', title: 'Missing ASIN' },
					{ asin: `${asin}-NO-TITLE` },
				],
			}),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const data = await response.json<any>();
		expect(data).toMatchObject({ success: true, total: 3, processed: 1, failed: 2 });

		const product = await env.DB.prepare(`SELECT title, upc_code, handle FROM products WHERE asin = ?`)
			.bind(asin)
			.first<{ title: string; upc_code: string; handle: string }>();
		expect(product).toMatchObject({ title: 'Bulk Product', upc_code: '111222333444', handle: 'bulk-product' });
	});

	it('bulk imports product reviews from simple product JSON', async () => {
		const asin = `BULK-WEBHOOK-${Date.now()}`;
		const request = new IncomingRequest('http://example.com/api/products/bulk?brand=happimess', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				products: [
					{
						asin,
						title: 'Bulk Product With Reviews',
						upc_code: '',
						reviews: [
							{ reviewer_name: 'Tester', review_count: '5.05', title: 'Great', content: 'Works well', date: 'Reviewed in the United States on January 25, 2026' },
							{ reviewer_name: 'Tester', review_count: '4.05', title: 'Good', content: 'Pretty useful' },
							{ reviewer_name: 'Tester', review_count: 3, title: 'Great', content: 'Duplicate title' },
							{ reviewer_name: 'Tester', review_count: 2, title: 'Missing body', content: '' },
						],
					},
				],
			}),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const data = await response.json<any>();
		expect(data).toMatchObject({ success: true, total: 1, processed: 1, failed: 0, reviewsInserted: 2, reviewsSkipped: 2, reviewsFailed: 0 });
		expect(data.results[0].reviewDetails).toEqual([
			'Review #3 "Great": skipped because a review with this title already exists for this ASIN.',
			'Review #4 "Missing body": skipped because review content is required.',
		]);

		const product = await env.DB.prepare(`SELECT title FROM products WHERE asin = ?`).bind(asin).first<{ title: string }>();
		const reviewCount = await env.DB.prepare(`SELECT COUNT(*) as total FROM reviews WHERE asin = ?`).bind(asin).first<{ total: number }>();
		const review = await env.DB.prepare(`SELECT reviewer_name, rating, title, body, date FROM reviews WHERE asin = ? AND title = ?`)
			.bind(asin, 'Great')
			.first<{ reviewer_name: string; rating: number; title: string; body: string; date: string }>();

		expect(product).toMatchObject({ title: 'Bulk Product With Reviews' });
		expect(reviewCount?.total).toBe(2);
		expect(review).toMatchObject({ reviewer_name: 'Tester', rating: 5, title: 'Great', body: 'Works well', date: '01/25/2026' });
	});

	it('bulk imports products when the products table is missing the ASIN brand unique constraint', async () => {
		await env.DB.prepare(`DROP TABLE IF EXISTS products`).run();
		await env.DB.prepare(
			`
			CREATE TABLE products (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				asin TEXT NOT NULL,
				brand_name TEXT NOT NULL,
				title TEXT,
				handle TEXT,
				upc_code TEXT,
				created_at TEXT DEFAULT CURRENT_TIMESTAMP
			)
		`,
		).run();

		const asin = `BULK-LEGACY-${Date.now()}`;
		const firstRequest = new IncomingRequest('http://example.com/api/products/bulk?brand=happimess', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ products: [{ asin, title: 'Legacy Product', upc_code: '111222333444', handle: 'legacy-product' }] }),
		});
		const firstCtx = createExecutionContext();
		const firstResponse = await worker.fetch(firstRequest, env, firstCtx);
		await waitOnExecutionContext(firstCtx);
		expect(firstResponse.status).toBe(200);

		const secondRequest = new IncomingRequest('http://example.com/api/products/bulk?brand=happimess', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ products: [{ asin, title: 'Updated Legacy Product', upc_code: '999888777666', handle: 'updated-legacy-product' }] }),
		});
		const secondCtx = createExecutionContext();
		const secondResponse = await worker.fetch(secondRequest, env, secondCtx);
		await waitOnExecutionContext(secondCtx);

		expect(secondResponse.status).toBe(200);
		const product = await env.DB.prepare(`SELECT title, upc_code, handle FROM products WHERE asin = ? AND brand_name = ?`)
			.bind(asin, 'happimess')
			.first<{ title: string; upc_code: string; handle: string }>();
		expect(product).toMatchObject({ title: 'Updated Legacy Product', upc_code: '999888777666', handle: 'updated-legacy-product' });
	});

	it('bulk imports reviews and reports duplicates and invalid rows without stopping', async () => {
		const asin = `BULK-R-${Date.now()}`;
		await env.DB.prepare(`INSERT INTO products (asin, brand_name, title) VALUES (?, ?, ?)`).bind(asin, 'happimess', 'Review Product').run();

		const request = new IncomingRequest('http://example.com/api/reviews/bulk?brand=happimess', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([
				{ asin, reviewer_name: 'Amazon Customer', review_count: 4, title: 'Looks good', content: 'Nice product.', date: 'Reviewed in the United States on January 25, 2026' },
				{ asin, reviewer_name: 'Amazon Customer', review_count: 4, title: 'Looks good', content: 'Duplicate title.' },
				{ asin: 'MISSING-ASIN', reviewer_name: 'Tessa', review_count: 5, title: 'Get it!', content: 'Great.' },
				{ asin, reviewer_name: 'No Rating', title: 'No rating', content: 'Missing rating.' },
			]),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const data = await response.json<any>();
		expect(data).toMatchObject({ success: true, total: 4, processed: 1, skipped: 1, failed: 2 });

		const review = await env.DB.prepare(`SELECT reviewer_name, rating, title, body, date FROM reviews WHERE asin = ?`)
			.bind(asin)
			.first<{ reviewer_name: string; rating: number; title: string; body: string; date: string }>();
		expect(review).toMatchObject({ reviewer_name: 'Amazon Customer', rating: 4, title: 'Looks good', body: 'Nice product.', date: '01/25/2026' });
	});

	it('applies random dates only to reviews with blank dates', async () => {
		const asin = `RAND-DATE-${Date.now()}`;
		await env.DB.prepare(`INSERT INTO products (asin, brand_name, title) VALUES (?, ?, ?)`).bind(asin, 'happimess', 'Random Date Product').run();
		await env.DB.batch([
			env.DB.prepare(`INSERT INTO reviews (asin, brand_name, reviewer_name, rating, title, body, date) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
				asin,
				'happimess',
				'Blank Date',
				5,
				'Blank one',
				'Needs date.',
				'',
			),
			env.DB.prepare(`INSERT INTO reviews (asin, brand_name, reviewer_name, rating, title, body, date) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
				asin,
				'happimess',
				'Null Date',
				4,
				'Blank two',
				'Also needs date.',
				null,
			),
			env.DB.prepare(`INSERT INTO reviews (asin, brand_name, reviewer_name, rating, title, body, date) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
				asin,
				'happimess',
				'Existing Date',
				3,
				'Already dated',
				'Keep this date.',
				'12/31/2025',
			),
		]);

		const request = new IncomingRequest('http://example.com/api/reviews/random-dates?brand=happimess', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ startDate: '2026-01-01', endDate: '2026-01-03' }),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const data = await response.json<any>();
		expect(data).toMatchObject({ success: true, matched: 2, updated: 2 });

		const reviews = await env.DB.prepare(`SELECT title, date FROM reviews WHERE asin = ? ORDER BY title`).bind(asin).all<{ title: string; date: string }>();
		const byTitle = Object.fromEntries((reviews.results || []).map((review) => [review.title, review.date]));
		expect(['01/01/2026', '01/02/2026', '01/03/2026']).toContain(byTitle['Blank one']);
		expect(['01/01/2026', '01/02/2026', '01/03/2026']).toContain(byTitle['Blank two']);
		expect(byTitle['Already dated']).toBe('12/31/2025');
	});
});
