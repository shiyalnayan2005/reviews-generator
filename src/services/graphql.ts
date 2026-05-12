import { BrandName } from '../config';
import { SHOPIFY_STORES } from '../shopifyStores';
import { validateShopifyStoreConfig } from '../middleware/validation';

export async function graphqlRequest(env: Env, brand: BrandName, query: string, variables?: Record<string, any>): Promise<any> {
	const maxRetries = 3;
	let attempt = 0;
	validateShopifyStoreConfig(brand, env);
	const store = SHOPIFY_STORES[brand];
	const url = `https://${store.storeUrl}/admin/api/2025-07/graphql.json`;
	const adminApiKey = env[store.adminApiKeyEnvName];

	while (attempt < maxRetries) {
		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Shopify-Access-Token': adminApiKey,
				},
				body: JSON.stringify({
					query,
					variables,
				}),
			});

			if (!response.ok) {
				throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
			}

			return response;
		} catch (error) {
			attempt += 1;
			if (attempt >= maxRetries) {
				console.error('GraphQL request failed:', error);
				throw new Error(`GraphQL request failed after ${attempt} attempts: ${error}`);
			}
		}
	}
}
