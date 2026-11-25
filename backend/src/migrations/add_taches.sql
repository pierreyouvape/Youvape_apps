-- ============================================================================
-- App Tâches — remplace le tableau « Tâches » de Monday + le scénario Make
-- ============================================================================
-- taches_tasks : une tâche (ex. « Xlim 4 Pro »), avec lien, étiquette, priorité.
--   Son statut est CALCULÉ à partir des étapes (aucune étape = statut manuel
--   `manual_status`) : pas de colonne à tenir à jour à la main.
--
-- taches_steps : les étapes d'une tâche, dans l'ordre (`position`). Statuts :
--   a_faire | en_cours | bloque | fait. Passer une étape à « fait » débloque la
--   suivante (bloque → a_faire) et prévient sur Slack les « personnes à notifier »
--   de l'étape terminée (sinon les responsables de l'étape suivante).
--
-- taches_step_people : plusieurs personnes par étape, dans deux rôles :
--   owner  = qui fait le travail (« Owner » de Monday)
--   notify = qui est prévenu quand ce travail est fini (« Personnes » de Monday)
--
-- taches_templates : enchaînements types (Fiche Produit…) ; les étapes et leurs
--   personnes par défaut sont dans `steps` (JSON), recopiées à la création.
--
-- taches_comments : fil de discussion d'une tâche.
-- taches_events   : journal (changements de statut, envois Slack et leur résultat).
--
-- monday_id : identifiant Monday de l'élément importé (import idempotent).
--
-- Réglages Slack dans app_config.taches_slack (JSON : webhook_url, members).
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_taches.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS taches_tasks (
  id             SERIAL PRIMARY KEY,
  title          TEXT NOT NULL,
  link_url       TEXT,
  label          TEXT,
  priority       TEXT CHECK (priority IN ('critique', 'haute', 'moyenne', 'basse')),
  manual_status  TEXT NOT NULL DEFAULT 'a_faire' CHECK (manual_status IN ('a_faire', 'en_cours', 'fait')),
  description    TEXT NOT NULL DEFAULT '',
  position       INTEGER NOT NULL DEFAULT 0,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Europe/Paris'),
  updated_at     TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Europe/Paris'),
  archived_at    TIMESTAMP,
  monday_id      BIGINT UNIQUE
);

CREATE TABLE IF NOT EXISTS taches_steps (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES taches_tasks(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'bloque' CHECK (status IN ('a_faire', 'en_cours', 'bloque', 'fait')),
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
  label       TEXT,
  steps       JSONB NOT NULL DEFAULT '[]',   -- [{ name, owners: [user_id], notify: [user_id] }]
  position    INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Europe/Paris')
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
  kind        TEXT NOT NULL,          -- status | slack | slack_error | created | …
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Europe/Paris')
);
CREATE INDEX IF NOT EXISTS idx_taches_events_task ON taches_events (task_id, created_at);

-- Modèle de départ, repris des sous-éléments Monday d'une fiche produit.
-- Personnes laissées vides : à régler dans l'app (Modèles).
INSERT INTO taches_templates (name, label, steps, position)
SELECT 'Fiche Produit', 'Fiche Produit',
       '[{"name":"Rédaction texte","owners":[],"notify":[]},
         {"name":"Stockage","owners":[],"notify":[]},
         {"name":"Photos produits","owners":[],"notify":[]},
         {"name":"Relecture en front","owners":[],"notify":[]},
         {"name":"Vérifier Code","owners":[],"notify":[]},
         {"name":"Vérif Globale","owners":[],"notify":[]},
         {"name":"Join Story","owners":[],"notify":[]}]'::jsonb, 0
WHERE NOT EXISTS (SELECT 1 FROM taches_templates);
