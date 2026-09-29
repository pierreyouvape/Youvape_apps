-- Retour arrière de add_packing_scans.sql : on perd seulement la trace des scans au Packing.

BEGIN;

DROP TABLE IF EXISTS packing_scans;

COMMIT;
