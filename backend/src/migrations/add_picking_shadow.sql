-- Sortie de BMS, lot 1 : la règle « à expédier » en SIMULATION (24/11/2026).
--
-- À chaque photo BMS du Picking, toShipShadowService calcule NOTRE liste des
-- commandes à expédier (toShipRules) et la compare à la photo. Rien ne change
-- pour l'équipe, rien n'est écrit sur le site ni chez BMS.
--
--   picking_shadow_diffs  : un écart (commande chez nous seulement, chez BMS
--                           seulement, articles différents), vu d'une photo à
--                           l'autre. Il ne compte que s'il dure (2 photos ET
--                           30 min) ; résolu quand il disparaît ; signalé une
--                           seule fois par mail (mailed_at).
--   picking_shadow_checks : commandes « à vérifier » (encore à expédier 3 jours
--                           après le paiement) déjà signalées par mail : une
--                           fois chacune.
--
-- Le service reste ÉTEINT tant que app_config.picking_shadow_since (AAAA-MM-JJ)
-- n'existe pas. Les commandes payées avant cette date ne sont ni comparées ni
-- signalées.
--
-- Idempotente : relançable sans dégât.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
--   1. git pull                                        (sur le VPS)
--   2. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_picking_shadow.sql
--   3. docker compose up --build -d backend
--
-- Retour arrière :
--   DROP TABLE picking_shadow_diffs; DROP TABLE picking_shadow_checks;
--   DELETE FROM app_config WHERE config_key LIKE 'picking_shadow_%';

CREATE TABLE IF NOT EXISTS picking_shadow_diffs (
  id            SERIAL PRIMARY KEY,
  order_number  TEXT        NOT NULL,
  kind          TEXT        NOT NULL CHECK (kind IN ('ours_only', 'bms_only', 'lines')),
  signature     TEXT        NOT NULL,
  lines         JSONB       NOT NULL DEFAULT '[]',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  photos_seen   INTEGER     NOT NULL DEFAULT 1,
  resolved_at   TIMESTAMPTZ,
  mailed_at     TIMESTAMPTZ
);

-- Un seul écart OUVERT par commande et par contenu.
CREATE UNIQUE INDEX IF NOT EXISTS uq_picking_shadow_diffs_open
  ON picking_shadow_diffs (order_number, signature) WHERE resolved_at IS NULL;

-- Le mail du jour : les écarts qui durent, pas encore signalés.
CREATE INDEX IF NOT EXISTS idx_picking_shadow_diffs_unmailed
  ON picking_shadow_diffs (first_seen_at) WHERE mailed_at IS NULL AND photos_seen >= 2;

CREATE TABLE IF NOT EXISTS picking_shadow_checks (
  order_number TEXT PRIMARY KEY,
  paid_at      TIMESTAMP,
  mailed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
