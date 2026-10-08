-- Réception : un quatrième motif, « erreur de saisie de commande » (08/10/2026)
--
-- Les trois premiers désignent tous le fournisseur : il doit encore envoyer
-- (reliquat), il ne l'enverra pas et a remboursé (soldé), ou il s'est trompé
-- et on réclame (manquant). Il manquait le cas où L'ERREUR EST DE NOTRE CÔTÉ —
-- une ligne commandée par erreur, une quantité mal saisie. Rien à réclamer à
-- personne, et surtout pas de relance à envoyer au fournisseur.
ALTER TABLE reception_counts DROP CONSTRAINT IF EXISTS reception_counts_motif_check;

ALTER TABLE reception_counts ADD CONSTRAINT reception_counts_motif_check
  CHECK (motif IS NULL OR motif IN ('reliquat', 'solde', 'manquant', 'erreur_saisie'));
