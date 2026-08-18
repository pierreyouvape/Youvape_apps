-- ============================================================================
-- Boutiques Nextore — Historique de stock façon "journal des changements"
-- ============================================================================
-- Remplace la logique de snapshot quotidien (nextore_stock_snapshots) par un
-- journal : on n'écrit une ligne QUE lorsque le stock d'un produit change. On
-- reconstruit le stock d'un produit à n'importe quel instant T en prenant la
-- dernière ligne dont captured_at <= T. ~50x plus léger qu'une photo complète.
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_nextore_stock_history.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS nextore_stock_history (
  id           BIGSERIAL PRIMARY KEY,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  warehouse_id INTEGER NOT NULL,
  product_id   TEXT NOT NULL,
  stock        NUMERIC NOT NULL
);

-- Lookup "dernier état connu <= T" pour un produit d'une boutique
CREATE INDEX IF NOT EXISTS idx_nextore_hist_lookup
  ON nextore_stock_history (warehouse_id, product_id, captured_at DESC);

-- Curseurs de synchro séparés (catalogue vs stock)
INSERT INTO app_config (config_key, config_value, updated_at)
VALUES
  ('nextore_last_catalog_sync_at', '', NOW()),
  ('nextore_last_stock_sync_at',   '', NOW())
ON CONFLICT (config_key) DO NOTHING;

-- La table nextore_stock_snapshots devient obsolète (conservée pour ne rien
-- perdre ; peut être supprimée plus tard : DROP TABLE nextore_stock_snapshots;).
