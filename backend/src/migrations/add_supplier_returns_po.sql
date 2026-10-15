-- SAV fournisseur (Pierre, 15/10/2026) :
--   - chaque pièce se rattache à une COMMANDE FOURNISSEUR du site, et on ne peut
--     pas en retourner plus que les pièces reçues sur cette commande (décompte
--     tous statuts confondus, site + boutique : returnRules.checkLot) ;
--   - les SAV de la BOUTIQUE (échangés en caisse) entrent dans le même stock SAV,
--     sans retour client : `return_line_id` vide, `source = 'boutique'`.
--
-- Les pièces déjà en SAV restent sans commande : on la renseigne depuis l'écran
-- du fournisseur.
--
-- Idempotente.
--   docker compose exec -T postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_supplier_returns_po.sql
--
-- Retour arrière : rollback_supplier_returns_po.sql

BEGIN;

ALTER TABLE supplier_return_items
  -- SET NULL : une commande peut être supprimée (purchaseOrderModel), la pièce reste.
  ADD COLUMN IF NOT EXISTS purchase_order_id INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source            VARCHAR(10) NOT NULL DEFAULT 'site',
  -- Boutique (warehouse_id Nextore : 1 Montpellier, 2 Castelnau) et référence libre.
  ADD COLUMN IF NOT EXISTS shop              INTEGER,
  ADD COLUMN IF NOT EXISTS note              TEXT;

ALTER TABLE supplier_return_items ALTER COLUMN return_line_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_return_items_source_check') THEN
    ALTER TABLE supplier_return_items ADD CONSTRAINT supplier_return_items_source_check CHECK (
      (source = 'site' AND return_line_id IS NOT NULL)
      OR (source = 'boutique' AND return_line_id IS NULL AND shop IS NOT NULL)
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supplier_return_items_po
  ON supplier_return_items (purchase_order_id, product_id);

COMMIT;
