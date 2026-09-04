-- ─────────────────────────────────────────────────────────────────────────────
-- Point relais choisi par le client, normalisé quel que soit le réseau.
--
-- Sans l'identifiant du point, aucun transporteur n'accepte une expédition en
-- relais : c'est la donnée qui manquait pour générer les étiquettes Mondial
-- Relay, Chronopost Relais, 2Shop et Colissimo point retrait.
--
-- L'information existait dans WooCommerce (trois plugins, trois formats) mais ne
-- quittait jamais le site : le chemin de sync vivant (yousync → wcSyncService)
-- ne la transmettait pas. La colonne mondial_relay_pickup_info, alimentée par
-- l'ancien chemin (youvape-sync-v2), est restée vide — 0 commande sur les 20 367
-- des 120 derniers jours. Elle est laissée en place, sans usage.
--
-- Forme du JSON, identique pour les trois réseaux :
--   {
--     "network":  "mondial_relay" | "chronopost" | "colissimo",
--     "id":       identifiant du point chez le transporteur,
--     "name":     enseigne,
--     "address":  ligne d'adresse,
--     "postcode": code postal,
--     "city":     ville,
--     "country":  code pays ISO 2,
--     "type":     type de point Colissimo (PCS, CMT, BPR, A2P…), null ailleurs,
--     "service":  méthode interne du plugin WMS quand elle est présente
--                 (chronopost_relais, chronopost_2shop, chronopost_2shop_europe,
--                 mondial_relay_point_relais) — absente des enregistrements
--                 laissés par les anciennes versions du plugin.
--   }
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS relay_point JSONB DEFAULT NULL;

-- La génération d'étiquettes part des commandes récentes à expédier en relais.
-- Index partiel : la grande majorité des commandes n'a pas de point relais.
CREATE INDEX IF NOT EXISTS idx_orders_relay_point_network
  ON orders ((relay_point ->> 'network'))
  WHERE relay_point IS NOT NULL;
