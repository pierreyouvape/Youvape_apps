-- Retour arrière de add_picking.sql. Les vagues créées sont perdues ; rien
-- n'avait été écrit dans BMS au lot 1.

BEGIN;

DROP TABLE IF EXISTS picking_wave_orders;
DROP TABLE IF EXISTS picking_waves;
DROP SEQUENCE IF EXISTS picking_wave_seq;
DROP TABLE IF EXISTS picking_wave_rules;
DROP TABLE IF EXISTS picking_blocks;
DROP TABLE IF EXISTS picking_bms_lines;
DROP TABLE IF EXISTS picking_bms_orders;
DELETE FROM app_config WHERE config_key IN ('picking_manual_prefix', 'picking_last_sync_at');

COMMIT;
