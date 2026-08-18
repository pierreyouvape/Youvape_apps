-- ============================================================================
-- Boutiques Nextore — Réfs/prix par fournisseur (colonne "Réf. fournisseur")
-- ============================================================================
-- Chaque produit Nextore a jusqu'à 5 fournisseurs, chacun avec sa réf et son
-- prix. On stocke la map { "<supplier_id>": { "ref": "...", "price": 8.7 } }
-- pour afficher la bonne réf selon le fournisseur filtré (option B).
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_nextore_supplier_refs.sql
-- ============================================================================

ALTER TABLE nextore_products ADD COLUMN IF NOT EXISTS supplier_refs JSONB;
