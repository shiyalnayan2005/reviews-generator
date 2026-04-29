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
      INSERT INTO products (asin, title, handle, upc_code, rating, total_reviews)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(asin) DO UPDATE SET
        title = excluded.title,
        handle = excluded.handle,
        upc_code = excluded.upc_code,
        rating = excluded.rating,
        total_reviews = excluded.total_reviews
    `,
		)
			.bind(data.asin, data.name || null, data.handle || null, data.upc_code || null, data.average_rating || null, data.total_reviews || null)
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
		await env.DB.prepare(`UPDATE products SET handle = ? WHERE asin = ?`).bind(handle || null, asin).run();
	} catch (error) {
		throw new DatabaseError(`Failed to update Shopify product handle: ${error}`);
	}
}

export async function insertReviews(env: Env, asin: string, reviews: ReviewInsertData[]): Promise<number> {
	try {
		const stmt = env.DB.prepare(`
    INSERT INTO reviews (asin, reviewer_name, email, rating, title, body)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

		const batch = reviews.map((r) => {
			const title = r.title
				? r.title
						.split('\n')
						.map((line: string) => line.trim())
						.find((line: string) => !line.includes('out of 5 stars') && line.trim())
				: '';
			const review = r.review
				? r.review
						.split('\n')
						.map((line: string) => line.trim())
						.filter(Boolean)
						.find((line: string) => !line.includes('The media could not be loaded') && !line.includes('Read more') && line.trim())
				: '';
			return stmt.bind(asin, r.username || 'Anonymous', r.email || '', parseFloat(String(r.stars)) || 0, title, review);
		});

		const results = await env.DB.batch(batch);
		return results.filter((r: D1BatchResult) => r.success).length;
	} catch (error) {
		throw new DatabaseError(`Failed to insert reviews: ${error}`);
	}
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

export async function getProductReviews(env: Env, asin: string, limit: number = 100, offset: number = 0): Promise<Review[]> {
	try {
		const result = await env.DB.prepare(`SELECT * FROM reviews WHERE asin = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`)
			.bind(asin, limit, offset)
			.all<Review>();
		return result.results || [];
	} catch (error) {
		throw new DatabaseError(`Failed to get product reviews: ${error}`);
	}
}

export async function searchReviews(env: Env, query: string, status?: string, limit: number = 50, offset: number = 0): Promise<Review[]> {
	try {
		let sql = `SELECT * FROM reviews WHERE (title LIKE ? OR body LIKE ? OR ai_body LIKE ?)`;
		const params = [`%${query}%`, `%${query}%`, `%${query}%`];

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
