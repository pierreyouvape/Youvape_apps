-- ============================================================================
-- Boutiques — PDA › Produit : motifs « Pour site » et « DLUO » (26/11/2026)
-- ============================================================================
-- Deux motifs de sortie en plus d'Ajustement et Défectueux. La contrainte de la
-- colonne `reason` est remplacée par une liste élargie ; aucune ligne n'est
-- modifiée (les motifs existants restent valides).
--
-- À appliquer AVANT le code :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_boutique_stock_moves_reasons.sql
-- ============================================================================

BEGIN;
ALTER TABLE boutique_stock_moves DROP CONSTRAINT IF EXISTS boutique_stock_moves_reason_check;
ALTER TABLE boutique_stock_moves ADD CONSTRAINT boutique_stock_moves_reason_check
  CHECK (reason IN ('ajustement', 'defectueux', 'pour_site', 'dluo'));
COMMIT;
