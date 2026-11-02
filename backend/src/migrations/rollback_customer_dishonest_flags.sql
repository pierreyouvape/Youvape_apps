-- Retour arrière de add_customer_dishonest_flags.sql.
-- ⚠️ Efface les signalements et leur historique : faire un pg_dump avant.
-- Les tickets SAV déjà ouverts restent dans le SAV.

BEGIN;

DROP TABLE IF EXISTS dishonest_orders;
DROP TABLE IF EXISTS customer_dishonest_flags;

COMMIT;
