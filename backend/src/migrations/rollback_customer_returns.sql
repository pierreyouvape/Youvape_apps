-- Retour arrière de add_customer_returns.sql (efface tous les retours).
-- Les mouvements de stock déjà passés dans BMS restent : ils ne se défont que dans BMS.
BEGIN;
DROP TABLE IF EXISTS supplier_return_items;
DROP TABLE IF EXISTS supplier_return_batches;
DROP TABLE IF EXISTS customer_return_lines;
DROP TABLE IF EXISTS customer_returns;
COMMIT;
