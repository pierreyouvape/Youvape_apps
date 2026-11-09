-- Réclamations de facturation Chronopost : ce qu'on a demandé, ligne par ligne, pour le
-- comparer aux avoirs et factures rectificatives reçus ensuite.
-- Une demande par facture, rattachée par son n° : elle survit à un réimport de la facture.
--
-- Avoirs : chaque ligne garde son montant brut, son type et la présence d'un poids
-- (amount_ht inclut les charges, il ne se compare pas au montant réclamé).
-- Avoirs enregistrés avant cette migration : ces colonnes restent vides.
--
-- Indemnisation : avoir « INDEMNISATION DES FRAIS DE TRANSPORT », relié à la réclamation
-- du colis (carrier_claims). Les avoirs sans TVA en base sont tous de ce type (3 PDF lus
-- le 09/11/2026).
--
-- Retour arrière : rollback_carrier_billing_claims.sql
BEGIN;

ALTER TABLE carrier_invoice_credits
  ADD COLUMN IF NOT EXISTS base_ht NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS has_weight BOOLEAN;

ALTER TABLE carrier_credit_documents
  ADD COLUMN IF NOT EXISTS is_indemnity BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE carrier_credit_documents
   SET is_indemnity = TRUE
 WHERE carrier = 'chronopost' AND total_ht IS NOT NULL AND total_ht <> 0 AND total_ht = total_ttc;

ALTER TABLE carrier_claims
  ADD COLUMN IF NOT EXISTS indemnity_credit_number VARCHAR(50);

CREATE TABLE IF NOT EXISTS carrier_billing_claims (
  id             SERIAL PRIMARY KEY,
  carrier        VARCHAR(50) NOT NULL,
  invoice_number VARCHAR(50) NOT NULL,
  sent_on        DATE NOT NULL,
  created_by     INTEGER REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (carrier, invoice_number)
);

CREATE TABLE IF NOT EXISTS carrier_billing_claim_lines (
  id              SERIAL PRIMARY KEY,
  claim_id        INTEGER NOT NULL REFERENCES carrier_billing_claims(id) ON DELETE CASCADE,
  kind            VARCHAR(12) NOT NULL CHECK (kind IN ('supplement', 'weight')),
  tracking        VARCHAR(64) NOT NULL,
  order_id        INTEGER,
  description     TEXT,
  claimed_ht      NUMERIC(10,2),  -- NULL : écart de poids au tarif non calculable
  billed_ht       NUMERIC(10,2),
  due_ht          NUMERIC(10,2),
  weight_declared NUMERIC(10,3),
  weight_billed   NUMERIC(10,3)
);
CREATE INDEX IF NOT EXISTS idx_billing_claim_lines_claim ON carrier_billing_claim_lines(claim_id);

COMMIT;
