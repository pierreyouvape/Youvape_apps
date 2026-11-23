-- Erreurs de commande au SAV fournisseur (Pierre, 23/11/2026).
--
-- Des produits NEUFS qu'on renvoie au fournisseur sans qu'aucun client ne les
-- ait eus : commandés par erreur (`reason = 'commande_erreur'`) ou reçus sans
-- avoir été commandés (`reason = 'non_commande'`). `source = 'erreur'`.
--   - site     : `shop` vide, `purchase_order_id` = commande fournisseur du site
--                (obligatoire à la saisie, contrôlé par l'app) ;
--   - boutique : `shop` = warehouse Nextore, `order_ref` = référence libre
--                de la commande (facultative).
-- Aucun stock n'est touché, ni BMS ni Nextore.
--
-- Pas de contrainte sur `purchase_order_id` : il est ON DELETE SET NULL, une
-- contrainte « obligatoire » empêcherait de supprimer une commande.
--
-- Idempotente.
--   docker compose exec -T postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_supplier_returns_order_errors.sql
--
-- Retour arrière : rollback_supplier_returns_order_errors.sql

BEGIN;

ALTER TABLE supplier_return_items ADD COLUMN IF NOT EXISTS order_ref TEXT;

ALTER TABLE supplier_return_items DROP CONSTRAINT IF EXISTS supplier_return_items_source_check;
ALTER TABLE supplier_return_items ADD CONSTRAINT supplier_return_items_source_check CHECK (
  (source = 'site' AND return_line_id IS NOT NULL)
  OR (source = 'boutique' AND return_line_id IS NULL AND shop IS NOT NULL)
  OR (source = 'erreur' AND return_line_id IS NULL AND reason IN ('commande_erreur', 'non_commande'))
);

COMMIT;
