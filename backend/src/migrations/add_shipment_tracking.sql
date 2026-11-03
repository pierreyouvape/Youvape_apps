-- Suivi des colis par les API des transporteurs (03/11/2026).
--
-- Remplacera, à la sortie de BMS, le plugin Vikings qui passe les commandes en
-- « Livrée ». Ce lot ne fait que SUIVRE : il n'écrit rien sur le site.
--
-- Trois sources : API Suivi de La Poste (Colissimo, Lettre suivie), API
-- Chronopost (Chronopost, 2Shop), WSI2 Mondial Relay. Chaque évènement reçu est
-- journalisé ; son code (ou son libellé, Mondial Relay n'ayant pas de code) est
-- traduit en un état commun par `tracking_status_map`, réglable dans
-- /packing/settings. Un code jamais vu s'ajoute sans état (« à classer ») et ne
-- change rien.
--
-- Idempotente : relançable sans dégât.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
--   1. pg_dump de sauvegarde
--   2. git pull                                        (sur le VPS)
--   3. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_shipment_tracking.sql
--   4. docker compose up --build -d backend frontend
--
-- Retour arrière : rollback_shipment_tracking.sql

BEGIN;

-- État courant d'un colis, recalculé depuis son journal à chaque passage.
ALTER TABLE shipment_labels
  ADD COLUMN IF NOT EXISTS tracking_state          VARCHAR(30),
  ADD COLUMN IF NOT EXISTS tracking_state_at       TIMESTAMPTZ,  -- date de l'évènement qui a donné l'état
  ADD COLUMN IF NOT EXISTS tracking_last_event_at  TIMESTAMPTZ,  -- dernier évènement, quel qu'il soit
  ADD COLUMN IF NOT EXISTS tracking_last_label     TEXT,
  ADD COLUMN IF NOT EXISTS tracking_delivered_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tracking_checked_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tracking_next_check_at  TIMESTAMPTZ,  -- NULL = à interroger dès que possible
  ADD COLUMN IF NOT EXISTS tracking_error          TEXT;

CREATE INDEX IF NOT EXISTS idx_shipment_labels_tracking_state
  ON shipment_labels (tracking_state);
CREATE INDEX IF NOT EXISTS idx_shipment_labels_tracking_due
  ON shipment_labels (tracking_next_check_at NULLS FIRST)
  WHERE status = 'active' AND tracking_number IS NOT NULL;

-- Le journal : un évènement transporteur par ligne. L'API renvoie tout
-- l'historique à chaque appel ; l'unicité évite de le réinsérer.
CREATE TABLE IF NOT EXISTS shipment_tracking_events (
  id           SERIAL PRIMARY KEY,
  label_id     INTEGER NOT NULL REFERENCES shipment_labels(id) ON DELETE CASCADE,
  source       VARCHAR(20) NOT NULL,    -- laposte | chronopost | mondial_relay
  event_key    VARCHAR(120) NOT NULL,   -- code (DI1, D…) ou libellé Mondial Relay
  label        TEXT,
  location     TEXT,
  detail       TEXT,
  occurred_at  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (label_id, occurred_at, event_key)
);
CREATE INDEX IF NOT EXISTS idx_shipment_tracking_events_label
  ON shipment_tracking_events (label_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_shipment_tracking_events_key
  ON shipment_tracking_events (source, event_key);

-- Correspondance code transporteur → état commun. state NULL = à classer.
-- Le nombre de fois qu'un code a été vu se compte dans le journal.
CREATE TABLE IF NOT EXISTS tracking_status_map (
  source         VARCHAR(20) NOT NULL,
  event_key      VARCHAR(120) NOT NULL,
  example_label  TEXT,
  state          VARCHAR(30),
  first_seen_at  TIMESTAMPTZ,
  last_seen_at   TIMESTAMPTZ,
  updated_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ,
  PRIMARY KEY (source, event_key)
);

-- Pré-remplissage : codes et libellés relevés les 02 et 03/11/2026 sur ~560
-- colis réels. Un réglage déjà modifié n'est pas écrasé.
INSERT INTO tracking_status_map (source, event_key, example_label, state) VALUES
  ('laposte', 'DR1', 'Votre Colissimo va bientôt nous être confié !', 'label_created'),
  ('laposte', 'PC1', 'Votre envoi est trié sur sa plateforme de départ.', 'picked_up'),
  ('laposte', 'ET1', 'Votre colis est en transit sur nos plateformes logistiques.', 'in_transit'),
  ('laposte', 'ET2', 'Votre colis est prêt à partir de son territoire d''expédition.', 'in_transit'),
  ('laposte', 'ET3', 'Votre colis poursuit son acheminement sur son territoire de destination.', 'in_transit'),
  ('laposte', 'EP1', 'Votre colis est en cours de traitement sur le site de tri local.', 'in_transit'),
  ('laposte', 'MD1', 'Votre colis est sur son site de distribution.', 'out_for_delivery'),
  ('laposte', 'MD2', 'Instruction de livraison reçue', 'out_for_delivery'),
  ('laposte', 'MD3', 'Nous sommes passés mais nous n''avons pu vous remettre votre colis.', 'delivery_failed'),
  ('laposte', 'PB1', 'L''adresse de livraison est incomplète…', 'incident'),
  ('laposte', 'AG1', 'Votre Colissimo vous attend dans votre point de retrait.', 'at_pickup_point'),
  ('laposte', 'DI1', 'Votre colis est livré.', 'delivered'),
  ('laposte', 'DI2', 'Votre envoi a été distribué à son expéditeur suite à un retour.', 'returned'),
  ('laposte', 'RE1', 'Votre colis va être retourné à l''expéditeur.', 'returning'),
  ('laposte', 'MD4', 'Point de retrait fermé ce jour : colis réacheminé vers un nouveau point.', 'delayed'),
  ('laposte', 'PB2', 'Nous avons dû renforcer l''emballage de votre colis.', 'info'),

  ('chronopost', 'DC', 'Colis en cours de préparation chez l''expéditeur', 'label_created'),
  ('chronopost', 'PC', 'Colis pris en charge par le transporteur', 'picked_up'),
  ('chronopost', 'SC', 'Tri effectué dans l''agence de départ', 'in_transit'),
  ('chronopost', 'EC', 'Tri effectué dans l''agence de départ', 'in_transit'),
  ('chronopost', 'EE', 'Colis en cours de traitement dans l''agence export', 'in_transit'),
  ('chronopost', 'O', 'Colis en cours d''acheminement', 'in_transit'),
  ('chronopost', 'TS', 'Colis en cours d''acheminement', 'in_transit'),
  ('chronopost', 'TP', 'Colis en cours d''acheminement', 'in_transit'),
  ('chronopost', 'TT', 'Colis remis par le relais Pickup au chauffeur', 'in_transit'),
  ('chronopost', 'SD', 'Tri effectué dans l''agence de distribution', 'in_transit'),
  ('chronopost', 'RO', 'Colis reconditionné pendant l''acheminement', 'in_transit'),
  ('chronopost', 'FC', 'Colis sorti du CRESA', 'in_transit'),
  ('chronopost', 'TA', 'Colis en cours de livraison par le livreur', 'out_for_delivery'),
  ('chronopost', 'RB', 'Colis en cours de livraison au point de retrait', 'out_for_delivery'),
  ('chronopost', 'AB', 'Colis mis à disposition au point de retrait', 'at_pickup_point'),
  ('chronopost', 'MD', 'Colis mis à disposition au point de retrait', 'at_pickup_point'),
  ('chronopost', 'A2', 'Colis retardé à l''agence de distribution', 'delayed'),
  ('chronopost', 'AT', 'Colis retardé durant l''acheminement', 'delayed'),
  ('chronopost', 'CR', 'Colis retardé durant l''acheminement', 'delayed'),
  ('chronopost', 'IA', 'Livraison reportée de 24h', 'delayed'),
  ('chronopost', 'RT', 'Livraison reportée de 24h', 'delayed'),
  ('chronopost', 'RA', 'Livraison reportée de 24h', 'delayed'),
  ('chronopost', 'DI', 'Livraison reportée de 24h', 'delayed'),
  ('chronopost', 'S', 'Retard probable', 'delayed'),
  ('chronopost', 'N', 'Colis non livré : client absent', 'delivery_failed'),
  ('chronopost', 'P', 'Echec de livraison suite à l''absence du destinataire.', 'delivery_failed'),
  ('chronopost', 'NA', 'Echec de livraison, en attente d''instructions pour nouvelle livraison', 'delivery_failed'),
  ('chronopost', 'D', 'Livraison effectuée', 'delivered'),
  ('chronopost', 'RI', 'Colis remis au destinataire au point de retrait', 'delivered'),
  ('chronopost', 'FI', 'Fin d''instance', 'returning'),
  ('chronopost', 'R', 'Colis en retour expéditeur', 'returning'),
  ('chronopost', 'SM', 'Destinataire informé par SMS ou mail', 'info'),
  ('chronopost', 'IS', 'Livraison prévue lundi prochain', 'info'),
  ('chronopost', 'CL', 'Instruction de livraison reçue', 'info'),
  ('chronopost', 'BL', 'Destinataire fermé, livraison programmée au prochain jour d''ouverture', 'info'),
  ('chronopost', 'NN', 'Attribution d''un numéro de colis complémentaire', 'info'),
  ('chronopost', 'EA', 'Colis faisant partie d''une expédition groupée', 'info'),
  ('chronopost', 'I', 'Colis en attente', 'info'),

  ('mondial_relay', 'RÉCEPTION DES DONNÉES', NULL, 'label_created'),
  ('mondial_relay', 'PRISE EN CHARGE POINT RELAIS', NULL, 'picked_up'),
  ('mondial_relay', 'Colis pris en charge sur le si', NULL, 'in_transit'),
  ('mondial_relay', 'PRISE EN CHARGE PAR LE TRANSPO', NULL, 'in_transit'),
  ('mondial_relay', 'PRISE EN CHARGE EN AGENCE', NULL, 'in_transit'),
  ('mondial_relay', 'EXPEDIE VERS LE HUB', NULL, 'in_transit'),
  ('mondial_relay', 'EN COURS DE LIVRAISON', NULL, 'out_for_delivery'),
  ('mondial_relay', 'COLIS REMIS AU TRANSPORTEUR', NULL, 'out_for_delivery'),
  ('mondial_relay', 'Colis en route vers un Locker/', NULL, 'out_for_delivery'),
  ('mondial_relay', 'DISPONIBLE AU POINT RELAIS', NULL, 'at_pickup_point'),
  ('mondial_relay', 'AVISAGE PAR EMAIL', NULL, 'info'),
  ('mondial_relay', 'EMAIL DISPO RELAIS', NULL, 'info'),
  ('mondial_relay', 'CONSIGNE SUPPLEMENTAIRE', NULL, 'info'),
  ('mondial_relay', 'EMAIL RELANCE DISPO RELAIS', NULL, 'info'),
  ('mondial_relay', 'COLIS LU AU MAUVAIS RELAIS', NULL, 'incident'),
  ('mondial_relay', 'COLIS DECLARÉ ABSENT PAR LE RE', NULL, 'incident'),
  ('mondial_relay', 'COLIS LIVRÉ', NULL, 'delivered'),
  ('mondial_relay', 'Colis livré avec QRCode sécuri', NULL, 'delivered'),
  -- Le colis quitte le relais : il peut y revenir (1266952) ; seul
  -- « RETOUR A L'EXPÉDITEUR » dit qu'il repart vers nous.
  ('mondial_relay', 'RETOUR DU COLIS', NULL, 'incident'),
  ('mondial_relay', 'RETOUR A L''EXPÉDITEUR', NULL, 'returning')
ON CONFLICT (source, event_key) DO NOTHING;

COMMIT;
