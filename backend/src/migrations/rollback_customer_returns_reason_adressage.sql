-- Retour arrière de add_customer_returns_reason_adressage.sql.
-- ⚠️ Échoue si des retours portent déjà le motif « erreur_adressage ».
BEGIN;
ALTER TABLE customer_returns DROP CONSTRAINT IF EXISTS customer_returns_reason_check;
ALTER TABLE customer_returns ADD CONSTRAINT customer_returns_reason_check
  CHECK (reason IN ('defaut', 'erreur_expedition', 'retractation', 'non_recupere'));
COMMIT;
