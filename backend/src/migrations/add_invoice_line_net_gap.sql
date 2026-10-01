-- L'écart RÉEL de chaque ligne de facture, remise de pied comprise.
--
-- `gap` compare le montant BRUT de la facture au montant de la commande. Chez un
-- fournisseur qui facture au brut et ne retire sa remise qu'au pied du document
-- (LVP et son code RSPV20), ça donnait « +12,30 € » sur une ligne dont l'écart
-- unitaire valait −0,0044 € : deux chiffres justes, contradictoires à l'œil.
--
-- On gèle donc, à côté du brut :
--   • la part de remise de pied imputée à la ligne ;
--   • l'écart réel qui en découle — celui qui s'additionne jusqu'à l'écart
--     global de la facture, et qui tombe à zéro quand le tarif est appliqué ;
--   • ce qui reste réellement réclamable après imputation, pour que le message
--     au commercial reconstruit depuis un document ARCHIVÉ dise la même chose
--     que l'écran au moment du contrôle.
--
-- Les documents déjà enregistrés gardent NULL : l'écran retombe alors sur `gap`,
-- qui était la seule chose qu'on savait à l'époque. Pas de rattrapage inventé.

ALTER TABLE supplier_document_lines
  ADD COLUMN IF NOT EXISTS discount_share      NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS net_gap             NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS residual_gap_price  NUMERIC(12,2);
