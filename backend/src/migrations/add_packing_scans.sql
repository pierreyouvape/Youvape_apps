-- PACKING — trace des ouvertures de commande au poste de packing.
--
-- Une ligne chaque fois qu'une commande est ouverte au Packing (scan du bon ou
-- saisie du numéro), avec qui et quand. Rien ne l'affiche aujourd'hui : c'est
-- mis de côté pour les Stats d'expédition, si un jour on veut mesurer le temps
-- scan → étiquette (écarté le 29/09/2026 : il ne compte pas l'emballage qui
-- suit la sortie de l'étiquette).
--
-- Idempotente : relançable sans dégât.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
-- La migration passe AVANT le rebuild. Le Packing n'attend pas l'écriture et
-- ignore son échec : même sans la table, il continue de tourner.
--
--   1. pg_dump de sauvegarde
--   2. git pull                                        (sur le VPS)
--   3. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_packing_scans.sql
--   4. docker compose up --build -d backend frontend
--
-- Retour arrière : rollback_packing_scans.sql

BEGIN;

CREATE TABLE IF NOT EXISTS packing_scans (
  id           SERIAL PRIMARY KEY,
  order_number VARCHAR(20) NOT NULL,
  user_id      INTEGER REFERENCES users(id),
  scanned_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_packing_scans_user_time ON packing_scans (user_id, scanned_at);
CREATE INDEX IF NOT EXISTS idx_packing_scans_order ON packing_scans (order_number);

COMMENT ON TABLE packing_scans IS
  'Ouverture d''une commande au Packing (scan ou saisie). scanned_at en UTC, comme shipment_labels.created_at.';

COMMIT;
