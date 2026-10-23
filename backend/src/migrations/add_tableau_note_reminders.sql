-- ============================================================================
-- App Tableau — rappel unique sur un post-it (notification et/ou email)
-- ============================================================================
-- remind_at          : date et heure du rappel, heure Paris (NULL = pas de rappel)
-- remind_screen      : notification à l'écran ; reste affichée jusqu'au « OK »,
--                      qui remet remind_at à NULL
-- remind_email       : email à l'adresse du compte
-- remind_email_sent  : un seul email (réservé avant l'envoi, rendu si échec)
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_tableau_note_reminders.sql
-- Rollback :
--   ALTER TABLE tableau_notes DROP COLUMN remind_at, DROP COLUMN remind_screen,
--     DROP COLUMN remind_email, DROP COLUMN remind_email_sent;
-- ============================================================================

ALTER TABLE tableau_notes
  ADD COLUMN IF NOT EXISTS remind_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS remind_screen BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS remind_email BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS remind_email_sent BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tableau_notes_remind ON tableau_notes (remind_at) WHERE remind_at IS NOT NULL;
