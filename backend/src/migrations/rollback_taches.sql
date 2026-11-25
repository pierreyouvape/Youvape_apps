-- Retire l'app Tâches (tables + réglages Slack). Les droits `taches` restent
-- dans user_permissions sans effet.
DROP TABLE IF EXISTS taches_events;
DROP TABLE IF EXISTS taches_comments;
DROP TABLE IF EXISTS taches_templates;
DROP TABLE IF EXISTS taches_step_people;
DROP TABLE IF EXISTS taches_steps;
DROP TABLE IF EXISTS taches_tasks;
DELETE FROM app_config WHERE config_key = 'taches_slack';
