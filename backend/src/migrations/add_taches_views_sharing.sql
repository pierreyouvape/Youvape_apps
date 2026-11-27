-- Tâches : vues personnelles par défaut (27/11/2026). Une vue n'est visible que de son auteur,
-- sauf partagée avec toute l'équipe (shared_all) ou avec des personnes choisies (shared_with).
ALTER TABLE taches_views ADD COLUMN IF NOT EXISTS shared_all boolean NOT NULL DEFAULT false;
ALTER TABLE taches_views ADD COLUMN IF NOT EXISTS shared_with integer[] NOT NULL DEFAULT '{}';
