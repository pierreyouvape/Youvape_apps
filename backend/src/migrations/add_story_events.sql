-- Statistiques des stories : événements envoyés par le lecteur du site
-- (yv-stories.js) vers POST /api/stories-collect.
--
-- Aucune donnée personnelle : `session_id` est tiré au hasard par le navigateur
-- pour la durée de l'onglet (sessionStorage, effacé à la fermeture), l'adresse
-- IP n'est pas conservée (elle ne sert qu'à freiner les abus, en mémoire).
--
-- source : site = youvape.fr ; preview = page d'aperçu (tests internes,
-- exclus des chiffres par défaut) ; email = arrivée par un lien Probance.
CREATE TABLE IF NOT EXISTS story_events (
  id           BIGSERIAL PRIMARY KEY,
  at           TIMESTAMP NOT NULL DEFAULT NOW(),
  type         TEXT NOT NULL,          -- impression | open | view | progress | seek | cta_click | close
  story_slug   TEXT,
  widget_slug  TEXT,
  page         TEXT,                   -- chemin de la page (/produit/…, /youvape-awards)
  source       TEXT NOT NULL DEFAULT 'site',
  session_id   TEXT,
  device       TEXT,                   -- mobile | tablet | desktop
  percent      SMALLINT,               -- progress : 25 / 50 / 75 / 100
  seconds      INTEGER                 -- close : temps passé dans le lecteur
);

CREATE INDEX IF NOT EXISTS idx_story_events_story_at ON story_events(story_slug, at);
CREATE INDEX IF NOT EXISTS idx_story_events_at ON story_events(at);
