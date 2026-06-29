-- Ajoute la colonne `discounted_price` (tarif remisé Woo Discount Rules, TTC).
-- Alimentée par le sync nocturne (productDbSyncService) via le champ
-- `wdr_discounted_price` exposé par un mu-plugin côté prod www.youvape.fr.
-- NULL = aucune remise active (ou mu-plugin prod pas encore déployé).
ALTER TABLE products ADD COLUMN IF NOT EXISTS discounted_price numeric(10,2);
