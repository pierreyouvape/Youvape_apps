const pool = require('../config/database');

/**
 * Clients inscrits SANS commande payée.
 *
 * Contexte métier : sur www.youvape.fr l'inscription se fait AU checkout, donc
 * les inscrits sans commande sont quasi toujours des paniers abandonnés
 * (`wc-checkout-draft`). On récupère leur pays de facturation depuis leur
 * dernière commande (brouillon inclus) quand elle existe — sinon "inconnu".
 *
 * ⚠️ La synchro des `wc-checkout-draft` est cassée depuis le 8/07/2026 : pour
 * les inscriptions récentes, le pays sera souvent absent tant que le flux n'a
 * pas été rétabli côté WordPress (cf. class-draft-scanner yousync).
 *
 * "Sans commande" = aucune commande dans les 6 statuts payés avec un total > 0
 * (même liste blanche que Financier / Stats).
 */

// Les 6 statuts WooCommerce considérés comme une vente réelle.
const PAID_STATUSES = [
  'wc-completed', 'wc-processing', 'wc-shipped',
  'wc-delivered', 'wc-being-delivered', 'wc-awaiting-delivery',
];

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

  const where = conditions.join('\n      AND ');

  // On pré-agrège en UNE passe la 1re commande payée par email (minuscule) plutôt
  // qu'une sous-requête corrélée par client (qui rescannait `orders` en entier pour
  // chaque inscrit → requête interminable, pas d'index sur billing_email).
  const query = `
    WITH paid_email_orders AS (
      SELECT LOWER(billing_email) AS email_lc, MIN(post_date) AS first_order_date
      FROM orders
      WHERE post_status = ANY($1)
        AND order_total > 0
        AND NULLIF(billing_email, '') IS NOT NULL
      GROUP BY LOWER(billing_email)
    )
    SELECT
      c.id,
      c.wp_user_id,
      c.email,
      c.first_name,
      c.last_name,
      c.user_registered,
      (
        SELECT NULLIF(o2.billing_country, '')
        FROM orders o2
        WHERE o2.wp_customer_id = c.wp_user_id
          AND NULLIF(o2.billing_country, '') IS NOT NULL
        ORDER BY o2.post_date DESC
        LIMIT 1
      ) AS country_code,
      -- A finalement commandé avec CE MÊME email (typiquement en invité,
      -- wp_customer_id = 0, donc non rattaché au compte). Insensible à la casse.
      peo.first_order_date AS ordered_by_email_date
    FROM customers c
    LEFT JOIN paid_email_orders peo ON peo.email_lc = LOWER(c.email)
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
