-- ============================================================================
-- Avoir des frais de port en points WPLoyalty, depuis la fiche commande (05/11/2026)
--
-- Un seul avoir de port par commande (UNIQUE) : la ligne est posée AVANT
-- l'appel à WPLoyalty et retirée s'il refuse, un double clic ne crédite donc
-- pas deux fois.
--
-- customer_returns.loyalty_shipping = part de port (€ TTC) comprise dans
-- l'avoir en points d'un retour. Elle empêche de rendre le port deux fois :
-- par un retour « + frais de port » ET par le bouton de la fiche commande.
-- Les 6 retours déjà crédités avec le port sont repris de leur outcome_ref
-- (« 954 points (5,64 € + 3,90 € de port) »).
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_order_shipping_credits.sql
-- Retour arrière : rollback_order_shipping_credits.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS order_shipping_credits (
  id           SERIAL PRIMARY KEY,
  wp_order_id  INTEGER NOT NULL UNIQUE,
  points       INTEGER NOT NULL CHECK (points > 0),
  amount_ttc   NUMERIC(10,2) NOT NULL,
  email        VARCHAR(255) NOT NULL,
  via          VARCHAR(10),
  ticket_id    INTEGER,
  credited_by  INTEGER REFERENCES users(id),
  credited_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE customer_returns ADD COLUMN IF NOT EXISTS loyalty_shipping NUMERIC(10,2);

UPDATE customer_returns
   SET loyalty_shipping = replace(substring(outcome_ref from '\+ ([0-9]+,[0-9]{2}) € de port'), ',', '.')::numeric
 WHERE outcome = 'points'
   AND outcome_ref LIKE '%€ de port%'
   AND loyalty_shipping IS NULL;

COMMIT;
