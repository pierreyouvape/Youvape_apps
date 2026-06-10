/**
 * Résolution d'un client interne (`customers.id`) à partir de l'email.
 *
 * Utilisé pour relier un ticket SAV à une fiche client WooCommerce quand seul
 * l'email du demandeur est connu (cas des tickets importés de Zendesk, où le
 * `customer_id` n'est pas fourni par la source).
 *
 * Cas des doublons d'email (un même email partagé par plusieurs fiches client) :
 * on retient la fiche **la plus active** = celle qui a le plus de commandes
 * valides, puis, à égalité, la plus récemment inscrite. C'est la fiche dont
 * l'historique est le plus utile au SAV.
 */

const pool = require('../config/database');

/**
 * @param {string|null} email
 * @returns {Promise<number|null>} customers.id ou null si non résolu
 */
async function resolveCustomerIdByEmail(email) {
  const e = (email || '').trim();
  if (!e) return null;

  const res = await pool.query(
    `SELECT c.id
       FROM customers c
       LEFT JOIN orders o
         ON o.wp_customer_id = c.wp_user_id
        AND o.post_status NOT IN ('wc-cancelled', 'wc-failed', 'trash')
      WHERE LOWER(c.email) = LOWER($1)
      GROUP BY c.id, c.user_registered
      ORDER BY COUNT(o.wp_order_id) DESC,
               c.user_registered DESC NULLS LAST,
               c.id DESC
      LIMIT 1`,
    [e]
  );
  return res.rows[0]?.id || null;
}

module.exports = { resolveCustomerIdByEmail };
