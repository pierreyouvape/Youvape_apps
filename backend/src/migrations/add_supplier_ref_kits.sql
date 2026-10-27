-- ─────────────────────────────────────────────────────────────────────────────
-- Packs fournisseur : une référence facturée qui contient plusieurs articles
-- (27/10/2026)
--
-- JoshNoa V3/2026/41269 facture « OCT - Pack Offre Gourmand Biggy Bear 200ml »
-- (josh00045997), 15 × 14,90 €, quand la commande S316563 porte ses quatre
-- parfums séparément à 4,90 €. Une réf. de supplier_refs ne désigne qu'UN
-- produit : le pack n'y a pas sa place. Il se décrit ici, composant par
-- composant, et le contrôle de facture le découpe avant le rapprochement
-- (utils/invoiceKits.js).
--
-- Le composant est désigné par SA réf. chez le fournisseur, celle que porte la
-- commande — c'est elle que le rapprochement compare.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS supplier_ref_kits (
  id             SERIAL PRIMARY KEY,
  supplier_id    INTEGER      NOT NULL REFERENCES suppliers(id),
  kit_ref        VARCHAR(100) NOT NULL CHECK (btrim(kit_ref) <> ''),
  label          TEXT,
  component_ref  VARCHAR(100) NOT NULL CHECK (btrim(component_ref) <> ''),
  -- Pièces de ce composant dans UN pack.
  qty            NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (qty > 0),
  created_by     INTEGER      REFERENCES users(id),
  created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- Même normalisation que supplierRefModel.normalizedSql.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_ref_kits_component_key
  ON supplier_ref_kits (
    supplier_id,
    lower(regexp_replace(btrim(kit_ref), '\s+', ' ', 'g')),
    lower(regexp_replace(btrim(component_ref), '\s+', ' ', 'g'))
  );

-- Ce que la ligne doit à un pack découpé, en clair : la facture rouverte montre
-- sinon un parfum que le PDF n'imprime nulle part.
ALTER TABLE supplier_document_lines ADD COLUMN IF NOT EXISTS kit_note TEXT;

COMMIT;
