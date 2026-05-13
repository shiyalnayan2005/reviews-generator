import { Review, Product, ProductInsertData, ReviewInsertData, D1BatchResult } from '../types';
import { DatabaseError } from '../lib/errors';
import { AIReviewOutput } from './aiService';

export interface ShopifyProductUpdateCandidate {
	asin: string;
	upc_code: string;
	handle: string | null;
}

export async function insertProduct(env: Env, data: ProductInsertData): Promise<void> {
	try {
		const title = data.name || null;
		const handle = data.handle || null;
		const upcCode = data.upc_code || null;

		try {
			await env.DB.prepare(
				`
				INSERT INTO products (asin, brand_name, title, handle, upc_code)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(asin, brand_name) DO UPDATE SET
					title = excluded.title,
					handle = excluded.handle,
					upc_code = excluded.upc_code
			`,
			)
				.bind(data.asin, data.brand_name, title, handle, upcCode)
				.run();
			return;
		} catch (error) {
			if (!isMissingProductConflictConstraintError(error)) throw error;
		}

		await upsertProductWithoutConflictConstraint(env, data.asin, data.brand_name, title, handle, upcCode);
	} catch (error) {
		throw new DatabaseError(`Failed to insert product: ${error}`);
	}
}

function isMissingProductConflictConstraintError(error: unknown): boolean {
	return String(error).includes('ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint');
}

async function upsertProductWithoutConflictConstraint(
	env: Env,
	asin: string,
	brandName: string,
	title: string | null,
	handle: string | null,
	upcCode: string | null,
): Promise<void> {
	const updateResult = await env.DB.prepare(
		`
		UPDATE products
		SET title = ?, handle = ?, upc_code = ?
		WHERE asin = ? AND brand_name = ?
	`,
	)
		.bind(title, handle, upcCode, asin, brandName)
		.run();

	if ((updateResult.meta?.changes || 0) > 0) return;

	await env.DB.prepare(
		`
		INSERT INTO products (asin, brand_name, title, handle, upc_code)
		VALUES (?, ?, ?, ?, ?)
	`,
	)
		.bind(asin, brandName, title, handle, upcCode)
		.run();
}

export async function getProductsForShopifyUpdate(env: Env, brand: string, limit: number = 25): Promise<ShopifyProductUpdateCandidate[]> {
	try {
		const result = await env.DB.prepare(
			`
			SELECT asin, upc_code, handle
			FROM products
			WHERE brand_name = ? AND upc_code IS NOT NULL AND TRIM(upc_code) != ''
			ORDER BY
				CASE WHEN handle IS NULL OR TRIM(handle) = '' THEN 0 ELSE 1 END,
				created_at DESC
			LIMIT ?
		`,
		)
			.bind(brand, limit)
			.all<ShopifyProductUpdateCandidate>();
		return result.results || [];
	} catch (error) {
		throw new DatabaseError(`Failed to get products for Shopify update: ${error}`);
	}
}

export async function updateProductShopifyHandle(env: Env, brand: string, asin: string, handle: string): Promise<void> {
	try {
		await env.DB.prepare(`UPDATE products SET handle = ? WHERE brand_name = ? AND asin = ?`)
			.bind(handle || null, brand, asin)
			.run();
	} catch (error) {
		throw new DatabaseError(`Failed to update Shopify product handle: ${error}`);
	}
}

export async function updateProduct(
	env: Env,
	brand: string,
	asin: string,
	data: { title?: string; upc_code?: string; handle?: string },
): Promise<void> {
	try {
		const updates = [];
		const params = [];

		if (data.title !== undefined) {
			updates.push('title = ?');
			params.push(data.title || null);
		}
		if (data.upc_code !== undefined) {
			updates.push('upc_code = ?');
			params.push(data.upc_code || null);
		}
		if (data.handle !== undefined) {
			updates.push('handle = ?');
			params.push(data.handle || null);
		}

		if (updates.length === 0) return;

		const sql = `UPDATE products SET ${updates.join(', ')} WHERE brand_name = ? AND asin = ?`;
		params.push(brand, asin);

		await env.DB.prepare(sql)
			.bind(...params)
			.run();
	} catch (error) {
		throw new DatabaseError(`Failed to update product: ${error}`);
	}
}

export async function insertReviews(env: Env, brand: string, asin: string, reviews: ReviewInsertData[]): Promise<number> {
	try {
		const insertStmt = env.DB.prepare(`
			INSERT INTO reviews (asin, brand_name, reviewer_name, email, rating, title, body)
			SELECT ?, ?, ?, ?, ?, ?, ?
			WHERE NOT EXISTS (
				SELECT 1 FROM reviews WHERE brand_name = ? AND asin = ? AND title = ?
			)
		`);

		const batch = reviews.map((r) => {
			const title = normalizeReviewTitle(r.title);
			const review = normalizeReviewBody(r.review);
			const rating = normalizeReviewRating(r.stars);
			return insertStmt.bind(asin, brand, r.username || 'Anonymous', r.email || '', rating, title, review, brand, asin, title);
		});

		const results = await env.DB.batch(batch);
		return results.reduce((count: number, result: D1BatchResult) => count + (result.success ? result.meta?.changes || 0 : 0), 0);
	} catch (error) {
		throw new DatabaseError(`Failed to insert reviews: ${error}`);
	}
}

function normalizeReviewTitle(title?: string): string {
	return title
		? title
				.split('\n')
				.map((line: string) => line.trim())
				.find((line: string) => !line.includes('out of 5 stars') && line.trim()) || ''
		: '';
}

function normalizeReviewBody(review?: string): string {
	return review
		? review
				.split('\n')
				.map((line: string) => line.trim())
				.filter(Boolean)
				.find((line: string) => !line.includes('The media could not be loaded') && !line.includes('Read more') && line.trim()) || ''
		: '';
}

function normalizeReviewRating(stars?: string | number): number {
	const rating = Math.trunc(parseFloat(String(stars)));
	if (!Number.isFinite(rating)) return 1;
	return Math.min(5, Math.max(1, rating));
}

export async function getReview(env: Env, id: string, brand?: string): Promise<Review | null> {
	try {
		if (!id) return null;
		const sql = brand ? 'SELECT * FROM reviews WHERE id = ? AND brand_name = ?' : 'SELECT * FROM reviews WHERE id = ?';
		const stmt = brand ? env.DB.prepare(sql).bind(parseInt(id), brand) : env.DB.prepare(sql).bind(parseInt(id));
		const review_data = await stmt.first<Review>();
		return review_data || null;
	} catch (error) {
		throw new DatabaseError(`Failed to get review: ${error}`);
	}
}

export async function updateReview(env: Env, id: string, status: string, aiReview: AIReviewOutput): Promise<void> {
	try {
		await env.DB.prepare(`UPDATE reviews SET ai_status = ?, ai_title = ?, ai_body = ?, email = ? WHERE id = ?`)
			.bind(status, aiReview.title, aiReview.body, aiReview.email, parseInt(id))
			.run();
	} catch (error) {
		throw new DatabaseError(`Failed to update review: ${error}`);
	}
}

export async function clearReviewAI(env: Env, brand: string, id: string): Promise<void> {
	try {
		await env.DB.prepare(`UPDATE reviews SET ai_status = ?, ai_title = ?, ai_body = ?, email = ? WHERE id = ? AND brand_name = ?`)
			.bind('pending', '', '', '', parseInt(id), brand)
			.run();
	} catch (error) {
		throw new DatabaseError(`Failed to clear review AI content: ${error}`);
	}
}

export async function deleteReview(env: Env, brand: string, id: string): Promise<void> {
	try {
		await env.DB.prepare(`DELETE FROM reviews WHERE id = ? AND brand_name = ?`).bind(parseInt(id), brand).run();
	} catch (error) {
		throw new DatabaseError(`Failed to delete review: ${error}`);
	}
}

export async function deleteProduct(env: Env, brand: string, asin: string): Promise<void> {
	try {
		await env.DB.batch([
			env.DB.prepare(`DELETE FROM reviews WHERE brand_name = ? AND asin = ?`).bind(brand, asin),
			env.DB.prepare(`DELETE FROM products WHERE brand_name = ? AND asin = ?`).bind(brand, asin),
		]);
	} catch (error) {
		throw new DatabaseError(`Failed to delete product: ${error}`);
	}
}

export async function getPendingReviews(env: Env, limit: number = 10, brand?: string): Promise<Review[]> {
	try {
		const sql = brand
			? `SELECT * FROM reviews WHERE brand_name = ? AND ai_status = ? LIMIT ?`
			: `SELECT * FROM reviews WHERE ai_status = ? LIMIT ?`;
		const stmt = brand ? env.DB.prepare(sql).bind(brand, 'pending', limit) : env.DB.prepare(sql).bind('pending', limit);
		const result = await stmt.all<Review>();
		return result.results || [];
	} catch (error) {
		throw new DatabaseError(`Failed to get pending reviews: ${error}`);
	}
}

export async function getProducts(env: Env, brand: string, limit: number = 50, offset: number = 0): Promise<Product[]> {
	try {
		const result = await env.DB.prepare(`SELECT * FROM products WHERE brand_name = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`)
			.bind(brand, limit, offset)
			.all<Product>();
		return result.results || [];
	} catch (error) {
		throw new DatabaseError(`Failed to get products: ${error}`);
	}
}

export async function getProductsWithReviewCounts(
	env: Env,
	brand: string,
	limit: number = 50,
	offset: number = 0,
): Promise<(Product & { review_count: number })[]> {
	try {
		const result = await env.DB.prepare(
			`
			SELECT p.*, COUNT(r.id) as review_count
			FROM products p
			LEFT JOIN reviews r ON p.asin = r.asin AND p.brand_name = r.brand_name
			WHERE p.brand_name = ?
			GROUP BY p.id, p.asin, p.brand_name, p.title, p.handle, p.upc_code, p.created_at
			ORDER BY p.created_at DESC
			LIMIT ? OFFSET ?
		`,
		)
			.bind(brand, limit, offset)
			.all<Product & { review_count: number }>();
		return result.results || [];
	} catch (error) {
		throw new DatabaseError(`Failed to get products with review counts: ${error}`);
	}
}

export async function getProductReviews(env: Env, brand: string, asin: string, limit: number = 100, offset: number = 0): Promise<Review[]> {
	try {
		const result = await env.DB.prepare(`SELECT * FROM reviews WHERE brand_name = ? AND asin = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`)
			.bind(brand, asin, limit, offset)
			.all<Review>();
		return result.results || [];
	} catch (error) {
		throw new DatabaseError(`Failed to get product reviews: ${error}`);
	}
}

export async function searchReviews(
	env: Env,
	brand: string,
	query: string,
	status?: string,
	limit: number = 50,
	offset: number = 0,
): Promise<Review[]> {
	try {
		let sql = `SELECT * FROM reviews WHERE brand_name = ? AND (title LIKE ? OR body LIKE ? OR ai_body LIKE ?)`;
		const params = [brand, `%${query}%`, `%${query}%`, `%${query}%`];

		if (status) {
			sql += ` AND ai_status = ?`;
			params.push(status);
		}

		sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
		params.push(limit.toString());
		params.push(offset.toString());

		const result = await env.DB.prepare(sql)
			.bind(...params)
			.all<Review>();
		return result.results || [];
	} catch (error) {
		throw new DatabaseError(`Failed to search reviews: ${error}`);
	}
}

export async function getReviewStats(
	env: Env,
	brand: string,
): Promise<{
	total: number;
	pending: number;
	processing: number;
	done: number;
	failed: number;
}> {
	try {
		const result = await env.DB.prepare(
			`
			SELECT
				COUNT(*) as total,
				SUM(CASE WHEN ai_status = 'pending' THEN 1 ELSE 0 END) as pending,
				SUM(CASE WHEN ai_status = 'processing' THEN 1 ELSE 0 END) as processing,
				SUM(CASE WHEN ai_status = 'done' THEN 1 ELSE 0 END) as done,
				SUM(CASE WHEN ai_status = 'failed' THEN 1 ELSE 0 END) as failed
			FROM reviews
			WHERE brand_name = ?
		`,
		)
			.bind(brand)
			.all();

		const stats = result.results?.[0] as any;
		return {
			total: stats?.total || 0,
			pending: stats?.pending || 0,
			processing: stats?.processing || 0,
			done: stats?.done || 0,
			failed: stats?.failed || 0,
		};
	} catch (error) {
		throw new DatabaseError(`Failed to get review stats: ${error}`);
	}
}

export async function getAllReviews(env: Env, brand: string, status: string, limit: number): Promise<Review[]> {
	try {
		const result = await env.DB.prepare(`SELECT * FROM reviews WHERE brand_name = ? AND ai_status = ? LIMIT ?`)
			.bind(brand, status, limit)
			.all<Review>();
		return result.results || [];
	} catch (error) {
		throw new DatabaseError(`Failed to get all reviews: ${error}`);
	}
}
