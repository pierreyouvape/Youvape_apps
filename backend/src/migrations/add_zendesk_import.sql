-- Importation Zendesk dans le SAV/Tickets.
--
-- 1. zendesk_id : identifiant du ticket côté Zendesk. Sert de clé d'upsert
--    (réimporter met à jour le ticket existant au lieu de créer un doublon).
--    UNIQUE pour garantir l'unicité. Au go-live, nos IDs internes pourront être
--    alignés sur ces valeurs (chantier séparé).
--
-- 2. sav_zendesk_status_map : mapping d'un statut Zendesk (ex. "open", "solved",
--    ou un statut custom) vers un statut de l'app (sav_ticket_statuses.value).
--    On mappe une fois par statut, réutilisé à chaque import.
--
-- La config de connexion (sous-domaine, email, token) est stockée dans app_config
-- (clés zendesk_subdomain / zendesk_email / zendesk_token), pas ici.

ALTER TABLE sav_tickets
  ADD COLUMN IF NOT EXISTS zendesk_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sav_tickets_zendesk_id
  ON sav_tickets(zendesk_id)
  WHERE zendesk_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sav_zendesk_status_map (
  id            SERIAL PRIMARY KEY,
  zendesk_value TEXT NOT NULL UNIQUE,          -- valeur brute du statut côté Zendesk
  app_status    TEXT NOT NULL,                 -- sav_ticket_statuses.value cible
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
