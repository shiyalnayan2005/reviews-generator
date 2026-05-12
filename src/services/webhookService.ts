import { insertProduct, insertReviews } from './db';
import { AmazonProductData } from '../types';
import { DatabaseError } from '../lib/errors';
import { fetchShopifyProductHandleByUPC } from './shopify';
import { BrandName } from '../config';

export interface WebhookPayload {
	input: string;
	result: string | AmazonProductData;
}

export async function processWebhookPayloads(
	env: Env,
	brand: BrandName,
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
			const asin = item.input.split('/').pop()?.trim() || '';
			const result: AmazonProductData = typeof item.result === 'string' ? JSON.parse(item.result) : item.result;
			const upcCode = result.product_information?.upc?.trim() || result.product_information?.UPC?.trim() || '';

			const handle = await fetchShopifyProductHandleByUPC(env, brand, upcCode);

			await insertProduct(env, {
				asin,
				brand_name: brand,
				name: result.name || '',
				handle: handle,
				upc_code: upcCode,
			});

			if (result.reviews?.length) {
				await insertReviews(
					env,
					brand,
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
