-- App « Stories » : ordre des vidéos réglable à la main (25/11/2026).
--
-- Par défaut, l'ordre reste celui d'arrivée (la plus récente en haut) : une
-- nouvelle vidéo prend une position au-dessus de toutes les autres. On peut
-- ensuite la déplacer (glisser-déposer, ↑ ↓) pour mettre une vidéo juste après
-- celle dont elle est la suite (Aegis Legend 3 : Découverte puis Mise en route).
-- Cet ordre est publié dans index.json (`position`) et repris par la page /videos.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS sort_order INTEGER;

-- Pas de reprise des vidéos existantes : une colonne vide (NULL) garde l'ordre
-- d'arrivée (tri NULLS FIRST puis created_at DESC). Le premier déplacement dans
-- l'app numérote toutes les vidéos. Passée en prod le 25/11/2026.
CREATE INDEX IF NOT EXISTS idx_stories_sort_order ON stories(sort_order);
