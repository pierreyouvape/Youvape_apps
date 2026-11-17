-- Boutiques : fournisseur ÉCARTÉ d'un produit (17/11/2026).
-- Les besoins proposent un produit chez ses fournisseurs = achats reçus + fiche Nextore.
-- Retirer un fournisseur le sort de la fiche Nextore ; s'il vient aussi des achats,
-- cette ligne l'écarte. Un nouvel achat reçu chez lui APRÈS excluded_at le fait revenir.
CREATE TABLE IF NOT EXISTS nextore_product_supplier_exclusions (
  product_id  TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  excluded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  excluded_by TEXT,
  PRIMARY KEY (product_id, supplier_id)
);
