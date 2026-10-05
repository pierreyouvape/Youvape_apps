-- App PDA « Produit » (/pda/produit) : journal des gestes faits au PDA.
--
-- BMS n'enregistre pas qui, chez nous, a changé un emplacement ou passé un
-- mouvement de stock (tout part sous le compte API) : ce journal le dit.
-- Une ligne par geste — emplacement, mouvement, code-barres ajouté / modifié /
-- retiré.
--
-- Idempotente : relançable sans dégât.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
-- La migration passe AVANT le rebuild : le code en service ne lit pas la table.
--
--   1. pg_dump de sauvegarde
--   2. git pull                                        (sur le VPS)
--   3. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_pda_product_log.sql
--   4. docker compose up --build -d backend frontend
--
-- Retour arrière : DROP TABLE pda_product_log;

BEGIN;

CREATE TABLE IF NOT EXISTS pda_product_log (
  id              SERIAL PRIMARY KEY,
  product_id      INTEGER REFERENCES products(id) ON DELETE SET NULL,
  sku             VARCHAR(100),
  user_id         INTEGER REFERENCES users(id),
  action          VARCHAR(20) NOT NULL
                  CHECK (action IN ('location', 'movement', 'barcode_add', 'barcode_edit', 'barcode_delete')),
  old_value       TEXT,
  new_value       TEXT,
  reason          VARCHAR(30),
  qty             INTEGER,
  comment         TEXT,
  bms_movement_id INTEGER,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pda_product_log_product ON pda_product_log (product_id, created_at DESC);

COMMENT ON TABLE pda_product_log IS
  'Gestes faits depuis l''app PDA Produit : emplacement, mouvement de stock BMS, codes-barres.';
COMMENT ON COLUMN pda_product_log.qty IS
  'Mouvement de stock : quantité signée (+ entrée, − sortie).';
COMMENT ON COLUMN pda_product_log.reason IS
  'Mouvement de stock : vente_boutique | ajustement | defectueux.';

COMMIT;
