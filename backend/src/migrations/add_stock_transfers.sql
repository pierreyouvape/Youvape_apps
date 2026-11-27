-- ============================================================================
-- Transferts de stock entre le site et les boutiques (27/11/2026)
-- ============================================================================
-- Un transfert part d'un stock (site ou boutique) vers l'autre :
--   site_to_shop : sortie du stock du site (BMS) à l'envoi ; commande boutique
--                  « en attente de réception » (fournisseur Nextore SARL EMC),
--                  mise en stock Nextore à la validation de la réception.
--   shop_to_site : sortie du stock Nextore à l'envoi ; commande d'achat BMS
--                  (fournisseur YouVape Montpelliier / YouVape Castelnau),
--                  mise en stock du site à la réception BMS.
-- Le coût d'une ligne est TOUJOURS le coût d'achat du site (PMP FIFO du jour de
-- l'envoi), figé à l'envoi : c'est la refacturation.
--
-- stock_transfers.status : draft (on compose, rien ne bouge) → sent (le stock
-- est sorti, la commande attend sa réception) | cancelled (brouillon abandonné).
-- La réception se lit sur la commande créée, jamais recopiée ici.
--
-- stock_transfer_items.out_status = la sortie du stock d'origine, en file :
--   NULL (brouillon) → queued → sending (posé AVANT l'appel) → sent | error
--   (« VÉRIFIEZ » dans le message quand la réponse était incertaine).
--
-- À appliquer AVANT le code :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_stock_transfers.sql
-- ============================================================================

ALTER TABLE boutique_orders DROP CONSTRAINT IF EXISTS boutique_orders_source_check;
ALTER TABLE boutique_orders ADD CONSTRAINT boutique_orders_source_check
  CHECK (source IN ('besoins', 'import', 'manuelle', 'transfert'));

CREATE TABLE IF NOT EXISTS stock_transfers (
  id                SERIAL PRIMARY KEY,
  direction         TEXT NOT NULL CHECK (direction IN ('site_to_shop', 'shop_to_site')),
  warehouse_id      INTEGER NOT NULL CHECK (warehouse_id IN (1, 2)),
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'cancelled')),
  note              TEXT,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sent_at           TIMESTAMPTZ,
  -- Commande de destination : boutique (site_to_shop) ou achat BMS (shop_to_site)
  boutique_order_id INTEGER REFERENCES boutique_orders(id) ON DELETE SET NULL,
  purchase_order_id INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL,
  order_status      TEXT CHECK (order_status IN ('pending', 'created', 'error')),
  order_error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_list ON stock_transfers (status, created_at DESC);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id              SERIAL PRIMARY KEY,
  transfer_id     INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id      INTEGER NOT NULL REFERENCES products(id),
  sku             TEXT,
  name            TEXT,
  nx_product_id   TEXT,
  -- Articles du site et pièces boutique : différents pour les résistances
  -- vendues en « Pack N » au site et à l'unité en boutique.
  qty_site        INTEGER NOT NULL CHECK (qty_site > 0),
  qty_shop        INTEGER NOT NULL CHECK (qty_shop > 0),
  unit_cost_ht    NUMERIC,            -- coût d'un article DU SITE, figé à l'envoi
  out_status      TEXT CHECK (out_status IN ('queued', 'sending', 'sent', 'error')),
  out_ref         TEXT,
  out_error       TEXT,
  out_at          TIMESTAMPTZ,
  out_stock_before NUMERIC,           -- stock Nextore relu avant la sortie (shop_to_site)
  UNIQUE (transfer_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_out
  ON stock_transfer_items (out_status) WHERE out_status IN ('queued', 'sending');
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_product ON stock_transfer_items (product_id);
