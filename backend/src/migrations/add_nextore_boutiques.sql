-- ============================================================================
-- Boutiques physiques (Nextore) — Module 1 : Fondation + Suivi de stock
-- ============================================================================
-- Un seul jeu de tables pour les deux boutiques, cloisonné par warehouse_id
-- (1 = Montpellier, 2 = Castelnau). Le catalogue produits est global ; le stock
-- et l'historique sont par boutique.
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_nextore_boutiques.sql
-- ============================================================================

-- Catalogue produits (global, miroir de /products) -------------------------
CREATE TABLE IF NOT EXISTS nextore_products (
  product_id        TEXT PRIMARY KEY,           -- Nextore products.id (string)
  code              TEXT,
  name              TEXT,
  unit              TEXT,
  cost              NUMERIC,                     -- prix d'achat HT
  price             NUMERIC,                     -- prix de vente TTC
  category_id       TEXT,
  subcategory_id    TEXT,
  subsubcategory_id TEXT,
  barcode           TEXT,
  tax_rate          TEXT,                        -- = id du taux (0/1/2/4), pas le %
  type              TEXT,                        -- standard / combo / gift_card / menu
  status            TEXT,                        -- '' / deleted / end_of_life / new / customer_order
  date_update       TIMESTAMP,                   -- Nextore date_update
  synced_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nextore_products_category ON nextore_products(category_id);

-- Stock courant par boutique (miroir de /stocks?warehouse_id=) --------------
CREATE TABLE IF NOT EXISTS nextore_stock (
  product_id   TEXT NOT NULL,
  warehouse_id INTEGER NOT NULL,
  stock        NUMERIC DEFAULT 0,
  rack         TEXT,                             -- emplacement physique
  synced_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (product_id, warehouse_id)
);
CREATE INDEX IF NOT EXISTS idx_nextore_stock_wh ON nextore_stock(warehouse_id);

-- Historique quotidien du stock (Nextore ne fournit pas d'historique) -------
CREATE TABLE IF NOT EXISTS nextore_stock_snapshots (
  snapshot_date DATE NOT NULL,                   -- date Europe/Paris
  warehouse_id  INTEGER NOT NULL,
  product_id    TEXT NOT NULL,
  stock         NUMERIC DEFAULT 0,
  PRIMARY KEY (snapshot_date, warehouse_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_nextore_snap_lookup
  ON nextore_stock_snapshots(warehouse_id, product_id, snapshot_date DESC);

-- Catégories (miroir léger pour l'affichage) --------------------------------
CREATE TABLE IF NOT EXISTS nextore_categories (
  id        TEXT PRIMARY KEY,
  code      TEXT,
  name      TEXT,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nextore_subcategories (
  id          TEXT PRIMARY KEY,
  category_id TEXT,
  code        TEXT,
  name        TEXT,
  synced_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Curseur de dernière synchro ----------------------------------------------
INSERT INTO app_config (config_key, config_value, updated_at)
VALUES ('nextore_last_sync_at', '', NOW())
ON CONFLICT (config_key) DO NOTHING;
