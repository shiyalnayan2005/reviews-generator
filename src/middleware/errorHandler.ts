import { ReviewsGeneratorError } from '../lib/errors';

export function handleError(error: unknown): Response {
	if (error instanceof ReviewsGeneratorError) {
		console.error(`[${error.code}] ${error.message}`, error);

		return new Response(
			JSON.stringify({
				error: {
					code: error.code,
					message: error.message,
				},
			}),
			{
				status: error.statusCode,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}

	console.error('Unexpected error:', error);
	return new Response(
		JSON.stringify({
			error: {
				code: 'INTERNAL_ERROR',
				message: 'An unexpected error occurred',
			},
		}),
		{
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		},
	);
}

export function createErrorResponse(code: string, message: string, status: number = 500): Response {
	return new Response(
		JSON.stringify({
			error: { code, message },
		}),
		{
			status,
			headers: { 'Content-Type': 'application/json' },
		},
	);
}
