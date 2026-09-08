-- Correspondance dénomination WooCommerce → transporteur, pour l'étiquetage.
--
-- Pourquoi une table et pas une déduction : les deux champs sur lesquels on
-- pourrait deviner mentent déjà.
--   * `orders.relay_point->>'service'` est renseigné par yousync et se trompe :
--     256 commandes portent le réseau `mondial_relay` alors que leur libellé
--     WooCommerce dit « Bpost Relais ». S'y fier enverrait des colis Bpost chez
--     Mondial Relay.
--   * le libellé lui-même bouge : « Mondial Relay 3 à 6 jours ouvrés » a été
--     remplacé le 03/09/2026 par « Point Relais » et « Lockers ».
--
-- D'où le principe : on ne devine pas. Une dénomination connue est mappée par un
-- responsable dans les réglages ; une dénomination inconnue **bloque le packing**
-- avec un message explicite. C'est un refus, pas un pari.
--
-- Trois cas, distingués par carrier_code :
--   * un transporteur ('laposte', 'mondial_relay')  → étiquette par son API
--   * 'interne'                                     → étiquette fabriquée par nous
--                                                     (retrait magasin : nom, prénom, n° de commande)
--   * NULL                                          → PAS d'étiquette, volontairement.
--     Indispensable : sans ce cas, l'alerte se déclencherait tous les jours sur des
--     modes qui n'ont rien à imprimer, et les préparateurs apprendraient à l'ignorer.
--
-- L'ABSENCE de ligne veut dire « inconnu » et déclenche l'alerte. Une ligne avec
-- carrier_code NULL veut dire « connu, et sans étiquette » : silence assumé.

BEGIN;

CREATE TABLE IF NOT EXISTS shipping_method_carrier_map (
  id            SERIAL PRIMARY KEY,
  denomination  VARCHAR(255) NOT NULL UNIQUE,
  carrier_code  VARCHAR(50),
  account_code  VARCHAR(50),
  delivery_mode VARCHAR(10),
  note          TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  -- Un transporteur exige un contrat ; « pas d'étiquette » n'en veut aucun.
  CONSTRAINT shipping_method_carrier_map_coherence CHECK (
    (carrier_code IS NULL     AND account_code IS NULL)
    OR (carrier_code IS NOT NULL AND account_code IS NOT NULL)
  )
);

COMMENT ON TABLE shipping_method_carrier_map IS
  'Dénomination WooCommerce (orders.shipping_method) → transporteur d''étiquetage. Absence de ligne = inconnu, bloque le packing.';
COMMENT ON COLUMN shipping_method_carrier_map.denomination IS
  'Valeur EXACTE de orders.shipping_method, telle que WooCommerce l''écrit.';
COMMENT ON COLUMN shipping_method_carrier_map.carrier_code IS
  'Code de l''adaptateur (services/carriers). NULL = mode sans étiquette, volontairement.';
COMMENT ON COLUMN shipping_method_carrier_map.delivery_mode IS
  'Produit du transporteur. Mondial Relay : 24R pour les points relais ET les consignes.';

CREATE INDEX IF NOT EXISTS idx_shipping_method_map_active
  ON shipping_method_carrier_map(active) WHERE active;

-- ── Amorçage ────────────────────────────────────────────────────────────────
-- Seules les dénominations dont le transporteur est certain. Tout le reste est
-- laissé absent : Colissimo, Chronopost et 2Shop n'ont pas encore d'adaptateur
-- (lots 2 et 3), ils doivent continuer de bloquer — c'est déjà ce que fait le
-- packing aujourd'hui, qui refuse tout sauf « Lettre Suivie ».
--
-- ⚠️ Les lignes Mondial Relay sont amorcées INACTIVES et sur le contrat sandbox.
-- Inactives, elles se comportent comme absentes : le packing continue de bloquer.
-- Les activer est une décision explicite, à prendre après validation, en même
-- temps que le passage sur le contrat de production.
INSERT INTO shipping_method_carrier_map
  (denomination, carrier_code, account_code, delivery_mode, active, note)
VALUES
  ('Lettre Suivie', 'laposte', 'lettre_suivie', NULL, true,
   'Poids forfaitaire de 20 g, propre à l''offre.'),

  ('Mondial Relay - Point Relais',     'mondial_relay', 'sandbox', '24R', false,
   'Activer après validation, et basculer account_code sur le contrat de production.'),
  ('Mondial Relay - Lockers',          'mondial_relay', 'sandbox', '24R', false,
   'Consigne : 24R aussi. 24L est une variante de TAILLE (Point Relais XL), pas le mode locker.'),
  ('Mondial Relay 3 à 6 jours ouvrés', 'mondial_relay', 'sandbox', '24R', false,
   'Ancien libellé, remplacé le 03/09/2026. Conservé pour les commandes antérieures.'),
  ('Mondial Relay',                    'mondial_relay', 'sandbox', '24R', false,
   'Libellé résiduel, 3 commandes.'),

  ('Retrait Magasin Castelnau le Lez 30 min.', 'interne', 'retrait_magasin', NULL, true,
   'Étiquette fabriquée en interne : nom, prénom, n° de commande.'),
  ('Retrait Magasin Castelnau-le-Lez',         'interne', 'retrait_magasin', NULL, true,
   'Étiquette fabriquée en interne : nom, prénom, n° de commande.')
ON CONFLICT (denomination) DO NOTHING;

COMMIT;
