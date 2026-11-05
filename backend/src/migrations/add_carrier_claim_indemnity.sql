-- Réclamations transporteur : réponse de Chronopost sur l'indemnisation (05/11/2026).
--
-- Un clic « acceptée » ou « refusée » dans /expeditions → Réclamations, sans
-- montant : le montant n'est jamais connu à la réponse, il se rapproche plus
-- tard (décision Pierre). NULL = pas encore de réponse.
--
-- Idempotente. Retour arrière : rollback_carrier_claim_indemnity.sql.

BEGIN;

ALTER TABLE carrier_claims
  ADD COLUMN IF NOT EXISTS indemnity_status VARCHAR(10)
    CHECK (indemnity_status IN ('accepted', 'refused')),
  ADD COLUMN IF NOT EXISTS indemnity_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS indemnity_by INTEGER REFERENCES users(id);

COMMENT ON COLUMN carrier_claims.indemnity_status IS
  'Réponse de Chronopost à la demande de remboursement du port : accepted, refused, ou NULL (en attente). Sans montant : rapproché plus tard.';
COMMENT ON COLUMN carrier_claims.indemnity_at IS
  'Date de la saisie de la réponse (filtre du récapitulatif des indemnisations).';

CREATE INDEX IF NOT EXISTS idx_carrier_claims_indemnity ON carrier_claims(indemnity_status, indemnity_at);

COMMIT;
