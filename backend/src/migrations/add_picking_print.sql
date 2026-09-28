-- App PICKING — lot 2 : suivi de l'impression des vagues.
--
-- La vague s'imprime en un seul PDF (page de garde + un bon par commande).
-- L'onglet Vagues doit dire si une vague a déjà été imprimée, par qui et
-- combien de fois : une vague réimprimée par erreur, c'est deux jeux de bons
-- qui circulent dans l'entrepôt.
--
-- Idempotente : relançable sans dégât.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
-- La migration passe AVANT le rebuild : le code en service ne lit pas ces
-- colonnes.
--
--   1. pg_dump de sauvegarde
--   2. git pull                                        (sur le VPS)
--   3. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_picking_print.sql
--   4. docker compose up --build -d backend frontend
--
-- Retour arrière : rollback_picking_print.sql

BEGIN;

ALTER TABLE picking_waves
  ADD COLUMN IF NOT EXISTS first_printed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS printed_at       TIMESTAMP,
  ADD COLUMN IF NOT EXISTS printed_by       INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS print_count      INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN picking_waves.first_printed_at IS
  'Première impression du PDF de la vague (UTC). NULL = jamais imprimée.';
COMMENT ON COLUMN picking_waves.printed_at IS
  'Dernière impression (UTC).';
COMMENT ON COLUMN picking_waves.printed_by IS
  'Auteur de la dernière impression.';
COMMENT ON COLUMN picking_waves.print_count IS
  'Nombre de fois où le PDF a été produit : au-delà de 1, des bons en double peuvent circuler.';

COMMIT;
