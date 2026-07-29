-- Mémorise les suppressions : (concurrent, produit) rejeté = ne jamais re-proposer/re-ajouter automatiquement
-- Créé le 2026-07-28
CREATE TABLE IF NOT EXISTS competitor_rejections (
  id          SERIAL PRIMARY KEY,
  competitor  VARCHAR(120) NOT NULL,
  parent_sku  VARCHAR(255) NOT NULL,  -- SKU produit Youvape (partie parent, sans la plage de variation)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (competitor, parent_sku)
);
