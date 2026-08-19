-- ─────────────────────────────────────────────────────────────────────────────
-- Frais fixes par colis dans le calcul de coût transport.
--
-- La grille `shipping_tariff_rates` ne porte que le PORT du contrat. Chaque
-- transporteur facture en plus des charges que le modèle ignorait totalement,
-- et qui ne se réduisent pas à un pourcentage :
--
--   Chronopost  redevance sûreté 0,70 €/colis  → ENTRE dans la base carburant
--               éco-participation 0,09 €/colis → APRÈS le carburant
--               frais de gestion ~30 €/facture → APRÈS, amorti par colis
--   Colissimo   CAE (surcharge carburant La Poste, 11–14 %) : ABSENT de la
--               grille contrat, à porter par `fuel_surcharge`. Attention : il
--               est en revanche DÉJÀ inclus dans `carrier_invoice_parcels.
--               amount_ht` — ne jamais le rajouter quand on part de la facture.
--   Mondial     forfait de collecte 299 €/mois → amorti par colis
--   La Poste    abonnement collecte annuel     → amorti par colis
--
-- D'où deux champs et non un : la sûreté Chronopost est soumise au carburant,
-- l'éco-participation ne l'est pas. Formule appliquée par computeOrderCost() :
--
--   coût = (port × (1 − remise) + fee_in_fuel_base) × (1 + carburant)
--                                + fee_after_fuel
--
-- Les deux champs valent 0 par défaut : sans paramétrage, le comportement est
-- strictement identique à l'existant.
--
-- Référence : formule `computeTarif()` de frontend/src/pages/ChronopostApp.jsx,
-- validée au centime contre le total HT de 8 factures Chronopost (19/08/2026).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE shipping_tariff_zones
  ADD COLUMN IF NOT EXISTS fee_in_fuel_base NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_after_fuel   NUMERIC(10,4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN shipping_tariff_zones.fee_in_fuel_base IS
  'Frais fixes par colis ajoutés AVANT la surcharge carburant (ex. redevance sûreté Chronopost 0,70 €)';
COMMENT ON COLUMN shipping_tariff_zones.fee_after_fuel IS
  'Frais fixes par colis ajoutés APRÈS la surcharge carburant (éco-participation, frais de gestion et forfaits périodiques amortis)';
