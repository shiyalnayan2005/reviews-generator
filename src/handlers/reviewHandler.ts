import { getReview, updateReview, getPendingReviews, getReviewStats } from '../services/db';
import { generateReviewWithRetry } from '../services/aiService';
import { validateReviewId } from '../middleware/validation';
import { handleError } from '../middleware/errorHandler';
import { ValidationError } from '../lib/errors';
import { PROCESSING_CONFIG } from '../config';

export async function handleReviewGenerate(request: Request, env: Env): Promise<Response> {
	try {
		const url = new URL(request.url);
		const id = url.searchParams.get('id');

		validateReviewId(id);

		console.log('Review fetching started...');
		const review = await getReview(env, id!);
		console.log('Review fetching end...', review);

		if (!review) {
			return handleError(new ValidationError(`Review not found with id=${id}`));
		}

		console.log('Review generating started...');
		const aiBody = await generateReviewWithRetry(env, {
			title: review.title || '',
			body: review.body || '',
			rating: review.rating || 4,
		});
		console.log('Review generating end...');

		if (aiBody) {
			console.log('Updating review...');
			await updateReview(env, id!, 'done', aiBody.title, aiBody.body);
			console.info(`Updated ${id} review`);

			return Response.json({ success: true, data: { ...aiBody } });
		}

		throw new Error('AI generation returned empty result');
	} catch (error) {
		return handleError(error);
	}
}

export async function handleReviewBulkGenerate(request: Request, env: Env): Promise<Response> {
	try {
		const url = new URL(request.url);
		const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), PROCESSING_CONFIG.BATCH_SIZE);
		const status = url.searchParams.get('status') || 'pending';

		console.log(`Processing ${limit} reviews with status: ${status}...`);

		const reviews = await getPendingReviews(env, limit);

		if (!reviews.length) {
			return Response.json({ success: true, message: 'No reviews to process' });
		}

		const results = [];

		for (const review of reviews) {
			try {
				console.log(`Processing review ${review.id}...`);

				// Mark as processing
				await updateReview(env, review.id.toString(), 'processing', '', '');

				const aiBody = await generateReviewWithRetry(env, {
					title: review.title || '',
					body: review.body || '',
					rating: review.rating || 4,
				});

				await updateReview(env, review.id.toString(), 'done', aiBody.title, aiBody.body);
				results.push({ id: review.id, status: 'done' });

				console.log(`Completed review ${review.id}`);
			} catch (err) {
				console.error(`Failed for ${review.id}:`, err);
				await updateReview(env, review.id.toString(), 'failed', '', '');
				results.push({ id: review.id, status: 'failed' });
			}
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
