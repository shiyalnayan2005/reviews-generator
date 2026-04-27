import { parseWebhookBody } from '../lib/utils';
import { insertProduct, insertReviews } from './db';
import { AmazonProductData } from '../types';

export interface WebhookPayload {
	input: string;
	result: string | AmazonProductData;
}

export async function processWebhookPayloads(
	env: Env,
	request: Request,
): Promise<{
	processed: number;
	total: number;
}> {
	const payloads: WebhookPayload[] = await parseWebhookBody(request);
	console.log(`Processing ${payloads.length} items from webhook`);

	let processed = 0;
	let total = payloads.length;

	for (const item of payloads) {
		try {
			const asin = item.input;
			const result: AmazonProductData = typeof item.result === 'string' ? JSON.parse(item.result) : item.result;

			await insertProduct(env, {
				asin,
				name: result.name || '',
				average_rating: result.average_rating,
				total_reviews: result.total_reviews,
			});

			if (result.reviews?.length) {
				await insertReviews(env, asin, result.reviews);
			}

			processed++;
		} catch (error) {
			console.error(`Failed to process webhook item ${item.input}:`, error);
			// Continue processing other items
		}
	}

	console.log(`Webhook processed: ${processed}/${total} items`);
	return { processed, total };
}
