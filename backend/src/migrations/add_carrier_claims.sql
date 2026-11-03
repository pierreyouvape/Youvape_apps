-- Réclamations transporteur (Chronopost d'abord) — 03/11/2026.
--
-- Chaque jour à 16 h, les colis Chrono 13 / Chrono Relais / Chrono Express
-- déposés (bordereau) et pas livrés à l'échéance sont réclamés : un fichier
-- d'import pour le « Service Client en ligne » Chronopost, envoyé par mail, et
-- une note privée dans le ticket SAV de la commande.
--
--   * carrier_claim_batches — un fichier produit (son CSV, son envoi) ;
--   * carrier_claims        — une réclamation par colis, jamais deux.
--
-- Idempotente. Rien ne lit ces tables avant le déploiement du code.
-- Retour arrière : rollback_carrier_claims.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS carrier_claim_batches (
  id            SERIAL PRIMARY KEY,
  carrier_code  VARCHAR(50)  NOT NULL,
  claim_count   INTEGER      NOT NULL DEFAULT 0,
  file_name     VARCHAR(120) NOT NULL,
  csv_data      BYTEA        NOT NULL,
  mailed_at     TIMESTAMPTZ,
  mail_error    TEXT,
  imported_at   TIMESTAMPTZ,
  imported_by   INTEGER REFERENCES users(id),
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE carrier_claim_batches IS
  'Fichiers d''import de réclamations produits (Chronopost : Service Client en ligne → Import de tickets). Le CSV est gardé tel qu''envoyé, en UTF-8 (le premier fichier, du 03/11/2026, en Windows-1252).';
COMMENT ON COLUMN carrier_claim_batches.created_by IS
  'NULL = contrôle automatique de 16 h ; sinon la personne qui a lancé le contrôle.';
COMMENT ON COLUMN carrier_claim_batches.imported_at IS
  'Posé quand le compte-rendu d''import de Chronopost a été collé dans l''app.';

CREATE TABLE IF NOT EXISTS carrier_claims (
  id                 SERIAL PRIMARY KEY,
  label_id           INTEGER      NOT NULL REFERENCES shipment_labels(id) ON DELETE CASCADE,
  batch_id           INTEGER      REFERENCES carrier_claim_batches(id) ON DELETE SET NULL,
  carrier_code       VARCHAR(50)  NOT NULL,
  order_number       VARCHAR(30)  NOT NULL,
  tracking_number    VARCHAR(64)  NOT NULL,
  object_code        VARCHAR(4)   NOT NULL,
  motif_code         VARCHAR(4),
  family_code        VARCHAR(4),
  content            TEXT,
  comment            TEXT         NOT NULL,
  deposit_day        DATE         NOT NULL,
  due_day            DATE         NOT NULL,
  carrier_ticket     VARCHAR(40),
  carrier_error      TEXT,
  sav_ticket_id      INTEGER,
  sav_error          TEXT,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (label_id)
);

COMMENT ON TABLE carrier_claims IS
  'Une réclamation par colis (UNIQUE label_id) : un colis toujours en retard le lendemain n''est pas réclamé une seconde fois.';
COMMENT ON COLUMN carrier_claims.object_code IS
  'Code « objet de la demande » Chronopost : RT retard / hors délais, PC position colis (aucune prise en charge).';
COMMENT ON COLUMN carrier_claims.carrier_ticket IS
  'N° de ticket rendu par Chronopost à l''import, lu dans le compte-rendu collé dans l''app.';
COMMENT ON COLUMN carrier_claims.sav_ticket_id IS
  'Ticket SAV qui porte la note privée de la réclamation (créé ou existant). NULL + sav_error = à retenter.';

CREATE INDEX IF NOT EXISTS idx_carrier_claims_batch ON carrier_claims(batch_id);
CREATE INDEX IF NOT EXISTS idx_carrier_claims_tracking ON carrier_claims(tracking_number);

-- Pas de date de départ ici : sans `chronopost_claims_since`, le contrôle ne
-- réclame rien. Elle se pose à part, une fois la simulation validée :
--   INSERT INTO app_config (config_key, config_value, updated_at)
--   VALUES ('chronopost_claims_since', 'AAAA-MM-JJ', NOW());
-- Les échéances antérieures à cette date ne sont jamais réclamées.

COMMIT;
