import { handleASINRequest } from './handlers/asinHandler';
import { handleWebhookRequest } from './handlers/webhookHandler';
import { handleReviewGenerate, handleReviewBulkGenerate, handleReviewStats } from './handlers/reviewHandler';
import { handleDashboard } from './handlers/dashboardHandler';
import { handleError } from './middleware/errorHandler';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const pathname = url.pathname;
		const method = request.method;

		try {
			// Dashboard and API routes
			if (pathname === '/' || pathname.startsWith('/api/') || pathname === '/dashboard') {
				return handleDashboard(request, env);
			}

			// ASIN scraping routes
			if (pathname.startsWith('/api/asin')) {
				if (method === 'GET') {
					return handleASINRequest(request, env);
				}
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

			return new Response('Not Found', { status: 404 });
		} catch (error) {
			return handleError(error);
		}
	},
} satisfies ExportedHandler<Env>;
