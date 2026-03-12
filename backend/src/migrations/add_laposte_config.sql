-- Migration: Configuration La Poste API Affranchissement Lettre Suivie
-- Date: 2026-03-12

INSERT INTO app_config (config_key, config_value) VALUES
  ('laposte_token_url', 'https://apim-gw-acc.net.extra.laposte.fr/token'),
  ('laposte_api_url', 'https://apim-gw-acc.net.extra.laposte.fr/postageExternal/v1'),
  ('laposte_client_id', 'ldLDYKkTxwVl1kcBOoEEOSlN7Gsa'),
  ('laposte_client_secret', 'kA1_PsIfhzeeZDg9mAu55CziU_oa'),
  ('laposte_contract_number', 'D-2411825-1'),
  ('laposte_cust_acc_number', '379309'),
  ('laposte_cust_invoice', '379309'),
  ('laposte_sender_name', 'SARL EMC'),
  ('laposte_sender_address', '580 avenue de l aube rouge'),
  ('laposte_sender_zipcode', '34170'),
  ('laposte_sender_town', 'Castelnau le lez'),
  ('laposte_sender_phone', '0499782453'),
  ('laposte_sender_email', 'contact@youvape.fr')
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value;
