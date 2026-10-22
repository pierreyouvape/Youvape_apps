-- ============================================================================
-- Boutiques Nextore — désactivation BOUTIQUE PAR BOUTIQUE
-- ============================================================================
-- Les deux boutiques n'ont pas le même catalogue : un produit désactivé l'est
-- dans une boutique, pas dans les deux. L'indicateur passe donc de
-- nextore_products (global) à nextore_stock (produit × boutique). La synchro du
-- stock n'écrit que stock et rack : ces colonnes survivent.
--
-- Les 1 597 produits désactivés le 22/10/2026 à 10h25 (liste « Dormants 12 mois »
-- de Montpellier) restent désactivés dans les DEUX boutiques : choix de Pierre,
-- ils sont dormants à Castelnau aussi.
--
-- À appliquer en DEUX temps sur le VPS (l'ancien code lit encore nextore_products) :
--   1. partie 1, puis déploiement du code ;
--   2. partie 2.
-- ============================================================================

-- Partie 1 -------------------------------------------------------------------
ALTER TABLE nextore_stock ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;
ALTER TABLE nextore_stock ADD COLUMN IF NOT EXISTS disabled_by TEXT;

UPDATE nextore_stock st
SET disabled_at = p.disabled_at, disabled_by = p.disabled_by
FROM nextore_products p
WHERE p.product_id = st.product_id
  AND p.disabled_at IS NOT NULL
  AND st.disabled_at IS NULL;

-- Partie 2 (après déploiement, appliquée le 22/10/2026) ---------------------
ALTER TABLE nextore_products DROP COLUMN IF EXISTS disabled_at;
ALTER TABLE nextore_products DROP COLUMN IF EXISTS disabled_by;
