-- ============================================================================
-- App Tâches — colonnes personnalisées et disposition des colonnes par tableau
-- ============================================================================
-- taches_boards.layout : ordre des colonnes affichées (JSON, liste de clés) :
--   colonnes de base ('id', 'title', 'link', 'progress', 'labels', 'created',
--   'updated', 'priority', 'status', 'due', 'people') et colonnes ajoutées
--   ('c<id>'). NULL = disposition par défaut.
--
-- taches_columns : colonnes ajoutées à un tableau, avec leur type :
--   text | number | date | period | link | people | checkbox | select
--   settings (JSON) : pour « select », { options: [{ label, color }] }.
--
-- taches_task_values : valeur d'une tâche dans une colonne ajoutée (JSON).
--
-- Additive seulement. À appliquer sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_taches_columns.sql
-- ============================================================================

ALTER TABLE taches_boards ADD COLUMN IF NOT EXISTS layout JSONB;

CREATE TABLE IF NOT EXISTS taches_columns (
  id          SERIAL PRIMARY KEY,
  board_id    INTEGER NOT NULL REFERENCES taches_boards(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('text', 'number', 'date', 'period', 'link', 'people', 'checkbox', 'select')),
  settings    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Europe/Paris')
);
CREATE INDEX IF NOT EXISTS idx_taches_columns_board ON taches_columns (board_id);

CREATE TABLE IF NOT EXISTS taches_task_values (
  task_id     INTEGER NOT NULL REFERENCES taches_tasks(id) ON DELETE CASCADE,
  column_id   INTEGER NOT NULL REFERENCES taches_columns(id) ON DELETE CASCADE,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Europe/Paris'),
  PRIMARY KEY (task_id, column_id)
);
