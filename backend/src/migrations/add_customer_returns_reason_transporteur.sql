-- Retours client : motif « Retour transporteur par erreur » (Pierre, 20/10/2026) :
-- le transporteur nous a ramené le colis sans raison. Issue proposée : renvoi
-- (commande de renvoi WC). Idempotente.
--
--   docker compose exec -T postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_customer_returns_reason_transporteur.sql
--
-- Retour arrière : rollback_customer_returns_reason_transporteur.sql

BEGIN;
ALTER TABLE customer_returns DROP CONSTRAINT IF EXISTS customer_returns_reason_check;
ALTER TABLE customer_returns ADD CONSTRAINT customer_returns_reason_check
  CHECK (reason IN ('defaut', 'erreur_expedition', 'retractation', 'non_recupere', 'erreur_adressage', 'colis_perdu',
                    'retour_transporteur'));
COMMIT;
