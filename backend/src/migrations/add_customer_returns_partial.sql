-- Retours client : retour PARTIEL d'un produit (Pierre, 14/10/2026).
-- On ne reçoit qu'une partie d'une cigarette (la batterie seule…) : la ligne
-- le dit, avec la consigne. La commande de renvoi porte l'article entier
-- (WooCommerce l'impose) ; le Packing affiche la consigne sur la ligne et fait
-- confirmer avant l'étiquette ; le Picking ne la met jamais dans une vague
-- générée par règle.
--
-- Idempotente.
--   docker compose exec -T postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_customer_returns_partial.sql
--
-- Retour arrière : rollback_customer_returns_partial.sql

BEGIN;
ALTER TABLE customer_return_lines
  ADD COLUMN IF NOT EXISTS partial      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS partial_note TEXT;
COMMIT;
