-- Retour arrière de add_shipment_tracking.sql : supprime le journal, la
-- correspondance et les colonnes de suivi. Le journal est perdu (il se
-- reconstruit en réinterrogeant les transporteurs, sur 45 jours seulement).

BEGIN;

DROP TABLE IF EXISTS shipment_tracking_events;
DROP TABLE IF EXISTS tracking_status_map;

DROP INDEX IF EXISTS idx_shipment_labels_tracking_state;
DROP INDEX IF EXISTS idx_shipment_labels_tracking_due;

ALTER TABLE shipment_labels
  DROP COLUMN IF EXISTS tracking_state,
  DROP COLUMN IF EXISTS tracking_state_at,
  DROP COLUMN IF EXISTS tracking_last_event_at,
  DROP COLUMN IF EXISTS tracking_last_label,
  DROP COLUMN IF EXISTS tracking_delivered_at,
  DROP COLUMN IF EXISTS tracking_checked_at,
  DROP COLUMN IF EXISTS tracking_next_check_at,
  DROP COLUMN IF EXISTS tracking_error;

COMMIT;
