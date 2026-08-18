-- ============================================================================
-- Boutiques Nextore — Historique de ventes (base de la prévision d'achat)
-- ============================================================================
-- Source : endpoint /sale_items (porte warehouse_id, product_id, quantity, date
-- + prix/coût/paiement). Filtre par date fiable. Sert au calcul de vélocité
-- (Module 2 - besoins), au CA par boutique (Coffre) et aux stats boutique.
--
-- Idempotence : l'import se fait par fenêtre de dates (delete + insert), donc
-- réimporter une plage ne crée pas de doublon.
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_nextore_sales.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS nextore_sales (
  id              BIGSERIAL PRIMARY KEY,
  sale_id         TEXT,
  sale_reference  TEXT,
  warehouse_id    INTEGER,
  product_id      TEXT,
  product_name    TEXT,
  quantity        NUMERIC,          -- peut être négatif (retour)
  unit_price      NUMERIC,
  real_unit_price NUMERIC,
  unit_cost       NUMERIC,
  tax_rate        NUMERIC,          -- ici = le taux (ex 20.00), pas l'id
  item_discount   NUMERIC,
  payments        TEXT,             -- mode(s) de paiement
  biller_id       TEXT,
  biller_name     TEXT,             -- vendeur
  customer_id     TEXT,
  sold_at         TIMESTAMP         -- heure Paris locale (comme WooCommerce)
);

-- Vélocité : somme des quantités par produit/boutique sur une fenêtre
CREATE INDEX IF NOT EXISTS idx_nextore_sales_velocity
  ON nextore_sales (warehouse_id, product_id, sold_at);
-- Purge/réimport par fenêtre de dates
CREATE INDEX IF NOT EXISTS idx_nextore_sales_date
  ON nextore_sales (sold_at);

INSERT INTO app_config (config_key, config_value, updated_at)
VALUES ('nextore_last_sales_sync_at', '', NOW())
ON CONFLICT (config_key) DO NOTHING;
