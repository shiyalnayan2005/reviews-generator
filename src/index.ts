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
import { decodeHtmlEntities, parseWebhookBody } from './lib/utils';
import { insertProduct, insertReviews } from './services/db';
import { AmazonProductData } from './types';

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
		}
		return new Response('Hello World!');
	},
} satisfies ExportedHandler<Env>;
