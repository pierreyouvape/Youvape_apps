-- Migration: fix_shipping_country_mappings.sql
-- Ajoute les mappings pays manquants pour colissimo et laposte
-- Corrige les incohérences entre shipping_country_mapping et shipping_tariff_zones

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. COLISSIMO — Pays manquants dans shipping_country_mapping
--    (certains pays avaient une zone dans tariff_zones mais pas de mapping pays)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO shipping_country_mapping (carrier, method, country_code, zone_name, is_postal_prefix)
VALUES
  -- Pays qui ont leur propre zone nommée dans tariff_zones (domicile_avec_signature)
  ('colissimo', NULL, 'ES', 'Espagne',      false),  -- Espagne
  ('colissimo', NULL, 'DE', 'Allemagne',    false),  -- Allemagne
  ('colissimo', NULL, 'IT', 'Italie',       false),  -- Italie
  ('colissimo', NULL, 'CH', 'Suisse',       false),  -- Suisse (domicile_sans_signature → zone Suisse)

  -- Zone 2 (même tarif que Hongrie / Pays-Bas dans tariff_zones)
  ('colissimo', NULL, 'PT', 'Zone 2',       false),  -- Portugal
  ('colissimo', NULL, 'LV', 'Zone 2',       false),  -- Lettonie
  ('colissimo', NULL, 'LT', 'Zone 2',       false),  -- Lituanie
  ('colissimo', NULL, 'PL', 'Zone 2',       false),  -- Pologne
  ('colissimo', NULL, 'FI', 'Zone 2',       false),  -- Finlande
  ('colissimo', NULL, 'AT', 'Zone 2',       false),  -- Autriche
  ('colissimo', NULL, 'CZ', 'Zone 2',       false),  -- République tchèque
  ('colissimo', NULL, 'SK', 'Zone 2',       false),  -- Slovaquie
  ('colissimo', NULL, 'SI', 'Zone 2',       false),  -- Slovénie
  ('colissimo', NULL, 'HR', 'Zone 2',       false),  -- Croatie
  ('colissimo', NULL, 'RO', 'Zone 2',       false),  -- Roumanie
  ('colissimo', NULL, 'BG', 'Zone 2',       false),  -- Bulgarie
  ('colissimo', NULL, 'EE', 'Zone 2',       false),  -- Estonie

  -- Zone 4 (pays hors Europe / Maghreb)
  ('colissimo', NULL, 'MA', 'Zone 4',       false),  -- Maroc
  ('colissimo', NULL, 'TN', 'Zone 4',       false),  -- Tunisie
  ('colissimo', NULL, 'DZ', 'Zone 4',       false),  -- Algérie
  ('colissimo', NULL, 'TR', 'Zone 4',       false),  -- Turquie
  ('colissimo', NULL, 'IL', 'Zone 4',       false),  -- Israël

  -- Zone 6 (pays lointains / hors UE éloignés)
  ('colissimo', NULL, 'CA', 'Zone 6',       false),  -- Canada
  ('colissimo', NULL, 'US', 'Zone 6',       false),  -- États-Unis
  ('colissimo', NULL, 'AU', 'Zone 6',       false),  -- Australie
  ('colissimo', NULL, 'JP', 'Zone 6',       false),  -- Japon

  -- Outre-mer France (OM1) — déjà MQ mais ajouter les manquants
  ('colissimo', NULL, 'RE', 'OM1',          false),  -- La Réunion
  ('colissimo', NULL, 'GP', 'OM1',          false),  -- Guadeloupe
  ('colissimo', NULL, 'GF', 'OM1',          false),  -- Guyane française
  ('colissimo', NULL, 'PM', 'OM1',          false),  -- Saint-Pierre-et-Miquelon

  -- Outre-mer France (OM2) — Pacifique
  ('colissimo', NULL, 'PF', 'OM2',          false),  -- Polynésie française
  ('colissimo', NULL, 'NC', 'OM2',          false),  -- Nouvelle-Calédonie
  ('colissimo', NULL, 'WF', 'OM2',          false)   -- Wallis-et-Futuna

ON CONFLICT (carrier, country_code, method) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. LAPOSTE — Ajouter les DOM-TOM pour Lettre Suivie
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO shipping_country_mapping (carrier, method, country_code, zone_name, is_postal_prefix)
VALUES
  ('laposte', NULL, 'MQ', 'OM1', false),  -- Martinique
  ('laposte', NULL, 'RE', 'OM1', false),  -- Réunion
  ('laposte', NULL, 'GP', 'OM1', false),  -- Guadeloupe
  ('laposte', NULL, 'GF', 'OM1', false),  -- Guyane
  ('laposte', NULL, 'PM', 'OM1', false),  -- Saint-Pierre-et-Miquelon
  ('laposte', NULL, 'PF', 'OM2', false),  -- Polynésie
  ('laposte', NULL, 'NC', 'OM2', false)   -- Nouvelle-Calédonie

ON CONFLICT (carrier, country_code, method) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. COLISSIMO — Ajouter les tariff_zones manquantes pour domicile_avec_signature
--    Les zones Zone2, Zone3, Zone4, Zone6 existent déjà pour domicile_avec_signature
--    Mais Suisse n'a pas de zone domicile_avec_signature → on utilise Zone 3
--    (même fourchette de prix)
-- ─────────────────────────────────────────────────────────────────────────────
-- Note: domicile_avec_signature n'a pas de zone "Suisse" séparée,
-- la Suisse sera mappée en domicile_sans_signature vers "Suisse"
-- et pour domicile_avec_signature elle utilisera "Zone 3" (Zone 2 fallback non dispo)
-- → On ajoute un alias dans country_mapping plutôt qu'une nouvelle tariff_zone

-- Vérification: le NL est dans Zone 1 (DK,LU,NL) dans country_mapping
-- mais la tariff_zone "Pays-Bas" est plus spécifique → on update le mapping NL
-- NL: était dans Zone 1, mais on a aussi une zone "Pays-Bas" dans tariff_zones avec domicile_avec_signature
-- Laisser NL → Zone 1 (c'est cohérent avec le contrat Colissimo qui groupe DK+LU+NL)
-- La zone "Pays-Bas" dans tariff_zones a les mêmes tarifs que Zone 1 donc pas de pb

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. LAPOSTE — Ajouter les tariff_zones pour OM1/OM2 (Lettre Suivie)
--    La Lettre Suivie n'a qu'une zone France actuellement
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO shipping_tariff_zones (carrier, method, zone_name, fuel_surcharge, discount_percent)
VALUES
  ('laposte', 'lettre_suivie', 'OM1', 0, 0),
  ('laposte', 'lettre_suivie', 'OM2', 0, 0)
ON CONFLICT DO NOTHING;

-- Tarifs Lettre Suivie OM1 (Martinique, Réunion, Guadeloupe, Guyane) — même tarif que France
-- La lettre suivie vers DOM coûte le même prix qu'en France métropolitaine
INSERT INTO shipping_tariff_rates (zone_id, weight_from, weight_to, price_ht)
SELECT stz.id, 0, 250, 1.54
FROM shipping_tariff_zones stz
WHERE stz.carrier = 'laposte' AND stz.method = 'lettre_suivie' AND stz.zone_name = 'OM1'
  AND NOT EXISTS (
    SELECT 1 FROM shipping_tariff_rates WHERE zone_id = stz.id
  );

INSERT INTO shipping_tariff_rates (zone_id, weight_from, weight_to, price_ht)
SELECT stz.id, 0, 250, 1.54
FROM shipping_tariff_zones stz
WHERE stz.carrier = 'laposte' AND stz.method = 'lettre_suivie' AND stz.zone_name = 'OM2'
  AND NOT EXISTS (
    SELECT 1 FROM shipping_tariff_rates WHERE zone_id = stz.id
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. COLISSIMO — Ajouter domicile_avec_signature pour Suisse (Zone 3)
--    La Suisse est en Zone 3 pour les envois avec signature
-- ─────────────────────────────────────────────────────────────────────────────
-- Note: La Suisse a déjà une zone "Suisse" pour domicile_sans_signature
-- Pour domicile_avec_signature, pas de zone "Suisse" → Zone 3 est équivalente
-- On met à jour le mapping CH pour qu'il pointe vers Zone 3 pour domicile_avec_signature
-- via un mapping method-specific (sinon le fallback NULL utilisera Suisse → ok pour sans sig)

-- Ajouter un mapping CH → Zone 3 spécifiquement pour domicile_avec_signature
INSERT INTO shipping_country_mapping (carrier, method, country_code, zone_name, is_postal_prefix)
VALUES ('colissimo', 'domicile_avec_signature', 'CH', 'Zone 3', false)
ON CONFLICT (carrier, country_code, method) DO NOTHING;

COMMIT;
