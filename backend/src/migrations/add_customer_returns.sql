-- Retours client (lot 1) : création depuis un ticket ou une commande,
-- validation au PC, remise en stock BMS, stock SAV par fournisseur.
--
-- Décisions de Pierre (09/10/2026) :
--   - motifs : défaut, erreur d'expédition, rétractation, commande non récupérée ;
--   - à la validation, l'opérateur SAV donne une destination à CHAQUE pièce :
--     remise en stock (mouvement BMS « retour produit »), SAV fournisseur, ou
--     rien (« ne pas remettre en stock », géré à la main) ;
--   - le stock SAV fournisseur ne vit QUE chez nous ; il s'exporte au renvoi ;
--   - les fournisseurs règlent toujours par avoir (lien avec les avoirs : lot 4).
--
-- Idempotente : relançable sans dégât.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
-- La migration passe AVANT le rebuild : le code en service ne lit pas ces tables.
--
--   1. pg_dump de sauvegarde
--   2. git pull                                        (sur le VPS)
--   3. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_customer_returns.sql
--   4. docker compose up --build -d backend frontend
--
-- Retour arrière : backend/src/migrations/rollback_customer_returns.sql

BEGIN;

-- Le statut se déduit de received_at / treated_at / cancelled_at
-- (returnRules.returnStatus) ; il est stocké pour filtrer la liste.
CREATE TABLE IF NOT EXISTS customer_returns (
  id               SERIAL PRIMARY KEY,
  wp_order_id      BIGINT NOT NULL REFERENCES orders(wp_order_id),
  ticket_id        INTEGER REFERENCES sav_tickets(id) ON DELETE SET NULL,
  reason           VARCHAR(20) NOT NULL
                   CHECK (reason IN ('defaut', 'erreur_expedition', 'retractation', 'non_recupere')),
  return_required  BOOLEAN NOT NULL DEFAULT true,
  status           VARCHAR(10) NOT NULL DEFAULT 'attente'
                   CHECK (status IN ('attente', 'recu', 'traite', 'annule')),
  -- Issue prévue à la création, confirmée (avec sa référence) une fois faite.
  outcome          VARCHAR(15) CHECK (outcome IN ('renvoi', 'points', 'remboursement', 'aucune')),
  outcome_ref      VARCHAR(255),
  note             TEXT,
  created_by       INTEGER REFERENCES users(id),
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  received_by      INTEGER REFERENCES users(id),
  received_at      TIMESTAMP,
  treated_by       INTEGER REFERENCES users(id),
  treated_at       TIMESTAMP,
  cancelled_by     INTEGER REFERENCES users(id),
  cancelled_at     TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_customer_returns_order ON customer_returns (wp_order_id);
CREATE INDEX IF NOT EXISTS idx_customer_returns_ticket ON customer_returns (ticket_id);
CREATE INDEX IF NOT EXISTS idx_customer_returns_status ON customer_returns (status);

-- Une ligne de commande retournée. `order_item_id` est l'id WooCommerce (pas
-- de clé étrangère : la synchro peut réécrire order_items). Un pack woosb porte
-- le prix et aucune destination ; ses composants (bundle_line_id) portent la
-- remise en stock.
CREATE TABLE IF NOT EXISTS customer_return_lines (
  id               SERIAL PRIMARY KEY,
  return_id        INTEGER NOT NULL REFERENCES customer_returns(id) ON DELETE CASCADE,
  order_item_id    BIGINT NOT NULL,
  product_id       INTEGER REFERENCES products(id),
  sku              VARCHAR(255),
  name             VARCHAR(255),
  qty              INTEGER NOT NULL CHECK (qty > 0),
  unit_paid        NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_bundle        BOOLEAN NOT NULL DEFAULT false,
  bundle_line_id   INTEGER REFERENCES customer_return_lines(id) ON DELETE CASCADE,
  qty_restock      INTEGER NOT NULL DEFAULT 0 CHECK (qty_restock >= 0),
  qty_supplier     INTEGER NOT NULL DEFAULT 0 CHECK (qty_supplier >= 0),
  qty_no_restock   INTEGER NOT NULL DEFAULT 0 CHECK (qty_no_restock >= 0),
  problem          TEXT,
  supplier_id      INTEGER REFERENCES suppliers(id),
  -- Pièces réellement entrées dans BMS : une ligne n'y est jamais renvoyée.
  restocked_qty    INTEGER NOT NULL DEFAULT 0,
  bms_movement_id  BIGINT,
  restocked_at     TIMESTAMP,
  CHECK (qty_restock + qty_supplier + qty_no_restock <= qty),
  CHECK (restocked_qty <= qty_restock)
);
CREATE INDEX IF NOT EXISTS idx_customer_return_lines_return ON customer_return_lines (return_id);
CREATE INDEX IF NOT EXISTS idx_customer_return_lines_item ON customer_return_lines (order_item_id);

-- Un renvoi au fournisseur : créé à l'export des lignes cochées.
CREATE TABLE IF NOT EXISTS supplier_return_batches (
  id           SERIAL PRIMARY KEY,
  supplier_id  INTEGER NOT NULL REFERENCES suppliers(id),
  status       VARCHAR(10) NOT NULL DEFAULT 'envoye' CHECK (status IN ('envoye', 'solde')),
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supplier_return_batches_supplier ON supplier_return_batches (supplier_id);

-- Stock SAV d'un fournisseur : les pièces à lui retourner.
CREATE TABLE IF NOT EXISTS supplier_return_items (
  id              SERIAL PRIMARY KEY,
  supplier_id     INTEGER NOT NULL REFERENCES suppliers(id),
  product_id      INTEGER NOT NULL REFERENCES products(id),
  return_line_id  INTEGER NOT NULL UNIQUE REFERENCES customer_return_lines(id) ON DELETE CASCADE,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  reason          VARCHAR(20) NOT NULL,
  problem         TEXT,
  unit_cost       NUMERIC(12,4),
  status          VARCHAR(12) NOT NULL DEFAULT 'a_retourner'
                  CHECK (status IN ('a_retourner', 'envoye', 'solde')),
  batch_id        INTEGER REFERENCES supplier_return_batches(id) ON DELETE SET NULL,
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supplier_return_items_supplier ON supplier_return_items (supplier_id, status);
CREATE INDEX IF NOT EXISTS idx_supplier_return_items_batch ON supplier_return_items (batch_id);

COMMIT;
