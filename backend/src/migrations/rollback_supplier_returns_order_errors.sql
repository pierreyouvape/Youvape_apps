-- Retour arrière de add_supplier_returns_order_errors.sql.
-- ⚠️ Efface les erreurs de commande saisies au SAV fournisseur.
BEGIN;
DELETE FROM supplier_return_items WHERE source = 'erreur';
ALTER TABLE supplier_return_items DROP CONSTRAINT IF EXISTS supplier_return_items_source_check;
ALTER TABLE supplier_return_items ADD CONSTRAINT supplier_return_items_source_check CHECK (
  (source = 'site' AND return_line_id IS NOT NULL)
  OR (source = 'boutique' AND return_line_id IS NULL AND shop IS NOT NULL)
);
ALTER TABLE supplier_return_items DROP COLUMN IF EXISTS order_ref;
COMMIT;
