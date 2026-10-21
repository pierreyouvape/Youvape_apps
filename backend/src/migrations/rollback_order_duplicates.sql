-- Retour arrière de add_order_duplicates.sql. Les tickets SAV déjà ouverts restent.
BEGIN;
DROP TABLE IF EXISTS order_duplicates;
COMMIT;
