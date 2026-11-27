-- Tâches : pièces jointes des commentaires (capture collée, fichier du poste), 27/11/2026.
-- [{ file, name, size, kind: 'image' | 'file' }] ; fichiers dans le volume taches_uploads.
ALTER TABLE taches_comments ADD COLUMN IF NOT EXISTS files jsonb NOT NULL DEFAULT '[]'::jsonb;
