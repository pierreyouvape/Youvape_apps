-- Migration: Suivi de stock par produit/déclinaison (équivalent ATUM Control Switch)
-- track_stock détermine si un produit/variation apparaît dans le catalogue/stock central de l'app
-- Initialisé depuis manage_stock (état actuel WooCommerce), puis géré manuellement dans l'app

ALTER TABLE products ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT true;

UPDATE products SET track_stock = manage_stock;
