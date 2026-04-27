import { scrapeASINs } from '../services/scrapingService';
import { validateASINRequest } from '../middleware/validation';
import { handleError } from '../middleware/errorHandler';
import { BRANDS_KEY } from '../config';

export async function handleASINRequest(request: Request, env: Env): Promise<Response> {
	try {
		const url = new URL(request.url);
		const params = url.searchParams;

		validateASINRequest(params);

		const brand = params.get('brand') as keyof typeof BRANDS_KEY;
		const limit = parseInt(params.get('limit') || '-1');

		const asins = await scrapeASINs(brand, limit);
		const asin_text_list = asins.join('\n');

		return new Response(asin_text_list, {
			headers: {
				'Content-Type': 'text/plain',
			},
		});
	} catch (error) {
		return handleError(error);
	}
}
