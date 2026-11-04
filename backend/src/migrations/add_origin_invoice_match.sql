-- Avoirs rattachés par leur « Facture d'origine » (04/11/2026)
--
-- Les avoirs LCA (A2611421302, A2611421306, A2611421307) ne portent pas de
-- « Réf. Commande », seulement la facture qu'ils corrigent. La commande est
-- celle de cette facture : nouveau mode de rapprochement « origin_invoice ».
BEGIN;
ALTER TABLE supplier_document_orders DROP CONSTRAINT IF EXISTS supplier_document_orders_matched_by_check;
ALTER TABLE supplier_document_orders ADD CONSTRAINT supplier_document_orders_matched_by_check
  CHECK (matched_by IN ('reference', 'manual', 'amount_date', 'origin_invoice'));
COMMIT;
