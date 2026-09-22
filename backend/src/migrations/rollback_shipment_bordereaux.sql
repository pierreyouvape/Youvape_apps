-- Retour arrière de add_shipment_bordereaux.sql.
--
-- À passer AVANT de revenir à une version du backend qui ignore les bordereaux.
-- Les bordereaux déjà émis existent toujours chez Colissimo (le chauffeur a le
-- papier) : seule leur trace locale — et donc la réimpression — disparaît.

BEGIN;

DROP INDEX IF EXISTS idx_shipment_labels_a_deposer;
DROP INDEX IF EXISTS idx_shipment_labels_bordereau;

ALTER TABLE shipment_labels DROP COLUMN IF EXISTS bordereau_id;

DROP INDEX IF EXISTS idx_shipment_bordereaux_created_at;
DROP TABLE IF EXISTS shipment_bordereaux;

COMMIT;
