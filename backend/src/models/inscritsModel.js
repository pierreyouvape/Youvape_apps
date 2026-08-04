const pool = require('../config/database');

/**
 * Clients inscrits SANS commande payée.
 *
 * Contexte métier : sur www.youvape.fr l'inscription se fait AU checkout. Ces
 * inscrits ont donc typiquement une (ou des) commande(s) qui n'a pas abouti :
 * paiement **échoué** (`wc-failed`) ou commande **annulée** (`wc-cancelled`).
 * Ces commandes sont bien synchronisées → on en tire le pays de facturation.
 *
 * "Sans commande" = aucune commande dans les 6 statuts payés avec un total > 0
 * (même liste blanche que Financier / Stats).
 */

// Les 6 statuts WooCommerce considérés comme une vente réelle.
const PAID_STATUSES = [
  'wc-completed', 'wc-processing', 'wc-shipped',
  'wc-delivered', 'wc-being-delivered', 'wc-awaiting-delivery',
];

// Tentatives de commande non abouties dont on tire le pays de facturation.
const FAILED_STATUSES = ['wc-failed', 'wc-cancelled'];

/**
 * Liste des inscrits sans commande sur une plage d'inscription.
 * `user_registered` est stocké en heure de Paris (pas UTC) → on compare tel quel.
 *
 * @param {Object}  opts
 * @param {string} [opts.dateFrom] borne basse incluse  'YYYY-MM-DD'
 * @param {string} [opts.dateTo]   borne haute incluse   'YYYY-MM-DD' (jour entier)
 * @returns {Promise<Array>} lignes { id, wp_user_id, email, first_name, last_name, user_registered, country_code }
 */
async function listWithoutOrders({ dateFrom, dateTo } = {}) {
  const conditions = ['c.user_registered IS NOT NULL'];
  const params = [PAID_STATUSES];
  let idx = 2;

  if (dateFrom) {
    conditions.push(`c.user_registered >= $${idx++}`);
    params.push(`${dateFrom} 00:00:00`);
  }
  if (dateTo) {
    // borne haute exclusive au lendemain minuit → journée complète incluse
    conditions.push(`c.user_registered < $${idx++}`);
    params.push(`${dateTo} 23:59:59.999`);
  }

  // Statuts "échouée / annulée" : source du pays (paramètre dédié).
  const failedIdx = idx++;
  params.push(FAILED_STATUSES);

  const where = conditions.join('\n      AND ');

  // Deux pré-agrégations en UNE passe chacune, indexées par email (minuscule),
  // plutôt que des sous-requêtes corrélées par client (qui rescannaient `orders`
  // en entier pour chaque inscrit → requête interminable) :
  //   - paid_email_orders : 1re commande PAYÉE (conversion ultérieure) ;
  //   - failed_email_country : pays de la dernière commande ÉCHOUÉE/ANNULÉE
  //     (tentative de checkout non aboutie, invité inclus car matché sur l'email).
  const query = `
    WITH paid_email_orders AS (
      SELECT LOWER(billing_email) AS email_lc, MIN(post_date) AS first_order_date
      FROM orders
      WHERE post_status = ANY($1)
        AND order_total > 0
        AND NULLIF(billing_email, '') IS NOT NULL
      GROUP BY LOWER(billing_email)
    ),
    failed_email_country AS (
      SELECT DISTINCT ON (LOWER(billing_email))
        LOWER(billing_email) AS email_lc,
        NULLIF(billing_country, '') AS cc
      FROM orders
      WHERE post_status = ANY($${failedIdx})
        AND NULLIF(billing_email, '') IS NOT NULL
        AND NULLIF(billing_country, '') IS NOT NULL
      ORDER BY LOWER(billing_email), post_date DESC
    ),
    last_order_by_email AS (
      SELECT DISTINCT ON (LOWER(billing_email))
        LOWER(billing_email) AS email_lc,
        post_status,
        NULLIF(mollie_payment_id, '') AS mollie_pay
      FROM orders
      WHERE NULLIF(billing_email, '') IS NOT NULL
      ORDER BY LOWER(billing_email), post_date DESC
    ),
    name_by_email AS (
      -- Nom/prénom de facturation de la dernière commande (tous statuts, échouée/
      -- annulée incluses) qui en porte un — pour compléter les comptes sans nom.
      SELECT DISTINCT ON (LOWER(billing_email))
        LOWER(billing_email) AS email_lc,
        NULLIF(billing_first_name, '') AS bfn,
        NULLIF(billing_last_name, '')  AS bln
      FROM orders
      WHERE NULLIF(billing_email, '') IS NOT NULL
        AND (NULLIF(billing_first_name, '') IS NOT NULL OR NULLIF(billing_last_name, '') IS NOT NULL)
      ORDER BY LOWER(billing_email), post_date DESC
    )
    SELECT
      c.id,
      c.wp_user_id,
      c.email,
      COALESCE(NULLIF(c.first_name, ''), nbe.bfn) AS first_name,
      COALESCE(NULLIF(c.last_name, ''),  nbe.bln) AS last_name,
      c.user_registered,
      -- Pays issu de leur dernière commande ÉCHOUÉE ou ANNULÉE.
      fec.cc AS country_code,
      -- A finalement commandé avec CE MÊME email (conversion, invité inclus).
      peo.first_order_date AS ordered_by_email_date,
      -- Statut de leur dernière commande (tous statuts) matché par email.
      lob.post_status AS last_order_status,
      -- Raison pour une commande échouée/annulée :
      --   • wc-failed = le paiement a été tenté et a échoué → "paiement refusé"
      --     (mollie_payment_id est sous-synchronisé, on se fie au statut) ;
      --   • wc-cancelled = "paiement refusé" si un paiement a été initié
      --     (mollie_payment_id présent), sinon "abandon" (jamais payé → auto-annulée).
      CASE
        WHEN lob.post_status = 'wc-failed'    THEN 'payment_refused'
        WHEN lob.post_status = 'wc-cancelled' THEN CASE WHEN lob.mollie_pay IS NOT NULL THEN 'payment_refused' ELSE 'abandon' END
        ELSE NULL
      END AS last_order_reason
    FROM customers c
    LEFT JOIN paid_email_orders peo ON peo.email_lc = LOWER(c.email)
    LEFT JOIN failed_email_country fec ON fec.email_lc = LOWER(c.email)
    LEFT JOIN last_order_by_email lob ON lob.email_lc = LOWER(c.email)
    LEFT JOIN name_by_email nbe ON nbe.email_lc = LOWER(c.email)
    WHERE ${where}
      AND NOT EXISTS (
        SELECT 1
        FROM orders o
        WHERE o.wp_customer_id = c.wp_user_id
          AND o.post_status = ANY($1)
          AND o.order_total > 0
      )
    ORDER BY c.user_registered DESC
  `;

  const { rows } = await pool.query(query, params);
  return rows;
}

module.exports = { listWithoutOrders, PAID_STATUSES };
