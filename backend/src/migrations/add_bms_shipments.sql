-- STATS / HISTORIQUE D'EXPÉDITION — colis emballés dans BMS.
--
-- Tant que la préparation se fait en partie dans BMS, l'app ne voit que ses
-- propres étiquettes (shipment_labels). BMS signe chacune de ses expéditions du
-- nom de la personne qui l'a emballée (`packer`, rempli depuis au moins
-- août 2026) ; les expéditions que l'app y confirme par API arrivent SANS nom.
-- On ne recopie donc que les expéditions signées : aucun colis compté deux fois.
--
-- Lecture seule côté BMS : services/bmsShipmentSyncService.js (cron 5 min,
-- 9h-19h en semaine) et scripts/backfillBmsShipments.js pour l'historique.
--
-- bms_packer_map relie le nom BMS au compte de l'app (« Celine Pialat » dans
-- BMS, « Celyne » dans l'app) : correspondance validée par Pierre le 29/09/2026.
--
-- Idempotente : relançable sans dégât.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
--   1. pg_dump de sauvegarde
--   2. git pull                                        (sur le VPS)
--   3. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_bms_shipments.sql
--   4. docker compose up --build -d backend frontend
--   5. docker exec -w /app youvape_backend node src/scripts/backfillBmsShipments.js
--
-- Retour arrière : rollback_bms_shipments.sql

BEGIN;

CREATE TABLE IF NOT EXISTS bms_shipments (
  bms_id             INTEGER PRIMARY KEY,
  order_number       VARCHAR(20)  NOT NULL,
  packer_name        VARCHAR(120) NOT NULL,
  created_at         TIMESTAMP    NOT NULL,
  method_code        VARCHAR(120),
  method_description VARCHAR(255),
  carrier_code       VARCHAR(50),
  account_code       VARCHAR(50),
  tracking_number    VARCHAR(64),
  items_qty          INTEGER,
  synced_at          TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bms_shipments_created_at ON bms_shipments (created_at);
CREATE INDEX IF NOT EXISTS idx_bms_shipments_order ON bms_shipments (order_number);
CREATE INDEX IF NOT EXISTS idx_bms_shipments_packer ON bms_shipments (packer_name, created_at);

COMMENT ON TABLE bms_shipments IS
  'Expéditions emballées dans BMS (champ packer renseigné). created_at en UTC, comme shipment_labels.';
COMMENT ON COLUMN bms_shipments.carrier_code IS
  'Transporteur de l''app déduit du mode BMS (bmsShipmentSyncService.bmsCarrier) ; NULL si inconnu.';

CREATE TABLE IF NOT EXISTS bms_packer_map (
  packer_name VARCHAR(120) PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE bms_packer_map IS
  'Nom du préparateur dans BMS → compte de l''app. Sans ligne, le nom BMS s''affiche tel quel.';

INSERT INTO bms_packer_map (packer_name, user_id) VALUES
  ('Celine Pialat', 8),
  ('Franck Demougeot', 6),
  ('Elena Coglitore', 9),
  ('Pierre Merle', 1)
ON CONFLICT (packer_name) DO NOTHING;

COMMIT;
