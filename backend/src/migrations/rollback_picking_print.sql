-- Retour arrière de add_picking_print.sql : on perd seulement la trace des impressions.

BEGIN;

ALTER TABLE picking_waves
  DROP COLUMN IF EXISTS first_printed_at,
  DROP COLUMN IF EXISTS printed_at,
  DROP COLUMN IF EXISTS printed_by,
  DROP COLUMN IF EXISTS print_count;

COMMIT;
