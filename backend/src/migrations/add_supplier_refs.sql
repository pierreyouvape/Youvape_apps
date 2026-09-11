-- ─────────────────────────────────────────────────────────────────────────────
-- supplier_refs : les références fournisseur, une ligne par RÉF.
--
-- Règle métier (Pierre, 11/09/2026) :
--   • un produit (simple ou déclinaison) peut avoir PLUSIEURS réfs chez un même
--     fournisseur : réf à l'unité, pack de 50, pack de 100, promo 4+1… ;
--   • une réf d'un fournisseur désigne UN SEUL produit. La remapper sur un autre
--     produit la retire du premier (c'est un déplacement, pas une copie).
--
-- Deux niveaux :
--   • product_suppliers reste le LIEN produit × fournisseur (principal, qté mini,
--     conditionnement et prix de l'association BMS) : UNIQUE(product_id,
--     supplier_id) est conservé, la quinzaine de requêtes qui joignent sur ce
--     couple ne dupliquent donc aucune ligne ;
--   • supplier_refs porte les réfs, chacune avec son conditionnement et son prix
--     HT DU PACK (prix unitaire = pack_price / pack_qty).
--
-- L'unicité porte sur la réf NORMALISÉE (casse, espaces en tête/fin, espaces
-- multiples), la même normalisation que normalizeSku() de l'import PDF : deux
-- fournisseurs peuvent partager un code, un même fournisseur non.
--
-- PRÉALABLE : aucune réf ne doit pointer sur plusieurs produits d'un même
-- fournisseur dans product_suppliers, sinon l'index unique refuse la reprise
-- (14 doublons nettoyés le 11/09/2026, sauvegarde product_suppliers_backup_20260911).
-- Contrôle avant d'appliquer — doit renvoyer 0 ligne :
--   SELECT supplier_id, lower(regexp_replace(btrim(supplier_sku), '\s+', ' ', 'g'))
--   FROM product_suppliers WHERE supplier_sku IS NOT NULL AND btrim(supplier_sku) <> ''
--   GROUP BY 1, 2 HAVING count(*) > 1;
--
-- product_suppliers.supplier_sku n'est plus ni lu ni écrit par l'app : la colonne
-- est gardée figée le temps de valider la bascule, puis à supprimer.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS supplier_refs (
  id           SERIAL PRIMARY KEY,
  supplier_id  INTEGER      NOT NULL,
  product_id   INTEGER      NOT NULL,
  supplier_sku VARCHAR(100) NOT NULL CHECK (btrim(supplier_sku) <> ''),
  label        VARCHAR(100),
  pack_qty     INTEGER      NOT NULL DEFAULT 1 CHECK (pack_qty >= 1),
  pack_price   NUMERIC(10,2),
  created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  -- Une réf n'existe que sur un lien produit × fournisseur ; retirer le
  -- fournisseur du produit emporte ses réfs.
  CONSTRAINT supplier_refs_link_fkey FOREIGN KEY (product_id, supplier_id)
    REFERENCES product_suppliers (product_id, supplier_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_refs_supplier_sku_key
  ON supplier_refs (supplier_id, lower(regexp_replace(btrim(supplier_sku), '\s+', ' ', 'g')));

CREATE INDEX IF NOT EXISTS idx_supplier_refs_product
  ON supplier_refs (product_id, supplier_id);

-- Reprise : chaque réf existante devient une réf, avec le conditionnement et le
-- prix portés jusqu'ici par le lien (supplier_price = prix du pack).
INSERT INTO supplier_refs (supplier_id, product_id, supplier_sku, pack_qty, pack_price, created_at, updated_at)
SELECT supplier_id, product_id, btrim(supplier_sku), COALESCE(NULLIF(pack_qty, 0), 1),
       supplier_price, created_at, updated_at
FROM product_suppliers
WHERE supplier_sku IS NOT NULL AND btrim(supplier_sku) <> ''
  AND NOT EXISTS (SELECT 1 FROM supplier_refs);

COMMENT ON COLUMN product_suppliers.supplier_sku IS
  'OBSOLÈTE depuis le 11/09/2026 — figée, plus lue ni écrite : les réfs sont dans supplier_refs.';

COMMIT;
