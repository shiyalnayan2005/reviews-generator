import { getReview, updateReview, getPendingReviews, getReviewStats, markReviewGenerationFailed } from '../services/db';
import { AIReviewOutput, generateReviewWithRetry } from '../services/aiService';
import { validateBrandName, validateReviewId } from '../middleware/validation';
import { handleError } from '../middleware/errorHandler';
import { ValidationError } from '../lib/errors';
import { BrandName, PROCESSING_CONFIG } from '../config';

export async function generateReviewById(env: Env, id: string, brand?: BrandName): Promise<AIReviewOutput> {
	validateReviewId(id);

	console.log('Review fetching started...');
	const review = await getReview(env, id, brand);
	console.log('Review fetching end...', review);

	if (!review) {
		throw new ValidationError(`Review not found with id=${id}`);
	}

	await updateReview(env, id, 'processing', { title: review.title || '', body: review.body || '', email: review.email || '' });

	console.log('Review generating started...');
	const aiReview = await generateReviewWithRetry(env, review);
	console.log('Review generating end...');

	if (!aiReview) {
		throw new Error('AI generation returned empty result');
	}

	console.log('Updating review...');
	await updateReview(env, id, 'done', aiReview);
	console.info(`Updated ${id} review`);

	return aiReview;
}

export async function processPendingReviews(env: Env, limit: number, brand?: BrandName): Promise<Array<{ id: number; status: 'done' | 'failed' }>> {
	console.log(`Processing ${limit} pending reviews...`);

	const reviews = await getPendingReviews(env, limit, brand);
	const results: Array<{ id: number; status: 'done' | 'failed' }> = [];

	for (const review of reviews) {
		try {
			console.log(`Processing review ${review.id}...`);
			await generateReviewById(env, review.id.toString(), brand);
			results.push({ id: review.id, status: 'done' });
			console.log(`Completed review ${review.id}`);
		} catch (err) {
			console.error(`Failed for ${review.id}:`, err);
			await markReviewGenerationFailed(env, review.id.toString(), buildReviewGenerationLog(err, review.id.toString(), brand), brand);
			results.push({ id: review.id, status: 'failed' });
		}
	}

	return results;
}

export async function handleReviewGenerate(request: Request, env: Env): Promise<Response> {
	try {
		const url = new URL(request.url);
		const id = url.searchParams.get('id');
		const brand = validateBrandName(url.searchParams.get('brand'));

		const aiBody = await generateReviewById(env, id!, brand);
		return Response.json({ success: true, data: { ...aiBody } });
	} catch (error) {
		const url = new URL(request.url);
		const id = url.searchParams.get('id');
		const brand = brandFromRequestForLog(url);
		if (id && !isNaN(parseInt(id))) {
			try {
				await markReviewGenerationFailed(env, id, buildReviewGenerationLog(error, id, brand), brand);
			} catch (updateError) {
				console.error('Failed to mark review generation as failed:', updateError);
			}
		}
		return handleError(error);
	}
}

function brandFromRequestForLog(url: URL): BrandName | undefined {
	try {
		return validateBrandName(url.searchParams.get('brand'));
	} catch {
		return undefined;
	}
}

function buildReviewGenerationLog(error: unknown, reviewId: string, brand?: BrandName): string {
	const lines = [
		`[${new Date().toISOString()}] Review generation failed`,
		`Review ID: ${reviewId}`,
		brand ? `Brand: ${brand}` : '',
		'Error:',
		formatErrorForLog(error),
	].filter(Boolean);
	return lines.join('\n');
}

function formatErrorForLog(error: unknown): string {
	if (error instanceof Error) {
		const details: string[] = [`Name: ${error.name}`, `Message: ${error.message}`];
		const maybeError = error as Error & { code?: unknown; statusCode?: unknown; retryable?: unknown };
		if (maybeError.code !== undefined) details.push(`Code: ${String(maybeError.code)}`);
		if (maybeError.statusCode !== undefined) details.push(`Status Code: ${String(maybeError.statusCode)}`);
		if (maybeError.retryable !== undefined) details.push(`Retryable: ${String(maybeError.retryable)}`);
		if (error.stack) details.push(`Stack:\n${error.stack}`);
		return details.join('\n');
	}

	try {
		return JSON.stringify(error, null, 2);
	} catch {
		return String(error);
	}
}

export async function handleReviewBulkGenerate(request: Request, env: Env): Promise<Response> {
	try {
		const url = new URL(request.url);
		const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), PROCESSING_CONFIG.BATCH_SIZE);
		const brand = validateBrandName(url.searchParams.get('brand'));

		const results = await processPendingReviews(env, limit, brand);
		if (!results.length) {
			return Response.json({ success: true, processed: 0, results: [], message: 'No reviews to process' });
		}

		return Response.json({
			success: true,
			processed: results.length,
			results,
		});
	} catch (error) {
		return handleError(error);
	}
}

export async function handleReviewStats(request: Request, env: Env): Promise<Response> {
	try {
		const brand = validateBrandName(new URL(request.url).searchParams.get('brand'));
		const stats = await getReviewStats(env, brand);
		return Response.json({ success: true, stats });
	} catch (error) {
		return handleError(error);
	}
}
