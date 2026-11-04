-- Coût de livraison RÉEL d'une commande, tous transporteurs confondus.
--
-- Avant : « Appliquer les tarifs » d'une facture REMPLAÇAIT orders.shipping_cost_calculated
-- par la ligne de cette facture. Un retour expéditeur facturé le mois suivant écrasait
-- donc le coût de l'aller (1264731 : 6,28 € → 2,48 €), et un retour facturé par un autre
-- transporteur (Colissimo, Mondial Relay) n'était jamais ajouté.
--
-- Maintenant :
--   carrier_invoice_parcels.cost_ht = coût complet de la ligne (transport + suppléments
--     + quote-part des charges de la facture : carburant, sûreté, éco, frais de gestion,
--     décarbonation…), calculé côté serveur quand on applique les tarifs d'une facture ;
--   order_carrier_costs (vue) = Σ cost_ht de TOUTES les lignes de la commande (aller,
--     retours, tous transporteurs) + Σ avoirs de la commande ;
--   orders.shipping_cost_calculated = cette somme, pour les commandes recalculées.
--
-- Rectificatives : la ligne de la rectificative REMPLACE celle de la facture d'origine
-- pour le même n° de suivi, et l'avoir de ce colis est ignoré (il annule la ligne
-- d'origine, déjà écartée). Sans cette règle, les 176 colis refacturés par 40852941
-- (avoirs absents de la base) seraient comptés deux fois.
--
-- Idempotente : relançable sans dégât.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
--   1. git pull                                        (sur le VPS)
--   2. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_order_carrier_costs.sql
--   3. docker compose up --build -d backend frontend
--   4. node src/scripts/recomputeOrderShippingCosts.js           (simulation)
--      node src/scripts/recomputeOrderShippingCosts.js --apply   (cost_ht + commandes)
--
-- Retour arrière :
--   DROP VIEW order_carrier_costs;
--   ALTER TABLE carrier_invoice_parcels DROP COLUMN cost_ht;

ALTER TABLE carrier_invoice_parcels ADD COLUMN IF NOT EXISTS cost_ht NUMERIC(10,4);
CREATE INDEX IF NOT EXISTS idx_carrier_parcels_order ON carrier_invoice_parcels(order_id);
CREATE INDEX IF NOT EXISTS idx_carrier_credits_order ON carrier_invoice_credits(order_id);

CREATE OR REPLACE VIEW order_carrier_costs AS
WITH rect AS (
  SELECT DISTINCT ci.carrier, UPPER(p.tracking) AS tracking
  FROM carrier_invoice_parcels p
  JOIN carrier_invoices ci ON ci.id = p.invoice_id
  WHERE ci.is_rectificative AND p.tracking IS NOT NULL
), lines AS (
  SELECT p.order_id, p.cost_ht AS amount
  FROM carrier_invoice_parcels p
  JOIN carrier_invoices ci ON ci.id = p.invoice_id
  WHERE p.order_id IS NOT NULL AND p.cost_ht IS NOT NULL
    AND (ci.is_rectificative
         OR NOT EXISTS (SELECT 1 FROM rect r WHERE r.carrier = ci.carrier AND r.tracking = UPPER(p.tracking)))
), credits AS (
  SELECT c.order_id, c.amount_ht AS amount
  FROM carrier_invoice_credits c
  WHERE c.order_id IS NOT NULL AND c.amount_ht IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM rect r WHERE r.carrier = c.carrier AND r.tracking = UPPER(c.tracking))
)
-- Un avoir seul ne fait pas un coût : la commande doit avoir au moins une ligne facturée
SELECT order_id, SUM(amount) AS cost, COUNT(*) AS lines
FROM (SELECT * FROM lines UNION ALL SELECT * FROM credits) x
WHERE order_id IN (SELECT order_id FROM lines)
GROUP BY order_id;
