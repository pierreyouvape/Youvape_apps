-- Lot annexe du chantier expédition : le BORDEREAU DE DÉPÔT.
--
-- Un bordereau (« delivery slip » chez Colissimo) est le papier que le chauffeur
-- signe en emportant les colis : il liste les numéros de suivi déposés ce
-- jour-là. Jusqu'ici il était produit dans BMS ; l'app doit savoir le produire
-- pour les étiquettes qu'elle a elle-même émises.
--
-- Deux objets :
--   * shipment_bordereaux       — un bordereau émis (numéro, PDF, date), pour
--     pouvoir le RÉIMPRIMER quand le chauffeur le redemande. Le transporteur ne
--     le rend qu'une fois : s'il n'est pas stocké ici, il est perdu.
--   * shipment_labels.bordereau_id — le lien colis → bordereau. C'est LUI qui
--     garantit qu'un colis ne figure jamais dans deux bordereaux : la liste des
--     colis à déposer, c'est « bordereau_id IS NULL ».
--
-- Idempotente : relançable sans dégât.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
-- La migration passe AVANT le rebuild. Dans ce sens, le code en service ne voit
-- rien (il n'écrit ni ne lit ces colonnes) et l'expédition continue. Dans
-- l'autre, l'app Bordereau refuse de générer tant que la table manque — elle le
-- dit à l'écran, l'étiquetage lui n'est pas touché.
--
--   1. git pull                                        (sur le VPS)
--   2. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_shipment_bordereaux.sql
--   3. docker compose up --build -d backend frontend
--
-- Retour arrière : rollback_shipment_bordereaux.sql (les bordereaux déjà émis
-- chez Colissimo existent toujours de leur côté — seule leur trace locale part).

BEGIN;

-- ── Bordereaux émis ─────────────────────────────────────────────────────────
-- bordereau_number est du TEXTE et pas un entier, alors que Colissimo rend un
-- nombre : un autre transporteur (Chronopost, lot 3) numérote comme il veut, et
-- une conversion perdue en route vaut un bordereau introuvable.
--
-- pdf_data porte le PDF en base64, comme shipment_labels.pdf_data : c'est la
-- seule copie. L'API Colissimo ne sait pas relire un bordereau déjà produit.
CREATE TABLE IF NOT EXISTS shipment_bordereaux (
  id               SERIAL PRIMARY KEY,
  carrier_code     VARCHAR(50)  NOT NULL,
  account_code     VARCHAR(50)  NOT NULL,
  bordereau_number VARCHAR(64)  NOT NULL,
  published_at     TIMESTAMP,
  parcel_count     INTEGER      NOT NULL DEFAULT 0,
  pdf_data         TEXT,
  created_by       INTEGER      REFERENCES users(id),
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  UNIQUE (carrier_code, bordereau_number)
);

COMMENT ON TABLE shipment_bordereaux IS
  'Bordereaux de dépôt émis (Colissimo « deliveryPaper »). Le PDF est stocké parce que le transporteur ne le rend qu''une fois : c''est la seule copie réimprimable.';
COMMENT ON COLUMN shipment_bordereaux.bordereau_number IS
  'Numéro rendu par le transporteur (Colissimo : bordereauHeader.bordereauNumber). Texte, pour ne pas imposer la numérotation de Colissimo aux transporteurs suivants.';
COMMENT ON COLUMN shipment_bordereaux.published_at IS
  'Date de publication rendue par le transporteur, en UTC comme tout le reste de la base (le VPS tourne en UTC).';
COMMENT ON COLUMN shipment_bordereaux.parcel_count IS
  'Nombre de colis portés par ce bordereau. Figé à la création : les étiquettes peuvent être annulées après coup, le papier signé par le chauffeur, lui, ne change pas.';

-- ── Lien colis → bordereau ──────────────────────────────────────────────────
-- Nullable, et c'est le cœur de la règle : « bordereau_id IS NULL » = colis
-- étiqueté, pas encore déposé. ON DELETE SET NULL pour qu'un bordereau supprimé
-- (erreur de manipulation) rende ses colis à la liste au lieu de les perdre.
ALTER TABLE shipment_labels
  ADD COLUMN IF NOT EXISTS bordereau_id INTEGER
  REFERENCES shipment_bordereaux(id) ON DELETE SET NULL;

COMMENT ON COLUMN shipment_labels.bordereau_id IS
  'Bordereau de dépôt qui porte ce colis. NULL = pas encore déposé, donc candidat au prochain bordereau. Un colis n''est jamais repris dans un second bordereau.';

CREATE INDEX IF NOT EXISTS idx_shipment_labels_bordereau
  ON shipment_labels(bordereau_id);

-- La requête de l'app : les colis actifs d'un contrat, sans bordereau, depuis
-- une date. L'index partiel ne couvre que ceux-là — quelques dizaines de lignes
-- là où la table en compte des milliers.
CREATE INDEX IF NOT EXISTS idx_shipment_labels_a_deposer
  ON shipment_labels(carrier_code, account_code, created_at)
  WHERE bordereau_id IS NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_shipment_bordereaux_created_at
  ON shipment_bordereaux(created_at DESC);

COMMIT;
