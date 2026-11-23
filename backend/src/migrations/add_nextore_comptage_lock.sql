-- ============================================================================
-- Boutiques Nextore — COMPTAGE : verrou d'un produit par la personne qui le compte
-- (23/11/2026, comptage boutique sur PDA)
-- ============================================================================
-- Plusieurs PDA comptent la même session. Dès sa première quantité, un produit
-- appartient à la personne qui l'a compté : les autres le voient grisé
-- (« compté par Franck ») et ne peuvent plus le compter.
--   counted_by    = email de la personne (users.email) ; garde la trace après envoi
--   counted_by_at = première quantité de cette personne
-- Le verrou tombe quand le produit est envoyé dans Nextore (pushed) ou quand un
-- responsable le libère au PC (counted_by remis à NULL, quantité gardée).
--
-- À appliquer AVANT le code :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_nextore_comptage_lock.sql
-- ============================================================================

ALTER TABLE nextore_comptage_items
  ADD COLUMN IF NOT EXISTS counted_by    TEXT,
  ADD COLUMN IF NOT EXISTS counted_by_at TIMESTAMPTZ;
