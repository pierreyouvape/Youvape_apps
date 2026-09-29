-- Une réception devient une SESSION reprenable, puis validée vers BMS.
--
-- Deux manques que cette migration comble.
--
-- 1. LE COMPTAGE NE SURVIVAIT À RIEN. Il vivait dans l'état React de l'écran :
--    une tablette qui se verrouille, un navigateur qui recharge, et le comptage
--    d'une commande LCA de 1 159 articles repartait de zéro. Personne n'ose
--    compter mille articles dans ces conditions.
--
-- 2. BMS EXIGE L'IDENTIFIANT DE SA PROPRE LIGNE pour enregistrer une réception
--    (POST /v2/purchase-orders/{id}/receive, vérifié le 29/09/2026), et nous ne
--    le stockions nulle part. On le capture à l'ouverture de la session, en même
--    temps que le conditionnement de la ligne : les deux servent à convertir ce
--    que l'opérateur compte en ce que BMS attend.

CREATE TABLE IF NOT EXISTS reception_sessions (
  id                SERIAL PRIMARY KEY,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  -- counting : en cours ; validated : envoyée à BMS ; abandoned : reprise à zéro.
  status            VARCHAR(20) NOT NULL DEFAULT 'counting',
  started_by        INTEGER REFERENCES users(id),
  started_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  validated_by      INTEGER REFERENCES users(id),
  validated_at      TIMESTAMP,
  -- La réponse de BMS, gardée telle quelle : une réception ne s'annule par
  -- aucune route, donc la trace de ce qui est parti est la seule preuve.
  bms_response      JSONB,
  notes             TEXT,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT reception_sessions_status_check
    CHECK (status IN ('counting', 'validated', 'abandoned'))
);

-- Une seule session EN COURS par commande : deux magasiniers sur le même bon
-- compteraient l'un contre l'autre.
CREATE UNIQUE INDEX IF NOT EXISTS reception_sessions_one_open
  ON reception_sessions (purchase_order_id) WHERE status = 'counting';

CREATE INDEX IF NOT EXISTS idx_reception_sessions_order
  ON reception_sessions (purchase_order_id);

CREATE TABLE IF NOT EXISTS reception_counts (
  id                     SERIAL PRIMARY KEY,
  session_id             INTEGER NOT NULL REFERENCES reception_sessions(id) ON DELETE CASCADE,
  purchase_order_item_id INTEGER NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
  -- L'identifiant de la ligne CHEZ BMS, relevé à l'ouverture de la session.
  bms_line_id            BIGINT,
  -- TOUJOURS EN PIÈCES, jamais en packs. BMS ajoute au stock le nombre qu'on lui
  -- envoie, littéralement : sur une ligne « 1 pack de 5 », envoyer 1 met UNE
  -- pièce en stock tout en soldant la ligne et en passant le bon en « complete »
  -- (constaté le 29/09/2026). C'est le piège du dispositif : on ne compte et on
  -- n'envoie que des pièces.
  units_counted          INTEGER NOT NULL DEFAULT 0,
  -- Ce qui est réellement parti dans BMS, figé à la validation.
  units_sent             INTEGER,
  updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT reception_counts_units_positive CHECK (units_counted >= 0),
  CONSTRAINT reception_counts_unique UNIQUE (session_id, purchase_order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_reception_counts_session
  ON reception_counts (session_id);

COMMENT ON TABLE reception_sessions IS
  'Une réception en cours ou validée. Reprenable tant que status = counting.';
COMMENT ON COLUMN reception_counts.units_counted IS
  'Nombre de PIÈCES comptées, jamais de packs — BMS ajoute au stock le nombre envoyé, littéralement.';
