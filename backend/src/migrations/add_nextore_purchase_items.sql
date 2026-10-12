-- ============================================================================
-- Boutiques Nextore — Historique des ACHATS (association produit → fournisseur)
-- ============================================================================
-- Source : endpoint /purchase_items, NON documenté par Nextore (trouvé le
-- 12/10/2026). ⚠️ Sans `status=received` il ne renvoie que les achats en
-- attente ; avec, + start_date/end_date, tout l'historique (depuis 10/2023).
--
-- Les supplier1..5 des fiches Nextore sont mal tenus : le fournisseur d'un
-- produit est désormais celui de son dernier achat REÇU (cf. getNeedsData).
-- Les achats EN ATTENTE (status = 'pending') donnent la colonne « En commande »
-- des Besoins, déduite des propositions.
--
-- Idempotence : reçus par fenêtre de dates (delete + insert), en attente
-- remplacés en bloc à chaque synchro.
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_nextore_purchase_items.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS nextore_purchase_items (
  id                 BIGSERIAL PRIMARY KEY,
  purchase_id        TEXT,
  purchase_reference TEXT,
  warehouse_id       INTEGER,
  supplier_id        TEXT,
  supplier_name      TEXT,
  product_id         TEXT,
  product_name       TEXT,
  unit_cost          NUMERIC,
  quantity_ordered   NUMERIC,
  quantity_received  NUMERIC,
  purchased_at       TIMESTAMP,        -- heure Paris locale
  status             TEXT NOT NULL DEFAULT 'received'   -- 'received' | 'pending'
);

-- Dernier achat d'un produit par boutique
CREATE INDEX IF NOT EXISTS idx_nextore_purchase_items_product
  ON nextore_purchase_items (product_id, warehouse_id, purchased_at);
-- Purge/réimport par fenêtre de dates
CREATE INDEX IF NOT EXISTS idx_nextore_purchase_items_date
  ON nextore_purchase_items (purchased_at);

INSERT INTO app_config (config_key, config_value, updated_at)
VALUES ('nextore_last_purchases_sync_at', '', NOW())
ON CONFLICT (config_key) DO NOTHING;
