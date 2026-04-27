import { getProducts, getProductReviews, getReview, searchReviews, getReviewStats } from '../services/db';
import { handleError } from '../middleware/errorHandler';
import { ValidationError } from '../lib/errors';

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

			const products = await getProducts(env, limit, offset);
			return Response.json({ success: true, products });
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
			if (!id) {
				return handleError(new ValidationError('Review id parameter required'));
			}

			const review = await getReview(env, id);
			if (!review) {
				return handleError(new ValidationError(`Review not found with id=${id}`));
			}

			return Response.json({ success: true, review });
		}

		if (pathname === '/api/search') {
			const query = url.searchParams.get('q');
			const status = url.searchParams.get('status') || undefined;
			const limit = parseInt(url.searchParams.get('limit') || '50');

			if (!query) {
				return handleError(new ValidationError('Search query required'));
			}

			const reviews = await searchReviews(env, query, status, limit);
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
            margin-bottom: 20px;
            color: #1f2937;
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
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }
        .modal-content {
            background: white;
            padding: 20px;
            border-radius: 8px;
            max-width: 600px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
        }
        .modal-close {
            float: right;
            cursor: pointer;
            font-size: 24px;
            line-height: 1;
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
        .page-btn.active {
            background: #2563eb;
            color: white;
        }
        .hidden { display: none; }
        .processing { opacity: 0.6; pointer-events: none; }
        .success { background: #d1fae5; color: #065f46; }
        .error { background: #fee2e2; color: #dc2626; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Reviews Generator Dashboard</h1>
            <p>Monitor and manage product reviews processing</p>
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

        <div class="search-section">
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

        <div class="products-section">
            <h2 class="section-title">Products</h2>
            <table class="table" id="products-table">
                <thead>
                    <tr>
                        <th>ASIN</th>
                        <th>Title</th>
                        <th>Rating</th>
                        <th>Total Reviews</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="products-tbody">
                    <tr>
                        <td colspan="5" style="text-align: center; padding: 40px;">
                            <div class="loading"></div> Loading products...
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="reviews-section">
            <h2 class="section-title">Reviews</h2>
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
        </div>
    </div>

    <div id="review-modal" class="modal hidden">
        <div class="modal-content">
            <span class="modal-close" onclick="closeModal()">&times;</span>
            <h3>Review Details</h3>
            <div id="review-content"></div>
        </div>
    </div>

    <script>
        let currentStatus = 'all';
        let currentSearch = '';
        let currentProductAsin = '';
        let currentReviews = [];
        let currentProductPage = 0;
        let currentReviewPage = 0;

        const icons = {
            eye: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
            refresh: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 1-9 9 9.8 9.8 0 0 1-6.7-2.7"></path><path d="M3 12a9 9 0 0 1 9-9 9.8 9.8 0 0 1 6.7 2.7"></path><path d="M3 3v6h6"></path><path d="M21 21v-6h-6"></path></svg>',
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

        function renderReviews() {
            const tbody = document.getElementById('reviews-tbody');
            tbody.innerHTML = currentReviews.map(review => \`
                <tr>
                    <td>\${escapeHtml(review.id)}</td>
                    <td>\${escapeHtml(review.asin)}</td>
                    <td>\${escapeHtml(review.title)}</td>
                    <td>\${escapeHtml(review.rating)}</td>
                    <td><span class="status-badge status-\${escapeHtml(review.ai_status)}">\${escapeHtml(review.ai_status)}</span></td>
                    <td>
                        <div class="actions">
                            <button class="btn btn-primary icon-btn" onclick="viewReview(\${review.id})" title="View review" aria-label="View review">\${icons.eye}</button>
                            <button class="btn btn-secondary icon-btn" onclick="generateReview(\${review.id}, event)" title="Generate review" aria-label="Generate review">\${icons.refresh}</button>
                        </div>
                    </td>
                </tr>
            \`).join('') || '<tr><td colspan="6" style="text-align: center; padding: 40px;">No reviews found.</td></tr>';
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
                const data = await fetchJson(\`/api/products?limit=20&offset=\${currentProductPage * 20}\`);
                if (data.success) {
                    const tbody = document.getElementById('products-tbody');
                    tbody.innerHTML = data.products.map(product => \`
                        <tr>
                            <td>\${escapeHtml(product.asin)}</td>
                            <td>\${escapeHtml(product.title)}</td>
                            <td>\${escapeHtml(product.rating)}</td>
                            <td>\${escapeHtml(product.total_reviews)}</td>
                            <td>
                                <button class="btn btn-secondary icon-btn" onclick="viewProductReviews('\${escapeHtml(product.asin)}')" title="View reviews" aria-label="View reviews">\${icons.eye}</button>
                            </td>
                        </tr>
                    \`).join('');
                }
            } catch (error) {
                console.error('Failed to load products:', error);
            }
        }

        async function loadReviews() {
            try {
                let url = currentProductAsin
                    ? '/api/products/reviews?asin=' + encodeURIComponent(currentProductAsin) + '&limit=20'
                    : '/api/search?q=' + encodeURIComponent(currentSearch || ' ') + '&limit=20';
                if (!currentProductAsin && currentStatus !== 'all') {
                    url += '&status=' + encodeURIComponent(currentStatus);
                }

                const data = await fetchJson(url);
                if (data.success) {
                    currentReviews = data.reviews;
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
                        <div>\${escapeHtml(review.ai_body)}</div>
                    </div>
                \`;
                modal.classList.remove('hidden');
            } catch (error) {
                console.error('Failed to view review:', error);
                showMessage(error.message || 'Failed to load review details', 'error');
            }
        }

        async function generateReview(reviewId, event) {
            const btn = event?.currentTarget || event?.target?.closest('button') || document.activeElement;
            const originalHtml = btn.innerHTML;
            btn.innerHTML = icons.spinner;
            btn.disabled = true;
            btn.classList.add('processing');

            try {
                const data = await fetchJson(\`/review/generate?id=\${reviewId}\`, { method: 'POST' });

                if (data.success) {
                    currentReviews = currentReviews.map((review) => Number(review.id) === Number(reviewId)
                        ? { ...review, ai_status: 'done', ai_title: data.data?.title || review.ai_title, ai_body: data.data?.body || review.ai_body }
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
                showMessage(error.message || 'Failed to generate review', 'error');
            } finally {
                btn.innerHTML = originalHtml;
                btn.disabled = false;
                btn.classList.remove('processing');
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

        async function refreshData() {
            const btn = document.getElementById('refresh-btn');
            const originalText = btn.textContent;
            btn.textContent = 'Refreshing...';
            btn.classList.add('processing');

            try {
                await Promise.all([
                    loadStats(),
                    loadProducts(),
                    loadReviews()
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
            document.getElementById('search-input').value = asin;
            loadReviews();
        }

        function closeModal() {
            document.getElementById('review-modal').classList.add('hidden');
        }

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

        // Initial load
        refreshData();
    </script>
</body>
</html>`;

	return new Response(html, {
		headers: { 'Content-Type': 'text/html' },
	});
}
