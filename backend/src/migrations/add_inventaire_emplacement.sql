-- Inventaire par emplacement (04/11/2026).
--
-- Décisions de Pierre :
--   - un dossier (inventories.kind = 'location') créé au PC ou au PDA, où l'on
--     scanne autant d'emplacements qu'on veut ; chaque passage garde qui l'a
--     validé, et quand ;
--   - le PDA affiche la quantité (physique BMS − prélevé non expédié), modifiable
--     en absolu ; un produit trouvé ici s'ajoute, sa quantité devient son stock
--     total et il est rangé ici ;
--   - à la validation, chaque produit attendu (avec du stock) non vu est mis à 0
--     ou déclaré « rangé ailleurs » (nouvel emplacement scanné) ;
--   - les corrections partent dans BMS dès la validation (mouvement de l'écart,
--     relu au moment de l'envoi) ; un mail à contact@ liste les produits passés
--     à 0 ou trouvés alors qu'ils étaient à 0.
--
-- Ne touche à aucune donnée existante. Idempotente.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
--   1. pg_dump de sauvegarde
--   2. git pull                                        (sur le VPS)
--   3. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_inventaire_emplacement.sql
--   4. docker compose up --build -d backend frontend
--
-- Retour arrière : backend/src/migrations/rollback_inventaire_emplacement.sql

BEGIN;

ALTER TABLE inventories DROP CONSTRAINT IF EXISTS inventories_kind_check;
ALTER TABLE inventories ADD CONSTRAINT inventories_kind_check CHECK (kind IN ('global', 'partial', 'location'));

-- Un passage sur un emplacement : counting → validated | abandoned.
CREATE TABLE IF NOT EXISTS inventory_spot_passes (
  id            SERIAL PRIMARY KEY,
  inventory_id  INTEGER NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
  location      VARCHAR(50) NOT NULL,
  status        VARCHAR(12) NOT NULL DEFAULT 'counting' CHECK (status IN ('counting', 'validated', 'abandoned')),
  started_by    INTEGER REFERENCES users(id),
  started_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  validated_by  INTEGER REFERENCES users(id),
  validated_at  TIMESTAMP,
  abandoned_by  INTEGER REFERENCES users(id),
  abandoned_at  TIMESTAMP,
  -- Mail « passés à 0 / trouvés » : fait (envoyé, ou rien à signaler) à mail_done_at.
  mail_done_at  TIMESTAMP,
  mail_rows     INTEGER,
  mail_attempts INTEGER NOT NULL DEFAULT 0,
  mail_error    TEXT
);
-- Une seule personne à la fois sur un emplacement, tous dossiers confondus.
CREATE UNIQUE INDEX IF NOT EXISTS uq_spot_pass_counting ON inventory_spot_passes (location) WHERE status = 'counting';
CREATE INDEX IF NOT EXISTS idx_spot_passes_inventory ON inventory_spot_passes (inventory_id);

-- Un produit dans un passage.
CREATE TABLE IF NOT EXISTS inventory_spot_lines (
  id                  SERIAL PRIMARY KEY,
  pass_id             INTEGER NOT NULL REFERENCES inventory_spot_passes(id) ON DELETE CASCADE,
  product_id          INTEGER NOT NULL REFERENCES products(id),
  sku                 VARCHAR(100),
  name                VARCHAR(255),
  added               BOOLEAN NOT NULL DEFAULT false,   -- trouvé ici, rangé ailleurs (from_location)
  from_location       VARCHAR(50),
  locked_by_inventory VARCHAR(120),                     -- compté dans un inventaire classique ouvert
  -- Quantité affichée, lue à l'ouverture
  ref_needed          BOOLEAN NOT NULL DEFAULT true,
  shown_qty           INTEGER,
  bms_location        VARCHAR(50),
  ref_error           TEXT,
  ref_at              TIMESTAMP,
  -- Saisie : qty NULL = pas encore vu
  qty                 INTEGER CHECK (qty >= 0),
  outcome             VARCHAR(10) CHECK (outcome IN ('count', 'moved')),
  moved_to            VARCHAR(50),
  counted_by          INTEGER REFERENCES users(id),
  counted_at          TIMESTAMP,
  -- Envoi à BMS (à la validation) : queued → sending → sent | error, ou ignored
  push_status         VARCHAR(10) CHECK (push_status IN ('queued', 'sending', 'sent', 'error', 'ignored')),
  push_physical       INTEGER,
  push_picked         INTEGER,
  push_qty            INTEGER,
  push_at             TIMESTAMP,
  push_error          TEXT,
  bms_movement_id     VARCHAR(40),
  location_done       BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (pass_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_spot_lines_ref_needed ON inventory_spot_lines (id) WHERE ref_needed;
CREATE INDEX IF NOT EXISTS idx_spot_lines_push_queued ON inventory_spot_lines (id) WHERE push_status = 'queued';
CREATE INDEX IF NOT EXISTS idx_spot_lines_product ON inventory_spot_lines (product_id);

COMMIT;
