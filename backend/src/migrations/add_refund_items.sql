-- Lignes des remboursements WooCommerce (articles, port, frais).
--
-- La table `refunds` ne garde que les totaux : yousync n'envoie ni les articles
-- ni leurs quantités. La fiche commande les demandait donc à l'API WC à chaque
-- affichage, et le picking comme le packing les ignoraient — un article
-- remboursé avant l'expédition était prélevé et emballé (commande 1268681).
--
-- Désormais le backend interroge WC UNE fois par commande, à l'arrivée du
-- remboursement (refundLinesService.syncOrder), et range les lignes ici. Fiche
-- commande, picking et packing lisent la même chose.
--
--   * refund_items.refunded_item_id — la ligne de la commande d'origine
--     (= order_items.order_item_id), relevée par WC dans la meta
--     `_refunded_item_id`. C'est elle qu'on déduit, pas le produit.
--   * refunds.lines_synced_at — NULL tant que les lignes n'ont pas été lues
--     chez WC (échec réseau à l'arrivée) : un cron reprend ces remboursements.
--
-- Pas de clé étrangère vers `refunds` : les lignes sont remplacées commande par
-- commande depuis la liste complète de WC, qui fait foi (un remboursement
-- supprimé dans WC disparaît au passage suivant).
--
-- Idempotente : relançable sans dégât.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
-- La migration passe AVANT le rebuild (le code lit refund_items).
--   docker compose exec -T postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_refund_items.sql
-- puis, après le rebuild, le rattrapage des remboursements des 60 derniers jours :
--   docker compose exec backend node src/scripts/backfillRefundItems.js --apply

CREATE TABLE IF NOT EXISTS refund_items (
  id               SERIAL PRIMARY KEY,
  wp_refund_id     INTEGER NOT NULL,
  wp_order_id      INTEGER NOT NULL,
  item_type        TEXT NOT NULL CHECK (item_type IN ('line_item', 'shipping', 'fee')),
  refunded_item_id INTEGER,
  product_id       INTEGER,
  variation_id     INTEGER,
  sku              TEXT,
  name             TEXT,
  quantity         INTEGER NOT NULL DEFAULT 0,
  total            NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_tax        NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_refund_items_wp_order_id ON refund_items (wp_order_id);
CREATE INDEX IF NOT EXISTS idx_refund_items_wp_refund_id ON refund_items (wp_refund_id);

COMMENT ON TABLE refund_items IS
  'Lignes des remboursements WC (articles, port, frais), lues une fois par commande via l''API WC — cf. refundLinesService.';
COMMENT ON COLUMN refund_items.refunded_item_id IS
  'order_items.order_item_id de la ligne remboursée (meta WC _refunded_item_id).';
COMMENT ON COLUMN refund_items.quantity IS
  'Quantité remboursée, positive (WC la stocke en négatif).';

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS lines_synced_at TIMESTAMP;
COMMENT ON COLUMN refunds.lines_synced_at IS
  'Date à laquelle les lignes de ce remboursement ont été lues chez WC (refund_items). NULL = à reprendre.';
