-- ============================================================================
-- Prélèvements du stock du site par la boutique de Castelnau (EMC → EMC2)
-- ============================================================================
-- Un prélèvement = des pièces prises au stock du site (aujourd'hui BMS, demain
-- WooCommerce) pour la boutique. Il fait trois choses, chacune avec son état :
--   1. sortie du stock du site  (site_status)
--   2. entrée dans le stock de la boutique dans Nextore (nx_status)
--   3. une ligne de refacturation EMC → EMC2 au coût d'achat du site (la ligne elle-même)
-- Rien ne bloque le vendeur : la ligne est enregistrée d'abord, les deux
-- écritures partent ensuite par une file (cron chaque minute).
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_boutique_prelevements.sql
-- ============================================================================

-- Produit du site → produit caisse, quand le code-barres ne suffit pas
-- (rattachement à la main, ou fiche créée dans Nextore par l'app).
-- Le lien par code-barres commun n'est PAS stocké : il se relit à chaque fois.
CREATE TABLE IF NOT EXISTS boutique_site_links (
  product_id    INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  nx_product_id TEXT NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('manual', 'created')),
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS boutique_prelevements (
  id             BIGSERIAL PRIMARY KEY,
  warehouse_id   INTEGER NOT NULL,                 -- boutique Nextore (2 = Castelnau)
  product_id     INTEGER NOT NULL REFERENCES products(id),
  sku            TEXT,
  name           TEXT,
  qty            INTEGER NOT NULL CHECK (qty > 0),  -- pièces du SITE
  unit_cost_ht   NUMERIC,                           -- coût d'achat du site, figé au prélèvement
  origin         TEXT NOT NULL CHECK (origin IN ('boutique', 'pda')),
  note           TEXT,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),

  -- 1. Sortie du stock du site
  site_status    TEXT NOT NULL DEFAULT 'queued'
                 CHECK (site_status IN ('queued', 'sending', 'sent', 'error')),
  site_ref       TEXT,                              -- n° du mouvement BMS
  site_error     TEXT,
  site_at        TIMESTAMPTZ,

  -- 2. Entrée en boutique dans Nextore
  nx_product_id  TEXT,                              -- NULL : produit pas encore dans la caisse
  nx_qty         NUMERIC,                           -- pièces BOUTIQUE (résistances : pack × N)
  -- skipped = reprise de l'historique : la pièce est déjà vendue, rien à entrer en caisse
  nx_status      TEXT NOT NULL DEFAULT 'waiting'
                 CHECK (nx_status IN ('waiting', 'queued', 'sending', 'sent', 'error', 'skipped')),
  nx_error       TEXT,
  nx_at          TIMESTAMPTZ,

  -- Mouvement PDA « Vente boutique » d'origine : une ligne PDA = un prélèvement, jamais deux
  pda_log_id     INTEGER UNIQUE REFERENCES pda_product_log(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_prelev_created ON boutique_prelevements (warehouse_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prelev_site_q  ON boutique_prelevements (site_status) WHERE site_status IN ('queued', 'sending');
CREATE INDEX IF NOT EXISTS idx_prelev_nx_q    ON boutique_prelevements (nx_status) WHERE nx_status IN ('waiting', 'queued', 'sending');
CREATE INDEX IF NOT EXISTS idx_prelev_product ON boutique_prelevements (product_id);
