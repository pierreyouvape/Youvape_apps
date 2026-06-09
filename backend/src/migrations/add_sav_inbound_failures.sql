-- Filet de sécurité pour les emails entrants SAV (Mailgun en mode Forward, sans
-- stockage Mailgun). Si le traitement d'un inbound échoue (exception), on
-- conserve ici le payload brut reçu + l'erreur, et on envoie une alerte mail.
-- Permet de retravailler manuellement le message perdu.
CREATE TABLE IF NOT EXISTS sav_inbound_failures (
  id           SERIAL PRIMARY KEY,
  sender       TEXT,                       -- expéditeur si disponible
  subject      TEXT,                       -- sujet si disponible
  message_id   TEXT,                       -- Message-Id Mailgun (dédup / référence)
  payload      JSONB NOT NULL,             -- req.body brut reçu de Mailgun
  error        TEXT,                       -- message d'erreur
  resolved     BOOLEAN NOT NULL DEFAULT FALSE, -- traité manuellement ?
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sav_inbound_failures_unresolved
  ON sav_inbound_failures(resolved, created_at);
