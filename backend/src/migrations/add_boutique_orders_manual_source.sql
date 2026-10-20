-- ============================================================================
-- Boutiques — commande fournisseur saisie à la main (20/10/2026)
-- ============================================================================
-- Troisième origine d'une commande boutique, après Besoins et Import commande :
-- l'écran Commandes sait en créer une, produit par produit.
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_boutique_orders_manual_source.sql
-- ============================================================================

ALTER TABLE boutique_orders DROP CONSTRAINT IF EXISTS boutique_orders_source_check;
ALTER TABLE boutique_orders ADD CONSTRAINT boutique_orders_source_check
  CHECK (source IN ('besoins', 'import', 'manuelle'));
