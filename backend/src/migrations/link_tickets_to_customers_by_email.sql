-- ─────────────────────────────────────────────────────────────────────────────
-- Relier rétroactivement les tickets SAV à leur fiche client via l'email.
--
-- Contexte : les tickets importés de Zendesk n'avaient pas de customer_id
-- (Zendesk ne fournit que le demandeur), donc l'app ne localisait pas le client.
-- On les relie par correspondance d'email avec la table customers.
--
-- Doublons d'email (un email partagé par plusieurs fiches) : on retient la fiche
-- LA PLUS ACTIVE = plus grand nombre de commandes valides, puis la plus
-- récemment inscrite. (Même logique que customerResolver.js côté app.)
--
-- Idempotent : ne touche que les tickets dont customer_id est NULL. Relancer la
-- migration est sans effet sur les tickets déjà reliés.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

WITH ranked AS (
  SELECT
    c.id   AS customer_id,
    LOWER(c.email) AS email_key,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(c.email)
      ORDER BY COUNT(o.wp_order_id) DESC,
               c.user_registered DESC NULLS LAST,
               c.id DESC
    ) AS rn
  FROM customers c
  LEFT JOIN orders o
    ON o.wp_customer_id = c.wp_user_id
   AND o.post_status NOT IN ('wc-cancelled', 'wc-failed', 'trash')
  WHERE NULLIF(c.email, '') IS NOT NULL
  GROUP BY c.id, c.email, c.user_registered
),
best_customer AS (
  -- Une seule fiche client par email (la plus active)
  SELECT customer_id, email_key FROM ranked WHERE rn = 1
)
UPDATE sav_tickets t
SET    customer_id = bc.customer_id
FROM   best_customer bc
WHERE  t.customer_id IS NULL
  AND  NULLIF(t.customer_email, '') IS NOT NULL
  AND  LOWER(t.customer_email) = bc.email_key;

COMMIT;

-- Vérification post-migration (lecture seule)
SELECT
  COUNT(*)                                   AS total_zendesk,
  COUNT(customer_id)                         AS reliés,
  COUNT(*) - COUNT(customer_id)              AS non_reliés
FROM sav_tickets
WHERE source = 'zendesk';
