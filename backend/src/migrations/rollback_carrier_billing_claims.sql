-- Retour arrière de add_carrier_billing_claims.sql. Les demandes enregistrées sont perdues.
BEGIN;
DROP TABLE IF EXISTS carrier_billing_claim_lines;
DROP TABLE IF EXISTS carrier_billing_claims;
ALTER TABLE carrier_claims DROP COLUMN IF EXISTS indemnity_credit_number;
ALTER TABLE carrier_credit_documents DROP COLUMN IF EXISTS is_indemnity;
ALTER TABLE carrier_invoice_credits
  DROP COLUMN IF EXISTS base_ht,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS has_weight;
COMMIT;
