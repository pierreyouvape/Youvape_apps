-- ============================================================================
-- Boutiques — PDA › Produit : mouvements de stock Nextore (26/11/2026)
-- ============================================================================
-- Un mouvement passé depuis le PDA d'une boutique (« Ajustement » entrée ou
-- sortie, « Défectueux » sortie), envoyé à Nextore en DELTA (PUT /stocks).
-- Une ligne par mouvement : qui, quand, pourquoi, le stock relu avant, et
-- l'issue de l'envoi.
--   status : sending (posé AVANT l'appel) → sent | error (rien n'est passé,
--            relu dans Nextore) | uncertain (stock relu ni avant ni après :
--            VÉRIFIEZ dans Nextore, ne jamais renvoyer seul)
--
-- À appliquer AVANT le code :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_boutique_stock_moves.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS boutique_stock_moves (
  id            SERIAL PRIMARY KEY,
  warehouse_id  INTEGER NOT NULL,
  product_id    TEXT NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('ajustement', 'defectueux')),
  delta         INTEGER NOT NULL CHECK (delta <> 0),
  comment       TEXT,
  stock_before  NUMERIC,
  stock_after   NUMERIC,
  status        TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'error', 'uncertain')),
  error         TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_boutique_stock_moves_product
  ON boutique_stock_moves (warehouse_id, product_id, created_at DESC);
