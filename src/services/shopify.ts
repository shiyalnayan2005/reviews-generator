import { graphqlRequest } from './graphql';

export async function fetchShopifyProductHandleByUPC(env: Env, upc: string): Promise<string> {
	try {
		const search = `metafields.new_custom.upc_code:${upc}`;
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
		const data = await result.json();
		console.log({ data });
		console.log({ productVariant: data.data.productVariants.edges[0] });
		return data.data.productVariants.edges[0]?.node.product.handle || '';
	} catch (error) {
		console.error(`Failed to fetch Shopify product handle for UPC ${upc}:`, error);
		return '';
	}
}
