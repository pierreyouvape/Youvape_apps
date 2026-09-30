-- La « Réf Fournisseur » de BMS, que nous ne reprenions pas.
--
-- BMS porte DEUX références sur un bon de commande, et nous n'en stockions
-- qu'une :
--   • `reference`          → notre `bms_reference` (« 356359 », « Test Maxime 7 »)
--   • `supplier_reference` → celle-ci, jusqu'ici perdue
--
-- La seconde est un champ libre, et c'est ce qui en fait sa valeur : les
-- acheteurs y écrivent ce que le numéro ne dit pas — « Précommande JNr 50ml »,
-- « Précommande Box & Kit Aegis So ». Sans elle, la liste des réceptions n'offre
-- qu'une suite de numéros, et rien ne distingue une précommande attendue depuis
-- six semaines d'un réassort de la veille.
--
-- Renseignée à la synchro BMS (purchaseOrderModel.syncFromBMS). Les commandes
-- déjà en base restent à NULL tant que BMS ne les remet pas à jour : c'est
-- l'objet de scripts/backfillSupplierReference.js.

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS bms_supplier_reference VARCHAR(255);
