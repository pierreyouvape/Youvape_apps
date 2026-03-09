-- Migration: Codes-barres produits (unité + pack)
-- Un produit peut avoir plusieurs codes-barres de chaque type

CREATE TABLE IF NOT EXISTS product_barcodes (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    barcode VARCHAR(50) NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('unit', 'pack')),
    quantity INTEGER DEFAULT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(product_id, barcode)
);

CREATE INDEX IF NOT EXISTS idx_product_barcodes_product_id ON product_barcodes(product_id);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_barcode ON product_barcodes(barcode);
