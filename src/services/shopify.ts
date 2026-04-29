import { graphqlRequest } from './graphql';

interface ShopifyGraphQLResponse<T> {
	data?: T;
	errors?: Array<{ message?: string }>;
}

interface ProductHandleNode {
	product?: {
		handle?: string;
	};
}

export async function fetchShopifyProductHandleByUPC(env: Env, upc: string): Promise<string> {
	const normalizedUPC = upc?.trim();
	if (!normalizedUPC) return '';

	try {
		const search = `barcode:"${upc}"`;
		const graphqlQuery = `
      query($search: String!) {
        productVariants(first: 1, query: $search) {
          edges {
            node {
              product {
                handle
              }
            }
          }
        }
      }
    `;
		const result = await graphqlRequest(env, graphqlQuery, { search });
		const data = (await result.json()) as ShopifyGraphQLResponse<{
			productVariants?: {
				edges?: Array<{
					node?: ProductHandleNode & {
						barcode?: string | null;
						upcCode?: { value?: string | null } | null;
					};
				}>;
			};
		}>;

		if (data.errors?.length) {
			console.warn(`Shopify barcode lookup failed for UPC ${upc}:`, data.errors);
			return '';
		}

		return data.data?.productVariants?.edges?.[0]?.node?.product?.handle || '';
	} catch (error) {
		console.error(`Failed to fetch Shopify product handle for UPC ${normalizedUPC}:`, error);
		return '';
	}
}
