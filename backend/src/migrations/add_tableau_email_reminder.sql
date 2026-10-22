-- ============================================================================
-- App Tableau — rappel par email des tâches récurrentes
-- ============================================================================
-- email_remind_minutes : délai avant l'heure de la tâche (NULL = pas d'email,
--                        0 = à l'heure). Indépendant du rappel à l'écran.
-- email_sent_for       : échéance pour laquelle l'email est parti (un seul par
--                        échéance ; réservé avant l'envoi, rendu en cas d'échec).
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_tableau_email_reminder.sql
-- Rollback :
--   ALTER TABLE tableau_tasks DROP COLUMN email_remind_minutes, DROP COLUMN email_sent_for;
-- ============================================================================

ALTER TABLE tableau_tasks
  ADD COLUMN IF NOT EXISTS email_remind_minutes INTEGER CHECK (email_remind_minutes >= 0),
  ADD COLUMN IF NOT EXISTS email_sent_for DATE;
