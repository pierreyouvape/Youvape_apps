-- App « Stories » : ordre des vidéos réglable à la main (25/11/2026).
--
-- Par défaut, l'ordre reste celui d'arrivée (la plus récente en haut) : une
-- nouvelle vidéo prend une position au-dessus de toutes les autres. On peut
-- ensuite la déplacer (glisser-déposer, ↑ ↓) pour mettre une vidéo juste après
-- celle dont elle est la suite (Aegis Legend 3 : Découverte puis Mise en route).
-- Cet ordre est publié dans index.json (`position`) et repris par la page /videos.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS sort_order INTEGER;

-- Vidéos existantes : leur ordre actuel (la plus récente en 1).
UPDATE stories s
   SET sort_order = o.rn
  FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC, id DESC) AS rn FROM stories) o
 WHERE o.id = s.id AND s.sort_order IS NULL;

CREATE INDEX IF NOT EXISTS idx_stories_sort_order ON stories(sort_order);
