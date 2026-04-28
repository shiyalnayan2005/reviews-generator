import { getReview, updateReview, getPendingReviews, getReviewStats } from '../services/db';
import { AIReviewOutput, generateReviewWithRetry } from '../services/aiService';
import { validateReviewId } from '../middleware/validation';
import { handleError } from '../middleware/errorHandler';
import { ValidationError } from '../lib/errors';
import { PROCESSING_CONFIG } from '../config';

export async function generateReviewById(env: Env, id: string): Promise<AIReviewOutput> {
	validateReviewId(id);

	console.log('Review fetching started...');
	const review = await getReview(env, id);
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

export async function processPendingReviews(env: Env, limit: number): Promise<Array<{ id: number; status: 'done' | 'failed' }>> {
	console.log(`Processing ${limit} pending reviews...`);

	const reviews = await getPendingReviews(env, limit);
	const results: Array<{ id: number; status: 'done' | 'failed' }> = [];

	for (const review of reviews) {
		try {
			console.log(`Processing review ${review.id}...`);
			await generateReviewById(env, review.id.toString());
			results.push({ id: review.id, status: 'done' });
			console.log(`Completed review ${review.id}`);
		} catch (err) {
			console.error(`Failed for ${review.id}:`, err);
			await updateReview(env, review.id.toString(), 'failed', { title: '', body: '', email: '' });
			results.push({ id: review.id, status: 'failed' });
		}
	}

	return results;
}

export async function handleReviewGenerate(request: Request, env: Env): Promise<Response> {
	try {
		const url = new URL(request.url);
		const id = url.searchParams.get('id');

		const aiBody = await generateReviewById(env, id!);
		return Response.json({ success: true, data: { ...aiBody } });
	} catch (error) {
		const id = new URL(request.url).searchParams.get('id');
		if (id && !isNaN(parseInt(id))) {
			try {
				await updateReview(env, id, 'failed', { title: '', body: '', email: '' });
			} catch (updateError) {
				console.error('Failed to mark review generation as failed:', updateError);
			}
		}
		return handleError(error);
	}
}

export async function handleReviewBulkGenerate(request: Request, env: Env): Promise<Response> {
	try {
		const url = new URL(request.url);
		const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), PROCESSING_CONFIG.BATCH_SIZE);

		const results = await processPendingReviews(env, limit);
		if (!results.length) {
			return Response.json({ success: true, message: 'No reviews to process' });
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
		const stats = await getReviewStats(env);
		return Response.json({ success: true, stats });
	} catch (error) {
		return handleError(error);
	}
}
