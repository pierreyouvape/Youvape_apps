-- Veille concurrentielle : mapping produits ↔ concurrents + historique des prix relevés
-- Créé le 2026-07-28

-- 1) Mapping : une ligne = un produit suivi chez un concurrent (via une URL)
CREATE TABLE IF NOT EXISTS competitor_products (
  id            SERIAL PRIMARY KEY,
  sku           VARCHAR(255) NOT NULL,          -- SKU du produit chez Youvape (clé de rapprochement)
  product_name  TEXT,                           -- libellé lisible
  competitor    VARCHAR(120) NOT NULL,          -- nom du concurrent (ex: levapoteur-discount)
  url           TEXT NOT NULL,                  -- URL directe de la fiche produit concurrente
  active        BOOLEAN NOT NULL DEFAULT TRUE,  -- désactiver un suivi sans supprimer la ligne
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (competitor, url)
);

CREATE INDEX IF NOT EXISTS idx_competitor_products_sku ON competitor_products (sku);

-- 2) Historique : un relevé quotidien par (competitor_product, jour)
CREATE TABLE IF NOT EXISTS competitor_prices (
  id                     SERIAL PRIMARY KEY,
  competitor_product_id  INTEGER NOT NULL REFERENCES competitor_products(id) ON DELETE CASCADE,
  price                  NUMERIC(10,2),          -- prix de vente TTC relevé (NULL si échec)
  regular_price          NUMERIC(10,2),          -- prix barré / avant remise si détecté
  in_stock               BOOLEAN,                -- disponibilité (NULL si inconnue)
  currency               VARCHAR(8) DEFAULT 'EUR',
  status                 VARCHAR(16) NOT NULL DEFAULT 'ok',  -- 'ok' | 'error'
  error_message          TEXT,
  source                 VARCHAR(16),            -- 'direct' | 'scraper'
  checked_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_competitor_prices_cp ON competitor_prices (competitor_product_id, checked_at DESC);

-- 3) Configuration (clés dédiées à la veille)
INSERT INTO app_config (config_key, config_value) VALUES
  ('competitor_monitor_enabled', 'true'),
  ('competitor_alert_email', 'youvape34@gmail.com'),
  ('scraperapi_key', '')
ON CONFLICT (config_key) DO NOTHING;
