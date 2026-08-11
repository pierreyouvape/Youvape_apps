-- ─────────────────────────────────────────────────────────────────────────────
-- units_per_qty : nombre d'UNITÉS DE STOCK représentées par 1 qty_ordered.
--
-- Les lignes de commande n'ont pas toutes la même unité de compte :
--   • cas normal  : qty_ordered est déjà en unités individuelles → units_per_qty = 1
--   • fournisseurs « à l'unité » (LCA, Highbuy, Levest, MG Vape) : leur facture
--     et leur PO BMS comptent en PACKS (le SKU = le pack) et unit_price est le
--     prix DU PACK → qty_ordered = nb de packs, units_per_qty = qty_pack
--   • lignes BMS où la désambiguïsation de prix a retenu « prix déjà unitaire » :
--     la qty BMS reste en packs → units_per_qty = qty_pack
--
-- Le montant d'une ligne reste TOUJOURS qty_ordered × unit_price (invariant) ;
-- units_per_qty ne sert qu'aux calculs de STOCK (arrivages, besoins, catalogue),
-- qui doivent compter (qty_ordered - qty_received) × units_per_qty.
--
-- Sans cette colonne, un pack de 10 commandé chez LCA était compté « 1 pièce en
-- arrivage » au lieu de 10 (cf. PO BMS 118531, réf. #REF12575-41110).
--
-- Rattrapage de l'existant : PAS en SQL. product_suppliers.pack_qty est le
-- conditionnement COURANT du catalogue, pas celui de la commande passée — s'en
-- servir gonfle les vieilles lignes déjà exprimées en unités (boosters LCA :
-- 200 unités relues comme 200 packs de 200). Utiliser à la place
-- `node backend/scripts/backfillUnitsPerQty.js --apply`, qui tranche en
-- comparant chaque ligne à la commande BMS d'origine.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS units_per_qty INTEGER NOT NULL DEFAULT 1;
