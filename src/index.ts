import { handleASINRequest } from './handlers/asinHandler';
import { handleWebhookRequest } from './handlers/webhookHandler';
import { handleReviewGenerate, handleReviewBulkGenerate, handleReviewStats, processPendingReviews } from './handlers/reviewHandler';
import { handleDashboard } from './handlers/dashboardHandler';
import { handleError } from './middleware/errorHandler';
import { exportReviews } from './handlers/exportHandler';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const pathname = url.pathname;
		const method = request.method;

		try {
			if (pathname === '/favicon.ico') {
				return new Response(null, { status: 204 });
			}

			// ASIN scraping routes
			if (pathname.startsWith('/api/asin')) {
				if (method === 'GET') {
					return handleASINRequest(request, env);
				}
			}

			// Dashboard and API routes
			if (pathname === '/' || pathname.startsWith('/api/') || pathname === '/dashboard') {
				return handleDashboard(request, env);
			}

			// Webhook routes
			if (pathname.startsWith('/webhook/')) {
				if (method === 'POST' && pathname === '/webhook/products') {
					return handleWebhookRequest(request, env);
				}
			}

			// Review processing routes
			if (pathname.startsWith('/review/')) {
				if (method === 'POST' && pathname === '/review/generate') {
					return handleReviewGenerate(request, env);
				}
				if (method === 'POST' && pathname === '/review/generate/bulk') {
					return handleReviewBulkGenerate(request, env);
				}
				if (method === 'GET' && pathname === '/review/stats') {
					return handleReviewStats(request, env);
				}
			}

			// Export route
			if (method === 'GET' && pathname.startsWith('/export')) {
				return exportReviews(env);
			}

			return new Response('Not Found', { status: 404 });
		} catch (error) {
			return handleError(error);
		}
	},

	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(
			(async () => {
				console.log(`Scheduled review generation started for cron: ${controller.cron}`);
				const results = await processPendingReviews(env, 1);
				if (!results.length) {
					console.log('Scheduled review generation skipped: no pending reviews.');
					return;
				}
				console.log('Scheduled review generation finished:', results[0]);
			})(),
		);
	},
} satisfies ExportedHandler<Env>;
