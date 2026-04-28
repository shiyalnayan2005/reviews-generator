import { graphqlRequest } from './graphql';

export async function fetchShopifyProductHandleByUPC(env: Env, upc: string): Promise<string> {
	try {
		const query = `
      query($upc: String!) {
        productVariants(first: 1, query: "metafield:new_custom.upc_code:$upc") {
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
		const result = await graphqlRequest(env, query, { upc });
		const data = await result.json();
		return data.data.productVariants.edges[0]?.node.product.handle || '';
	} catch (error) {
		console.error(`Failed to fetch Shopify product handle for UPC ${upc}:`, error);
		return '';
	}
}
