-- Snapshots de la valeur de stock (achat HT) — un enregistrement par jour.
-- Écrit chaque jour par le cron (method = 'snapshot', exact au moment de la mesure).
-- Les points passés sans snapshot sont reconstruits à la volée (method = 'reconstructed').
CREATE TABLE IF NOT EXISTS stock_valuation_snapshots (
  id                        SERIAL PRIMARY KEY,
  snapshot_date             DATE NOT NULL UNIQUE,
  total_value_ht            NUMERIC(14,2) NOT NULL,
  value_with_po_history     NUMERIC(14,2) NOT NULL DEFAULT 0,
  value_without_po_history  NUMERIC(14,2) NOT NULL DEFAULT 0,
  products_count            INTEGER NOT NULL DEFAULT 0,
  total_units               BIGINT  NOT NULL DEFAULT 0,
  method                    VARCHAR(20) NOT NULL DEFAULT 'snapshot',
  created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stock_valuation_snapshots_date
  ON stock_valuation_snapshots (snapshot_date);
