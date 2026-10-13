-- Fiche produit remplacée par une autre (scission, recréation dans WooCommerce).
--
-- Cas d'origine (13/10/2026) : les Cartouches CLK One 20mg ont quitté le produit
-- #1217380 pour un nouveau produit #1268828 ; les 13 anciennes déclinaisons ont
-- été supprimées dans WC (neutralisées chez nous, jamais effacées). Sans ce
-- lien, les nouvelles déclinaisons démarraient sans historique de ventes : le
-- calcul des Besoins ne les proposait pas au réassort alors qu'elles se vendent.
--
-- Le lien ne réécrit RIEN de l'historique : les commandes clients et d'achat
-- restent sur l'ancienne fiche. Il dit seulement « les ventes, le dernier tarif
-- validé et les fournisseurs prouvés de l'ancienne comptent pour la nouvelle »
-- (needsCalculationModel).
CREATE TABLE IF NOT EXISTS product_successors (
  old_product_id  INTEGER PRIMARY KEY REFERENCES products(id),
  new_product_id  INTEGER NOT NULL REFERENCES products(id),
  note            TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (old_product_id <> new_product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_successors_new ON product_successors(new_product_id);
