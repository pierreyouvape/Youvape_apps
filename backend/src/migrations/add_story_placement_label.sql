-- App « Stories » : emplacements par catégorie WooCommerce (03/11/2026).
--
-- target_type = 'category' : target_ref = identifiant du terme product_cat
-- (stable, contrairement au nom ou au slug) ; le widget s'affiche sur toutes les
-- fiches de la catégorie ET de ses sous-catégories. target_label garde le nom
-- lisible (« E-liquides › Arômes et Concentrés ») pour l'app et l'aperçu.
ALTER TABLE story_placements ADD COLUMN IF NOT EXISTS target_label TEXT;
