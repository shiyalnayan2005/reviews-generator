CREATE UNIQUE INDEX IF NOT EXISTS idx_products_asin_brand_unique ON products (asin, brand_name);
