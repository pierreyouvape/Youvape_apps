-- Lot 0 du chantier expédition multi-transporteurs : sortir l'étiquetage du
-- cas particulier La Poste.
--
-- Deux tables remplacent l'existant :
--   * carrier_accounts  — un contrat transporteur (identifiants + réglages),
--     à la place des clés `laposte_*` éparpillées dans app_config. C'est une
--     TABLE et pas des clés à plat parce que Chronopost arrivera avec deux
--     contrats distincts à router sur le mode de livraison (lot 3) : une clé
--     `chronopost_contract_number` n'aurait pas su en porter deux.
--   * shipment_labels   — les étiquettes émises, tous transporteurs confondus,
--     à la place de laposte_labels.
--
-- Idempotente : relançable sans dégât. laposte_labels n'est ni vidée ni
-- supprimée — elle reste la photo d'avant-bascule le temps que la lettre suivie
-- soit validée sur le nouveau chemin.
--
-- ── PROCÉDURE — l'ordre n'est pas négociable ────────────────────────────────
-- Le packing envoie des lettres suivies toute la journée et n'a pas de solution
-- de secours. La migration passe AVANT le rebuild : dans ce sens, l'ancien code
-- continue de tourner sur laposte_labels sans rien voir. Dans l'autre, le
-- nouveau code refuse d'acheter une étiquette qu'il ne saurait pas enregistrer,
-- et l'expédition s'arrête jusqu'à ce que la migration passe.
--
--   1. git pull                                        (sur le VPS)
--   2. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_shipment_labels.sql
--   3. Contrôle go / no-go. Le script arrive avec le pull mais PAS dans l'image
--      qui tourne encore : le faire tourner depuis les sources fraîches, sans
--      toucher au conteneur en service.
--        cd /home/ubuntu/Youvape_apps
--        tar czf /tmp/precheck.tgz -C backend src
--        docker cp /tmp/precheck.tgz youvape_backend:/tmp/
--        docker exec youvape_backend sh -c 'rm -rf /app/precheck /tmp/src && \
--          mkdir -p /app/precheck && tar xzf /tmp/precheck.tgz -C /tmp && \
--          cp -r /tmp/src/. /app/precheck/'
--        docker exec -w /app/precheck youvape_backend node scripts/checkShipmentSchema.js
--        docker exec youvape_backend sh -c 'rm -rf /app/precheck /tmp/src /tmp/precheck.tgz'
--      → doit afficher « Bascule possible » et sortir en 0. Sinon, NE PAS
--        continuer : à ce stade rien n'a changé pour le packing.
--   4. docker compose up --build -d backend
--   5. docker exec youvape_backend node src/scripts/checkShipmentSchema.js
--      (le script est dans l'image, cette fois), puis surveiller la première
--      étiquette réellement émise par l'équipe :
--        docker logs youvape_backend --since 10m | grep -E '\[LaPoste\]|\[BMS\]'
--
-- Retour arrière : passer rollback_shipment_labels.sql AVANT de revenir à la
-- version précédente du backend, sans quoi les étiquettes émises depuis la
-- bascule seraient invisibles à l'écran de réimpression.

BEGIN;

-- ── Contrats transporteurs ──────────────────────────────────────────────────
-- carrier_code reprend le vocabulaire de shipping_carriers (colissimo,
-- chronopost, mondial_relay, laposte) déjà utilisé par les tarifs et le
-- contrôle de factures : une seule orthographe pour tout le monde, garantie par
-- la clé étrangère. account_code désigne le contrat au sein du transporteur.
--
-- credentials et settings sont séparés pour une raison : les premiers sont des
-- secrets (ils ne doivent jamais partir vers le front ni dans un log), les
-- seconds sont de la configuration ordinaire, éditable un jour depuis les
-- réglages Livraison.
CREATE TABLE IF NOT EXISTS carrier_accounts (
  id            SERIAL PRIMARY KEY,
  carrier_code  VARCHAR(50)  NOT NULL REFERENCES shipping_carriers(code),
  account_code  VARCHAR(50)  NOT NULL,
  label         VARCHAR(150) NOT NULL,
  credentials   JSONB        NOT NULL DEFAULT '{}'::jsonb,
  settings      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  active        BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  UNIQUE (carrier_code, account_code)
);

COMMENT ON TABLE carrier_accounts IS
  'Contrats transporteurs : identifiants API et réglages d''expédition. Un transporteur peut en avoir plusieurs (Chronopost).';
COMMENT ON COLUMN carrier_accounts.credentials IS
  'Identifiants d''API. Seuls les champs marqués `secret` par l''adaptateur (accountFields) ne descendent jamais vers le navigateur : mot de passe, client_secret. Les identifiants non secrets (client_id, login, URL de jeton) restent lisibles dans les réglages, pour qu''un responsable puisse vérifier la configuration face au portail du transporteur.';
COMMENT ON COLUMN carrier_accounts.settings IS
  'Réglages non secrets : URL d''API, numéros de contrat, adresse expéditeur, codes offre/produit.';

-- ── Étiquettes émises ───────────────────────────────────────────────────────
-- order_number reste en varchar(20) : c'est la limite que le formulaire
-- d'expédition manuelle contrôle déjà côté serveur, la déplacer sans toucher au
-- contrôle ne ferait que déporter l'erreur.
--
-- carrier_order_id est nullable, à la différence de laposte_labels.laposte_order_id :
-- tous les transporteurs n'exposent pas d'identifiant de commande distinct du
-- numéro de suivi. Pour La Poste il reste toujours renseigné — c'est lui qui
-- permet l'annulation.
CREATE TABLE IF NOT EXISTS shipment_labels (
  id               SERIAL PRIMARY KEY,
  carrier_code     VARCHAR(50)  NOT NULL,
  account_code     VARCHAR(50)  NOT NULL,
  method_code      VARCHAR(50),
  order_number     VARCHAR(20)  NOT NULL,
  tracking_number  VARCHAR(64),
  carrier_order_id VARCHAR(100),
  status           VARCHAR(20)  NOT NULL DEFAULT 'active',
  weight_g         INTEGER,
  packed_by        INTEGER      REFERENCES users(id),
  pdf_data         TEXT,
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  cancelled_at     TIMESTAMP
);

COMMENT ON TABLE shipment_labels IS
  'Étiquettes d''expédition émises, tous transporteurs. Remplace laposte_labels (conservée en photo d''avant-bascule).';
COMMENT ON COLUMN shipment_labels.weight_g IS
  'Poids déclaré au transporteur, en grammes. Forfaitaire à 20 g pour la lettre suivie, poids réel (services/orderWeightService) ailleurs.';

CREATE INDEX IF NOT EXISTS idx_shipment_labels_order_number ON shipment_labels(order_number);
CREATE INDEX IF NOT EXISTS idx_shipment_labels_status       ON shipment_labels(status);
CREATE INDEX IF NOT EXISTS idx_shipment_labels_carrier      ON shipment_labels(carrier_code, account_code);
CREATE INDEX IF NOT EXISTS idx_shipment_labels_created_at   ON shipment_labels(created_at DESC);

-- ── Reprise du contrat La Poste depuis app_config ───────────────────────────
-- Les valeurs de repli reproduisent celles qui étaient codées en dur dans
-- laposteController : la ligne créée ici doit produire exactement la même
-- étiquette que la veille.
WITH cfg AS (
  SELECT
    MAX(config_value) FILTER (WHERE config_key = 'laposte_token_url')       AS token_url,
    MAX(config_value) FILTER (WHERE config_key = 'laposte_client_id')       AS client_id,
    MAX(config_value) FILTER (WHERE config_key = 'laposte_client_secret')   AS client_secret,
    MAX(config_value) FILTER (WHERE config_key = 'laposte_api_url')         AS api_url,
    MAX(config_value) FILTER (WHERE config_key = 'laposte_contract_number') AS contract_number,
    MAX(config_value) FILTER (WHERE config_key = 'laposte_cust_acc_number') AS cust_acc_number,
    MAX(config_value) FILTER (WHERE config_key = 'laposte_cust_invoice')    AS cust_invoice,
    MAX(config_value) FILTER (WHERE config_key = 'laposte_sender_email')    AS sender_email,
    MAX(config_value) FILTER (WHERE config_key = 'laposte_sender_phone')    AS sender_phone,
    MAX(config_value) FILTER (WHERE config_key = 'laposte_sender_name')     AS sender_name,
    MAX(config_value) FILTER (WHERE config_key = 'laposte_sender_address')  AS sender_address,
    MAX(config_value) FILTER (WHERE config_key = 'laposte_sender_zipcode')  AS sender_zipcode,
    MAX(config_value) FILTER (WHERE config_key = 'laposte_sender_town')     AS sender_town
  FROM app_config
)
INSERT INTO carrier_accounts (carrier_code, account_code, label, credentials, settings)
SELECT
  'laposte',
  'lettre_suivie',
  'La Poste — Lettre Suivie',
  jsonb_strip_nulls(jsonb_build_object(
    'token_url',     cfg.token_url,
    'client_id',     cfg.client_id,
    'client_secret', cfg.client_secret
  )),
  jsonb_strip_nulls(jsonb_build_object(
    'api_url',         cfg.api_url,
    'contract_number', cfg.contract_number,
    'cust_acc_number', cfg.cust_acc_number,
    'cust_invoice',    cfg.cust_invoice,
    'offer_code',      '3125',
    'product_code',    'K7',
    'visual_format',   'rollA',
    'country_code',    '250',
    'fixed_weight_g',  20,
    'sender', jsonb_build_object(
      'email',   COALESCE(cfg.sender_email,   'contact@youvape.fr'),
      'phone',   COALESCE(cfg.sender_phone,   '0499782453'),
      'name',    COALESCE(cfg.sender_name,    'SAS EMC'),
      'address', COALESCE(cfg.sender_address, '580 avenue de l aube rouge'),
      'zipcode', COALESCE(cfg.sender_zipcode, '34170'),
      'town',    COALESCE(cfg.sender_town,    'Castelnau le lez')
    )
  ))
FROM cfg
ON CONFLICT (carrier_code, account_code) DO NOTHING;

-- ── Reprise des étiquettes déjà émises ──────────────────────────────────────
-- Les id sont conservés : ils circulent dans les URL du front
-- (/laposte/labels/:id/pdf, /cancel). Un onglet resté ouvert pendant la bascule
-- continue de tomber sur la bonne étiquette.
INSERT INTO shipment_labels
  (id, carrier_code, account_code, method_code, order_number, tracking_number,
   carrier_order_id, status, weight_g, packed_by, pdf_data, created_at, cancelled_at)
SELECT
  l.id, 'laposte', 'lettre_suivie', 'lettre_suivie', l.order_number, l.tracking_id,
  l.laposte_order_id, l.status, 20, l.packed_by, l.pdf_data, l.created_at, l.cancelled_at
FROM laposte_labels l
ON CONFLICT (id) DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('shipment_labels', 'id'),
  GREATEST(COALESCE((SELECT MAX(id) FROM shipment_labels), 0), 1),
  (SELECT MAX(id) IS NOT NULL FROM shipment_labels)
);

COMMIT;
