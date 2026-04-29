import { graphqlRequest } from './graphql';

const UPC_METAFIELD_NAMESPACE = 'new_custom';
const UPC_METAFIELD_KEY = 'upc_code';

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
		const uniqueMetafieldHandle = await fetchVariantHandleByUniqueMetafield(env, normalizedUPC);
		if (uniqueMetafieldHandle) return uniqueMetafieldHandle;

		return await fetchVariantHandleByBarcode(env, normalizedUPC);
	} catch (error) {
		console.error(`Failed to fetch Shopify product handle for UPC ${normalizedUPC}:`, error);
		return '';
	}
}

async function fetchVariantHandleByUniqueMetafield(env: Env, upc: string): Promise<string> {
	const graphqlQuery = `
    query($identifier: ProductVariantIdentifierInput!) {
      productVariantByIdentifier(identifier: $identifier) {
        product {
          handle
        }
      }
    }
  `;
	const result = await graphqlRequest(env, graphqlQuery, {
		identifier: {
			customId: {
				namespace: UPC_METAFIELD_NAMESPACE,
				key: UPC_METAFIELD_KEY,
				value: upc,
			},
		},
	});
	const data = (await result.json()) as ShopifyGraphQLResponse<{
		productVariantByIdentifier?: ProductHandleNode;
	}>;

	if (data.errors?.length) {
		console.warn(`Shopify unique metafield lookup failed for UPC ${upc}:`, data.errors);
		return '';
	}

	return data.data?.productVariantByIdentifier?.product?.handle || '';
}

async function fetchVariantHandleByBarcode(env: Env, upc: string): Promise<string> {
	const search = `barcode:"${escapeShopifySearchValue(upc)}"`;
	const graphqlQuery = `
      query($search: String!) {
        productVariants(first: 10, query: $search) {
          edges {
            node {
              barcode
              upcCode: metafield(namespace: "${UPC_METAFIELD_NAMESPACE}", key: "${UPC_METAFIELD_KEY}") {
                value
              }
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

	const edges = data.data?.productVariants?.edges || [];
	const exactMatch = edges.find(({ node }) => node?.barcode === upc || node?.upcCode?.value === upc);
	return exactMatch?.node?.product?.handle || '';
}

function escapeShopifySearchValue(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
