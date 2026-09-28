-- Retour arrière de add_picking_packing.sql. Les tickets SAV créés restent.

BEGIN;

DROP TABLE IF EXISTS picking_packing_incidents;
ALTER TABLE picking_wave_orders
  DROP COLUMN IF EXISTS removed_at,
  DROP COLUMN IF EXISTS removed_by,
  DROP COLUMN IF EXISTS removed_reason;
ALTER TABLE picking_waves DROP COLUMN IF EXISTS closed_at;

COMMIT;
