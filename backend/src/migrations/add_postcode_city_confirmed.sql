-- ─────────────────────────────────────────────────────────────────────────────
-- Adresse validée malgré le contrôle code postal / commune (Picking).
--
-- Le Picking signale « Code postal / ville incohérents » quand la commune
-- n'existe pas pour le code postal dans la base La Poste : Colissimo facture
-- 3 € HT de « qualité d'annonce » (commande 1257705). Certaines adresses sont
-- justes quand même — code CEDEX d'entreprise, commune nouvelle pas encore dans
-- la base. Le bouton « Adresse vérifiée, garder telle quelle » enregistre ici
-- le couple validé :
--   { "postcode": "94275", "city": "Le Kremlin-Bicêtre",
--     "by": 12, "by_name": "Pierre", "at": "2026-11-04T11:20:00Z" }
--
-- La validation ne vaut que pour CE couple : si le code postal ou la ville
-- changent ensuite (correction, resynchro WooCommerce), le contrôle reprend.
-- La synchro WooCommerce n'écrit jamais cette colonne.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS postcode_city_confirmed JSONB DEFAULT NULL;
