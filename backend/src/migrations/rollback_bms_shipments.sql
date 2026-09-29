-- Retour arrière de add_bms_shipments.sql : on perd la copie des expéditions BMS
-- (reconstructible par scripts/backfillBmsShipments.js) et la correspondance des noms.

BEGIN;

DROP TABLE IF EXISTS bms_packer_map;
DROP TABLE IF EXISTS bms_shipments;

COMMIT;
