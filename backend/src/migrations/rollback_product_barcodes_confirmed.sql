-- Retour arrière de add_product_barcodes_confirmed.sql : les confirmations sont perdues,
-- la réception reposera la question pour ces codes.
BEGIN;
ALTER TABLE product_barcodes DROP COLUMN IF EXISTS confirmed_by, DROP COLUMN IF EXISTS confirmed_at;
COMMIT;
