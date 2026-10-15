-- Retour arrière de add_supplier_returns_po.sql.
-- ⚠️ Efface les SAV boutique et le rattachement des pièces à leur commande fournisseur.
BEGIN;
DELETE FROM supplier_return_items WHERE source = 'boutique';
ALTER TABLE supplier_return_items DROP CONSTRAINT IF EXISTS supplier_return_items_source_check;
DROP INDEX IF EXISTS idx_supplier_return_items_po;
ALTER TABLE supplier_return_items
  DROP COLUMN IF EXISTS purchase_order_id,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS shop,
  DROP COLUMN IF EXISTS note;
ALTER TABLE supplier_return_items ALTER COLUMN return_line_id SET NOT NULL;
COMMIT;
