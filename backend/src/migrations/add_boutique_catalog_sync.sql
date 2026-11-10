-- ============================================================================
-- Catalogue caisse : produits du site → Nextore (10/11/2026)
-- ============================================================================
-- Toutes les heures (nextoreCatalogSyncService) :
--   - nouveau produit du site (1re réception après `nextore_autocreate_since`)
--     → rattaché par code-barres, ou créé dans Nextore si rien ne ressemble et
--       que la catégorie est sûre ; sinon il part dans la liste à vérifier ;
--   - code-barres ajouté sur le site → ajouté à la fiche Nextore liée ;
--   - prix normal du site changé → envoyé à la caisse (sans remise WDR).
-- Ce qui demande un humain va dans boutique_catalog_reviews.
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_boutique_catalog_sync.sql
-- ============================================================================

-- Dernier prix envoyé à la caisse, par produit du site. Absent = jamais comparé.
CREATE TABLE IF NOT EXISTS boutique_nx_sync (
  product_id    INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  nx_product_id TEXT NOT NULL,
  price_pushed  NUMERIC,                 -- prix normal du site au dernier alignement
  price_locked  BOOLEAN NOT NULL DEFAULT false,  -- « garder le prix caisse » : plus d'alignement
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Liste à vérifier. Une ligne par (produit, motif) ; rouverte au besoin.
--   doublon      nouveau produit, une fiche caisse au nom proche existe
--   categorie    nouveau produit, catégorie caisse incertaine
--   sans_ean     nouveau produit sans code-barres
--   ean_multiple un code-barres du site est sur plusieurs fiches caisse
--   absent       produit existant en stock, introuvable dans la caisse (reprise)
--   prix         prix caisse ≠ prix normal du site (1re comparaison)
--   ean_conflit  code-barres du site déjà sur une AUTRE fiche caisse
CREATE TABLE IF NOT EXISTS boutique_catalog_reviews (
  id            BIGSERIAL PRIMARY KEY,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL CHECK (reason IN ('doublon', 'categorie', 'sans_ean', 'ean_multiple', 'absent', 'prix', 'ean_conflit')),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'ignored')),
  nx_product_id TEXT,
  candidates    JSONB,                   -- fiches caisse proches : [{id, name, score}]
  suggested_category_id TEXT,
  detail        JSONB,                   -- prix, codes-barres en conflit…
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolution    TEXT,
  UNIQUE (product_id, reason)
);
CREATE INDEX IF NOT EXISTS idx_catalog_reviews_open ON boutique_catalog_reviews (reason) WHERE status = 'open';

-- Mise en route (APRÈS validation de la simulation), pas dans cette migration :
--   INSERT INTO app_config (config_key, config_value, updated_at)
--   VALUES ('nextore_autocreate_since', 'YYYY-MM-DD', NOW());
-- Un produit dont la 1re réception est postérieure à cette date est « nouveau » :
-- il peut être créé automatiquement. Les autres passent par la liste « absent ».
-- Sans cette clé, la synchro ne fait rien.
