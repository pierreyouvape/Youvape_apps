-- ============================================================================
-- Boutiques Nextore — Coffre : fond de monnaie
-- ============================================================================
-- Le fond de monnaie (réserve de pièces et petits billets) est suivi À PART :
-- il n'entre pas dans le solde théorique du coffre, et le comptage du coffre
-- se fait sans lui. Chaque saisie `fond` donne son montant à cet instant
-- (détail des coupures facultatif) ; le fond actuel est la dernière saisie.
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_coffre_fond_monnaie.sql
-- ============================================================================

ALTER TABLE coffre_movements DROP CONSTRAINT IF EXISTS coffre_movements_kind_check;
ALTER TABLE coffre_movements
  ADD CONSTRAINT coffre_movements_kind_check CHECK (kind IN ('comptage', 'remise', 'fond'));
