-- ============================================================================
-- Boutiques Nextore — Import de commandes fournisseur (parseurs du site)
-- ============================================================================
-- 1. nextore_suppliers.site_supplier_id : fournisseur du site correspondant,
--    qui donne le parseur (suppliers.code) et les réfs du site à proposer.
-- 2. nextore_supplier_refs : réf fournisseur → produit Nextore, mappée au fil
--    des imports. Comme supplier_refs : une réf d'un fournisseur ne désigne
--    qu'UN produit (index unique sur la réf normalisée, même normalisation).
--    pack_qty = nombre de pièces dans UN article de la réf.
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_nextore_import_refs.sql
-- ============================================================================

ALTER TABLE nextore_suppliers
  ADD COLUMN IF NOT EXISTS site_supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS nextore_supplier_refs (
  id           SERIAL PRIMARY KEY,
  supplier_id  TEXT NOT NULL REFERENCES nextore_suppliers(id) ON DELETE CASCADE,
  supplier_sku TEXT NOT NULL,
  product_id   TEXT NOT NULL REFERENCES nextore_products(product_id) ON DELETE CASCADE,
  pack_qty     INTEGER NOT NULL DEFAULT 1 CHECK (pack_qty >= 1),
  source       TEXT NOT NULL DEFAULT 'manuel',   -- 'manuel' | 'site' (proposition du site retenue)
  created_by   TEXT,                             -- email
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS nextore_supplier_refs_sku_key
  ON nextore_supplier_refs (supplier_id, lower(regexp_replace(btrim(supplier_sku), '\s+', ' ', 'g')));
CREATE INDEX IF NOT EXISTS idx_nextore_supplier_refs_product
  ON nextore_supplier_refs (product_id);

-- Correspondances relevées le 12/10/2026 (fournisseurs ayant un parseur)
UPDATE nextore_suppliers ns SET site_supplier_id = v.site_id
FROM (VALUES
  ('33333', 1),   -- LCA
  ('33332', 2),   -- Joshnoa
  ('38191', 36),  -- LVP Distribution
  ('33337', 3),   -- GFC FrancoChine
  ('33338', 4),   -- Levest - Roykin
  ('35921', 9),   -- Highbuy
  ('33340', 10),  -- Curieux
  ('33339', 7),   -- Etasty
  ('33335', 5),   -- Revolute - Cosmer
  ('35234', 33),  -- MG Vape
  ('33343', 37),  -- Cloud Vapor
  ('38521', 41)   -- LIPS - French Liquide
) AS v(nx_id, site_id)
WHERE ns.id = v.nx_id;
