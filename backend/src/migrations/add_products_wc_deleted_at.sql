-- Un produit supprimé de WooCommerce doit sortir du catalogue.
--
-- La ligne, elle, ne peut pas être supprimée : commandes d'achat, réceptions,
-- lignes de documents fournisseurs et liens Nextore la référencent par des FK
-- sans CASCADE. On la marque donc comme disparue plutôt que de l'effacer.
--
-- Le marqueur est posé ET RETIRÉ par la resynchro nocturne (productDbSyncService),
-- qui compare la base au catalogue WooCommerce live : un produit sorti de la
-- corbeille revient donc tout seul au catalogue à la synchro suivante.
ALTER TABLE products ADD COLUMN IF NOT EXISTS wc_deleted_at TIMESTAMP;

-- Index partiel : seules les lignes disparues y entrent (une poignée), ce qui
-- rend leur recensement immédiat sans alourdir les écritures du catalogue.
CREATE INDEX IF NOT EXISTS idx_products_wc_deleted_at
  ON products (wc_deleted_at) WHERE wc_deleted_at IS NOT NULL;
