-- Retour arrière de add_customer_returns_lost.sql.
-- ⚠️ Échoue si des retours portent déjà le motif « colis_perdu ».
BEGIN;
ALTER TABLE customer_returns DROP CONSTRAINT IF EXISTS customer_returns_reason_check;
ALTER TABLE customer_returns ADD CONSTRAINT customer_returns_reason_check
  CHECK (reason IN ('defaut', 'erreur_expedition', 'retractation', 'non_recupere', 'erreur_adressage'));
COMMIT;
