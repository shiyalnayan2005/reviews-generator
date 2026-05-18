import { generateAIReview } from '../lib/ai-client';
import { AIError } from '../lib/errors';
import { retryWithBackoff } from '../lib/retryUtils';
import { PROCESSING_CONFIG } from '../config';
import { Review } from '../types';

export interface AIReviewOutput {
	title: string;
	body: string;
	email?: string;
}

export async function generateReviewWithRetry(env: Env, review: Review): Promise<AIReviewOutput> {
	try {
		return await retryWithBackoff(() => generateAIReview(env, review), {
			maxAttempts: PROCESSING_CONFIG.MAX_RETRIES,
			baseDelayMs: PROCESSING_CONFIG.RETRY_DELAY_MS,
			maxDelayMs: PROCESSING_CONFIG.MAX_RETRY_DELAY_MS,
			timeoutMs: 60000, // 60 second timeout for AI calls
		});
	} catch (error) {
		throw new AIError(`AI generation failed: ${formatAIError(error)}`, true);
	}
}

function formatAIError(error: unknown): string {
	if (error instanceof Error) {
		return [error.message, error.stack ? `Stack:\n${error.stack}` : ''].filter(Boolean).join('\n');
	}
	return String(error);
}
