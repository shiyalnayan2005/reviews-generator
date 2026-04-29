import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchShopifyProductHandleByUPC } from '../src/services/shopify';

describe('Shopify service', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('falls back to metafield search when custom id lookup does not return a variant', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({
					data: {
						productVariantByIdentifier: null,
					},
				}),
			)
			.mockResolvedValueOnce(
				Response.json({
					data: {
						productVariants: {
							edges: [
								{
									node: {
										upcCode: { value: '123456789012' },
										product: { handle: 'correct-product' },
									},
								},
							],
						},
					},
				}),
			);
		vi.stubGlobal('fetch', fetchMock);

		const handle = await fetchShopifyProductHandleByUPC(
			{
				SHOPIFY_STORE_URL: 'example.myshopify.com',
				SHOPIFY_ADMIN_API: 'token',
			} as Env,
			'123456789012',
		);

		expect(handle).toBe('correct-product');
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).variables.search).toBe('metafields.new_custom.upc_code:123456789012');
	});
});
