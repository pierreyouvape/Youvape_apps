-- Envoi automatique de rapports par email
-- Les adresses des destinataires sont stockées dans app_config sous forme de
-- chaîne (séparateurs acceptés : virgule, point-virgule, espace, retour ligne).
-- Une valeur vide => aucun envoi pour cette fréquence.
INSERT INTO app_config (config_key, config_value, updated_at)
VALUES
  ('report_email_daily',   '', NOW()),
  ('report_email_weekly',  '', NOW()),
  ('report_email_monthly', '', NOW())
ON CONFLICT (config_key) DO NOTHING;
