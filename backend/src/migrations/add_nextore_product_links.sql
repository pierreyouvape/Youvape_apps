-- ============================================================================
-- Boutiques Nextore — Rapprochement produits caisse <-> site (WooCommerce)
-- ============================================================================
-- Un lien = un produit Nextore (global, pas par boutique) rattaché à UN produit
-- WooCommerce, avec le multiplicateur `pack_qty` : combien d'unités BOUTIQUE
-- tient un produit SITE. Les résistances sont vendues à l'unité en boutique et
-- en pack de 3/5 sur le site → pack_qty = 3 ou 5, coût boutique = coût site / N.
--
-- Rien n'est actif tant que status <> 'approved' : le moteur propose, l'humain
-- valide (les EAN de la caisse ne sont pas fiables à 100 %).
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_nextore_product_links.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS nextore_product_links (
  nx_product_id  TEXT PRIMARY KEY REFERENCES nextore_products(product_id) ON DELETE CASCADE,
  wc_product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
  pack_qty       INTEGER NOT NULL DEFAULT 1 CHECK (pack_qty >= 1),
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected')),
  match_method   TEXT,      -- ean | ean_ambiguous | name | manual
  score          NUMERIC,   -- 0..1, confiance du moteur
  candidates     JSONB,     -- autres pistes proposées : [{wc_product_id, score, ...}]
  pack_source    TEXT,      -- title | cost_ratio | manual | default
  pack_warning   TEXT,      -- incohérence détectée (titre vs ratio de coût)
  reviewed_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nx_links_status ON nextore_product_links(status);
CREATE INDEX IF NOT EXISTS idx_nx_links_wc     ON nextore_product_links(wc_product_id);

-- Curseur du dernier passage du moteur de rapprochement
INSERT INTO app_config (config_key, config_value, updated_at)
VALUES ('nextore_last_match_at', '', NOW())
ON CONFLICT (config_key) DO NOTHING;
