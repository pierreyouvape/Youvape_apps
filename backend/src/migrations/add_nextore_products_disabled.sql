-- ============================================================================
-- Boutiques Nextore — produits désactivés (onglet « Produits »)
-- ============================================================================
-- Le catalogue Nextore garde tous les anciens produits. Un produit désactivé
-- chez nous sort de la liste, du comptage et des besoins des DEUX boutiques.
-- Rien n'est écrit dans Nextore : la synchro ne touche pas ces colonnes.
-- Une vente ou une réception postérieure à la désactivation le réactive.
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_nextore_products_disabled.sql
-- ============================================================================

ALTER TABLE nextore_products ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;
ALTER TABLE nextore_products ADD COLUMN IF NOT EXISTS disabled_by TEXT;
