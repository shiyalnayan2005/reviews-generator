export async function exportReviews(env: Env): Promise<Response> {
	const result = await env.DB.prepare(
		`
    SELECT 
      p.handle,
      r.ai_body,
      r.rating,
      r.ai_title,
      r.reviewer_name,
      r.email
    FROM reviews r
    JOIN products p ON r.asin = p.asin
    WHERE r.ai_body IS NOT NULL
  `,
	).all();

	const formatted = result.results.map((row: any) => ({
		'Shopify Product Handle': row.handle,
		'Review Content': row.ai_body,
		'Review Score': row.rating,
		'Review Title': row.ai_title,
		'Reviewer Display Name': row.reviewer_name,
		'Reviewer Email': row.email,
		'Publish Review': false,
	}));

	return new Response(JSON.stringify(formatted, null, 2), {
		headers: {
			'Content-Type': 'application/json',
			'Content-Disposition': 'attachment; filename=reviews_export.json',
		},
	});
}
