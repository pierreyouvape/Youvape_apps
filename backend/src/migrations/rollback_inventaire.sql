-- Retour arrière de add_inventaire.sql (efface tous les inventaires).
BEGIN;
DROP TABLE IF EXISTS inventory_events;
DROP TABLE IF EXISTS inventory_counts;
DROP TABLE IF EXISTS inventory_items;
DROP TABLE IF EXISTS inventory_locations;
DROP TABLE IF EXISTS inventories;
COMMIT;
