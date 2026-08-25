-- ============================================================================
-- Boutiques Nextore — Marque (cf1) + agent validant (comptage liste manuelle)
-- ============================================================================
-- Nextore stocke la marque/gamme dans le champ custom cf1 (WINK, Geekvape…).
-- On l'expose comme `brand` pour la recherche produit (comptage « liste »).
-- `validated_by` = l'agent qui valide/compte (distinct du créateur de la liste).
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_nextore_brand_validated.sql
-- ============================================================================

ALTER TABLE nextore_products ADD COLUMN IF NOT EXISTS brand TEXT; -- cf1 (marque/gamme)
CREATE INDEX IF NOT EXISTS idx_nextore_products_brand ON nextore_products(brand);

ALTER TABLE nextore_comptages ADD COLUMN IF NOT EXISTS validated_by TEXT;
