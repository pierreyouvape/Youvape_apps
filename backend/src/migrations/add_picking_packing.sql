-- App PICKING — lot 4 : le packing et la fin des vagues.
--
--   * picking_waves.closed_at — une vague dont toutes les commandes sont
--     expédiées se clôture seule (actualisation toutes les 5 min) ; ses
--     commandes sont libérées.
--   * picking_wave_orders.removed_* — « Mettre de côté » au packing sort la
--     commande de sa vague (pour que la vague puisse se clôturer sans elle).
--   * picking_packing_incidents — le journal des « Envoyer incomplète » et
--     « Mettre de côté » : qui, quoi, quels manquants, quel ticket SAV. Il
--     garantit aussi qu'un double clic n'envoie pas deux mails ni deux tickets.
--
-- Idempotente : relançable sans dégât.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
--   1. pg_dump de sauvegarde
--   2. git pull                                        (sur le VPS)
--   3. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_picking_packing.sql
--   4. docker compose up --build -d backend frontend
--
-- Retour arrière : rollback_picking_packing.sql

BEGIN;

ALTER TABLE picking_waves
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP;

COMMENT ON COLUMN picking_waves.closed_at IS
  'Clôture automatique : toutes les commandes de la vague sont expédiées (étiquette du packing, ou plus rien à expédier chez BMS).';

ALTER TABLE picking_wave_orders
  ADD COLUMN IF NOT EXISTS removed_at     TIMESTAMP,
  ADD COLUMN IF NOT EXISTS removed_by     INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS removed_reason TEXT;

COMMENT ON COLUMN picking_wave_orders.removed_at IS
  'Commande sortie de sa vague (« Mettre de côté » au packing). La ligne reste pour l''historique, inactive.';

CREATE TABLE IF NOT EXISTS picking_packing_incidents (
  id            SERIAL PRIMARY KEY,
  order_number  VARCHAR(20)  NOT NULL,
  wave_id       INTEGER      REFERENCES picking_waves(id) ON DELETE SET NULL,
  action        VARCHAR(20)  NOT NULL CHECK (action IN ('incomplete', 'set_aside')),
  missing       JSONB        NOT NULL,
  tracking_number VARCHAR(64),
  ticket_id     INTEGER,
  mail_sent     BOOLEAN      NOT NULL DEFAULT false,
  mail_error    TEXT,
  created_by    INTEGER      REFERENCES users(id),
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  UNIQUE (order_number, wave_id, action)
);

COMMENT ON TABLE picking_packing_incidents IS
  'Commandes envoyées incomplètes ou mises de côté au packing, faute d''articles (manquants du picking). Une ligne par commande, vague et action : un second clic ne renvoie ni mail ni ticket.';
COMMENT ON COLUMN picking_packing_incidents.missing IS
  'Articles manquants de la commande : [{sku, name, qty}].';

COMMIT;
