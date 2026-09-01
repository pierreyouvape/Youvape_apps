-- Sous-étapes de l'app Process.
--
-- Une étape regroupait tout son texte puis toutes ses photos en bloc : avec
-- plusieurs captures, on ne savait plus laquelle illustrait quel passage. Une
-- sous-étape porte son propre texte, ses propres photos et son propre encadré,
-- et se cite par sa position (« étape 2.3 »).
--
-- Stocké en JSONB plutôt qu'en troisième table : le snapshot de version est
-- construit à partir des étapes normalisées, les sous-étapes suivent donc
-- l'historique sans toucher au versionnage.
--
-- Un élément de `substeps` :
--   { position, title, body, callout, images: [{ filename, original_name,
--     mime, size, url, caption }] }
--
-- Un seul niveau, volontairement : au-delà, une sous-étape mérite d'être un
-- process à part.

ALTER TABLE process_steps
  ADD COLUMN IF NOT EXISTS substeps JSONB NOT NULL DEFAULT '[]'::jsonb;
