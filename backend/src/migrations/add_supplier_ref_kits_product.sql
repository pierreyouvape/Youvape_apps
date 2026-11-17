-- ─────────────────────────────────────────────────────────────────────────────
-- Packs fournisseur : un composant peut être désigné par NOTRE produit (17/11/2026)
--
-- Un pack d'offre contient souvent des articles jamais achetés chez ce
-- fournisseur : leur réf. chez lui est inconnue (JoshNoa V3/2026/38074,
-- « Offre de pré-commande 30ml Frozen Beast »). Le composant se déclare alors
-- par notre SKU, et la ligne garde le produit : dès qu'une vraie réf. de ce
-- fournisseur existe pour lui, le pack la prend (supplierKitModel.listKits).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE supplier_ref_kits
  ADD COLUMN IF NOT EXISTS component_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL;

-- Les composants déjà déclarés le sont par une réf. connue : on note leur produit.
UPDATE supplier_ref_kits k
   SET component_product_id = r.product_id
  FROM supplier_refs r
 WHERE r.supplier_id = k.supplier_id
   AND lower(regexp_replace(btrim(r.supplier_sku), '\s+', ' ', 'g'))
     = lower(regexp_replace(btrim(k.component_ref), '\s+', ' ', 'g'))
   AND k.component_product_id IS NULL;

COMMIT;
