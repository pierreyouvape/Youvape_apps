-- ============================================================================
-- Boutiques — RÉCEPTION : verrou d'une ligne par la personne qui la compte
-- (24/11/2026, réception boutique sur PDA)
-- ============================================================================
-- Chaque appareil envoie le TOTAL compté d'une ligne (valeur absolue) : deux
-- personnes sur la même ligne s'écrasaient l'une l'autre. Dès sa première pièce,
-- une ligne appartient à celle qui la compte ; les autres la voient grisée
-- (« Compté par Franck ») et le serveur les refuse.
--   counted_by    = email de la personne (users.email) ; NULL = ligne libre
--   counted_by_at = première pièce de cette personne
-- Remettre la ligne à 0 la libère ; un responsable peut aussi la libérer au PC
-- (quantité gardée).
--
-- À appliquer AVANT le code :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_boutique_reception_count_lock.sql
-- ============================================================================

ALTER TABLE boutique_reception_counts
  ADD COLUMN IF NOT EXISTS counted_by    TEXT,
  ADD COLUMN IF NOT EXISTS counted_by_at TIMESTAMPTZ;
