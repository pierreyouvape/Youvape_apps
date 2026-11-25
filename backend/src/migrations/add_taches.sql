-- ============================================================================
-- App Tâches — remplace les tableaux Monday (« Tâches », « Suivi Tâches
-- quotidiennes ») et les scénarios Make qui postent dans Slack.
-- ============================================================================
-- taches_boards : un tableau (Tâches, Suivi quotidien…).
-- taches_groups : ses groupes, dans l'ordre (« Liste des tâches », « Terminée »…).
--
-- taches_tasks : une tâche. Étiquettes multiples (`labels`), dates de début et
--   de fin (Gantt, calendrier), personnes de la tâche (taches_task_people, la
--   colonne « Person » du suivi quotidien).
--   Statut : CALCULÉ depuis les étapes s'il y en a ; sinon `manual_status`.
--
-- taches_steps : les étapes (sous-éléments Monday), dans l'ordre (`position`).
--   Passer une étape à « fait » débloque la suivante (bloque → a_faire) et
--   prévient Slack.
--
-- taches_step_people : plusieurs personnes par étape, deux rôles :
--   owner  = qui fait le travail (« Owner » de Monday)
--   notify = qui est prévenu quand ce travail est fini (« Personnes » de Monday)
--
-- taches_templates : enchaînements types (groupe « Modèles » de Monday).
-- taches_comments  : fil de discussion d'une tâche (« updates » de Monday).
-- taches_events    : journal (statuts, envois Slack et leur résultat).
--
-- monday_id / monday_key : identifiants Monday (import rejouable).
-- Réglages Slack dans app_config.taches_slack (JSON : webhook_url, members).
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_taches.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS taches_boards (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  monday_id   BIGINT UNIQUE
);

CREATE TABLE IF NOT EXISTS taches_groups (
  id          SERIAL PRIMARY KEY,
  board_id    INTEGER NOT NULL REFERENCES taches_boards(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#579BFC',
  position    INTEGER NOT NULL DEFAULT 0,
  monday_key  TEXT UNIQUE            -- '<board monday>:<group monday>'
);

CREATE TABLE IF NOT EXISTS taches_tasks (
  id             SERIAL PRIMARY KEY,
  board_id       INTEGER NOT NULL REFERENCES taches_boards(id) ON DELETE CASCADE,
  group_id       INTEGER REFERENCES taches_groups(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  link_url       TEXT,
  labels         TEXT[] NOT NULL DEFAULT '{}',
  priority       TEXT CHECK (priority IN ('critique', 'haute', 'moyenne', 'basse')),
  manual_status  TEXT NOT NULL DEFAULT 'a_faire'
                 CHECK (manual_status IN ('a_faire', 'en_cours', 'bloque', 'longue', 'fait')),
  start_date     DATE,
  due_date       DATE,
  description    TEXT NOT NULL DEFAULT '',
  position       INTEGER NOT NULL DEFAULT 0,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Europe/Paris'),
  updated_at     TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Europe/Paris'),
  archived_at    TIMESTAMP,
  monday_id      BIGINT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_taches_tasks_board ON taches_tasks (board_id, group_id, position);

CREATE TABLE IF NOT EXISTS taches_task_people (
  task_id  INTEGER NOT NULL REFERENCES taches_tasks(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_taches_task_people_user ON taches_task_people (user_id);

CREATE TABLE IF NOT EXISTS taches_steps (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES taches_tasks(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'bloque'
              CHECK (status IN ('a_faire', 'en_cours', 'attente_correction', 'suivi_google', 'bloque', 'fait')),
  priority    TEXT CHECK (priority IN ('critique', 'haute', 'moyenne', 'basse')),
  start_date  DATE,
  due_date    DATE,
  note        TEXT NOT NULL DEFAULT '',
  done_at     TIMESTAMP,
  done_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Europe/Paris'),
  monday_id   BIGINT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_taches_steps_task ON taches_steps (task_id, position);

CREATE TABLE IF NOT EXISTS taches_step_people (
  step_id  INTEGER NOT NULL REFERENCES taches_steps(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role     TEXT NOT NULL CHECK (role IN ('owner', 'notify')),
  PRIMARY KEY (step_id, user_id, role)
);
CREATE INDEX IF NOT EXISTS idx_taches_step_people_user ON taches_step_people (user_id, role);

CREATE TABLE IF NOT EXISTS taches_templates (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  labels      TEXT[] NOT NULL DEFAULT '{}',
  steps       JSONB NOT NULL DEFAULT '[]',   -- [{ name, owners: [user_id], notify: [user_id] }]
  position    INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Europe/Paris'),
  monday_id   BIGINT UNIQUE
);

CREATE TABLE IF NOT EXISTS taches_comments (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES taches_tasks(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Europe/Paris')
);
CREATE INDEX IF NOT EXISTS idx_taches_comments_task ON taches_comments (task_id, created_at);

CREATE TABLE IF NOT EXISTS taches_events (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER REFERENCES taches_tasks(id) ON DELETE CASCADE,
  step_id     INTEGER REFERENCES taches_steps(id) ON DELETE SET NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,          -- created | status | task_status | slack | slack_error
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Europe/Paris')
);
CREATE INDEX IF NOT EXISTS idx_taches_events_task ON taches_events (task_id, created_at);

-- Tableau de départ (l'import Monday crée les siens, rattachés par monday_id).
INSERT INTO taches_boards (name, position)
SELECT 'Tâches', 0 WHERE NOT EXISTS (SELECT 1 FROM taches_boards);
INSERT INTO taches_groups (board_id, name, position)
SELECT b.id, 'Liste des tâches', 0 FROM taches_boards b
 WHERE NOT EXISTS (SELECT 1 FROM taches_groups) ORDER BY b.id LIMIT 1;

-- Modèle « Fiche Produit » (sous-éléments habituels d'une fiche sur Monday,
-- où il n'existait pas de modèle). Personnes à régler dans l'app (Modèles).
INSERT INTO taches_templates (name, labels, steps, position)
SELECT 'Fiche Produit', ARRAY['Fiche Produit'],
       '[{"name":"Rédaction texte","owners":[],"notify":[]},
         {"name":"Stockage","owners":[],"notify":[]},
         {"name":"Photos produits","owners":[],"notify":[]},
         {"name":"Relecture en front","owners":[],"notify":[]},
         {"name":"Vérifier Code","owners":[],"notify":[]},
         {"name":"Vérif Globale","owners":[],"notify":[]},
         {"name":"Join Story","owners":[],"notify":[]}]'::jsonb, 0
WHERE NOT EXISTS (SELECT 1 FROM taches_templates WHERE name = 'Fiche Produit');
