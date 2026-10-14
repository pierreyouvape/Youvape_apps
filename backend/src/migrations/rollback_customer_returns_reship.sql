-- Retour arrière de add_customer_returns_reship.sql.
-- ⚠️ Échoue si des retours portent déjà l'issue « reexpedition » : les repasser
-- d'abord en « aucune ». L'étiquette reste dans shipment_labels.
BEGIN;
ALTER TABLE customer_returns DROP COLUMN IF EXISTS reship_label_id;
ALTER TABLE customer_returns DROP CONSTRAINT IF EXISTS customer_returns_outcome_check;
ALTER TABLE customer_returns ADD CONSTRAINT customer_returns_outcome_check
  CHECK (outcome IN ('renvoi', 'points', 'remboursement', 'aucune'));
COMMIT;
