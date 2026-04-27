import { TimeoutError } from './errors';

export interface RetryOptions {
	maxAttempts: number;
	baseDelayMs: number;
	maxDelayMs: number;
	backoffMultiplier: number;
	timeoutMs?: number;
}

export async function retryWithBackoff<T>(fn: () => Promise<T>, options: Partial<RetryOptions> = {}): Promise<T> {
	const opts: RetryOptions = {
		maxAttempts: 3,
		baseDelayMs: 1000,
		maxDelayMs: 30000,
		backoffMultiplier: 2,
		...options,
	};

	let lastError: Error | null = null;

	for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
		try {
			// Add timeout if specified
			let promise: Promise<T>;
			if (opts.timeoutMs) {
				promise = Promise.race([
					fn(),
					new Promise<never>((_, reject) =>
						setTimeout(() => reject(new TimeoutError(`Operation timed out after ${opts.timeoutMs}ms`)), opts.timeoutMs),
					),
				]);
			} else {
				promise = fn();
			}

			return await promise;
		} catch (error) {
			lastError = error as Error;

			// Don't retry non-retryable errors
			if (error instanceof Error && 'retryable' in error && !(error as any).retryable) {
				throw error;
			}

			if (attempt === opts.maxAttempts) break;

			const delayMs = Math.min(opts.baseDelayMs * Math.pow(opts.backoffMultiplier, attempt - 1), opts.maxDelayMs);

			console.warn(`Attempt ${attempt} failed, retrying in ${delayMs}ms:`, error);

			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}

	throw lastError;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => setTimeout(() => reject(new TimeoutError(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)),
	]);
}
