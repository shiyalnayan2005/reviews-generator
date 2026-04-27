import { ValidationError } from '../lib/errors';
import { BRANDS_KEY } from '../config';

export function validateASINRequest(params: URLSearchParams): void {
	const brand = params.get('brand');
	const limit = params.get('limit');

	if (!brand) throw new ValidationError('brand parameter required');
	if (!(brand in BRANDS_KEY)) {
		throw new ValidationError(`Unknown brand: ${brand}`);
	}
	if (limit && isNaN(parseInt(limit))) {
		throw new ValidationError('limit must be a number');
	}
}

export async function validateWebhookPayload(payloads: any[]): Promise<void> {
	if (!Array.isArray(payloads) || payloads.length === 0) {
		throw new ValidationError('Empty or invalid webhook payload');
	}

	for (const item of payloads) {
		if (!item.input) throw new ValidationError('Missing input field');
		if (!item.result) throw new ValidationError('Missing result field');
	}
}

export function validateReviewId(id: string | null): void {
	if (!id) throw new ValidationError('Review ID is required');
	if (isNaN(parseInt(id))) throw new ValidationError('Invalid review ID');
}
