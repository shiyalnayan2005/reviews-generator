export async function graphqlRequest(env: Env, query: string, variables?: Record<string, any>): Promise<any> {
	const maxRetries = 3;
	let attempt = 0;

	while (attempt < maxRetries) {
		try {
			const response = await fetch(env.SHOPIFY_ADMIN_API, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_API,
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
