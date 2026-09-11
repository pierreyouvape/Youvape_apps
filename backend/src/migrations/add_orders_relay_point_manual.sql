-- Point relais saisi à la main dans la fiche commande (lot 2 du chantier expédition).
--
-- Une commande créée au back-office WooCommerce n'a pas de point relais : la
-- méta des plugins ne s'édite pas depuis l'administration (commande Bpost
-- 1259888, `created_via: admin`). Le packing refuse alors d'étiqueter. Le point
-- se saisit désormais dans la fiche commande de l'app.
--
-- Colonne À PART de `relay_point` : la synchro écrit `relay_point =
-- COALESCE(<WooCommerce>, <base>)` et remettrait la valeur WooCommerce sur une
-- correction au premier changement de statut. Celle-ci, la synchro l'ignore.
-- Le packing lit COALESCE(relay_point_manual, relay_point).
--
-- Idempotente. Colonne nullable sans défaut : ajout instantané, aucune
-- réécriture de la table `orders`, que la synchro écrit en continu.
--
-- Même procédure que add_cn23_to_shipment_labels.sql, et dans la même fenêtre :
-- migration AVANT le rebuild, puis contrôle go / no-go (checkShipmentSchema.js).
-- Le packing lit la colonne sans la nommer : il continue de tourner si cette
-- migration tarde ; seule la saisie depuis la fiche commande échoue.

BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS relay_point_manual JSONB;

COMMENT ON COLUMN orders.relay_point_manual IS
  'Point relais saisi à la main dans la fiche commande (commandes créées au back-office). '
  'Même forme que relay_point, plus entered_by / entered_at. Prioritaire sur relay_point '
  'pour l''étiquetage ; jamais écrit par la synchro WooCommerce.';

COMMIT;
