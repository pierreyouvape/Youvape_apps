-- Retours client : issue « Réparé / même produit renvoyé » (Pierre, 14/10/2026).
-- Une étiquette au n° de la commande d'origine, sans confirmation BMS ; elle
-- s'imprime depuis l'historique d'expédition.
--
-- Idempotente. Suppose add_customer_returns_lot2.sql appliquée.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
--   1. pg_dump de sauvegarde
--   2. git pull                                        (sur le VPS)
--   3. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_customer_returns_reship.sql
--   4. docker compose up --build -d backend frontend
--
-- Retour arrière : backend/src/migrations/rollback_customer_returns_reship.sql

BEGIN;

ALTER TABLE customer_returns DROP CONSTRAINT IF EXISTS customer_returns_outcome_check;
ALTER TABLE customer_returns ADD CONSTRAINT customer_returns_outcome_check
  CHECK (outcome IN ('renvoi', 'reexpedition', 'points', 'remboursement', 'aucune'));

-- shipment_labels.id de l'étiquette ; 0 = création en cours (verrou contre le
-- double clic), d'où l'absence de clé étrangère.
ALTER TABLE customer_returns ADD COLUMN IF NOT EXISTS reship_label_id INTEGER;

COMMIT;
