/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { generateAIReview } from './lib/ai-client';
import { decodeHtmlEntities, parseWebhookBody } from './lib/utils';
import { getReview, insertProduct, insertReviews, updateReview } from './services/db';
import { AmazonProductData, Review } from './types';

const SITE_URL = 'https://www.amazon.in';
const BRANDS_KEY = {
	happimess: '17337761031',
	jonathany: '18809330031',
};

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const pathname = url.pathname;
		const method = request.method;
		const params = url.searchParams;

		if (pathname.startsWith('/api')) {
			const base = '/api';
			if (method === 'GET' && pathname === `${base}/asin`) {
				const brand = params.get('brand') as keyof typeof BRANDS_KEY;
				const limit = parseInt(params.get('limit') || '-1');
				if (!(brand in BRANDS_KEY)) return new Response('Invalid brand name', { status: 400 });

				const brand_url = `${SITE_URL}/s?srs=${BRANDS_KEY[brand]}`;
				try {
					const res = await fetch(brand_url);

					// get ASIN from response html
					const asin_items = new Set<string>();
					const rewriter = new HTMLRewriter().on('[data-asin]', {
						element(el) {
							const asin = el.getAttribute('data-asin');
							if (asin && asin !== 'null') asin_items.add(asin);
						},
					});

					const html = await rewriter.transform(res).text();

					//return new Response(html, { headers: { 'Content-Type': 'text/html' } });
					const asin_text_list = [...asin_items].slice(0, limit).join('\n');
					return new Response(asin_text_list, {
						headers: {
							'Content-Type': 'text/plain',
						},
					});
				} catch (error) {
					console.error('Brand ASIN fail : ', error);
					return new Response('Internal error', { status: 500 });
				}
			}
		} else if (pathname.startsWith('/webhook')) {
			const base = '/webhook';
			if (method === 'POST' && pathname === `${base}/products`) {
				const payloads = await parseWebhookBody(request);
				console.log(`Processing ${payloads.length} items from webhook`);

				let processed = 0;
				for (const item of payloads) {
					const asin = item.input;
					const result: AmazonProductData = typeof item.result === 'string' ? JSON.parse(item.result) : item.result;

					await insertProduct(env, {
						asin,
						name: decodeHtmlEntities(result.name || ''),
						average_rating: result.average_rating,
						total_reviews: result.total_reviews,
					});

					if (result.reviews?.length) {
						await insertReviews(env, asin, result.reviews);
					}

					processed++;
				}

				console.log(`Webhook processed: ${processed} items`);
				return Response.json({ success: true, processed });
			}
		} else if (pathname.startsWith('/review')) {
			const base = '/review';
			if (method === 'POST' && pathname === `${base}/generate`) {
				const id = params.get('id') || '';
				if (id) {
					try {
						console.log('review fetching started...');
						const review = await getReview(env, id);
						console.log('review fetching end...', review);
						if (review) {
							console.log('review generating started...');
							const aiBody = await generateAIReview(env, {
								title: review.title || '',
								body: review.body || '',
								rating: review.rating || 4,
							});
							console.log('review generating end...');
							if (aiBody) {
								console.log('updating review...');
								await updateReview(env, id, 'done', aiBody.title, aiBody.body);
								console.info(`Updated ${id} review`);
								return Response.json({ success: true, data: { ...aiBody } });
							}
						} else {
							console.warn(`Review not found with id=${id}`);
							return Response.json({ error: `Review not found with id=${id}` });
						}
					} catch (error) {
						console.error(`Failed to process review ${id}:`, error);
						return new Response('Failed to process review', { status: 500 });
					}
				} else {
					return new Response('Review id is missing');
				}
			}
			if (method === 'POST' && pathname === `${base}/generate/bulk`) {
				const limit = parseInt(params.get('limit') || '10'); // batch size
				const status = params.get('status') || 'pending'; // filter

				try {
					// 🔹 fetch reviews to process
					const reviews = await env.DB.prepare(`SELECT * FROM reviews WHERE ai_status = ? LIMIT ?`).bind(status, limit).all<Review>();

					if (!reviews.results.length) {
						return Response.json({ success: true, message: 'No reviews to process' });
					}

					console.log(`Processing ${reviews.results.length} reviews...`);

					const results = [];

					for (const review of reviews.results) {
						try {
							// 🔹 mark as processing (prevents duplicate runs)
							await updateReview(env, review.id, 'processing', '', '');

							const aiBody = await generateAIReview(env, {
								title: review.title || '',
								body: review.body || '',
								rating: review.rating || 4,
							});

							await updateReview(env, review.id, 'done', aiBody.title, aiBody.body);

							results.push({ id: review.id, status: 'done' });
						} catch (err) {
							console.error(`Failed for ${review.id}`, err);

							await updateReview(env, review.id, 'failed', '', '');

							results.push({ id: review.id, status: 'failed' });
						}
					}

					return Response.json({
						success: true,
						processed: results.length,
						results,
					});
				} catch (error) {
					console.error('Bulk generation failed:', error);
					return new Response('Bulk generation failed', { status: 500 });
				}
			}
		}
		return new Response('Hello World!');
	},
} satisfies ExportedHandler<Env>;
