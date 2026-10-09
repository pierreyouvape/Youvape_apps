-- Retour arrière de add_customer_returns_lot2.sql.
-- Les commandes de renvoi, points crédités et étiquettes émises restent chez
-- WooCommerce, WPLoyalty et Mondial Relay : seule notre trace disparaît.
BEGIN;
DROP TABLE IF EXISTS supplier_return_batch_credits;
DROP INDEX IF EXISTS uq_customer_returns_refund;
ALTER TABLE customer_returns
  DROP COLUMN IF EXISTS replacement_order_id,
  DROP COLUMN IF EXISTS loyalty_points,
  DROP COLUMN IF EXISTS loyalty_credited_at,
  DROP COLUMN IF EXISTS refund_wp_id,
  DROP COLUMN IF EXISTS refund_amount,
  DROP COLUMN IF EXISTS label_tracking,
  DROP COLUMN IF EXISTS label_format,
  DROP COLUMN IF EXISTS label_mime,
  DROP COLUMN IF EXISTS label_data,
  DROP COLUMN IF EXISTS label_created_at,
  DROP COLUMN IF EXISTS label_created_by;
COMMIT;
