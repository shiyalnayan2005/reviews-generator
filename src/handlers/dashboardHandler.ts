import {
	clearReviewAI,
	deleteProduct,
	deleteReview,
	getProductsWithReviewCounts,
	getProductReviews,
	getReview,
	searchReviews,
	getReviewStats,
	getProductsForShopifyUpdate,
	insertProduct,
	insertReviews,
	updateProductShopifyHandle,
	updateProduct,
} from '../services/db';
import { handleError } from '../middleware/errorHandler';
import { ValidationError } from '../lib/errors';
import { fetchShopifyProductHandleByUPC } from '../services/shopify';

export async function handleDashboard(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const pathname = url.pathname;

	try {
		if (pathname === '/' || pathname === '/dashboard') {
			return serveDashboardHTML();
		}

		if (pathname === '/api/products') {
			const limit = parseInt(url.searchParams.get('limit') || '50');
			const offset = parseInt(url.searchParams.get('offset') || '0');

			const products = await getProductsWithReviewCounts(env, limit, offset);
			return Response.json({ success: true, products });
		}

		if (pathname === '/api/products/shopify-info' && request.method === 'POST') {
			const limit = parseInt(url.searchParams.get('limit') || '25');
			const result = await updateShopifyProductInformation(env, limit);
			return Response.json({ success: true, ...result });
		}

		if (pathname === '/api/products/reviews') {
			const asin = url.searchParams.get('asin');
			if (!asin) {
				return handleError(new ValidationError('ASIN parameter required'));
			}

			const limit = parseInt(url.searchParams.get('limit') || '100');
			const offset = parseInt(url.searchParams.get('offset') || '0');

			const reviews = await getProductReviews(env, asin, limit, offset);
			return Response.json({ success: true, reviews });
		}

		if (pathname === '/api/review') {
			const id = url.searchParams.get('id');

			if (request.method === 'POST' && url.searchParams.get('action') === 'clear') {
				if (!id) {
					return handleError(new ValidationError('Review id parameter required'));
				}
				await clearReviewAI(env, id);
				return Response.json({ success: true });
			}

			if (request.method === 'POST') {
				const body = (await request.json().catch(() => ({}))) as {
					asin?: string;
					reviewer_name?: string;
					email?: string;
					rating?: string | number;
					title?: string;
					body?: string;
				};
				const asin = body.asin?.trim();
				if (!asin) {
					return handleError(new ValidationError('ASIN is required'));
				}

				const product = await env.DB.prepare(`SELECT asin FROM products WHERE asin = ?`).bind(asin).first<{ asin: string }>();
				if (!product) {
					return handleError(new ValidationError('Review ASIN must match an existing product'));
				}

				const inserted = await insertReviews(env, asin, [
					{
						username: body.reviewer_name?.trim() || 'Anonymous',
						email: body.email?.trim() || '',
						stars: body.rating || 1,
						title: body.title?.trim() || '',
						review: body.body?.trim() || '',
					},
				]);
				return Response.json({ success: true, inserted });
			}

			if (!id) {
				return handleError(new ValidationError('Review id parameter required'));
			}

			if (request.method === 'DELETE') {
				await deleteReview(env, id);
				return Response.json({ success: true });
			}

			if (request.method === 'PUT') {
				const requestBody = (await request.json().catch(() => ({}))) as { title?: string; body?: string; rating?: number };
				const { title, body: reviewBody, rating } = requestBody;
				await env.DB.prepare(`UPDATE reviews SET title = ?, body = ?, rating = ? WHERE id = ?`)
					.bind(title || null, reviewBody || null, rating || 1, parseInt(id))
					.run();
				return Response.json({ success: true });
			}

			const review = await getReview(env, id);
			if (!review) {
				return handleError(new ValidationError(`Review not found with id=${id}`));
			}

			return Response.json({ success: true, review });
		}

		if (pathname === '/api/product') {
			const asin = url.searchParams.get('asin');

			if (request.method === 'POST') {
				const body = (await request.json().catch(() => ({}))) as { asin?: string; title?: string; upc_code?: string; handle?: string };
				const productAsin = body.asin?.trim();
				if (!productAsin) {
					return handleError(new ValidationError('ASIN is required'));
				}

				await insertProduct(env, {
					asin: productAsin,
					name: body.title?.trim() || '',
					upc_code: body.upc_code?.trim() || '',
					handle: body.handle?.trim() || '',
				});
				return Response.json({ success: true });
			}

			if (!asin) {
				return handleError(new ValidationError('ASIN parameter required'));
			}

			if (request.method === 'DELETE') {
				await deleteProduct(env, asin);
				return Response.json({ success: true });
			}

			if (request.method === 'PUT') {
				const body = (await request.json().catch(() => ({}))) as { title?: string; upc_code?: string; handle?: string };
				const { title, upc_code, handle } = body;
				await updateProduct(env, asin, { title, upc_code, handle });
				return Response.json({ success: true });
			}
		}

		if (pathname === '/api/search') {
			const query = url.searchParams.get('q');
			const status = url.searchParams.get('status') || undefined;
			const limit = parseInt(url.searchParams.get('limit') || '50');
			const offset = parseInt(url.searchParams.get('offset') || '0');

			if (!query) {
				return handleError(new ValidationError('Search query required'));
			}

			const reviews = await searchReviews(env, query, status, limit, offset);
			return Response.json({ success: true, reviews });
		}

		if (pathname === '/api/stats') {
			const stats = await getReviewStats(env);
			return Response.json({ success: true, stats });
		}

		return new Response('Not Found', { status: 404 });
	} catch (error) {
		return handleError(error);
	}
}

async function updateShopifyProductInformation(
	env: Env,
	limit: number,
): Promise<{
	processed: number;
	updated: number;
	notFound: number;
	skipped: number;
	total: number;
}> {
	const safeLimit = Math.min(Math.max(limit || 25, 1), 100);
	const products = await getProductsForShopifyUpdate(env, safeLimit);
	let updated = 0;
	let notFound = 0;
	let skipped = 0;

	for (const product of products) {
		if (!product.upc_code) {
			skipped++;
			continue;
		}

		const handle = await fetchShopifyProductHandleByUPC(env, product.upc_code);
		if (!handle) {
			notFound++;
			continue;
		}

		await updateProductShopifyHandle(env, product.asin, handle);
		updated++;
	}

	return {
		processed: products.length,
		updated,
		notFound,
		skipped,
		total: products.length,
	};
}

function serveDashboardHTML(): Response {
	const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reviews Generator Dashboard</title>
        <style>
            * { box-sizing: border-box; }
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                margin: 0;
                padding: 20px;
                background: #f5f5f5;
            }
            .container {
                max-width: 1200px;
                margin: 0 auto;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                overflow: hidden;
            }
            .header {
                background: #2563eb;
                color: white;
                padding: 20px;
                text-align: center;
            }
            .stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 20px;
                padding: 20px;
                background: #f8fafc;
            }
            .stat-card {
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                text-align: center;
            }
            .stat-number {
                font-size: 2em;
                font-weight: bold;
                color: #2563eb;
            }
            .stat-label {
                color: #64748b;
                margin-top: 5px;
            }
            .search-section {
                padding: 20px;
                border-bottom: 1px solid #e2e8f0;
            }
            .tabs {
                display: flex;
                gap: 8px;
                padding: 16px 20px 0;
                border-bottom: 1px solid #e2e8f0;
            }
            .tab-btn {
                padding: 10px 16px;
                border: 1px solid #d1d5db;
                border-bottom: none;
                background: #f8fafc;
                border-radius: 6px 6px 0 0;
                cursor: pointer;
                color: #475569;
                font-weight: 600;
            }
            .tab-btn.active {
                background: white;
                color: #2563eb;
                border-color: #2563eb;
            }
            .search-input {
                width: 100%;
                padding: 12px;
                border: 2px solid #e2e8f0;
                border-radius: 8px;
                font-size: 16px;
                margin-bottom: 10px;
            }
            .filters {
                display: flex;
                gap: 10px;
                margin-bottom: 20px;
                flex-wrap: wrap;
            }
            .filter-btn {
                padding: 8px 16px;
                border: 1px solid #d1d5db;
                background: white;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s;
            }
            .filter-btn.active {
                background: #2563eb;
                color: white;
                border-color: #2563eb;
            }
            .products-section, .reviews-section {
                padding: 20px;
            }
            .section-title {
                font-size: 1.5em;
                margin: 0 0 20px;
                color: #1f2937;
            }
            .section-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                flex-wrap: wrap;
                margin-bottom: 20px;
            }
            .section-header .section-title {
                margin-bottom: 0;
            }
            .section-actions {
                display: flex;
                gap: 10px;
                align-items: center;
                flex-wrap: wrap;
            }
            .table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 20px;
            }
            .table th, .table td {
                padding: 12px;
                text-align: left;
                border-bottom: 1px solid #e2e8f0;
            }
            .table th {
                background: #f8fafc;
                font-weight: 600;
                color: #374151;
            }
            .table tr:hover {
                background: #f8fafc;
            }
            .status-badge {
                padding: 4px 8px;
                border-radius: 12px;
                font-size: 0.8em;
                font-weight: 500;
            }
            .status-pending { background: #fef3c7; color: #92400e; }
            .status-processing { background: #dbeafe; color: #1e40af; }
            .status-done { background: #d1fae5; color: #065f46; }
            .status-failed { background: #fee2e2; color: #dc2626; }
            .btn {
                padding: 8px 16px;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.2s;
            }
            .btn-primary { background: #2563eb; color: white; }
            .btn-primary:hover { background: #1d4ed8; }
            .btn-secondary { background: #f1f5f9; color: #475569; }
            .btn-secondary:hover { background: #e2e8f0; }
            .btn-danger { background: #fee2e2; color: #b91c1c; }
            .btn-danger:hover { background: #fecaca; }
            .actions {
                display: flex;
                gap: 8px;
                align-items: center;
            }
            .icon-btn {
                width: 36px;
                height: 36px;
                padding: 0;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            .icon {
                width: 18px;
                height: 18px;
                stroke: currentColor;
                fill: none;
                stroke-width: 2;
                stroke-linecap: round;
                stroke-linejoin: round;
            }
            .loading {
                display: inline-block;
                width: 16px;
                height: 16px;
                border: 2px solid #e2e8f0;
                border-radius: 50%;
                border-top-color: #2563eb;
                animation: spin 1s ease-in-out infinite;
            }
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
            
            .modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(15, 23, 42, 0.58);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 1000;
                padding: 20px;
            }
            .modal-content {
                background: white;
                padding: 0;
                border-radius: 12px;
                max-width: 1000px;
                width: 95%;
                max-height: 90vh;
                overflow-y: auto;
                box-shadow: 0 24px 60px rgba(15, 23, 42, 0.24);
            }
            .modal-close {
                cursor: pointer;
                width: 36px;
                height: 36px;
                border: 1px solid #e2e8f0;
                border-radius: 50%;
                background: white;
                color: #475569;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 22px;
                line-height: 1;
            }
            .modal-header {
                display: flex;
                flex-wrap: wrap;
                justify-content: space-between;
                gap: 16px;
                align-items: flex-start;
                padding: 22px 24px;
                border-bottom: 1px solid #e2e8f0;
                background: #f8fafc;
            }
            .modal-title {
                margin: 0;
                font-size: 1.3em;
                color: #0f172a;
            }
            .modal-note {
                color: #475569;
                margin-top: 6px;
                font-size: 0.95em;
            }
            .modal-body {
                padding: 24px;
            }
            .modal-footer {
                display: flex;
                gap: 10px;
                justify-content: flex-end;
                padding: 18px 24px;
                border-top: 1px solid #e2e8f0;
                background: #f8fafc;
            }
            .form-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 16px;
            }
            .form-field {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .form-field.full {
                grid-column: 1 / -1;
            }
            .form-field label {
                color: #334155;
                font-size: 0.9em;
                font-weight: 700;
            }
            .form-field input,
            .form-field select,
            .form-field textarea {
                width: 100%;
                padding: 11px 12px;
                border: 1px solid #cbd5e1;
                border-radius: 8px;
                color: #0f172a;
                font: inherit;
                background: white;
            }
            .form-field input:focus,
            .form-field select:focus,
            .form-field textarea:focus {
                outline: none;
                border-color: #2563eb;
                box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
            }
            .form-field input[readonly] {
                background: #f8fafc;
                color: #64748b;
            }
            .form-help {
                color: #64748b;
                font-size: 0.84em;
            }
            .detail-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                gap: 12px;
                margin-bottom: 20px;
            }
            .detail-item {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                padding: 16px;
                border-radius: 12px;
                background: #f8fafc;
                border: 1px solid #e2e8f0;
            }
            .detail-icon {
                display: inline-flex;
                width: 24px;
                height: 24px;
                align-items: center;
                justify-content: center;
                color: #2563eb;
                flex-shrink: 0;
            }
            .detail-label {
                font-size: 0.8em;
                color: #64748b;
                margin-bottom: 4px;
            }
            .detail-value {
                color: #111827;
                font-weight: 700;
                word-break: break-word;
            }
            .review-section {
                margin-bottom: 24px;
            }
            .review-section .section-title {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-bottom: 12px;
                font-size: 1.05em;
                color: #1e293b;
            }
            .review-email {
              color: blue;
              margin-bottom: 10px;
          }
            .review-box {
                background: white;
                border: 1px solid #e2e8f0;
                border-radius: 12px;
                padding: 18px;
            }
            .review-label {
                font-weight: 700;
                margin-bottom: 12px;
                color: #0f172a;
            }
            .review-meta {
                color: #334155;
                line-height: 1.7;
                white-space: pre-wrap;
            }
            .review-content {
                margin-top: 20px;
                line-height: 1.6;
            }
            .review-original, .review-ai {
                margin-bottom: 20px;
                padding: 15px;
                border-radius: 8px;
            }
            .review-original {
                background: #f8fafc;
                border-left: 4px solid #64748b;
            }
            .review-ai {
                background: #ecfdf5;
                border-left: 4px solid #10b981;
            }
            .review-title {
                font-weight: bold;
                margin-bottom: 10px;
            }
            .pagination {
                display: flex;
                justify-content: center;
                align-items: center;
                gap: 10px;
                margin-top: 20px;
            }
            .page-btn {
                padding: 8px 12px;
                border: 1px solid #d1d5db;
                background: white;
                border-radius: 4px;
                cursor: pointer;
            }
            .page-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .page-label {
                color: #475569;
                font-weight: 600;
                min-width: 80px;
                text-align: center;
            }
            .hidden { display: none; }
            .processing { opacity: 0.6; pointer-events: none; }
            .success { background: #d1fae5; color: #065f46; }
            .error { background: #fee2e2; color: #dc2626; }
            @media (max-width: 720px) {
                body { padding: 10px; }
                .form-grid { grid-template-columns: 1fr; }
                .modal-footer { flex-direction: column-reverse; }
                .modal-footer .btn { width: 100%; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Reviews Generator Dashboard</h1>
                <p>Monitor and manage product reviews processing</p>
                <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                    <a href="/export" class="btn btn-primary" target="_blank">Export Reviews</a>
                    <button class="btn btn-secondary" onclick="openJsonModal()">📄 Upload JSON</button>
                </div>
            </div>

            <div class="stats" id="stats">
                <div class="stat-card">
                    <div class="stat-number" id="total-reviews">-</div>
                    <div class="stat-label">Total Reviews</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="pending-reviews">-</div>
                    <div class="stat-label">Pending</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="processing-reviews">-</div>
                    <div class="stat-label">Processing</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="done-reviews">-</div>
                    <div class="stat-label">Completed</div>
                </div>
            </div>

            <div class="tabs">
                <button class="tab-btn active" data-tab="products" onclick="switchTab('products')">Products</button>
                <button class="tab-btn" data-tab="reviews" onclick="switchTab('reviews')">Reviews</button>
            </div>

            <div class="search-section hidden" id="reviews-controls">
                <input type="text" id="search-input" class="search-input" placeholder="Search reviews...">
                <div class="filters">
                    <button class="filter-btn active" data-status="all">All</button>
                    <button class="filter-btn" data-status="pending">Pending</button>
                    <button class="filter-btn" data-status="processing">Processing</button>
                    <button class="filter-btn" data-status="done">Done</button>
                    <button class="filter-btn" data-status="failed">Failed</button>
                </div>
                <div style="margin-top: 10px;">
                    <button class="btn btn-primary" id="refresh-btn" onclick="refreshData()">Refresh Data</button>
                    <button class="btn btn-secondary" id="process-batch-btn" onclick="processBatch()">Process Pending Reviews</button>
                </div>
            </div>

            <div class="products-section" id="products-section">
                <div class="section-header">
                    <h2 class="section-title">Products</h2>
                    <div class="section-actions">
                        <button class="btn btn-primary" onclick="openProductAddModal()">Add Product</button>
                        <button class="btn btn-secondary" id="shopify-update-btn" onclick="updateShopifyProductInfo()">Update Shopify Handles</button>
                    </div>
                </div>
                <table class="table" id="products-table">
                    <thead>
                        <tr>
                            <th>ASIN</th>
                            <th>Title</th>
                            <th>UPC</th>
                            <th>Handle</th>
                            <th>Review Count</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="products-tbody">
                        <tr>
                            <td colspan="6" style="text-align: center; padding: 40px;">
                                <div class="loading"></div> Loading products...
                            </td>
                        </tr>
                    </tbody>
                </table>
                <div class="pagination" id="products-pagination"></div>
            </div>

            <div class="reviews-section hidden" id="reviews-section">
                <div class="section-header">
                    <h2 class="section-title">Reviews</h2>
                    <div class="section-actions">
                        <button class="btn btn-primary" onclick="openReviewAddModal()">Add Review</button>
                    </div>
                </div>
                <table class="table" id="reviews-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>ASIN</th>
                            <th>Title</th>
                            <th>Rating</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="reviews-tbody">
                        <tr>
                            <td colspan="6" style="text-align: center; padding: 40px;">
                                <div class="loading"></div> Loading reviews...
                            </td>
                        </tr>
                    </tbody>
                </table>
                <div class="pagination" id="reviews-pagination"></div>
            </div>
        </div>

        <div id="review-modal" class="modal hidden">
            <div class="modal-content">
                <div class="modal-header">
                    <div>
                        <h3 class="modal-title">Review Details</h3>
                        <div class="modal-note">Original content and generated AI output.</div>
                    </div>
                    <button type="button" class="modal-close" onclick="closeModal()" aria-label="Close">&times;</button>
                </div>
                <div class="modal-body" id="review-content"></div>
            </div>
        </div>

        <div id="product-add-modal" class="modal hidden">
            <div class="modal-content" style="max-width: 720px;">
                <div class="modal-header">
                    <div>
                        <h3 class="modal-title">Add Product</h3>
                        <div class="modal-note">Create a product before adding reviews to it.</div>
                    </div>
                    <button type="button" class="modal-close" onclick="closeProductAddModal()" aria-label="Close">&times;</button>
                </div>
                <form id="product-add-form">
                    <div class="modal-body">
                        <div class="form-grid">
                            <div class="form-field">
                                <label for="add-product-asin">ASIN</label>
                                <input type="text" id="add-product-asin" required placeholder="B0XXXXXXXX">
                            </div>
                            <div class="form-field">
                                <label for="add-product-upc">UPC</label>
                                <input type="text" id="add-product-upc" placeholder="Optional">
                            </div>
                            <div class="form-field full">
                                <label for="add-product-title">Title</label>
                                <input type="text" id="add-product-title" required placeholder="Product title">
                            </div>
                            <div class="form-field full">
                                <label for="add-product-handle">Shopify Handle</label>
                                <input type="text" id="add-product-handle" placeholder="Optional">
                                <div class="form-help">You can fill this now or use Update Shopify Handles later.</div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="closeProductAddModal()">Cancel</button>
                        <button type="submit" class="btn btn-primary">Add Product</button>
                    </div>
                </form>
            </div>
        </div>

        <div id="product-edit-modal" class="modal hidden">
            <div class="modal-content" style="max-width: 720px;">
                <div class="modal-header">
                    <div>
                        <h3 class="modal-title">Edit Product</h3>
                        <div class="modal-note">Update product details used for review exports and matching.</div>
                    </div>
                    <button type="button" class="modal-close" onclick="closeProductEditModal()" aria-label="Close">&times;</button>
                </div>
                <form id="product-edit-form">
                    <div class="modal-body">
                        <div class="form-grid">
                            <div class="form-field">
                                <label for="edit-asin">ASIN</label>
                                <input type="text" id="edit-asin" readonly>
                            </div>
                            <div class="form-field">
                                <label for="edit-upc">UPC</label>
                                <input type="text" id="edit-upc">
                            </div>
                            <div class="form-field full">
                                <label for="edit-title">Title</label>
                                <input type="text" id="edit-title">
                            </div>
                            <div class="form-field full">
                                <label for="edit-handle">Shopify Handle</label>
                                <input type="text" id="edit-handle">
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="closeProductEditModal()">Cancel</button>
                        <button type="submit" class="btn btn-primary">Save Changes</button>
                    </div>
                </form>
            </div>
        </div>

        <div id="review-add-modal" class="modal hidden">
            <div class="modal-content" style="max-width: 760px;">
                <div class="modal-header">
                    <div>
                        <h3 class="modal-title">Add Review</h3>
                        <div class="modal-note">Reviews can only be created for products already in the products table.</div>
                    </div>
                    <button type="button" class="modal-close" onclick="closeReviewAddModal()" aria-label="Close">&times;</button>
                </div>
                <form id="review-add-form">
                    <div class="modal-body">
                        <div class="form-grid">
                            <div class="form-field">
                                <label for="add-review-asin">Product ASIN</label>
                                <select id="add-review-asin" required></select>
                            </div>
                            <div class="form-field">
                                <label for="add-review-rating">Rating</label>
                                <select id="add-review-rating" required>
                                    <option value="5">5</option>
                                    <option value="4">4</option>
                                    <option value="3">3</option>
                                    <option value="2">2</option>
                                    <option value="1">1</option>
                                </select>
                            </div>
                            <div class="form-field">
                                <label for="add-reviewer-name">Reviewer Name</label>
                                <input type="text" id="add-reviewer-name" placeholder="Anonymous">
                            </div>
                            <div class="form-field">
                                <label for="add-review-email">Email</label>
                                <input type="email" id="add-review-email" placeholder="Optional">
                            </div>
                            <div class="form-field full">
                                <label for="add-review-title">Title</label>
                                <input type="text" id="add-review-title" required>
                            </div>
                            <div class="form-field full">
                                <label for="add-review-body">Body</label>
                                <textarea id="add-review-body" rows="6" required></textarea>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="closeReviewAddModal()">Cancel</button>
                        <button type="submit" class="btn btn-primary">Add Review</button>
                    </div>
                </form>
            </div>
        </div>

        <div id="review-edit-modal" class="modal hidden">
            <div class="modal-content" style="max-width: 760px;">
                <div class="modal-header">
                    <div>
                        <h3 class="modal-title">Edit Review</h3>
                        <div class="modal-note">Adjust the original review content and rating.</div>
                    </div>
                    <button type="button" class="modal-close" onclick="closeReviewEditModal()" aria-label="Close">&times;</button>
                </div>
                <form id="review-edit-form">
                    <div class="modal-body">
                        <div class="form-grid">
                            <div class="form-field">
                                <label for="edit-review-id">Review ID</label>
                                <input type="text" id="edit-review-id" readonly>
                            </div>
                            <div class="form-field">
                                <label for="edit-review-rating">Rating</label>
                                <select id="edit-review-rating">
                                    <option value="5">5</option>
                                    <option value="4">4</option>
                                    <option value="3">3</option>
                                    <option value="2">2</option>
                                    <option value="1">1</option>
                                </select>
                            </div>
                            <div class="form-field full">
                                <label for="edit-review-title">Title</label>
                                <input type="text" id="edit-review-title">
                            </div>
                            <div class="form-field full">
                                <label for="edit-review-body">Body</label>
                                <textarea id="edit-review-body" rows="6"></textarea>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="closeReviewEditModal()">Cancel</button>
                        <button type="submit" class="btn btn-primary">Save Changes</button>
                    </div>
                </form>
            </div>
        </div>

        <div id="json-modal" class="modal hidden">
            <div class="modal-content" style="max-width: 700px;">
                <div class="modal-header">
                    <div>
                        <h3 class="modal-title">Upload JSON Data</h3>
                        <div class="modal-note">Import product payloads from JSON, JSONL, or a text file.</div>
                    </div>
                    <button type="button" class="modal-close" onclick="closeJsonModal()" aria-label="Close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-grid">
                        <div class="form-field full">
                            <label for="json-input">Paste JSON Data</label>
                            <textarea id="json-input" rows="9" style="font-family: monospace; font-size: 14px;" placeholder='Paste JSON array or JSONL data...&#10;&#10;Example: [{"input": "ASIN123", "result": {...}}, ...]'></textarea>
                        </div>
                        <div class="form-field full">
                            <label for="json-file">Or Upload JSON File</label>
                            <input type="file" id="json-file" accept=".json,.jsonl,.txt">
                        </div>
                    </div>
                    <div id="json-stats" style="display: none; padding: 10px; background: #f0f9ff; border-radius: 6px; margin-top: 18px;">
                        <strong>Items detected:</strong> <span id="json-item-count">0</span>
                    </div>
                    <div id="json-status" style="display: none; margin-top: 18px;"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeJsonModal()">Cancel</button>
                    <button class="btn btn-primary" id="json-submit-btn" onclick="submitJsonData()" disabled>Submit Data</button>
                </div>
            </div>
        </div>

        <script>
            let currentStatus = 'all';
            let currentSearch = '';
            let currentProductAsin = '';
            let activeTab = 'products';
            let currentProducts = [];
            let currentReviews = [];
            let productOptions = [];
            let productActions = {};
            let reviewActions = {};
            let currentProductPage = 0;
            let currentReviewPage = 0;
            let hasNextProductPage = false;
            let hasNextReviewPage = false;
            const PAGE_SIZE = 20;

            const icons = {
                eye: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
                refresh: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 1-9 9 9.8 9.8 0 0 1-6.7-2.7"></path><path d="M3 12a9 9 0 0 1 9-9 9.8 9.8 0 0 1 6.7 2.7"></path><path d="M3 3v6h6"></path><path d="M21 21v-6h-6"></path></svg>',
                edit: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
                eraser: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 21-4-4 10-10 4 4-10 10Z"></path><path d="m14 6 4-4 4 4-4 4"></path><path d="M10 21h11"></path></svg>',
                trash: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v5"></path><path d="M14 11v5"></path></svg>',
                spinner: '<span class="loading" aria-hidden="true"></span>'
            };

            async function fetchJson(url, options = {}) {
                const response = await fetch(url, options);
                const contentType = response.headers.get('content-type') || '';
                const payload = contentType.includes('application/json') ? await response.json() : { error: { message: await response.text() } };

                if (!response.ok || payload.success === false) {
                    throw new Error(payload.error?.message || payload.message || \`Request failed with status \${response.status}\`);
                }

                return payload;
            }

            function escapeHtml(value) {
                return String(value ?? 'N/A').replace(/[&<>"']/g, (char) => ({
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#39;'
                }[char]));
            }

            function renderActionIcon(actionState, actionName, icon) {
                return actionState === actionName ? icons.spinner : icon;
            }

            async function loadProductOptions() {
                const data = await fetchJson('/api/products?limit=500&offset=0');
                productOptions = data.products || [];
                const select = document.getElementById('add-review-asin');
                select.innerHTML = productOptions.length
                    ? productOptions.map((product) => \`<option value="\${escapeHtml(product.asin)}">\${escapeHtml(product.asin)} - \${escapeHtml(product.title || 'Untitled product')}</option>\`).join('')
                    : '<option value="">No products available</option>';
                select.disabled = !productOptions.length;
                return productOptions;
            }

            function renderPagination(containerId, currentPage, hasNextPage, changeFunctionName) {
                document.getElementById(containerId).innerHTML = \`
                    <button class="page-btn" onclick="\${changeFunctionName}(-1)" \${currentPage === 0 ? 'disabled' : ''}>Previous</button>
                    <span class="page-label">Page \${currentPage + 1}</span>
                    <button class="page-btn" onclick="\${changeFunctionName}(1)" \${hasNextPage ? '' : 'disabled'}>Next</button>
                \`;
            }

            function switchTab(tab) {
                activeTab = tab;
                document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
                document.getElementById('products-section').classList.toggle('hidden', tab !== 'products');
                document.getElementById('reviews-section').classList.toggle('hidden', tab !== 'reviews');
                document.getElementById('reviews-controls').classList.toggle('hidden', tab !== 'reviews');
                if (tab === 'products' && !currentProducts.length) loadProducts();
                if (tab === 'reviews' && !currentReviews.length) loadReviews();
            }

            function changeProductPage(direction) {
                const nextPage = currentProductPage + direction;
                if (nextPage < 0 || (direction > 0 && !hasNextProductPage)) return;
                currentProductPage = nextPage;
                loadProducts();
            }

            function changeReviewPage(direction) {
                const nextPage = currentReviewPage + direction;
                if (nextPage < 0 || (direction > 0 && !hasNextReviewPage)) return;
                currentReviewPage = nextPage;
                loadReviews();
            }

            function renderProducts() {
                const tbody = document.getElementById('products-tbody');
                tbody.innerHTML = currentProducts.map(product => {
                    const actionState = productActions[product.asin];
                    return \`
                        <tr>
                            <td>\${escapeHtml(product.asin)}</td>
                            <td>\${escapeHtml(product.title)}</td>
                            <td>\${escapeHtml(product.upc_code)}</td>
                            <td>\${escapeHtml(product.handle)}</td>
                            <td>\${escapeHtml(product.review_count)}</td>
                            <td>
                                <div class="actions">
                                    <button class="btn btn-secondary icon-btn" onclick="editProduct('\${escapeHtml(product.asin)}')" title="Edit product" aria-label="Edit product" \${actionState ? 'disabled' : ''}>\${icons.edit}</button>
                                    <button class="btn btn-secondary icon-btn" onclick="viewProductReviews('\${escapeHtml(product.asin)}')" title="View reviews" aria-label="View reviews" \${actionState ? 'disabled' : ''}>\${icons.eye}</button>
                                    <button class="btn btn-danger icon-btn" onclick="removeProduct('\${escapeHtml(product.asin)}', event)" title="Remove product" aria-label="Remove product" \${actionState ? 'disabled' : ''}>\${renderActionIcon(actionState, 'delete', icons.trash)}</button>
                                </div>
                            </td>
                        </tr>
                    \`;
                }).join('') || '<tr><td colspan="6" style="text-align: center; padding: 40px;">No products found.</td></tr>';
                renderPagination('products-pagination', currentProductPage, hasNextProductPage, 'changeProductPage');
            }

            function renderReviews() {
                const tbody = document.getElementById('reviews-tbody');
                tbody.innerHTML = currentReviews.map(review => {
                    const actionState = reviewActions[review.id];
                    return \`
                        <tr>
                            <td>\${escapeHtml(review.id)}</td>
                            <td>\${escapeHtml(review.asin)}</td>
                            <td>\${escapeHtml(review.title)}</td>
                            <td>\${escapeHtml(review.rating)}</td>
                            <td><span class="status-badge status-\${escapeHtml(review.ai_status)}">\${escapeHtml(review.ai_status)}</span></td>
                            <td>
                                <div class="actions">
                                    <button class="btn btn-secondary icon-btn" onclick="editReview(\${review.id})" title="Edit review" aria-label="Edit review" \${actionState ? 'disabled' : ''}>\${icons.edit}</button>
                                    <button class="btn btn-primary icon-btn" onclick="viewReview(\${review.id})" title="View review" aria-label="View review" \${actionState ? 'disabled' : ''}>\${icons.eye}</button>
                                    <button class="btn btn-secondary icon-btn" onclick="generateReview(\${review.id})" title="Generate review" aria-label="Generate review" \${actionState ? 'disabled' : ''}>\${renderActionIcon(actionState, 'generate', icons.refresh)}</button>
                                    <button class="btn btn-secondary icon-btn" onclick="clearReviewAI(\${review.id})" title="Clear AI review" aria-label="Clear AI review" \${actionState ? 'disabled' : ''}>\${renderActionIcon(actionState, 'clear', icons.eraser)}</button>
                                    <button class="btn btn-danger icon-btn" onclick="removeReview(\${review.id})" title="Remove review" aria-label="Remove review" \${actionState ? 'disabled' : ''}>\${renderActionIcon(actionState, 'delete', icons.trash)}</button>
                                </div>
                            </td>
                        </tr>
                    \`;
                }).join('') || '<tr><td colspan="6" style="text-align: center; padding: 40px;">No reviews found.</td></tr>';
                renderPagination('reviews-pagination', currentReviewPage, hasNextReviewPage, 'changeReviewPage');
            }

            async function loadStats() {
                try {
                    const data = await fetchJson('/api/stats');
                    if (data.success) {
                        document.getElementById('total-reviews').textContent = data.stats.total;
                        document.getElementById('pending-reviews').textContent = data.stats.pending;
                        document.getElementById('processing-reviews').textContent = data.stats.processing;
                        document.getElementById('done-reviews').textContent = data.stats.done;
                    }
                } catch (error) {
                    console.error('Failed to load stats:', error);
                }
            }

            async function loadProducts() {
                try {
                    const data = await fetchJson(\`/api/products?limit=\${PAGE_SIZE + 1}&offset=\${currentProductPage * PAGE_SIZE}\`);
                    if (data.success) {
                        hasNextProductPage = data.products.length > PAGE_SIZE;
                        currentProducts = data.products.slice(0, PAGE_SIZE);
                        renderProducts();
                    }
                } catch (error) {
                    console.error('Failed to load products:', error);
                    showMessage(error.message || 'Failed to load products', 'error');
                }
            }

            async function loadReviews() {
                try {
                    let url = currentProductAsin
                        ? '/api/products/reviews?asin=' + encodeURIComponent(currentProductAsin) + '&limit=' + (PAGE_SIZE + 1) + '&offset=' + (currentReviewPage * PAGE_SIZE)
                        : '/api/search?q=' + encodeURIComponent(currentSearch || ' ') + '&limit=' + (PAGE_SIZE + 1) + '&offset=' + (currentReviewPage * PAGE_SIZE);
                    if (!currentProductAsin && currentStatus !== 'all') {
                        url += '&status=' + encodeURIComponent(currentStatus);
                    }

                    const data = await fetchJson(url);
                    if (data.success) {
                        hasNextReviewPage = data.reviews.length > PAGE_SIZE;
                        currentReviews = data.reviews.slice(0, PAGE_SIZE);
                        renderReviews();
                    }
                } catch (error) {
                    console.error('Failed to load reviews:', error);
                    showMessage(error.message || 'Failed to load reviews', 'error');
                }
            }

            async function viewReview(reviewId) {
                try {
                    const review = currentReviews.find((item) => Number(item.id) === Number(reviewId));
                    if (!review) {
                        throw new Error('Review is not available in the current table. Refresh the list and try again.');
                    }

                    // Show review details in modal
                    const modal = document.getElementById('review-modal');
                    const content = document.getElementById('review-content');
                    content.innerHTML = \`
                        <div class="review-original">
                            <div class="review-title">Original Review</div>
                            <div class="review-title">\${escapeHtml(review.title)}</div>
                            <div>\${escapeHtml(review.body)}</div>
                        </div>
                        <div class="review-ai">
                            <div class="review-title">AI Generated Review</div>
                            <div class="review-title">\${escapeHtml(review.ai_title)}</div>
                            <div class="review-email">\${escapeHtml(review.email)}</div>
                            <div>\${escapeHtml(review.ai_body)}</div>
                        </div>
                    \`;
                    modal.classList.remove('hidden');
                } catch (error) {
                    console.error('Failed to view review:', error);
                    showMessage(error.message || 'Failed to load review details', 'error');
                }
            }

            async function generateReview(reviewId) {
                const previousReview = currentReviews.find((review) => Number(review.id) === Number(reviewId));
                reviewActions[reviewId] = 'generate';
                currentReviews = currentReviews.map((review) => Number(review.id) === Number(reviewId)
                    ? { ...review, ai_status: 'processing' }
                    : review
                );
                renderReviews();
                await loadStats();

                try {
                    const data = await fetchJson(\`/review/generate?id=\${reviewId}\`, { method: 'POST' });

                    if (data.success) {
                        currentReviews = currentReviews.map((review) => Number(review.id) === Number(reviewId)
                            ? { ...review, ai_status: 'done', ai_title: data.data?.title || review.ai_title, ai_body: data.data?.body || review.ai_body, email: data.data?.email || review.email }
                            : review
                        );
                        renderReviews();
                        await loadStats();
                        showMessage('Review generated successfully!', 'success');
                    } else {
                        showMessage('Failed to generate review', 'error');
                    }
                } catch (error) {
                    console.error('Failed to generate review:', error);
                    if (previousReview) {
                        currentReviews = currentReviews.map((review) => Number(review.id) === Number(reviewId) ? previousReview : review);
                        renderReviews();
                        await loadStats();
                    }
                    showMessage(error.message || 'Failed to generate review', 'error');
                } finally {
                    delete reviewActions[reviewId];
                    renderReviews();
                }
            }

            async function clearReviewAI(reviewId) {
                const previousReview = currentReviews.find((review) => Number(review.id) === Number(reviewId));
                reviewActions[reviewId] = 'clear';
                renderReviews();

                try {
                    await fetchJson(\`/api/review?id=\${reviewId}&action=clear\`, { method: 'POST' });
                    currentReviews = currentReviews.map((review) => Number(review.id) === Number(reviewId)
                        ? { ...review, ai_status: 'pending', ai_title: '', ai_body: '' }
                        : review
                    );
                    await loadStats();
                    showMessage('AI review cleared successfully!', 'success');
                } catch (error) {
                    console.error('Failed to clear AI review:', error);
                    if (previousReview) {
                        currentReviews = currentReviews.map((review) => Number(review.id) === Number(reviewId) ? previousReview : review);
                    }
                    showMessage(error.message || 'Failed to clear AI review', 'error');
                } finally {
                    delete reviewActions[reviewId];
                    renderReviews();
                }
            }

            async function removeReview(reviewId) {
                if (!confirm('Remove this review?')) return;

                const previousReviews = currentReviews;
                reviewActions[reviewId] = 'delete';
                renderReviews();

                try {
                    await fetchJson(\`/api/review?id=\${reviewId}\`, { method: 'DELETE' });
                    currentReviews = currentReviews.filter((review) => Number(review.id) !== Number(reviewId));
                    if (!currentReviews.length && currentReviewPage > 0) {
                        currentReviewPage--;
                        await loadReviews();
                    }
                    await loadStats();
                    showMessage('Review removed successfully!', 'success');
                } catch (error) {
                    console.error('Failed to remove review:', error);
                    currentReviews = previousReviews;
                    showMessage(error.message || 'Failed to remove review', 'error');
                } finally {
                    delete reviewActions[reviewId];
                    renderReviews();
                }
            }

            async function removeProduct(asin) {
                if (!confirm('Remove this product and its reviews?')) return;

                const previousProducts = currentProducts;
                const previousReviews = currentReviews;
                productActions[asin] = 'delete';
                renderProducts();

                try {
                    await fetchJson('/api/product?asin=' + encodeURIComponent(asin), { method: 'DELETE' });
                    currentProducts = currentProducts.filter((product) => product.asin !== asin);
                    currentReviews = currentReviews.filter((review) => review.asin !== asin);
                    if (currentProductAsin === asin) {
                        currentProductAsin = '';
                        currentSearch = '';
                        document.getElementById('search-input').value = '';
                    }
                    await loadStats();
                    if (!currentProducts.length && currentProductPage > 0) {
                        currentProductPage--;
                        await loadProducts();
                    }
                    showMessage('Product removed successfully!', 'success');
                } catch (error) {
                    console.error('Failed to remove product:', error);
                    currentProducts = previousProducts;
                    currentReviews = previousReviews;
                    showMessage(error.message || 'Failed to remove product', 'error');
                } finally {
                    delete productActions[asin];
                    renderProducts();
                    renderReviews();
                }
            }

            async function processBatch() {
                const btn = document.getElementById('process-batch-btn');
                const originalText = btn.textContent;
                btn.textContent = 'Processing...';
                btn.classList.add('processing');

                try {
                    const data = await fetchJson('/review/generate/bulk?limit=5', { method: 'POST' });

                    if (data.success) {
                        await refreshData();
                        showMessage(\`Processed \${data.processed} reviews successfully!\`, 'success');
                    } else {
                        showMessage('Failed to process batch', 'error');
                    }
                } catch (error) {
                    console.error('Failed to process batch:', error);
                    showMessage('Failed to process batch', 'error');
                } finally {
                    btn.textContent = originalText;
                    btn.classList.remove('processing');
                }
            }

            async function updateShopifyProductInfo() {
                const btn = document.getElementById('shopify-update-btn');
                const originalText = btn.textContent;
                btn.textContent = 'Updating...';
                btn.classList.add('processing');
                btn.disabled = true;

                try {
                    const data = await fetchJson('/api/products/shopify-info?limit=25', { method: 'POST' });
                    await loadProducts();
                    showMessage(\`Updated \${data.updated} handles. \${data.notFound} UPCs not found.\`, 'success');
                } catch (error) {
                    console.error('Failed to update Shopify product information:', error);
                    showMessage(error.message || 'Failed to update Shopify handles', 'error');
                } finally {
                    btn.textContent = originalText;
                    btn.classList.remove('processing');
                    btn.disabled = false;
                }
            }

            async function refreshData() {
                const btn = document.getElementById('refresh-btn');
                const originalText = btn.textContent;
                btn.textContent = 'Refreshing...';
                btn.classList.add('processing');

                try {
                    await Promise.all([
                        loadStats(),
                        activeTab === 'products' ? loadProducts() : loadReviews()
                    ]);
                    showMessage('Data refreshed successfully!', 'success');
                } catch (error) {
                    console.error('Failed to refresh data:', error);
                    showMessage('Failed to refresh data', 'error');
                } finally {
                    btn.textContent = originalText;
                    btn.classList.remove('processing');
                }
            }

            function viewProductReviews(asin) {
                currentProductAsin = asin;
                currentSearch = asin;
                currentReviewPage = 0;
                document.getElementById('search-input').value = asin;
                switchTab('reviews');
                loadReviews();
            }

            function closeModal() {
                document.getElementById('review-modal').classList.add('hidden');
            }

            function closeProductEditModal() {
                document.getElementById('product-edit-modal').classList.add('hidden');
            }

            function openProductAddModal() {
                document.getElementById('product-add-form').reset();
                document.getElementById('product-add-modal').classList.remove('hidden');
                document.getElementById('add-product-asin').focus();
            }

            function closeProductAddModal() {
                document.getElementById('product-add-modal').classList.add('hidden');
            }

            document.getElementById('product-add-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const submitBtn = e.submitter;
                const originalText = submitBtn.textContent;
                submitBtn.textContent = 'Adding...';
                submitBtn.disabled = true;

                const asin = document.getElementById('add-product-asin').value.trim();
                const title = document.getElementById('add-product-title').value.trim();
                const upc_code = document.getElementById('add-product-upc').value.trim();
                const handle = document.getElementById('add-product-handle').value.trim();

                try {
                    await fetchJson('/api/product', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ asin, title, upc_code, handle })
                    });

                    closeProductAddModal();
                    currentProductPage = 0;
                    await loadProducts();
                    productOptions = [];
                    showMessage('Product added successfully!', 'success');
                } catch (error) {
                    console.error('Failed to add product:', error);
                    showMessage(error.message || 'Failed to add product', 'error');
                } finally {
                    submitBtn.textContent = originalText;
                    submitBtn.disabled = false;
                }
            });

            async function editProduct(asin) {
                const product = currentProducts.find(p => p.asin === asin);
                if (!product) return;

                document.getElementById('edit-asin').value = product.asin;
                document.getElementById('edit-title').value = product.title || '';
                document.getElementById('edit-upc').value = product.upc_code || '';
                document.getElementById('edit-handle').value = product.handle || '';

                document.getElementById('product-edit-modal').classList.remove('hidden');
            }

            document.getElementById('product-edit-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const asin = document.getElementById('edit-asin').value;
                const title = document.getElementById('edit-title').value;
                const upc_code = document.getElementById('edit-upc').value;
                const handle = document.getElementById('edit-handle').value;

                try {
                    await fetchJson('/api/product?asin=' + encodeURIComponent(asin), {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title, upc_code, handle })
                    });

                    // Update the product in the current list
                    currentProducts = currentProducts.map(p =>
                        p.asin === asin ? { ...p, title: title || null, upc_code: upc_code || null, handle: handle || null } : p
                    );
                    renderProducts();
                    closeProductEditModal();
                    showMessage('Product updated successfully!', 'success');
                } catch (error) {
                    console.error('Failed to update product:', error);
                    showMessage(error.message || 'Failed to update product', 'error');
                }
            });

            function closeReviewEditModal() {
                document.getElementById('review-edit-modal').classList.add('hidden');
            }

            async function openReviewAddModal() {
                document.getElementById('review-add-form').reset();
                document.getElementById('add-review-rating').value = '5';
                try {
                    await loadProductOptions();
                    document.getElementById('review-add-modal').classList.remove('hidden');
                    if (!productOptions.length) {
                        showMessage('Add a product before adding reviews.', 'error');
                    }
                } catch (error) {
                    console.error('Failed to load product options:', error);
                    showMessage(error.message || 'Failed to load products for review form', 'error');
                }
            }

            function closeReviewAddModal() {
                document.getElementById('review-add-modal').classList.add('hidden');
            }

            document.getElementById('review-add-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const submitBtn = e.submitter;
                const originalText = submitBtn.textContent;
                submitBtn.textContent = 'Adding...';
                submitBtn.disabled = true;

                const payload = {
                    asin: document.getElementById('add-review-asin').value,
                    rating: Number(document.getElementById('add-review-rating').value),
                    reviewer_name: document.getElementById('add-reviewer-name').value.trim(),
                    email: document.getElementById('add-review-email').value.trim(),
                    title: document.getElementById('add-review-title').value.trim(),
                    body: document.getElementById('add-review-body').value.trim()
                };

                try {
                    const data = await fetchJson('/api/review', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    closeReviewAddModal();
                    currentReviewPage = 0;
                    await Promise.all([loadStats(), loadProducts(), activeTab === 'reviews' ? loadReviews() : Promise.resolve()]);
                    showMessage(data.inserted ? 'Review added successfully!' : 'Review already exists for this product title.', data.inserted ? 'success' : 'error');
                } catch (error) {
                    console.error('Failed to add review:', error);
                    showMessage(error.message || 'Failed to add review', 'error');
                } finally {
                    submitBtn.textContent = originalText;
                    submitBtn.disabled = false;
                }
            });

            async function editReview(reviewId) {
                const review = currentReviews.find(r => r.id === reviewId);
                if (!review) return;

                document.getElementById('edit-review-id').value = review.id;
                document.getElementById('edit-review-title').value = review.title || '';
                document.getElementById('edit-review-body').value = review.body || '';
                document.getElementById('edit-review-rating').value = String(review.rating || 5);

                document.getElementById('review-edit-modal').classList.remove('hidden');
            }

            document.getElementById('review-edit-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const id = document.getElementById('edit-review-id').value;
                const title = document.getElementById('edit-review-title').value;
                const body = document.getElementById('edit-review-body').value;
                const rating = Number(document.getElementById('edit-review-rating').value);

                try {
                    await fetchJson('/api/review?id=' + encodeURIComponent(id), {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title, body, rating })
                    });

                    // Update the review in the current list
                    currentReviews = currentReviews.map(r =>
                        r.id === parseInt(id) ? { ...r, title: title || null, body: body || null, rating } : r
                    );
                    renderReviews();
                    closeReviewEditModal();
                    showMessage('Review updated successfully!', 'success');
                } catch (error) {
                    console.error('Failed to update review:', error);
                    showMessage(error.message || 'Failed to update review', 'error');
                }
            });

            function showMessage(message, type) {
                // Simple message display - you can enhance this
                const msgDiv = document.createElement('div');
                msgDiv.className = \`message \${type}\`;
                msgDiv.textContent = message;
                msgDiv.style.cssText = \`
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    padding: 10px 20px;
                    border-radius: 4px;
                    color: white;
                    z-index: 1001;
                    font-weight: bold;
                \`;
                document.body.appendChild(msgDiv);
                setTimeout(() => msgDiv.remove(), 3000);
            }

            // Event listeners
            document.getElementById('search-input').addEventListener('input', (e) => {
                currentSearch = e.target.value;
                currentProductAsin = '';
                currentReviewPage = 0;
                loadReviews();
            });

            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    currentStatus = e.target.dataset.status;
                    currentProductAsin = '';
                    currentReviewPage = 0;
                    loadReviews();
                });
            });

            // JSON Upload Functions
            let parsedJsonData = null;

            function openJsonModal() {
                document.getElementById('json-modal').classList.remove('hidden');
                resetJsonForm();
            }

            function closeJsonModal() {
                document.getElementById('json-modal').classList.add('hidden');
                resetJsonForm();
            }

            function resetJsonForm() {
                parsedJsonData = null;
                document.getElementById('json-input').value = '';
                document.getElementById('json-file').value = '';
                document.getElementById('json-submit-btn').disabled = true;
                document.getElementById('json-stats').style.display = 'none';
                document.getElementById('json-status').style.display = 'none';
            }

            // Parse JSON text
            function parseJsonInput(text) {
                const trimmed = text.trim();
                if (!trimmed) return [];
                
                try {
                    // Try parsing as JSON array first
                    const parsed = JSON.parse(trimmed);
                    if (Array.isArray(parsed)) return parsed;
                    if (parsed.input && parsed.result) return [parsed];
                    if (parsed.payloads && Array.isArray(parsed.payloads)) return parsed.payloads;
                    return [];
                } catch {
                    // Try JSONL format (one JSON object per line)
                    return trimmed.split('\\n')
                        .filter(line => line.trim())
                        .map(line => {
                            try { return JSON.parse(line.trim()); } 
                            catch { return null; }
                        })
                        .filter(item => item && item.input && item.result);
                }
            }

            // Handle textarea input
            document.getElementById('json-input').addEventListener('input', function(e) {
                const data = parseJsonInput(e.target.value);
                updateJsonData(data);
            });

            // Handle file upload
            document.getElementById('json-file').addEventListener('change', function(e) {
                const file = e.target.files[0];
                if (!file) return;
                
                const reader = new FileReader();
                reader.onload = function(event) {
                    const data = parseJsonInput(event.target.result);
                    updateJsonData(data);
                    
                    // Show file content in textarea for preview
                    if (data.length > 0) {
                        document.getElementById('json-input').value = event.target.result.substring(0, 500) + 
                            (event.target.result.length > 500 ? '\\n... (truncated preview)' : '');
                    }
                };
                reader.readAsText(file);
            });

            function updateJsonData(data) {
                parsedJsonData = data;
                const submitBtn = document.getElementById('json-submit-btn');
                const statsDiv = document.getElementById('json-stats');
                
                if (data.length > 0) {
                    submitBtn.disabled = false;
                    statsDiv.style.display = 'block';
                    document.getElementById('json-item-count').textContent = data.length;
                } else {
                    submitBtn.disabled = true;
                    statsDiv.style.display = 'none';
                }
            }

            async function submitJsonData() {
                if (!parsedJsonData || parsedJsonData.length === 0) {
                    showMessage('No valid data to submit', 'error');
                    return;
                }
                
                const submitBtn = document.getElementById('json-submit-btn');
                const statusDiv = document.getElementById('json-status');
                const originalText = submitBtn.textContent;
                
                submitBtn.disabled = true;
                submitBtn.textContent = 'Submitting...';
                statusDiv.style.display = 'block';
                statusDiv.innerHTML = '<div style="padding: 10px; background: #dbeafe; border-radius: 4px;">Processing data...</div>';
                
                try {
                    const response = await fetch('/webhook/products', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ payloads: parsedJsonData })
                    });
                    
                    const result = await response.json();
                    
                    if (response.ok && result.success) {
                        statusDiv.innerHTML = \`<div style="padding: 10px; background: #d1fae5; border-radius: 4px; color: #065f46;">
                            ✅ Successfully processed \${result.processed} of \${result.total} items
                        </div>\`;
                        
                        // Reload data after success
                        setTimeout(() => {
                            closeJsonModal();
                            refreshData();
                        }, 2000);
                        
                        showMessage(\`Successfully processed \${result.processed} of \${result.total} items\`, 'success');
                    } else {
                        throw new Error(result.error || result.message || 'Processing failed');
                    }
                } catch (error) {
                    console.error('JSON submit error:', error);
                    statusDiv.innerHTML = \`<div style="padding: 10px; background: #fee2e2; border-radius: 4px; color: #dc2626;">
                        ❌ Error: \${escapeHtml(error.message)}
                    </div>\`;
                    showMessage(error.message || 'Failed to process JSON data', 'error');
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalText;
                }
            }

            // Close modal when clicking outside
            document.getElementById('json-modal').addEventListener('click', function(e) {
                if (e.target === this) {
                    closeJsonModal();
                }
            });

            // Initial load
            refreshData();
        </script>
    </body>
    </html>
  `;

	return new Response(html, {
		headers: { 'Content-Type': 'text/html' },
	});
}
