-- Suivi de la confirmation d'expédition dans BMS, étiquette par étiquette.
--
-- Jusqu'ici, confirmer l'expédition dans BMS était un appel sans lendemain : un
-- POST /sales/order/{ref}/ship, et en cas d'échec un mail. Rien en base, aucune
-- reprise, aucune trace à l'écran. Le colis partait, BMS croyait avoir encore le
-- stock, et seul un mail lu à temps permettait de rattraper — le 21/09/2026,
-- deux commandes ont raté leur confirmation le même jour, une seule a été vue
-- (1262418 est restée trois jours avec 3 unités jamais sorties du stock).
--
-- Ces colonnes rendent l'échec durable et donc rattrapable : le cron de reprise
-- (bmsShipmentConfirmService) repasse toutes les 15 min, et l'écran des
-- étiquettes affiche ce qui n'est pas confirmé.
--
-- ── bms_ship_status ─────────────────────────────────────────────────────────
--   'pending'   — à confirmer : le cron s'en occupe
--   'confirmed' — BMS porte bien la ligne d'expédition
--   'manual'    — régularisé hors app (bouton de l'écran, ou expédition déjà
--                 enregistrée dans BMS par un autre chemin)
--   'skipped'   — aucune confirmation attendue : étiquette manuelle (la commande
--                 est en général déjà expédiée dans BMS), transporteur déclaré
--                 `confirmsShipmentInBms: false`, et TOUTES les étiquettes
--                 antérieures à cette migration.
--
-- Le défaut 'skipped' est délibéré : c'est lui qui garantit qu'appliquer cette
-- migration ne déclenche pas la reprise sur les 400+ étiquettes déjà en base.
-- Leur état a été audité contre l'API BMS le 22/09/2026 (404 étiquettes sur
-- 14 jours, toutes expédiées côté BMS sauf 1262418, régularisée depuis) ; les
-- rejouer ne corrigerait rien et enverrait des expéditions en double.
-- Seules les étiquettes émises APRÈS le rebuild partent en 'pending'.
--
-- Idempotente. Colonnes nullables ou avec défaut constant : pas de réécriture de
-- table, pas de verrou long, le packing peut tourner pendant.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
-- Sans danger pour l'étiquetage : le modèle ne nomme ces colonnes que s'il les
-- trouve (cf. shipmentLabelModel), donc une étiquette s'enregistre à l'identique
-- migration passée ou non. Tant qu'elle n'est pas passée, la reprise reste en
-- sommeil et le dit dans les logs au démarrage.
--
--   1. git pull                                        (sur le VPS)
--   2. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_bms_confirmation_to_shipment_labels.sql
--   3. docker compose up --build -d backend frontend

BEGIN;

ALTER TABLE shipment_labels
  ADD COLUMN IF NOT EXISTS bms_ship_status      VARCHAR(16) NOT NULL DEFAULT 'skipped',
  ADD COLUMN IF NOT EXISTS bms_confirmed_at     TIMESTAMP,
  ADD COLUMN IF NOT EXISTS bms_attempts         INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bms_last_attempt_at  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS bms_last_error       TEXT,
  ADD COLUMN IF NOT EXISTS bms_ship_title       VARCHAR(120);

COMMENT ON COLUMN shipment_labels.bms_ship_status IS
  'pending | confirmed | manual | skipped — état de la confirmation d''expédition dans BMS. '
  'Défaut skipped : une étiquette qui ne demande pas de confirmation, et tout l''historique antérieur à la migration.';
COMMENT ON COLUMN shipment_labels.bms_confirmed_at IS
  'Horodatage de la confirmation effective dans BMS (ou de la régularisation à la main).';
COMMENT ON COLUMN shipment_labels.bms_attempts IS
  'Nombre de tentatives de confirmation, première comprise. Sert à espacer l''alerte, pas à abandonner.';
COMMENT ON COLUMN shipment_labels.bms_ship_title IS
  'Libellé d''expédition envoyé à BMS. Conservé pour que la reprise renvoie EXACTEMENT le même : '
  'Colissimo en a un par produit (domicile / signature / point de retrait), et le défaut du transporteur '
  'étiquetterait un point relais en « Domicile sans signature ».';
COMMENT ON COLUMN shipment_labels.bms_last_error IS
  'Message d''erreur BMS de la dernière tentative. Conservé après succès tardif : il dit pourquoi ça avait échoué.';

-- La reprise ne lit que les étiquettes en attente : une poignée de lignes sur
-- des dizaines de milliers. Index partiel, donc quasi vide et gratuit à tenir.
CREATE INDEX IF NOT EXISTS idx_shipment_labels_bms_pending
  ON shipment_labels (created_at)
  WHERE bms_ship_status = 'pending';

COMMIT;
