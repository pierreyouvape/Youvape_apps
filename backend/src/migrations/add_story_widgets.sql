-- App « Stories » : widgets (bulles / carrousel) et leurs emplacements sur le site.
--
-- Un widget = une liste ORDONNÉE de stories, affichée au format bulles (fiches
-- produit, remplace le `list-bubble` de Join) ou carrousel de cartes (pages
-- éditoriales comme /youvape-awards, remplace le `list-card`). Une même story
-- peut figurer dans plusieurs widgets.
--
-- Rien n'est lu en direct par WordPress : « Publier » écrit des fichiers JSON
-- sur R2 (stories/index.json + stories/widgets/<slug>.json), que le mu-plugin
-- du site lit et met en cache.

CREATE TABLE IF NOT EXISTS story_widgets (
  id            SERIAL PRIMARY KEY,
  -- Identifiant du widget côté site (shortcode [yv_stories widget="<slug>"]) : ne change plus.
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  -- bubbles = bulles rondes ; cards = carrousel de cartes 9:16
  layout        TEXT NOT NULL DEFAULT 'bubbles',
  -- draft = pas encore sur le site ; published = inclus à la prochaine publication
  status        TEXT NOT NULL DEFAULT 'draft',
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS story_widget_items (
  widget_id     INTEGER NOT NULL REFERENCES story_widgets(id) ON DELETE CASCADE,
  story_id      INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (widget_id, story_id)
);

-- Où le widget s'affiche. `product` = fiche produit (wp_product_id du produit
-- simple / variable / pack, jamais d'une déclinaison) ; `page` = chemin d'une
-- page du site (ex. /youvape-awards), pour les pages sans fiche produit.
CREATE TABLE IF NOT EXISTS story_placements (
  id            SERIAL PRIMARY KEY,
  widget_id     INTEGER NOT NULL REFERENCES story_widgets(id) ON DELETE CASCADE,
  target_type   TEXT NOT NULL,
  target_ref    TEXT NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (widget_id, target_type, target_ref)
);

CREATE INDEX IF NOT EXISTS idx_story_placements_target ON story_placements(target_type, target_ref);

-- Date de la dernière publication sur R2 (une seule ligne) : sert à signaler
-- dans l'app les modifications pas encore parties sur le site.
CREATE TABLE IF NOT EXISTS story_publications (
  id            SERIAL PRIMARY KEY,
  published_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  published_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  widgets_count INTEGER NOT NULL DEFAULT 0,
  stories_count INTEGER NOT NULL DEFAULT 0
);
