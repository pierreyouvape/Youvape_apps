-- Migration : déplacer product_suppliers des variations vers les parents
-- Les fournisseurs sont désormais gérés au niveau parent, pas variation
--
-- Logique :
-- 1. Pour chaque variation dans product_suppliers, trouver son parent
-- 2. Insérer (ou mettre à jour) la ligne pour le parent
-- 3. Supprimer les lignes des variations
--
-- ON CONFLICT : si le parent a déjà ce fournisseur, on garde le prix le plus récent (updated_at)

BEGIN;

-- Étape 1 : Insérer les associations variation→parent qui n'existent pas encore pour le parent
-- On prend les données de la variation la plus récemment mise à jour pour chaque (parent, supplier)
INSERT INTO product_suppliers (product_id, supplier_id, is_primary, supplier_sku, supplier_price, min_order_qty, pack_qty, created_at, updated_at)
SELECT DISTINCT ON (parent.id, ps.supplier_id)
  parent.id as product_id,
  ps.supplier_id,
  ps.is_primary,
  ps.supplier_sku,
  ps.supplier_price,
  ps.min_order_qty,
  COALESCE(ps.pack_qty, 1) as pack_qty,
  ps.created_at,
  ps.updated_at
FROM product_suppliers ps
JOIN products v ON ps.product_id = v.id
JOIN products parent ON v.wp_parent_id = parent.wp_product_id AND parent.product_type = 'variable'
WHERE v.product_type = 'variation'
ORDER BY parent.id, ps.supplier_id, ps.updated_at DESC
ON CONFLICT (product_id, supplier_id) DO UPDATE SET
  supplier_price = COALESCE(EXCLUDED.supplier_price, product_suppliers.supplier_price),
  supplier_sku = COALESCE(EXCLUDED.supplier_sku, product_suppliers.supplier_sku),
  pack_qty = COALESCE(EXCLUDED.pack_qty, product_suppliers.pack_qty),
  updated_at = GREATEST(EXCLUDED.updated_at, product_suppliers.updated_at);

-- Étape 2 : Supprimer les lignes des variations (elles sont maintenant sur le parent)
DELETE FROM product_suppliers
WHERE product_id IN (
  SELECT ps.product_id
  FROM product_suppliers ps
  JOIN products p ON ps.product_id = p.id
  WHERE p.product_type = 'variation'
);

COMMIT;
