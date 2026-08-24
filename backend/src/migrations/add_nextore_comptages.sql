-- ============================================================================
-- Boutiques Nextore — Module COMPTAGE (inventaire) — 1er module d'ÉCRITURE
-- ============================================================================
-- 3 types : tournant (10 réfs proposées), spontané (libre), catégorie (exhaustif
-- en plusieurs fois). Écriture via PUT /stocks qui est un DELTA :
--   delta = quantité comptée − S_ref (stock Nextore live capturé au comptage).
-- Le delta absorbe automatiquement les ventes survenues APRÈS le comptage.
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_nextore_comptages.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS nextore_comptages (
  id           BIGSERIAL PRIMARY KEY,
  warehouse_id INTEGER NOT NULL,
  type         TEXT NOT NULL,            -- 'tournant' | 'spontane' | 'categorie'
  name         TEXT,
  status       TEXT NOT NULL DEFAULT 'en_cours', -- 'en_cours' | 'valide'
  filter_type  TEXT,                     -- null | 'category' | 'subcategory'
  filter_id    TEXT,                     -- id catégorie / sous-catégorie
  created_by   TEXT,                     -- email/id utilisateur
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_nextore_comptages_wh ON nextore_comptages(warehouse_id, status);

CREATE TABLE IF NOT EXISTS nextore_comptage_items (
  id           BIGSERIAL PRIMARY KEY,
  comptage_id  BIGINT NOT NULL REFERENCES nextore_comptages(id) ON DELETE CASCADE,
  product_id   TEXT NOT NULL,
  s_ref        NUMERIC,                  -- stock Nextore live au moment du comptage
  counted_qty  NUMERIC,                  -- quantité comptée (scans + manuel)
  pushed       BOOLEAN NOT NULL DEFAULT FALSE,
  pushed_at    TIMESTAMPTZ,
  delta_pushed NUMERIC,
  moved        BOOLEAN NOT NULL DEFAULT FALSE, -- Nextore a bougé vs s_ref à la poussée
  UNIQUE (comptage_id, product_id)
);
-- Cooldown "vendu souvent" (14 j) : dernier comptage poussé par produit/boutique
CREATE INDEX IF NOT EXISTS idx_nextore_comptage_items_cooldown
  ON nextore_comptage_items(product_id, pushed_at DESC);
