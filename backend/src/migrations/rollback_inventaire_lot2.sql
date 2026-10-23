-- Retour arrière de add_inventaire_lot2.sql.
-- ⚠️ L'index « un seul ouvert » ne se recrée que s'il n'y a plus qu'un inventaire ouvert.
BEGIN;
DROP INDEX IF EXISTS idx_inventory_items_push_queued;
DROP INDEX IF EXISTS idx_inventory_items_product;
ALTER TABLE inventory_items
  DROP COLUMN IF EXISTS decision,
  DROP COLUMN IF EXISTS decided_by,
  DROP COLUMN IF EXISTS decided_at,
  DROP COLUMN IF EXISTS push_status,
  DROP COLUMN IF EXISTS push_qty,
  DROP COLUMN IF EXISTS push_at,
  DROP COLUMN IF EXISTS push_error,
  DROP COLUMN IF EXISTS bms_movement_id,
  DROP COLUMN IF EXISTS location_fixed_to,
  DROP COLUMN IF EXISTS location_fixed_at;
ALTER TABLE inventories DROP COLUMN IF EXISTS closed_by;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventories_one_open ON inventories ((true)) WHERE status = 'open';
COMMIT;
