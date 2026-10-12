-- ============================================================================
-- Boutiques — commandes fournisseur gardées CHEZ NOUS + réception
-- ============================================================================
-- L'API Nextore ne sait pas réceptionner un achat existant (essais du
-- 12/10/2026 : PUT → 405, et un achat reçu ne se supprime même pas dans
-- l'interface Nextore). La commande vit donc ici ; la réception crée dans
-- Nextore un achat DÉJÀ REÇU des pièces comptées (POST /purchases, status
-- received), ce qui met en stock avec le coût.
--
-- Tout est compté en PIÈCES.
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_boutique_orders_reception.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS boutique_orders (
  id           SERIAL PRIMARY KEY,
  warehouse_id INTEGER NOT NULL,                    -- 1 = Montpellier, 2 = Castelnau
  supplier_id  TEXT NOT NULL REFERENCES nextore_suppliers(id),
  reference    TEXT NOT NULL,                       -- n° du document, ou APP-…
  source       TEXT NOT NULL CHECK (source IN ('besoins', 'import')),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'received', 'cancelled')),
  created_by   TEXT,                                -- email
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_boutique_orders_shop ON boutique_orders (warehouse_id, status);

CREATE TABLE IF NOT EXISTS boutique_order_items (
  id                 SERIAL PRIMARY KEY,
  order_id           INTEGER NOT NULL REFERENCES boutique_orders(id) ON DELETE CASCADE,
  product_id         TEXT NOT NULL REFERENCES nextore_products(product_id),
  supplier_sku       TEXT,
  pack_qty           INTEGER NOT NULL DEFAULT 1 CHECK (pack_qty >= 1),
  qty_ordered        INTEGER NOT NULL CHECK (qty_ordered >= 0),   -- pièces ; 0 = ajouté à la réception
  unit_cost          NUMERIC(12,4) NOT NULL DEFAULT 0,          -- HT d'une pièce
  qty_received       INTEGER NOT NULL DEFAULT 0,                -- pièces, cumul des réceptions
  -- Motif qui solde le reste de la ligne (un reliquat la laisse ouverte)
  closed_reason      TEXT CHECK (closed_reason IN ('solde', 'manquant', 'erreur_saisie')),
  added_at_reception BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_boutique_order_items_order ON boutique_order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_boutique_order_items_product ON boutique_order_items (product_id);

CREATE TABLE IF NOT EXISTS boutique_reception_sessions (
  id                  SERIAL PRIMARY KEY,
  order_id            INTEGER NOT NULL REFERENCES boutique_orders(id) ON DELETE CASCADE,
  -- 'sending' = verrou pendant l'appel à Nextore : un double envoi créerait deux
  -- achats reçus, et un achat reçu ne se supprime pas
  status              TEXT NOT NULL DEFAULT 'counting'
                      CHECK (status IN ('counting', 'sending', 'validated', 'abandoned')),
  started_by          TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validated_by        TEXT,
  validated_at        TIMESTAMPTZ,
  nextore_reference   TEXT,
  nextore_purchase_id TEXT,
  last_error          TEXT
);
-- Une seule réception en cours par commande
CREATE UNIQUE INDEX IF NOT EXISTS boutique_reception_sessions_open_key
  ON boutique_reception_sessions (order_id) WHERE status IN ('counting', 'sending');

CREATE TABLE IF NOT EXISTS boutique_reception_counts (
  session_id     INTEGER NOT NULL REFERENCES boutique_reception_sessions(id) ON DELETE CASCADE,
  order_item_id  INTEGER NOT NULL REFERENCES boutique_order_items(id) ON DELETE CASCADE,
  units_counted  INTEGER NOT NULL DEFAULT 0 CHECK (units_counted >= 0),
  units_expected INTEGER,      -- reste attendu au moment de la validation (historique)
  motif          TEXT CHECK (motif IN ('reliquat', 'solde', 'manquant', 'erreur_saisie')),
  PRIMARY KEY (session_id, order_item_id)
);

-- Codes-barres rattachés ou confirmés à la réception, CHEZ NOUS seulement
-- (jamais écrits dans Nextore). kind = 'carton' → un scan vaut pack_qty pièces.
CREATE TABLE IF NOT EXISTS nextore_reception_barcodes (
  barcode    TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES nextore_products(product_id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'unit' CHECK (kind IN ('unit', 'carton')),
  pack_qty   INTEGER NOT NULL DEFAULT 1 CHECK (pack_qty >= 1),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (barcode, product_id)
);
