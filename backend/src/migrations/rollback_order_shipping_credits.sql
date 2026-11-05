-- Retour arrière de add_order_shipping_credits.sql
-- ⚠️ Les points déjà crédités restent dans WPLoyalty : seule notre trace disparaît.
BEGIN;
DROP TABLE IF EXISTS order_shipping_credits;
ALTER TABLE customer_returns DROP COLUMN IF EXISTS loyalty_shipping;
COMMIT;
