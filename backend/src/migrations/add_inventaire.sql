-- App Inventaire (lot 1) : création au PC, comptage au PDA, avancement.
--
-- Décisions de Pierre (05-06/10/2026) :
--   - inventaire partiel (catégories, sous-catégories, marques) ou global
--     (périmètre de la valeur de stock du catalogue) ; la liste des références
--     est FIGÉE à la création ;
--   - on compte par emplacement, une personne par emplacement ; chacun valide
--     sa journée le soir ;
--   - en fin d'emplacement, on relève le stock physique BMS MOINS ce qui a été
--     prélevé dans nos vagues sans être encore expédié : l'écart = compté −
--     ce relevé, et il absorbe les ventes et réceptions qui suivent ;
--   - recomptage si l'écart atteint 5 pièces ET dépasse 15 % du théorique ;
--     le recomptage refait le relevé, et c'est lui qui fait foi.
--
-- Idempotente : relançable sans dégât.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
-- La migration passe AVANT le rebuild : le code en service ne lit pas ces tables.
--
--   1. pg_dump de sauvegarde
--   2. git pull                                        (sur le VPS)
--   3. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_inventaire.sql
--   4. docker compose up --build -d backend frontend
--
-- Retour arrière : backend/src/migrations/rollback_inventaire.sql

BEGIN;

CREATE TABLE IF NOT EXISTS inventories (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  kind          VARCHAR(10) NOT NULL CHECK (kind IN ('global', 'partial')),
  filters       JSONB NOT NULL DEFAULT '{}',
  status        VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled', 'closed')),
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  cancelled_by  INTEGER REFERENCES users(id),
  cancelled_at  TIMESTAMP,
  closed_at     TIMESTAMP
);
-- Un seul inventaire ouvert à la fois : le PDA n'a pas à demander lequel.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventories_one_open ON inventories ((true)) WHERE status = 'open';

-- '' = « Sans emplacement » (produits sans shelf_location).
-- free → counting (pris par quelqu'un) → closed (terminé, rouvrable par son
-- compteur) → validated (« Valider ma journée » : définitif).
CREATE TABLE IF NOT EXISTS inventory_locations (
  id            SERIAL PRIMARY KEY,
  inventory_id  INTEGER NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
  location      VARCHAR(50) NOT NULL,
  status        VARCHAR(12) NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'counting', 'closed', 'validated')),
  assigned_to   INTEGER REFERENCES users(id),
  assigned_at   TIMESTAMP,
  closed_by     INTEGER REFERENCES users(id),
  closed_at     TIMESTAMP,
  validated_at  TIMESTAMP,
  UNIQUE (inventory_id, location)
);

-- Une ligne par référence à compter.
-- pending → counted | recount → recounted
CREATE TABLE IF NOT EXISTS inventory_items (
  id                 SERIAL PRIMARY KEY,
  inventory_id       INTEGER NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
  product_id         INTEGER NOT NULL REFERENCES products(id),
  sku                VARCHAR(100),
  name               VARCHAR(255),
  expected_location  VARCHAR(50) NOT NULL DEFAULT '',
  added_by_scan      BOOLEAN NOT NULL DEFAULT false,   -- trouvé en rayon, absent de la liste figée
  status             VARCHAR(12) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'counted', 'recount', 'recounted')),
  -- Relevé du stock théorique (BMS physique − prélevé non expédié)
  ref_needed         BOOLEAN NOT NULL DEFAULT false,
  ref_physical       INTEGER,
  ref_picked         INTEGER,
  ref_at             TIMESTAMP,
  ref_error          TEXT,
  -- 1er comptage, gardé quand un recomptage est demandé
  first_counted      INTEGER,
  first_theoretical  INTEGER,
  recount_locked_by  INTEGER REFERENCES users(id),
  recount_qty        INTEGER CHECK (recount_qty >= 0),
  recount_by         INTEGER REFERENCES users(id),
  recount_at         TIMESTAMP,
  UNIQUE (inventory_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_items_location ON inventory_items (inventory_id, expected_location);
CREATE INDEX IF NOT EXISTS idx_inventory_items_ref_needed ON inventory_items (id) WHERE ref_needed;

-- Quantité comptée d'un produit dans un emplacement (0 = « absent »).
CREATE TABLE IF NOT EXISTS inventory_counts (
  id            SERIAL PRIMARY KEY,
  inventory_id  INTEGER NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
  location_id   INTEGER NOT NULL REFERENCES inventory_locations(id) ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  qty           INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  counted_by    INTEGER REFERENCES users(id),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (location_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_counts_product ON inventory_counts (inventory_id, product_id);

-- Journal : qui a fait quoi, et quand.
CREATE TABLE IF NOT EXISTS inventory_events (
  id            SERIAL PRIMARY KEY,
  inventory_id  INTEGER NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
  location_id   INTEGER REFERENCES inventory_locations(id) ON DELETE SET NULL,
  product_id    INTEGER REFERENCES products(id),
  user_id       INTEGER REFERENCES users(id),
  action        VARCHAR(20) NOT NULL,
  qty           INTEGER,
  code          VARCHAR(60),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_events_inventory ON inventory_events (inventory_id, created_at);

COMMIT;
