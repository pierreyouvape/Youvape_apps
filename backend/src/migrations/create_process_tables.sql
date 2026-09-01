-- App "Process" : base de connaissance des procédures internes
-- (ex. « supprimer un client sur WooCommerce », « utiliser la gestion d'achat »).
--
-- Modèle en deux temps :
--   * `processes` + `process_steps` = la version COURANTE, celle qu'on lit et
--     qu'on édite ;
--   * `process_versions`            = l'historique, une ligne par enregistrement,
--     avec l'auteur, la date, la note de modification et un snapshot COMPLET des
--     étapes. Rien n'est jamais écrasé : restaurer une ancienne version crée une
--     nouvelle version, elle ne supprime pas les suivantes.

CREATE TABLE IF NOT EXISTS process_categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  color       TEXT NOT NULL DEFAULT '#135E84',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS processes (
  id           SERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  summary      TEXT,
  category_id  INTEGER REFERENCES process_categories(id) ON DELETE SET NULL,
  -- draft = en cours de rédaction, published = validé, archived = obsolète
  status       TEXT NOT NULL DEFAULT 'draft',
  -- 'restricted' = seuls les utilisateurs de process_access voient ce process
  -- 'all'        = lisible par tous ceux qui ont l'app (l'écriture reste nominative)
  visibility   TEXT NOT NULL DEFAULT 'restricted',
  -- Numéro de la version courante (miroir du dernier process_versions.version_no)
  version_no   INTEGER NOT NULL DEFAULT 1,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_processes_category ON processes(category_id);
CREATE INDEX IF NOT EXISTS idx_processes_status   ON processes(status);

-- Visibilité nominative, process par process.
--
-- Ne concerne QUE les non-admins : un admin voit et modifie tout sans y figurer.
-- La lecture vient d'ici ou de visibility = 'all' ; l'écriture vient uniquement
-- d'ici, avec can_write = true.
CREATE TABLE IF NOT EXISTS process_access (
  id          SERIAL PRIMARY KEY,
  process_id  INTEGER NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  can_write   BOOLEAN NOT NULL DEFAULT false,
  granted_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  granted_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (process_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_process_access_user    ON process_access(user_id);
CREATE INDEX IF NOT EXISTS idx_process_access_process ON process_access(process_id);

-- Étapes numérotées de la version courante.
-- `images` : [{ filename, original_name, mime, size, url, caption }]
--   Les fichiers vivent dans uploads/process/<process_id>/ et ne sont JAMAIS
--   supprimés à l'édition : une ancienne version les référence encore.
CREATE TABLE IF NOT EXISTS process_steps (
  id          SERIAL PRIMARY KEY,
  process_id  INTEGER NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  title       TEXT,
  body        TEXT,
  -- Encadré d'avertissement : NULL | 'info' | 'warning' | 'danger'
  callout     TEXT,
  images      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_process_steps_process ON process_steps(process_id, position);

-- Historique. `steps` est le snapshot figé des étapes au moment de l'enregistrement.
CREATE TABLE IF NOT EXISTS process_versions (
  id           SERIAL PRIMARY KEY,
  process_id   INTEGER NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  version_no   INTEGER NOT NULL,
  title        TEXT NOT NULL,
  summary      TEXT,
  category_id  INTEGER,
  status       TEXT,
  steps        JSONB NOT NULL DEFAULT '[]'::jsonb,
  change_note  TEXT,
  author_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (process_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_process_versions_process ON process_versions(process_id, version_no DESC);

-- Catégories de départ (modifiables ensuite dans l'app)
INSERT INTO process_categories (name, color, position) VALUES
  ('WooCommerce', '#7F54B3', 1),
  ('Achats',      '#F59E0B', 2),
  ('SAV',         '#0891B2', 3),
  ('Logistique',  '#6366F1', 4),
  ('Boutique',    '#0D9488', 5),
  ('Interne',     '#8A99A4', 6)
ON CONFLICT (name) DO NOTHING;
