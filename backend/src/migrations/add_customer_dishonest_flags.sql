-- Clients ayant été malhonnêtes (02/11/2026).
--
-- Un client a déjà volé un colis, déclaré à tort une non-réception… On le
-- signale depuis sa fiche (droit tickets en écriture), avec un motif libre.
-- Ses commandes FUTURES — payées après le signalement — sont reconnues, même
-- sous un nouveau compte : même compte, même email, même téléphone (9 derniers
-- chiffres) ou même nom et prénom (sans casse, accents ni ordre).
--
-- Une commande reconnue est exclue des règles de vague du Picking tant que le
-- client reste signalé (vague manuelle possible), porte un badge au Picking et
-- au Packing, et ouvre un ticket SAV avec note privée (dishonestOrderService,
-- toutes les 5 min). Fermer le ticket ne la libère pas (décision Pierre du
-- 02/11/2026) : seul le retrait du signalement le fait.
--
-- Idempotente : relançable sans dégât.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
--   1. pg_dump de sauvegarde
--   2. git pull                                        (sur le VPS)
--   3. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_customer_dishonest_flags.sql
--   4. docker compose up --build -d backend frontend
--
-- Retour arrière : rollback_customer_dishonest_flags.sql

BEGIN;

CREATE TABLE IF NOT EXISTS customer_dishonest_flags (
  id          SERIAL PRIMARY KEY,
  wp_user_id  BIGINT NOT NULL,
  reason      TEXT NOT NULL,
  flagged_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  flagged_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  removed_at  TIMESTAMPTZ
);

-- Un seul signalement en cours par client ; les retirés restent en historique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_dishonest_flags_active
  ON customer_dishonest_flags (wp_user_id) WHERE removed_at IS NULL;

COMMENT ON TABLE customer_dishonest_flags IS
  'Clients signalés comme ayant été malhonnêtes (colis volé, fausse non-réception…). Retirer = removed_at, jamais DELETE.';
COMMENT ON COLUMN customer_dishonest_flags.wp_user_id IS
  'Compte WordPress du client signalé (= customers.wp_user_id, id de l''adresse /customers/:id).';
COMMENT ON COLUMN customer_dishonest_flags.flagged_at IS
  'Seules les commandes créées après cette date sont reconnues.';

CREATE TABLE IF NOT EXISTS dishonest_orders (
  id           SERIAL PRIMARY KEY,
  wp_order_id  BIGINT NOT NULL UNIQUE,
  flag_id      INTEGER NOT NULL REFERENCES customer_dishonest_flags(id),
  matched_by   TEXT NOT NULL CHECK (matched_by IN ('compte', 'email', 'telephone', 'nom')),
  matched_value TEXT,
  detected_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  ticket_id    INTEGER REFERENCES sav_tickets(id) ON DELETE SET NULL,
  ticket_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_dishonest_orders_flag ON dishonest_orders (flag_id);

COMMENT ON TABLE dishonest_orders IS
  'Commandes reconnues comme passées par un client signalé : une ligne par commande, un seul ticket SAV. Le blocage au Picking, lui, est recalculé à chaque lecture.';
COMMENT ON COLUMN dishonest_orders.ticket_error IS
  'Dernière erreur de création du ticket ; la création est retentée au passage suivant.';

COMMIT;
