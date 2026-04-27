export class ReviewsGeneratorError extends Error {
	constructor(
		public code: string,
		message: string,
		public statusCode: number = 500,
		public retryable: boolean = false,
	) {
		super(message);
		this.name = 'ReviewsGeneratorError';
	}
}

export class ValidationError extends ReviewsGeneratorError {
	constructor(message: string) {
		super('VALIDATION_ERROR', message, 400, false);
	}
}

export class AIError extends ReviewsGeneratorError {
	constructor(message: string, retryable: boolean = true) {
		super('AI_ERROR', message, 500, retryable);
	}
}

export class DatabaseError extends ReviewsGeneratorError {
	constructor(message: string, retryable: boolean = true) {
		super('DB_ERROR', message, 500, retryable);
	}
}

export class ScrapingError extends ReviewsGeneratorError {
	constructor(message: string, statusCode: number = 502, retryable: boolean = true) {
		super('SCRAPING_ERROR', message, statusCode, retryable);
	}
}

export class AuthenticationError extends ReviewsGeneratorError {
	constructor(message: string = 'Unauthorized') {
		super('AUTH_ERROR', message, 401, false);
	}
}

export class TimeoutError extends ReviewsGeneratorError {
	constructor(message: string = 'Request timeout') {
		super('TIMEOUT_ERROR', message, 408, true);
	}
}
