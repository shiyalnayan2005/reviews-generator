import { SITE_URL, BRANDS_KEY } from '../config';
import { ScrapingError } from '../lib/errors';

export async function scrapeASINs(brand: keyof typeof BRANDS_KEY, limit: number = -1): Promise<string[]> {
	const brandUrl = new URL('/s', SITE_URL);
	brandUrl.searchParams.set('srs', BRANDS_KEY[brand]);

	const response = await fetch(brandUrl.toString(), {
		headers: {
			Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			'Accept-Language': 'en-IN,en;q=0.9',
			'Cache-Control': 'no-cache',
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
		},
	});
	if (!response.ok) {
		throw new ScrapingError(`Amazon brand page request failed with status ${response.status}`, 502);
	}

	const html = await response.text();

	const asin_items = new Set<string>();
	const rewriter = new HTMLRewriter().on('[data-asin]', {
		element(el) {
			const asin = el.getAttribute('data-asin');
			if (isValidASIN(asin)) asin_items.add(asin!);
		},
	});

	await rewriter.transform(new Response(html)).text();

	for (const match of html.matchAll(/data-asin=["']([A-Z0-9]{10})["']/g)) {
		if (isValidASIN(match[1])) asin_items.add(match[1]);
	}

	const asins = [...asin_items];
	if (!asins.length) {
		throw new ScrapingError('Amazon response did not contain any product ASINs. The page may be blocked, changed, or empty.', 502);
	}

	return limit > 0 ? asins.slice(0, limit) : asins;
}

function isValidASIN(value: string | null): value is string {
	return /^[A-Z0-9]{10}$/.test(value || '');
}
