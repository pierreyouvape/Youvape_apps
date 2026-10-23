-- App Inventaire (lot 2) : revue des écarts, envoi à BMS, clôture, plusieurs
-- inventaires ouverts.
--
-- Décisions de Pierre (23/10/2026) :
--   - plusieurs inventaires peuvent être ouverts ; une référence ne peut être
--     que dans UN inventaire ouvert (exclue à la création, avec un message),
--     sinon son écart partirait deux fois dans BMS ;
--   - chaque écart est envoyé à BMS (mouvement d'ajustement de l'écart, jamais
--     une quantité absolue) ou écarté, par un responsable ;
--   - l'inventaire se clôture quand plus rien n'est en attente.
--
-- N'ajoute que des colonnes et retire l'index « un seul ouvert » : aucune
-- donnée existante n'est modifiée. Idempotente.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
--   1. pg_dump de sauvegarde
--   2. git pull                                        (sur le VPS)
--   3. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_inventaire_lot2.sql
--   4. docker compose up --build -d backend frontend
--
-- Retour arrière : backend/src/migrations/rollback_inventaire_lot2.sql

BEGIN;

DROP INDEX IF EXISTS uq_inventories_one_open;

ALTER TABLE inventories
  ADD COLUMN IF NOT EXISTS closed_by INTEGER REFERENCES users(id);

-- decision : 'send' (à envoyer / envoyé) ou 'ignore' (écarté)
-- push_status : queued → sending → sent | error
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS decision          VARCHAR(10) CHECK (decision IN ('send', 'ignore')),
  ADD COLUMN IF NOT EXISTS decided_by        INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS decided_at        TIMESTAMP,
  ADD COLUMN IF NOT EXISTS push_status       VARCHAR(10) CHECK (push_status IN ('queued', 'sending', 'sent', 'error')),
  ADD COLUMN IF NOT EXISTS push_qty          INTEGER,
  ADD COLUMN IF NOT EXISTS push_at           TIMESTAMP,
  ADD COLUMN IF NOT EXISTS push_error        TEXT,
  ADD COLUMN IF NOT EXISTS bms_movement_id   VARCHAR(40),
  ADD COLUMN IF NOT EXISTS location_fixed_to VARCHAR(50),
  ADD COLUMN IF NOT EXISTS location_fixed_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_inventory_items_push_queued ON inventory_items (id) WHERE push_status = 'queued';
CREATE INDEX IF NOT EXISTS idx_inventory_items_product ON inventory_items (product_id);

COMMIT;
