-- Mapping configurable des champs personnalisés Zendesk → champs de l'app.
--
-- 1. Colonnes natives manquantes sur sav_tickets :
--    - customer_first_name / customer_last_name : Zendesk a des custom fields
--      séparés prénom/nom. customer_name (existant) reste rempli par concaténation
--      pour rester compatible avec l'affichage actuel.
--    - order_tracking : numéro de suivi transporteur.
--    - custom_fields : stockage JSONB pour les champs Zendesk « créés » depuis
--      l'interface de mapping (label → valeur), sans migration à chaque fois.
--
-- 2. sav_zendesk_field_map : pour chaque champ Zendesk (clé = "custom:<id>"),
--    la cible côté app. target_type :
--      - 'native'  → target = nom de colonne (order_id, customer_phone, …)
--      - 'json'    → target = label sous lequel stocker dans custom_fields
--      - 'ignore'  → champ non importé
--    On mappe une fois par champ, réutilisé à chaque import.

ALTER TABLE sav_tickets
  ADD COLUMN IF NOT EXISTS customer_first_name VARCHAR(255);

ALTER TABLE sav_tickets
  ADD COLUMN IF NOT EXISTS customer_last_name VARCHAR(255);

ALTER TABLE sav_tickets
  ADD COLUMN IF NOT EXISTS order_tracking VARCHAR(255);

ALTER TABLE sav_tickets
  ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS sav_zendesk_field_map (
  id             SERIAL PRIMARY KEY,
  zendesk_field  TEXT NOT NULL UNIQUE,   -- "custom:<id>"
  zendesk_title  TEXT,                   -- titre lisible (snapshot, pour info)
  target_type    TEXT NOT NULL,          -- 'native' | 'json' | 'ignore'
  target         TEXT,                   -- colonne native, ou label JSON, ou NULL si ignore
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
