export interface Product {
	id: number;
	asin: string;
	title: string | null;
	rating: number | null;
	total_reviews: number | null;
	created_at: string;
}

export interface Review {
	id: number;
	asin: string;
	reviewer_name: string | null;
	rating: number | null;
	title: string | null;
	body: string | null;
	ai_title: string | null;
	ai_body: string | null;
	ai_status: 'pending' | 'processing' | 'done' | 'failed';
	created_at: string;
}

export interface Env {
	DB: D1Database;
	GEMINI_API_KEY: string;
}

export interface ScraperAPIResponse {
	input: string;
	result: string | AmazonProductData;
}

export interface AmazonProductData {
	asin?: string;
	name?: string;
	average_rating?: number;
	total_reviews?: number;
	reviews?: AmazonReview[];
}

export interface AmazonReview {
	username?: string;
	stars?: string | number;
	title?: string;
	review?: string;
}

// Database operation types
export interface ProductInsertData {
	asin: string;
	name?: string;
	average_rating?: number;
	total_reviews?: number;
}

export interface ReviewInsertData {
	username?: string;
	stars?: string | number;
	title?: string;
	review?: string;
}

export interface D1BatchResult {
	success: boolean;
	error?: string;
	results?: any[];
}
