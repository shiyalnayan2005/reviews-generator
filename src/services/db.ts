export async function insertProduct(env: Env, data: any): Promise<void> {
	await env.DB.prepare(
		`
      INSERT OR IGNORE INTO products (asin, title, rating, total_reviews)
      VALUES (?, ?, ?, ?)
    `,
	)
		.bind(data.asin, data.name || null, data.average_rating || null, data.total_reviews || null)
		.run();
}

export async function insertReviews(env: Env, asin: string, reviews: any[]): Promise<number> {
	const stmt = env.DB.prepare(`
    INSERT INTO reviews (asin, reviewer_name, rating, title, body)
    VALUES (?, ?, ?, ?, ?)
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
		return stmt.bind(asin, r.username || 'Anonymous', parseFloat(r.stars) || 0, title, review);
	});

	const results = await env.DB.batch(batch);
	return results.filter((r: any) => r.success).length;
}
