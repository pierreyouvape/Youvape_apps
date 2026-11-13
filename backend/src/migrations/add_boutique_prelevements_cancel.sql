-- ============================================================================
-- Prélèvements boutique : annulation (13/11/2026)
-- ============================================================================
-- Le client change d'avis avant la fin de la vente : la pièce retourne au site.
-- Annuler défait ce qui est déjà parti et supprime ce qui ne l'est pas encore :
--   étape déjà faite (sent)        → écriture inverse en file (*_undo_status)
--   étape pas encore faite         → statut 'cancelled', rien n'est envoyé
-- La ligne sort de la refacturation (cancelled_at).
--
-- À appliquer AVANT le code :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_boutique_prelevements_cancel.sql
-- ============================================================================

BEGIN;

ALTER TABLE boutique_prelevements
  ADD COLUMN IF NOT EXISTS cancelled_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Remise dans le stock du site (mouvement d'entrée)
  ADD COLUMN IF NOT EXISTS site_undo_status TEXT CHECK (site_undo_status IN ('queued', 'sending', 'sent', 'error')),
  ADD COLUMN IF NOT EXISTS site_undo_ref    TEXT,
  ADD COLUMN IF NOT EXISTS site_undo_error  TEXT,
  ADD COLUMN IF NOT EXISTS site_undo_at     TIMESTAMPTZ,
  -- Retrait du stock de la boutique dans Nextore (delta négatif)
  ADD COLUMN IF NOT EXISTS nx_undo_status   TEXT CHECK (nx_undo_status IN ('queued', 'sending', 'sent', 'error')),
  ADD COLUMN IF NOT EXISTS nx_undo_error    TEXT,
  ADD COLUMN IF NOT EXISTS nx_undo_at       TIMESTAMPTZ;

ALTER TABLE boutique_prelevements DROP CONSTRAINT IF EXISTS boutique_prelevements_site_status_check;
ALTER TABLE boutique_prelevements ADD CONSTRAINT boutique_prelevements_site_status_check
  CHECK (site_status IN ('queued', 'sending', 'sent', 'error', 'cancelled'));

ALTER TABLE boutique_prelevements DROP CONSTRAINT IF EXISTS boutique_prelevements_nx_status_check;
ALTER TABLE boutique_prelevements ADD CONSTRAINT boutique_prelevements_nx_status_check
  CHECK (nx_status IN ('waiting', 'queued', 'sending', 'sent', 'error', 'skipped', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_prelev_site_undo_q ON boutique_prelevements (site_undo_status) WHERE site_undo_status IN ('queued', 'sending');
CREATE INDEX IF NOT EXISTS idx_prelev_nx_undo_q   ON boutique_prelevements (nx_undo_status)   WHERE nx_undo_status   IN ('queued', 'sending');

COMMIT;
