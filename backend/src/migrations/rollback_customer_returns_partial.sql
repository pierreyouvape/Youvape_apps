-- Retour arrière de add_customer_returns_partial.sql (efface les consignes).
BEGIN;
ALTER TABLE customer_return_lines
  DROP COLUMN IF EXISTS partial,
  DROP COLUMN IF EXISTS partial_note;
COMMIT;
