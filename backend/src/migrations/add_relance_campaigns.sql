-- Relance code promo : suivi des envois et des clients fidélisés (05/11/2026).
--
-- Une campagne = une liste d'adresses envoyée à une date (export de l'app ou
-- fichier Probance nettoyé). Les commandes payées passées APRÈS `sent_at` par ces
-- adresses donnent les clients fidélisés, avec ou sans le code.
-- `sent_at` est en heure de Paris, comme les dates des commandes.
CREATE TABLE IF NOT EXISTS relance_campaigns (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL,
  source      TEXT NOT NULL,              -- app | probance
  label       TEXT,
  filters     JSONB,
  sent_at     TIMESTAMP NOT NULL,
  recipients  INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS relance_campaign_recipients (
  campaign_id INTEGER NOT NULL REFERENCES relance_campaigns(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,              -- minuscules, sans espaces
  PRIMARY KEY (campaign_id, email)
);

CREATE INDEX IF NOT EXISTS idx_relance_recipients_email ON relance_campaign_recipients(email);
