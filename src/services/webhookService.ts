import { insertProduct, insertReviews } from './db';
import { AmazonProductData } from '../types';
import { DatabaseError } from '../lib/errors';
import { fetchShopifyProductHandleByUPC } from './shopify';

export interface WebhookPayload {
	input: string;
	result: string | AmazonProductData;
}

export async function processWebhookPayloads(
	env: Env,
	payloads: WebhookPayload[],
): Promise<{
	processed: number;
	total: number;
}> {
	console.log(`Processing ${payloads.length} items from webhook`);

	let processed = 0;
	let total = payloads.length;

	for (const item of payloads) {
		try {
			const asin = item.input;
			const result: AmazonProductData = typeof item.result === 'string' ? JSON.parse(item.result) : item.result;

			const handle = await fetchShopifyProductHandleByUPC(env, result.product_information?.upc || '');

			await insertProduct(env, {
				asin,
				name: result.name || '',
				handle: handle,
				upc_code: result.product_information?.upc || '',
				average_rating: result.average_rating,
				total_reviews: result.total_reviews,
			});

			if (result.reviews?.length) {
				await insertReviews(
					env,
					asin,
					result.reviews.map((r) => ({ ...r, email: '' })),
				);
			}

			processed++;
		} catch (error) {
			console.error(`Failed to process webhook item ${item.input}:`, error);
			// Continue processing other items
		}
	}

	console.log(`Webhook processed: ${processed}/${total} items`);
	if (total > 0 && processed === 0) {
		throw new DatabaseError('Failed to process any webhook items. Check the payload shape and D1 table schema.');
	}

	return { processed, total };
}
