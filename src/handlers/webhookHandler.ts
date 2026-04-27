import { parseWebhookBody } from '../lib/utils';
import { processWebhookPayloads } from '../services/webhookService';
import { validateWebhookPayload } from '../middleware/validation';
import { handleError } from '../middleware/errorHandler';

export async function handleWebhookRequest(request: Request, env: Env): Promise<Response> {
	try {
		const payloads = await parseWebhookBody(request);
		await validateWebhookPayload(payloads);

		const result = await processWebhookPayloads(env, payloads);

		return Response.json({
			success: true,
			processed: result.processed,
			total: result.total,
		});
	} catch (error) {
		return handleError(error);
	}
}
