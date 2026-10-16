-- Retours client : motif « Colis perdu » (Pierre, 16/10/2026). Déclaré par son
-- propre bouton, sans retour du produit : le constat est validé à la
-- déclaration, toutes les pièces « non remises en stock ». La commande de
-- renvoi garde la méthode d'origine (Chronopost compris). Idempotente.
--
--   docker compose exec -T postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_customer_returns_lost.sql
--
-- Retour arrière : rollback_customer_returns_lost.sql

BEGIN;
ALTER TABLE customer_returns DROP CONSTRAINT IF EXISTS customer_returns_reason_check;
ALTER TABLE customer_returns ADD CONSTRAINT customer_returns_reason_check
  CHECK (reason IN ('defaut', 'erreur_expedition', 'retractation', 'non_recupere', 'erreur_adressage', 'colis_perdu'));
COMMIT;
