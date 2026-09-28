-- App PICKING — lot 1 : liste des commandes à préparer et vagues de picking.
--
-- Jusqu'ici les vagues étaient faites dans BMS (règles « transporteur × nombre
-- de commandes »). L'app les reprend : elle lit les commandes à expédier dans
-- BMS, calcule leur disponibilité en stock, et les regroupe en vagues.
--
-- Cinq objets :
--   * picking_bms_orders / picking_bms_lines — la PHOTO des commandes BMS en
--     `processing` et de leurs quantités à expédier, écrasée à chaque
--     actualisation (toutes les 5 min + bouton). Pourquoi BMS et pas le statut
--     WooCommerce : WC est en retard sur BMS (de quelques minutes à jamais —
--     les Bpost expédiées dans BMS restent `wc-processing`, ex. 1263515).
--   * picking_blocks — les commandes bloquées À LA MAIN (motif obligatoire).
--   * picking_wave_rules — les règles de génération (modes de livraison ×
--     taille maximale × préfixe, dans un ordre de passage).
--   * picking_waves / picking_wave_orders — les vagues et leurs commandes.
--     L'index unique partiel sur picking_wave_orders garantit qu'une commande
--     n'est jamais dans deux vagues ouvertes : c'est la base qui l'interdit,
--     pas le code.
--
-- Idempotente : relançable sans dégât.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
-- La migration passe AVANT le rebuild. Le code en service n'utilise aucune de
-- ces tables : rien ne change pour le packing ni pour BMS.
--
--   1. pg_dump de sauvegarde
--   2. git pull                                        (sur le VPS)
--   3. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_picking.sql
--   4. docker compose up --build -d backend frontend
--
-- Retour arrière : rollback_picking.sql (les vagues créées sont perdues ; rien
-- n'a été écrit dans BMS au lot 1).

BEGIN;

-- ── Photo BMS ───────────────────────────────────────────────────────────────
-- order_number = référence BMS = wp_order_id WooCommerce (texte, comme
-- shipment_labels.order_number).
CREATE TABLE IF NOT EXISTS picking_bms_orders (
  order_number     VARCHAR(20)  PRIMARY KEY,
  bms_order_id     INTEGER,
  bms_status       VARCHAR(20)  NOT NULL,
  bms_created_at   TIMESTAMP,
  bms_wave_id      INTEGER,
  shipping_method  VARCHAR(255),
  ship_name        VARCHAR(255),
  ship_country     VARCHAR(2)
);

COMMENT ON TABLE picking_bms_orders IS
  'Photo des commandes BMS ayant encore au moins une ligne à expédier. Écrasée à chaque actualisation du Picking.';
COMMENT ON COLUMN picking_bms_orders.bms_status IS
  'processing = listée dans le Picking. holded = en attente dans BMS : non listée, mais sa réservation compte dans le stock physique.';
COMMENT ON COLUMN picking_bms_orders.bms_wave_id IS
  'batch_id de la vague BMS (in-progress « new ») qui porte déjà la commande. Non NULL = préparée par BMS : ni sélectionnable, ni prise par les règles.';

CREATE TABLE IF NOT EXISTS picking_bms_lines (
  order_number  VARCHAR(20)  NOT NULL REFERENCES picking_bms_orders(order_number) ON DELETE CASCADE,
  sku           VARCHAR(100) NOT NULL,
  product_name  VARCHAR(255),
  qty_to_ship   INTEGER      NOT NULL,
  qty_reserved  INTEGER      NOT NULL DEFAULT 0,
  PRIMARY KEY (order_number, sku)
);

COMMENT ON TABLE picking_bms_lines IS
  'Lignes à expédier de la photo BMS (qty_to_ship > 0). Les packs woosb n''y figurent pas : BMS les classe « virtual », à 0 à expédier ; seuls leurs composants comptent.';
COMMENT ON COLUMN picking_bms_lines.qty_reserved IS
  'Quantité réservée par BMS. Sert UNIQUEMENT à reconstituer le stock physique de transition (disponible + réservé) ; la répartition entre commandes est la nôtre.';

-- ── Blocages manuels ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS picking_blocks (
  order_number  VARCHAR(20)  PRIMARY KEY,
  reason        TEXT         NOT NULL,
  blocked_by    INTEGER      REFERENCES users(id),
  blocked_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE picking_blocks IS
  'Commandes bloquées à la main dans le Picking (onglet « Bloquée »). Le blocage est toujours manuel ; un problème d''adresse ou de point relais est un tag, pas un blocage.';

-- ── Règles de génération ────────────────────────────────────────────────────
-- denominations : les `orders.shipping_method` concernés, tels que dans
-- shipping_method_carrier_map. Le niveau « mode de livraison » plutôt que
-- « code transporteur » parce que 2Shop est rangé sous chronopost et Bpost
-- sous colissimo.
CREATE TABLE IF NOT EXISTS picking_wave_rules (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(100) NOT NULL,
  denominations  TEXT[]       NOT NULL DEFAULT '{}',
  max_orders     INTEGER      NOT NULL CHECK (max_orders > 0),
  prefix         VARCHAR(10)  NOT NULL,
  priority       INTEGER      NOT NULL DEFAULT 0,
  active         BOOLEAN      NOT NULL DEFAULT true,
  created_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP    NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE picking_wave_rules IS
  'Règles de génération des vagues : appliquées par priorité croissante, sur les seules commandes « En cours » libres, les plus anciennement payées d''abord.';

-- ── Vagues ──────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS picking_wave_seq;

CREATE TABLE IF NOT EXISTS picking_waves (
  id            SERIAL PRIMARY KEY,
  wave_number   VARCHAR(30)  NOT NULL UNIQUE,
  rule_id       INTEGER      REFERENCES picking_wave_rules(id) ON DELETE SET NULL,
  status        VARCHAR(20)  NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'picking', 'picked', 'closed', 'cancelled')),
  created_by    INTEGER      REFERENCES users(id),
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  cancelled_by  INTEGER      REFERENCES users(id),
  cancelled_at  TIMESTAMP
);

COMMENT ON COLUMN picking_waves.wave_number IS
  'Préfixe de la règle (ou préfixe manuel) + compteur global picking_wave_seq, ex. MR-000123.';
COMMENT ON COLUMN picking_waves.rule_id IS
  'Règle qui a produit la vague ; NULL = vague créée à la main.';

CREATE TABLE IF NOT EXISTS picking_wave_orders (
  wave_id       INTEGER      NOT NULL REFERENCES picking_waves(id) ON DELETE CASCADE,
  order_number  VARCHAR(20)  NOT NULL,
  position      INTEGER      NOT NULL,
  active        BOOLEAN      NOT NULL DEFAULT true,
  PRIMARY KEY (wave_id, order_number)
);

COMMENT ON COLUMN picking_wave_orders.active IS
  'false quand la vague est annulée (ou close) : la commande redevient libre. L''index unique partiel ne porte que sur les lignes actives.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_picking_wave_orders_active
  ON picking_wave_orders(order_number) WHERE active;

CREATE INDEX IF NOT EXISTS idx_picking_waves_status
  ON picking_waves(status, created_at DESC);

-- Préfixe des vagues manuelles, réglable dans l'écran des règles.
INSERT INTO app_config (config_key, config_value)
VALUES ('picking_manual_prefix', 'MAN')
ON CONFLICT (config_key) DO NOTHING;

COMMIT;
