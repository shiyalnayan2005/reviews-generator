export const SITE_URL = 'https://www.amazon.in';

export const BRANDS_KEY = {
	happimess: '17337761031',
	jonathany: '18809330031',
};

export const PROCESSING_CONFIG = {
	BATCH_SIZE: 5, // Process 5 reviews at a time
	MAX_RETRIES: 3,
	RETRY_DELAY_MS: 1000,
	MAX_RETRY_DELAY_MS: 30000,
};

export const AI_CONFIG = {
	TEMPERATURE: 0.9,
	MODEL: 'gemini-3-flash-preview',
};
