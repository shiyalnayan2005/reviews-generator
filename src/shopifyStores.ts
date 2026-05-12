import { BrandName } from './config';

export interface ShopifyStoreConfig {
	storeUrl: string;
	adminApiKeyEnvName: 'HAPPIMESS_SHOPIFY_ADMIN_API' | 'JONATHANY_SHOPIFY_ADMIN_API';
}

export const SHOPIFY_STORES: Record<BrandName, ShopifyStoreConfig> = {
	happimess: {
		storeUrl: 'happimess-dev.myshopify.com',
		adminApiKeyEnvName: 'HAPPIMESS_SHOPIFY_ADMIN_API',
	},
	jonathany: {
		storeUrl: 'jonathany.myshopify.com',
		adminApiKeyEnvName: 'JONATHANY_SHOPIFY_ADMIN_API',
	},
};
