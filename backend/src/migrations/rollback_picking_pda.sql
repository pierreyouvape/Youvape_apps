-- Retour arrière de add_picking_pda.sql : l'avancement des pickings est perdu.

BEGIN;

DROP TABLE IF EXISTS picking_wave_lines;
DROP INDEX IF EXISTS idx_picking_waves_assigned;
ALTER TABLE picking_waves
  DROP COLUMN IF EXISTS assigned_to,
  DROP COLUMN IF EXISTS assigned_at,
  DROP COLUMN IF EXISTS picked_by,
  DROP COLUMN IF EXISTS picked_at;

COMMIT;
