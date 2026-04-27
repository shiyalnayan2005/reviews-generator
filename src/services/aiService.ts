import { generateAIReview } from '../lib/ai-client';
import { AIError } from '../lib/errors';
import { retryWithBackoff } from '../lib/retryUtils';
import { PROCESSING_CONFIG } from '../config';

export interface AIReviewInput {
	title: string;
	body: string;
	rating: number;
}

export interface AIReviewOutput {
	title: string;
	body: string;
}

export async function generateReviewWithRetry(env: Env, input: AIReviewInput): Promise<AIReviewOutput> {
	try {
		return await retryWithBackoff(() => generateAIReview(env, input), {
			maxAttempts: PROCESSING_CONFIG.MAX_RETRIES,
			baseDelayMs: PROCESSING_CONFIG.RETRY_DELAY_MS,
			maxDelayMs: PROCESSING_CONFIG.MAX_RETRY_DELAY_MS,
			timeoutMs: 60000, // 60 second timeout for AI calls
		});
	} catch (error) {
		throw new AIError(`AI generation failed: ${error}`, true);
	}
}
