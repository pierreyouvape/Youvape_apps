-- ============================================================================
-- App Tableau — post-its personnels, envois entre collègues, tâches récurrentes
-- ============================================================================
-- tableau_notes : un post-it appartient à UN compte (owner_id). Pendant un envoi
-- « déplacer », il garde son propriétaire mais passe `in_transit` : il disparaît
-- du tableau de l'expéditeur et y revient tel quel (même place) en cas de refus.
--
-- tableau_note_transfers : un envoi. Le texte et la couleur y sont figés au moment
-- de l'envoi, pour qu'une COPIE reste ce qu'on a envoyé même si l'original est
-- modifié ou supprimé avant la réponse.
--
-- tableau_tasks : une tâche récurrente et sa prochaine échéance (`next_due`).
-- Une échéance manquée ne s'empile pas : la tâche reste en retard jusqu'à être
-- faite une fois, puis repart sur la prochaine échéance future.
--
-- tableau_task_completions : historique des « fait », sert à annuler un clic.
--
-- Dates en heure Paris (comme le reste de la base).
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_tableau.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS tableau_notes (
  id             SERIAL PRIMARY KEY,
  owner_id       INTEGER NOT NULL REFERENCES users(id),
  content        TEXT NOT NULL DEFAULT '',
  color          TEXT NOT NULL DEFAULT 'jaune',
  x              INTEGER NOT NULL DEFAULT 40,
  y              INTEGER NOT NULL DEFAULT 40,
  width          INTEGER NOT NULL DEFAULT 220,
  height         INTEGER NOT NULL DEFAULT 200,
  z              INTEGER NOT NULL DEFAULT 0,
  in_transit     BOOLEAN NOT NULL DEFAULT false,
  received_from  INTEGER REFERENCES users(id),   -- reçu de (affiché sur le post-it)
  created_at     TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Europe/Paris'),
  updated_at     TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Europe/Paris')
);

CREATE INDEX IF NOT EXISTS idx_tableau_notes_owner ON tableau_notes (owner_id);

CREATE TABLE IF NOT EXISTS tableau_note_transfers (
  id              SERIAL PRIMARY KEY,
  note_id         INTEGER REFERENCES tableau_notes(id) ON DELETE SET NULL,
  mode            TEXT NOT NULL CHECK (mode IN ('move', 'copy')),
  from_user_id    INTEGER NOT NULL REFERENCES users(id),
  to_user_id      INTEGER NOT NULL REFERENCES users(id),
  content         TEXT NOT NULL,
  color           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'refused', 'cancelled')),
  created_at      TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Europe/Paris'),
  answered_at     TIMESTAMP,
  sender_seen_at  TIMESTAMP          -- l'expéditeur a pris connaissance de la réponse
);

CREATE INDEX IF NOT EXISTS idx_tableau_transfers_to_pending
  ON tableau_note_transfers (to_user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_tableau_transfers_from_unseen
  ON tableau_note_transfers (from_user_id) WHERE sender_seen_at IS NULL;
-- Un post-it ne peut être « en route » que vers une seule personne à la fois
CREATE UNIQUE INDEX IF NOT EXISTS uq_tableau_transfers_move_pending
  ON tableau_note_transfers (note_id) WHERE status = 'pending' AND mode = 'move';

CREATE TABLE IF NOT EXISTS tableau_tasks (
  id                     SERIAL PRIMARY KEY,
  owner_id               INTEGER NOT NULL REFERENCES users(id),
  title                  TEXT NOT NULL,
  notes                  TEXT,
  unit                   TEXT NOT NULL CHECK (unit IN ('day', 'week', 'month')),
  every                  INTEGER NOT NULL DEFAULT 1 CHECK (every BETWEEN 1 AND 365),
  weekdays               SMALLINT[],          -- unit = week : jours ISO 1 (lundi) … 7
  month_day              SMALLINT CHECK (month_day BETWEEN 1 AND 31),  -- unit = month (31 = dernier jour)
  start_date             DATE NOT NULL,
  due_time               TIME,                -- heure de la tâche (facultative)
  remind_minutes         INTEGER CHECK (remind_minutes >= 0),  -- NULL = pas de rappel, 0 = à l'heure
  next_due               DATE NOT NULL,
  reminder_dismissed_for DATE,                -- échéance dont le rappel a été fermé
  created_at             TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Europe/Paris'),
  updated_at             TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Europe/Paris')
);

CREATE INDEX IF NOT EXISTS idx_tableau_tasks_owner ON tableau_tasks (owner_id);

CREATE TABLE IF NOT EXISTS tableau_task_completions (
  id        SERIAL PRIMARY KEY,
  task_id   INTEGER NOT NULL REFERENCES tableau_tasks(id) ON DELETE CASCADE,
  due_date  DATE NOT NULL,     -- l'échéance que ce « fait » a soldée (restaurée par l'annulation)
  done_at   TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Europe/Paris')
);

CREATE INDEX IF NOT EXISTS idx_tableau_completions_task ON tableau_task_completions (task_id, done_at DESC);
