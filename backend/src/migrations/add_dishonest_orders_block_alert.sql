-- Clients ayant été malhonnêtes : blocage automatique par téléphone + mail
-- d'alerte (09/11/2026).
--
-- Un signalement peut être coché « bloquer automatiquement » depuis la fiche
-- client (customer_dishonest_flags.auto_block). Ses commandes payées passées
-- avec SON TÉLÉPHONE (9 derniers chiffres), sous n'importe quel compte ou
-- email, sont alors BLOQUÉES au Picking (picking_blocks) par
-- dishonestOrderService, et un mail d'alerte part à contact@. Les signalements
-- non cochés gardent le fonctionnement d'avant (hors règles + ticket SAV).
-- Cas d'origine : Mary Obeun, 4 comptes PayPal en 50 min, un seul numéro.
--
--   dishonest_orders.blocked_at    : quand l'app l'a bloquée
--   dishonest_orders.block_note    : pourquoi elle ne l'a pas été (étiquette
--                                    déjà faite, déjà bloquée à la main…)
--   dishonest_orders.alert_sent_at : mail d'alerte parti
--   dishonest_orders.alert_error   : dernier échec d'envoi (retenté 24 h)
--
-- Idempotente : relançable sans dégât.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
--   1. git pull                                        (sur le VPS)
--   2. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_dishonest_orders_block_alert.sql
--   3. docker compose up --build -d backend frontend
--
-- Retour arrière :
--   ALTER TABLE customer_dishonest_flags DROP COLUMN auto_block;
--   ALTER TABLE dishonest_orders DROP COLUMN blocked_at, DROP COLUMN block_note,
--     DROP COLUMN alert_sent_at, DROP COLUMN alert_error;

BEGIN;

ALTER TABLE customer_dishonest_flags
  ADD COLUMN IF NOT EXISTS auto_block BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE dishonest_orders
  ADD COLUMN IF NOT EXISTS blocked_at    TIMESTAMP,
  ADD COLUMN IF NOT EXISTS block_note    TEXT,
  ADD COLUMN IF NOT EXISTS alert_sent_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS alert_error   TEXT;

COMMIT;
