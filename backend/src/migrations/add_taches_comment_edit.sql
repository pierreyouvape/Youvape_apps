-- Tâches : commentaire modifiable par son auteur (27/11/2026) ; « modifié » affiché sous le texte.
ALTER TABLE taches_comments ADD COLUMN IF NOT EXISTS edited_at timestamp without time zone;
