-- Retours client : motif « Erreur d'adressage » (Pierre, 14/10/2026), issue
-- proposée : points fidélité. Idempotente.
--
--   docker compose exec -T postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_customer_returns_reason_adressage.sql
--
-- Retour arrière : rollback_customer_returns_reason_adressage.sql

BEGIN;
ALTER TABLE customer_returns DROP CONSTRAINT IF EXISTS customer_returns_reason_check;
ALTER TABLE customer_returns ADD CONSTRAINT customer_returns_reason_check
  CHECK (reason IN ('defaut', 'erreur_expedition', 'retractation', 'non_recupere', 'erreur_adressage'));
COMMIT;
