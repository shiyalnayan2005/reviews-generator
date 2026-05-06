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
		await env.DB.prepare(
			`
      INSERT INTO products (asin, title, handle, upc_code)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(asin) DO UPDATE SET
        title = excluded.title,
        handle = excluded.handle,
        upc_code = excluded.upc_code
    `,
		)
			.bind(data.asin, data.name || null, data.handle || null, data.upc_code || null)
			.run();
	} catch (error) {
		throw new DatabaseError(`Failed to insert product: ${error}`);
	}
}

export async function getProductsForShopifyUpdate(env: Env, limit: number = 25): Promise<ShopifyProductUpdateCandidate[]> {
	try {
		const result = await env.DB.prepare(
			`
      SELECT asin, upc_code, handle
      FROM products
      WHERE upc_code IS NOT NULL AND TRIM(upc_code) != ''
      ORDER BY
        CASE WHEN handle IS NULL OR TRIM(handle) = '' THEN 0 ELSE 1 END,
        created_at DESC
      LIMIT ?
    `,
		)
			.bind(limit)
			.all<ShopifyProductUpdateCandidate>();
		return result.results || [];
	} catch (error) {
		throw new DatabaseError(`Failed to get products for Shopify update: ${error}`);
	}
}

export async function updateProductShopifyHandle(env: Env, asin: string, handle: string): Promise<void> {
	try {
		await env.DB.prepare(`UPDATE products SET handle = ? WHERE asin = ?`)
			.bind(handle || null, asin)
			.run();
	} catch (error) {
		throw new DatabaseError(`Failed to update Shopify product handle: ${error}`);
	}
}

export async function updateProduct(env: Env, asin: string, data: { title?: string; upc_code?: string; handle?: string }): Promise<void> {
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

		const sql = `UPDATE products SET ${updates.join(', ')} WHERE asin = ?`;
		params.push(asin);

		await env.DB.prepare(sql)
			.bind(...params)
			.run();
	} catch (error) {
		throw new DatabaseError(`Failed to update product: ${error}`);
	}
}

export async function insertReviews(env: Env, asin: string, reviews: ReviewInsertData[]): Promise<number> {
	try {
		const insertStmt = env.DB.prepare(`
			INSERT INTO reviews (asin, reviewer_name, email, rating, title, body)
			SELECT ?, ?, ?, ?, ?, ?
			WHERE NOT EXISTS (
				SELECT 1 FROM reviews WHERE asin = ? AND title = ?
			)
		`);

		const batch = reviews.map((r) => {
			const title = normalizeReviewTitle(r.title);
			const review = normalizeReviewBody(r.review);
			const rating = normalizeReviewRating(r.stars);
			return insertStmt.bind(asin, r.username || 'Anonymous', r.email || '', rating, title, review, asin, title);
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
	const rating = parseFloat(String(stars));
	return Number.isFinite(rating) && rating > 0 ? rating : 1;
}

export async function getReview(env: Env, id: string): Promise<Review | null> {
	try {
		if (!id) return null;
		const review_data = await env.DB.prepare('SELECT * FROM reviews WHERE id = ?').bind(parseInt(id)).first<Review>();
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

export async function clearReviewAI(env: Env, id: string): Promise<void> {
	try {
		await env.DB.prepare(`UPDATE reviews SET ai_status = ?, ai_title = ?, ai_body = ?, email = ? WHERE id = ?`)
			.bind('pending', '', '', '', parseInt(id))
			.run();
	} catch (error) {
		throw new DatabaseError(`Failed to clear review AI content: ${error}`);
	}
}

export async function deleteReview(env: Env, id: string): Promise<void> {
	try {
		await env.DB.prepare(`DELETE FROM reviews WHERE id = ?`).bind(parseInt(id)).run();
	} catch (error) {
		throw new DatabaseError(`Failed to delete review: ${error}`);
	}
}

export async function deleteProduct(env: Env, asin: string): Promise<void> {
	try {
		await env.DB.batch([
			env.DB.prepare(`DELETE FROM reviews WHERE asin = ?`).bind(asin),
			env.DB.prepare(`DELETE FROM products WHERE asin = ?`).bind(asin),
		]);
	} catch (error) {
		throw new DatabaseError(`Failed to delete product: ${error}`);
	}
}

export async function getPendingReviews(env: Env, limit: number = 10): Promise<Review[]> {
	try {
		const result = await env.DB.prepare(`SELECT * FROM reviews WHERE ai_status = ? LIMIT ?`).bind('pending', limit).all<Review>();
		return result.results || [];
	} catch (error) {
		throw new DatabaseError(`Failed to get pending reviews: ${error}`);
	}
}

export async function getProducts(env: Env, limit: number = 50, offset: number = 0): Promise<Product[]> {
	try {
		const result = await env.DB.prepare(`SELECT * FROM products ORDER BY created_at DESC LIMIT ? OFFSET ?`)
			.bind(limit, offset)
			.all<Product>();
		return result.results || [];
	} catch (error) {
		throw new DatabaseError(`Failed to get products: ${error}`);
	}
}

export async function getProductsWithReviewCounts(
	env: Env,
	limit: number = 50,
	offset: number = 0,
): Promise<{ products: (Product & { review_count: number })[]; total: number }> {
	try {
		const countResult = await env.DB.prepare(`SELECT COUNT(*) as total FROM products`).first<{ total: number }>();
		const total = countResult?.total || 0;

		const result = await env.DB.prepare(
			`
			SELECT p.*, COUNT(r.id) as review_count
			FROM products p
			LEFT JOIN reviews r ON p.asin = r.asin
			GROUP BY p.id, p.asin, p.title, p.handle, p.upc_code, p.created_at
			ORDER BY p.created_at DESC
			LIMIT ? OFFSET ?
		`,
		)
			.bind(limit, offset)
			.all<Product & { review_count: number }>();

		return { products: result.results || [], total };
	} catch (error) {
		throw new DatabaseError(`Failed to get products with review counts: ${error}`);
	}
}

export async function getProductReviews(
	env: Env,
	asin: string,
	limit: number = 100,
	offset: number = 0,
): Promise<{ reviews: Review[]; total: number }> {
	try {
		const countResult = await env.DB.prepare(`SELECT COUNT(*) as total FROM reviews WHERE asin = ?`).bind(asin).first<{ total: number }>();
		const total = countResult?.total || 0;

		const result = await env.DB.prepare(`SELECT * FROM reviews WHERE asin = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`)
			.bind(asin, limit, offset)
			.all<Review>();
		return { reviews: result.results || [], total };
	} catch (error) {
		throw new DatabaseError(`Failed to get product reviews: ${error}`);
	}
}

export async function searchReviews(
	env: Env,
	query: string,
	status?: string,
	limit: number = 50,
	offset: number = 0,
): Promise<{ reviews: Review[]; total: number }> {
	try {
		const searchClause = `(asin LIKE ? OR reviewer_name LIKE ? OR title LIKE ? OR body LIKE ? OR ai_body LIKE ? OR email LIKE ?)`;
		const params = [`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`];

		let countSql = `SELECT COUNT(*) as total FROM reviews WHERE ${searchClause}`;
		let sql = `SELECT * FROM reviews WHERE ${searchClause}`;

		if (status) {
			countSql += ` AND ai_status = ?`;
			sql += ` AND ai_status = ?`;
			params.push(status);
		}

		sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
		params.push(limit.toString(), offset.toString());

		const countResult = await env.DB.prepare(countSql)
			.bind(...params.slice(0, status ? 7 : 6))
			.first<{ total: number }>();
		const total = countResult?.total || 0;

		const result = await env.DB.prepare(sql)
			.bind(...params)
			.all<Review>();
		return { reviews: result.results || [], total };
	} catch (error) {
		throw new DatabaseError(`Failed to search reviews: ${error}`);
	}
}

export async function getReviewStats(env: Env): Promise<{
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
		`,
		).all();

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

export async function getAllReviews(env: Env, status: string, limit: number): Promise<Review[]> {
	try {
		const result = await env.DB.prepare(`SELECT * FROM reviews WHERE ai_status = ? LIMIT ?`).bind(status, limit).all<Review>();
		return result.results || [];
	} catch (error) {
		throw new DatabaseError(`Failed to get all reviews: ${error}`);
	}
}
