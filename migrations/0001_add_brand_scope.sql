PRAGMA foreign_keys = off;

CREATE TABLE products_new (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	asin TEXT NOT NULL,
	brand_name TEXT NOT NULL DEFAULT 'happimess',
	title TEXT,
	handle TEXT,
	upc_code TEXT,
	created_at TEXT DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(asin, brand_name)
);

INSERT INTO products_new (id, asin, brand_name, title, handle, upc_code, created_at)
SELECT id, asin, 'happimess', title, handle, upc_code, created_at
FROM products;

DROP TABLE products;
ALTER TABLE products_new RENAME TO products;

CREATE TABLE reviews_new (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	asin TEXT NOT NULL,
	brand_name TEXT NOT NULL DEFAULT 'happimess',
	reviewer_name TEXT,
	email TEXT,
	rating REAL,
	title TEXT,
	body TEXT,
	ai_title TEXT DEFAULT '',
	ai_body TEXT DEFAULT '',
	ai_status TEXT DEFAULT 'pending',
	created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO reviews_new (id, asin, brand_name, reviewer_name, email, rating, title, body, ai_title, ai_body, ai_status, created_at)
SELECT id, asin, 'happimess', reviewer_name, email, rating, title, body, ai_title, ai_body, ai_status, created_at
FROM reviews;

DROP TABLE reviews;
ALTER TABLE reviews_new RENAME TO reviews;

CREATE INDEX IF NOT EXISTS idx_products_brand_created_at ON products (brand_name, created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_brand_asin_created_at ON reviews (brand_name, asin, created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_brand_status ON reviews (brand_name, ai_status);

PRAGMA foreign_keys = on;
