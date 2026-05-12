import { parseWebhookBody } from '../lib/utils';
import { processWebhookPayloads } from '../services/webhookService';
import { validateBrandName, validateWebhookPayload } from '../middleware/validation';
import { handleError } from '../middleware/errorHandler';

export async function handleWebhookRequest(request: Request, env: Env): Promise<Response> {
	try {
		const url = new URL(request.url);
		const brand = validateBrandName(url.searchParams.get('brand'));
		const payloads = await parseWebhookBody(request);
		await validateWebhookPayload(payloads);

		const result = await processWebhookPayloads(env, brand, payloads);

		return Response.json({
			success: true,
			processed: result.processed,
			total: result.total,
		});
	} catch (error) {
		return handleError(error);
	}
}
