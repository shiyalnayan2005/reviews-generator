export interface Product {
	id: number;
	asin: string;
	brand_name: string;
	title: string | null;
	handle: string | null;
	upc_code: string | null;
	review_count?: number;
	created_at: string;
}

export interface Review {
	id: number;
	asin: string;
	brand_name: string;
	reviewer_name: string | null;
	rating: number | null;
	title: string | null;
	email: string | null;
	body: string | null;
	ai_title: string | null;
	ai_body: string | null;
	ai_status: 'pending' | 'processing' | 'done' | 'failed';
	created_at: string;
}

export interface ScraperAPIResponse {
	input: string;
	result: string | AmazonProductData;
}

export interface AmazonProductData {
	asin?: string;
	name?: string;
	product_information?: {
		upc: string;
		UPC: string;
	};
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
	brand_name: string;
	name?: string;
	handle?: string;
	upc_code?: string;
}

export interface ReviewInsertData {
	username?: string;
	email?: string;
	stars?: string | number;
	title?: string;
	review?: string;
}

export interface D1BatchResult {
	success: boolean;
	error?: string;
	results?: any[];
	meta?: {
		changes?: number;
	};
}
