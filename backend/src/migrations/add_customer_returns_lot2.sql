-- Retours client, lots 2 à 4 (validés avec Pierre le 09/10/2026) :
--   - lot 2 : commande de renvoi WooCommerce, points WPLoyalty, remboursement rapproché ;
--   - lot 3 : étiquette retour Mondial Relay (PDF ou QR code) ;
--   - lot 4 : avoirs fournisseurs liés aux renvois.
--
-- Idempotente : relançable sans dégât. Suppose add_customer_returns.sql appliquée.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
--   1. pg_dump de sauvegarde
--   2. git pull                                        (sur le VPS)
--   3. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_customer_returns_lot2.sql
--   4. docker compose up --build -d backend frontend
--
-- Retour arrière : backend/src/migrations/rollback_customer_returns_lot2.sql

BEGIN;

ALTER TABLE customer_returns
  -- 0 = création WooCommerce en cours (verrou contre le double clic).
  ADD COLUMN IF NOT EXISTS replacement_order_id BIGINT,
  ADD COLUMN IF NOT EXISTS loyalty_points       INTEGER,
  ADD COLUMN IF NOT EXISTS loyalty_credited_at  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS refund_wp_id         INTEGER,
  ADD COLUMN IF NOT EXISTS refund_amount        NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS label_tracking       VARCHAR(40),
  ADD COLUMN IF NOT EXISTS label_format         VARCHAR(5) CHECK (label_format IN ('pdf', 'qr')),
  ADD COLUMN IF NOT EXISTS label_mime           VARCHAR(60),
  ADD COLUMN IF NOT EXISTS label_data           TEXT,
  ADD COLUMN IF NOT EXISTS label_created_at     TIMESTAMP,
  ADD COLUMN IF NOT EXISTS label_created_by     INTEGER REFERENCES users(id);

-- Un remboursement WooCommerce ne se rattache qu'à un seul retour.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_returns_refund
  ON customer_returns (refund_wp_id) WHERE refund_wp_id IS NOT NULL;

-- Avoirs fournisseur (app Factures) qui règlent un renvoi. Un avoir ne règle
-- qu'un renvoi ; un renvoi peut en recevoir plusieurs.
CREATE TABLE IF NOT EXISTS supplier_return_batch_credits (
  batch_id     INTEGER NOT NULL REFERENCES supplier_return_batches(id) ON DELETE CASCADE,
  document_id  INTEGER NOT NULL UNIQUE REFERENCES supplier_documents(id) ON DELETE CASCADE,
  linked_by    INTEGER REFERENCES users(id),
  linked_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (batch_id, document_id)
);

COMMIT;
