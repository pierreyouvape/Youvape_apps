-- ============================================================================
-- Étiquettes de prix : « Revenir à l'ancien prix » (10/11/2026)
-- ============================================================================
-- Un vendeur peut juger qu'un produit était mieux à son ancien prix caisse : on
-- remet l'ancien prix dans Nextore, on fige le prix (plus d'alignement) et
-- l'étiquette sort de la liste (ou une étiquette « retour » est créée si une
-- boutique l'avait déjà refaite).
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_boutique_price_labels_revert.sql
-- ============================================================================

ALTER TABLE boutique_price_labels ADD COLUMN IF NOT EXISTS reverted_at TIMESTAMPTZ;
ALTER TABLE boutique_price_labels ADD COLUMN IF NOT EXISTS reverted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE boutique_price_labels DROP CONSTRAINT IF EXISTS boutique_price_labels_source_check;
ALTER TABLE boutique_price_labels ADD CONSTRAINT boutique_price_labels_source_check
  CHECK (source IN ('aligned', 'auto', 'reverted'));
