-- Codes-barres CONFIRMÉS par une personne (réception, 01/10/2026).
--
-- Un produit à deux codes « unité » cache souvent un code de carton mal classé
-- à l'import (BMS ne dit pas lequel est lequel). Scanné en réception, il comptait
-- 1 pièce au lieu du carton, sans rien dire : la question « unité ou carton ? »
-- ne se posait que pour un produit acheté au carton, or depuis la bascule en
-- pièces du 30/09 presque tous ont un conditionnement de 1 (65 articles à
-- plusieurs codes sur 4 réceptions du 01/10, question posée pour 4).
--
-- La question se pose désormais pour tout code « unité » d'un produit qui en a
-- plusieurs, TANT QUE personne ne l'a confirmé. Sans cette colonne, un « unité »
-- confirmé et un « unité » importé seraient indiscernables : la question
-- reviendrait à chaque scan.
--
-- Rempli par productModel.addBarcode (saisie humaine : réception, fiche
-- produit) ; les imports (BMS, CSV) le laissent vide.
--
-- Idempotente. À passer AVANT le rebuild (le code lit la colonne).
-- Retour arrière : rollback_product_barcodes_confirmed.sql

BEGIN;

ALTER TABLE product_barcodes
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS confirmed_by INTEGER REFERENCES users(id);

COMMENT ON COLUMN product_barcodes.confirmed_at IS
  'Type (unité / carton + quantité) confirmé par une personne. NULL = importé, jamais vérifié : la réception pose la question si le produit a plusieurs codes.';

COMMIT;
