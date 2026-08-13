-- App « Actions Promos » : préparation d'opérations promotionnelles.
-- Purement préparatoire : AUCUN prix n'est poussé vers WooCommerce, ces tables
-- servent à simuler des remises, calculer les marges et mesurer l'effet a posteriori.

CREATE TABLE IF NOT EXISTS promo_operations (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT,
  -- draft = brouillon, planned = validée à venir, running = en cours,
  -- done = terminée (analysable), archived = archivée
  status           TEXT NOT NULL DEFAULT 'draft',
  start_date       DATE,
  end_date         DATE,
  -- Taux de TVA utilisé pour repasser les prix TTC en HT (marges).
  vat_rate         NUMERIC(5,2) NOT NULL DEFAULT 20.00,
  -- Base de calcul de la remise : 'discounted' = tarif remisé en cours (Woo
  -- Discount Rules) quand il existe, sinon le prix de vente ; 'price' = prix de
  -- vente public, en ignorant la remise déjà active.
  base_price_mode  TEXT NOT NULL DEFAULT 'discounted',
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS promo_operation_items (
  id                    SERIAL PRIMARY KEY,
  operation_id          INTEGER NOT NULL REFERENCES promo_operations(id) ON DELETE CASCADE,
  -- wp_product_id de l'unité vendable (produit simple, variation ou bundle woosb)
  wp_product_id         BIGINT NOT NULL,
  product_id            INTEGER REFERENCES products(id) ON DELETE SET NULL,
  sku                   TEXT,
  product_name          TEXT,
  -- Remise simulée. promo_price (TTC) prime sur discount_percent quand renseigné.
  discount_percent      NUMERIC(5,2) NOT NULL DEFAULT 0,
  promo_price           NUMERIC(10,2),
  note                  TEXT,
  position              INTEGER NOT NULL DEFAULT 0,
  -- Photo des valeurs au moment de l'ajout (traçabilité : les valeurs affichées
  -- dans l'app sont toujours les valeurs LIVE de la table products).
  snap_price            NUMERIC(10,2),
  snap_regular_price    NUMERIC(10,2),
  snap_discounted_price NUMERIC(10,2),
  snap_cost             NUMERIC(10,4),
  snap_stock            INTEGER,
  snapshot_at           TIMESTAMP,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT promo_operation_items_unique UNIQUE (operation_id, wp_product_id)
);

CREATE INDEX IF NOT EXISTS idx_promo_items_operation ON promo_operation_items(operation_id);
CREATE INDEX IF NOT EXISTS idx_promo_items_wp_product ON promo_operation_items(wp_product_id);
CREATE INDEX IF NOT EXISTS idx_promo_operations_status ON promo_operations(status);

-- 2026-08-13 : la remise s'applique par défaut au tarif REMISÉ (attendu métier :
-- « -30 % » se lit à partir du tarif déjà affiché au client, pas du prix public).
ALTER TABLE promo_operations ALTER COLUMN base_price_mode SET DEFAULT 'discounted';
