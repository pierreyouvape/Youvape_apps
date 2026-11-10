-- ============================================================================
-- Étiquettes de prix à refaire en boutique (10/11/2026)
-- ============================================================================
-- Chaque prix changé dans la caisse par l'app (alignement sur le site, à la main
-- ou automatique) = une étiquette à refaire, dans CHAQUE boutique (le catalogue
-- Nextore est commun) : cochée « faite » séparément à Montpellier et à Castelnau.
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_boutique_price_labels.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS boutique_price_labels (
  id            BIGSERIAL PRIMARY KEY,
  product_id    INTEGER REFERENCES products(id) ON DELETE CASCADE,
  nx_product_id TEXT NOT NULL,
  old_price     NUMERIC,
  new_price     NUMERIC NOT NULL,
  changed_at    TIMESTAMPTZ DEFAULT NOW(),
  source        TEXT NOT NULL CHECK (source IN ('aligned', 'auto')),
  done_mtp_at   TIMESTAMPTZ,
  done_mtp_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done_cast_at  TIMESTAMPTZ,
  done_cast_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_price_labels_changed ON boutique_price_labels (changed_at DESC);

-- Reprise : les alignements faits à la main avant cette table (liste « prix »).
INSERT INTO boutique_price_labels (product_id, nx_product_id, old_price, new_price, changed_at, source)
SELECT r.product_id, r.nx_product_id, (r.detail->>'caisse')::numeric, np.price, r.resolved_at, 'aligned'
  FROM boutique_catalog_reviews r
  JOIN nextore_products np ON np.product_id = r.nx_product_id
 WHERE r.reason = 'prix' AND r.resolution = 'aligned'
   AND NOT EXISTS (SELECT 1 FROM boutique_price_labels l WHERE l.nx_product_id = r.nx_product_id AND l.changed_at = r.resolved_at);
