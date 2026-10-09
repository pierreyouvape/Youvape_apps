-- Bons de réduction fournisseur « à valoir sur la prochaine commande » (09/10/2026)
--
-- GFC, LVP et CigAccess ne font pas toujours d'avoir quand ils se trompent de
-- tarif : ils émettent un BON, déduit de la commande suivante. LVP F2610289037 :
-- puffs Dojo facturées 4,95 € au lieu de 4,60 € (5 × 0,35 €) et cartouches
-- 3,05 € au lieu de 2,90 € (30 × 0,15 €), soit un bon de 6,25 € HT.
--
-- Deux torts sans cette table :
--   • la facture fautive gardait son écart « à réclamer » alors qu'il était
--     rendu ;
--   • la facture suivante imprimait le bon comme une simple « Remise : » de
--     pied, que le contrôle RÉPARTISSAIT sur le coût de ses lignes — un coût de
--     revient trop bas — et qui pouvait « expliquer » une vraie surfacturation
--     de cette nouvelle commande.
--
-- Sur les deux factures, le bon ne se reconnaît qu'à son CODE (« Code(s) promo :
-- V687392C8282O278763 » chez LVP, « 721UVYSR » chez GFC) : la ligne de remise
-- s'appelle « Remise », comme une remise commerciale.
BEGIN;

CREATE TABLE IF NOT EXISTS supplier_vouchers (
  id                   SERIAL PRIMARY KEY,
  supplier_id          INTEGER       NOT NULL REFERENCES suppliers(id),
  -- La facture fautive qui a donné lieu au bon.
  source_document_id   INTEGER       NOT NULL REFERENCES supplier_documents(id) ON DELETE CASCADE,
  amount_ht            NUMERIC(12,2) NOT NULL CHECK (amount_ht > 0),
  -- Le code tel que le fournisseur le communique : c'est lui qu'on retrouve sur
  -- la facture suivante. Vide tant qu'on ne l'a pas reçu.
  code                 VARCHAR(80),
  -- Les références dont le bon rend l'écart. Vide = tous les écarts de la facture.
  covered_refs         TEXT[]        NOT NULL DEFAULT '{}',
  note                 TEXT,
  -- La facture sur laquelle le bon a été déduit. NULL = bon encore à valoir.
  -- Supprimer cette facture rouvre le bon.
  consumed_document_id INTEGER       REFERENCES supplier_documents(id) ON DELETE SET NULL,
  consumed_at          TIMESTAMP,
  created_by           INTEGER       REFERENCES users(id),
  created_at           TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  CHECK (consumed_document_id IS NULL OR consumed_document_id <> source_document_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_vouchers_source ON supplier_vouchers (source_document_id);
CREATE INDEX IF NOT EXISTS idx_supplier_vouchers_open
  ON supplier_vouchers (supplier_id) WHERE consumed_document_id IS NULL;

-- La part d'une remise de pied qui est en réalité un bon d'une facture
-- précédente : une ligne à part, jamais répartie sur le coût des lignes.
ALTER TABLE supplier_document_lines DROP CONSTRAINT IF EXISTS supplier_document_lines_kind_check;
ALTER TABLE supplier_document_lines ADD CONSTRAINT supplier_document_lines_kind_check
  CHECK (kind IN ('product', 'shipping', 'discount', 'voucher', 'other'));

COMMIT;
