-- ============================================================================
-- Boutiques Nextore — TOUS les codes-barres d'un article, un par ligne
-- ============================================================================
-- Nextore n'a qu'un champ `barcode` par article et y range plusieurs codes
-- séparés par « ; » (ex. « 6932467663983;6932467659559 » : ancien et nouvel
-- emballage). Comparé tel quel, aucun des deux codes ne correspondait : le
-- comptage répondait « code-barres inconnu ».
--
-- La synchro catalogue (nextoreModel.syncCatalog) réécrit la table à chaque
-- passage. L'INSERT ci-dessous l'amorce depuis le miroir actuel, avec la même
-- normalisation que utils/nextoreBarcodes.js, pour qu'elle ne soit pas vide
-- entre le déploiement et la synchro suivante.
--
-- À appliquer manuellement sur le VPS AVANT de déployer le code :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_nextore_product_barcodes.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS nextore_product_barcodes (
  product_id TEXT NOT NULL REFERENCES nextore_products(product_id) ON DELETE CASCADE,
  barcode    TEXT NOT NULL,
  PRIMARY KEY (product_id, barcode)
);

CREATE INDEX IF NOT EXISTS idx_nextore_product_barcodes_barcode
  ON nextore_product_barcodes (barcode);

INSERT INTO nextore_product_barcodes (product_id, barcode)
SELECT DISTINCT product_id, code
FROM (
  SELECT p.product_id,
         upper(regexp_replace(regexp_replace(t.code, '\s', '', 'g'), '^\][A-Za-z][0-9]', '')) AS code
  FROM nextore_products p
  CROSS JOIN LATERAL regexp_split_to_table(p.barcode, '[;,]') AS t(code)
  WHERE p.barcode IS NOT NULL
) c
WHERE code <> ''
ON CONFLICT DO NOTHING;
