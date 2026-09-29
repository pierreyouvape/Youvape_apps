-- Un tarif RETENU sur une facture fait autorité.
--
-- `supplier_refs.pack_price` existait déjà, mais rien ne disait d'où il venait.
-- À l'import, `convertLine` ne s'y fiait qu'à moitié : chez les fournisseurs en
-- `invertPackQty` (e.tasty, Curieux, Pulp), le prix du document l'emportait
-- toujours, « le prix en base étant parfois incohérent ».
--
-- Depuis le contrôle de facture, un prix peut être RELEVÉ SUR UNE FACTURE RÉELLE,
-- promotions de pied comprises, et retenu explicitement par l'acheteur. Celui-là
-- n'est pas douteux : il fait autorité sur le prix imprimé, y compris s'il est
-- plus élevé — c'est le cas d'une promotion terminée.
--
-- La colonne date ce geste. NULL = prix d'origine inconnue, comportement inchangé.
ALTER TABLE supplier_refs ADD COLUMN IF NOT EXISTS price_retained_at TIMESTAMP;

COMMENT ON COLUMN supplier_refs.price_retained_at IS
  'Date à laquelle pack_price a été retenu depuis une facture contrôlée. Un prix daté fait autorité à l''import.';
