import { SITE_URL, BRANDS_KEY } from '../config';

export async function scrapeASINs(brand: keyof typeof BRANDS_KEY, limit: number = -1): Promise<string[]> {
	const brand_url = `${SITE_URL}/s?srs=${BRANDS_KEY[brand]}`;

	const response = await fetch(brand_url);
	if (!response.ok) {
		throw new Error(`Failed to fetch brand page: ${response.status}`);
	}

	const html = await response.text();

	// Extract ASINs from HTML
	const asin_items = new Set<string>();
	const rewriter = new HTMLRewriter().on('[data-asin]', {
		element(el) {
			const asin = el.getAttribute('data-asin');
			if (asin && asin !== 'null') asin_items.add(asin);
		},
	});

	await rewriter.transform(new Response(html)).text();

	const asins = [...asin_items];
	return limit > 0 ? asins.slice(0, limit) : asins;
}
