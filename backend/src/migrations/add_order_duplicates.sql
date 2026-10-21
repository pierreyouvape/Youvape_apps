-- Doublons probables de commandes clients (21/10/2026).
--
-- Un client paie, ne revient pas sur la page de confirmation (3D Secure validé
-- dans l'app de sa banque, onglet du checkout rouvert…), trouve son panier
-- encore plein et repaie la même commande. 33 cas depuis janvier 2026.
--
-- Doublon probable = deux commandes payées, même email de facturation, mêmes
-- articles (produit/déclinaison × quantité), moins d'une heure d'écart.
-- orderDuplicateService le détecte toutes les 5 min et ouvre un ticket SAV.
-- Tant que ce ticket n'est pas résolu, la SECONDE commande est exclue des
-- règles de vague du Picking (vague manuelle possible).
--
-- Idempotente : relançable sans dégât.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
--   1. pg_dump de sauvegarde
--   2. git pull                                        (sur le VPS)
--   3. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_order_duplicates.sql
--   4. docker compose up --build -d backend frontend
--
-- Retour arrière : rollback_order_duplicates.sql

BEGIN;

CREATE TABLE IF NOT EXISTS order_duplicates (
  id              SERIAL PRIMARY KEY,
  first_order_id  BIGINT NOT NULL,
  second_order_id BIGINT NOT NULL UNIQUE,
  detected_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  ticket_id       INTEGER REFERENCES sav_tickets(id) ON DELETE SET NULL,
  ticket_error    TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_duplicates_first ON order_duplicates (first_order_id);

COMMENT ON TABLE order_duplicates IS
  'Doublons probables : même email, mêmes articles, < 1 h. Une ligne par seconde commande (la première est l''originale).';
COMMENT ON COLUMN order_duplicates.ticket_id IS
  'Ticket SAV ouvert à la détection. Résolu (terminé) = alerte éteinte, la seconde commande revient dans les règles.';
COMMENT ON COLUMN order_duplicates.ticket_error IS
  'Dernière erreur de création du ticket ; la création est retentée au passage suivant.';

COMMIT;
