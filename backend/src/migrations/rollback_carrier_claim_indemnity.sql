-- Retour arrière de add_carrier_claim_indemnity.sql. Les notes posées dans le SAV restent.
BEGIN;
DROP INDEX IF EXISTS idx_carrier_claims_indemnity;
ALTER TABLE carrier_claims
  DROP COLUMN IF EXISTS indemnity_status,
  DROP COLUMN IF EXISTS indemnity_at,
  DROP COLUMN IF EXISTS indemnity_by;
COMMIT;
