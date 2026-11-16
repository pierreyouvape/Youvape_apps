-- Envoi du suivi des colis au site par le plugin youvape-logistique (16/11/2026).
--
-- Chaque étiquette émise après l'allumage de l'envoi (app_config.logistique_ship_push)
-- part au site par `order/ship`, sans mail : services/logistiqueShipService.js.
--
-- site_ship_status :
--   NULL      pas encore envoyée (ou émise avant l'allumage : jamais envoyée)
--   'sent'    écrite sur la commande du site (ou déjà présente : rejeu)
--   'retry'   échec passager, le cron la renvoie
--   'error'   refusée par le plugin, ou trop d'échecs : à regarder
--   'skipped' la référence n'est pas une commande du site (expédition manuelle)

ALTER TABLE shipment_labels
  ADD COLUMN IF NOT EXISTS site_ship_status varchar(16),
  ADD COLUMN IF NOT EXISTS site_ship_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS site_ship_error text,
  ADD COLUMN IF NOT EXISTS site_ship_last_attempt_at timestamp,
  ADD COLUMN IF NOT EXISTS site_shipped_at timestamp;

CREATE INDEX IF NOT EXISTS idx_shipment_labels_site_ship_due
  ON shipment_labels (created_at)
  WHERE status = 'active' AND (site_ship_status IS NULL OR site_ship_status = 'retry');
