-- ============================================================================
-- App Tâches — notifications dans l'app (cloche) et mentions @ en commentaire
-- ============================================================================
-- taches_notifications : une ligne par personne prévenue.
--   kind = mention    : @Maxime dans un commentaire
--          assigned   : on m'a mis responsable d'une étape ou personne d'une tâche
--          unblocked  : mon étape vient de passer « À faire »
--          comment    : nouveau commentaire sur une tâche que je suis
--   read_at NULL = non lue.
--
-- taches_comments.mentions : comptes mentionnés (@) dans le commentaire.
--
-- Additive seulement. À appliquer sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_taches_notifications.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS taches_notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('mention', 'assigned', 'unblocked', 'comment')),
  task_id     INTEGER REFERENCES taches_tasks(id) ON DELETE CASCADE,
  step_id     INTEGER REFERENCES taches_steps(id) ON DELETE SET NULL,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Europe/Paris'),
  read_at     TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_taches_notifications_user ON taches_notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_taches_notifications_unread ON taches_notifications (user_id) WHERE read_at IS NULL;

ALTER TABLE taches_comments ADD COLUMN IF NOT EXISTS mentions INTEGER[] NOT NULL DEFAULT '{}';
