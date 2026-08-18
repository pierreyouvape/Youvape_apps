-- ============================================================================
-- Boutiques Nextore — Fournisseurs (pour filtre par fournisseur dans Besoins)
-- ============================================================================
-- Nextore : chaque produit porte jusqu'à 5 fournisseurs (supplier1..5). On
-- stocke le fournisseur principal (supplier1) + la liste de tous ses
-- fournisseurs (pour filtrer « produits du fournisseur X »).
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_nextore_suppliers.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS nextore_suppliers (
  id        TEXT PRIMARY KEY,
  company   TEXT,               -- nom du fournisseur (champ Nextore "company")
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE nextore_products ADD COLUMN IF NOT EXISTS supplier_id  TEXT;      -- principal (supplier1)
ALTER TABLE nextore_products ADD COLUMN IF NOT EXISTS supplier_ids TEXT[];    -- tous (supplier1..5)

CREATE INDEX IF NOT EXISTS idx_nextore_products_supplier_ids
  ON nextore_products USING GIN (supplier_ids);
