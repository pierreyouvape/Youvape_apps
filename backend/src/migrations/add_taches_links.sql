-- Tâches liées entre elles (comme les « Linked items » de GitLab).
-- kind = 'relates' (liée à) ou 'blocks' (task_id bloque other_id). Une seule liaison par paire.
CREATE TABLE IF NOT EXISTS taches_task_links (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES taches_tasks(id) ON DELETE CASCADE,
  other_id    INTEGER NOT NULL REFERENCES taches_tasks(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'relates' CHECK (kind IN ('relates', 'blocks')),
  created_by  INTEGER,
  created_at  TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Paris'),
  CHECK (task_id <> other_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS taches_task_links_pair
  ON taches_task_links (LEAST(task_id, other_id), GREATEST(task_id, other_id));
CREATE INDEX IF NOT EXISTS taches_task_links_other ON taches_task_links (other_id);
