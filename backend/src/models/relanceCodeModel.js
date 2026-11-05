const pool = require('../config/database');
const { PAID_STATUSES } = require('./inscritsModel');

/**
 * Relance code promo : clients qui n'ont JAMAIS utilisé un code (TEAMYOUVAPE par défaut).
 *
 * Sert à préparer une liste d'e-mails pour Probance (relance de la 2e commande, ou envoi
 * aux clients existants). Le consentement newsletter n'est PAS ici : il vit chez Probance
 * (plugin probance-optin, `optin_flag`), qui écarte lui-même les non-abonnés à l'envoi.
 *
 * - Un client = une adresse e-mail de facturation (minuscules), sur ses commandes PAYÉES
 *   (mêmes statuts que Financier / Stats, total > 0).
 * - « A utilisé le code » = une ligne `coupon` de ce nom sur une commande payée, soit avec
 *   cette adresse, soit sur le même compte WordPress (WooCommerce limite le code par compte
 *   ET par adresse).
 * - Les clients signalés malhonnêtes (`customer_dishonest_flags` actif) sont exclus.
 * - Dates en heure de Paris, comme WooCommerce les stocke.
 */

// Date de référence du filtre « il y a entre X et Y jours ».
const REF_COLUMNS = {
  first: 'cl.first_order',
  last: 'cl.last_order',
  registered: 'cu.user_registered',
};

function buildQuery({ code, ref = 'first', minDays = null, maxDays = null, oneOrderOnly = false, country = '' }) {
  const refCol = REF_COLUMNS[ref];
  if (!refCol) throw new Error(`Date de référence inconnue : ${ref}`);

  const params = [PAID_STATUSES, code];
  const where = [];
  const today = "(now() AT TIME ZONE 'Europe/Paris')::date";

  if (minDays !== null) {
    params.push(minDays);
    where.push(`${refCol}::date <= ${today} - $${params.length}::int`);
  }
  if (maxDays !== null) {
    params.push(maxDays);
    where.push(`${refCol}::date >= ${today} - $${params.length}::int`);
  }
  if (oneOrderOnly) where.push('cl.nb_orders = 1');
  if (country) {
    params.push(country);
    where.push(`cl.country = $${params.length}`);
  }

  const sql = `
    WITH paid AS (
      SELECT o.wp_order_id,
             LOWER(TRIM(o.billing_email)) AS email,
             NULLIF(o.wp_customer_id, 0) AS uid,
             COALESCE(o.paid_date, o.post_date) AS d,
             NULLIF(o.billing_country, '') AS c,
             NULLIF(TRIM(o.billing_first_name), '') AS fn,
             NULLIF(TRIM(o.billing_last_name), '') AS ln
      FROM orders o
      WHERE o.post_status = ANY($1)
        AND o.order_total > 0
        AND o.billing_email LIKE '%@%'
    ),
    coupon_orders AS (
      SELECT DISTINCT wp_order_id
      FROM order_items
      WHERE order_item_type = 'coupon'
        AND LOWER(TRIM(order_item_name)) = LOWER(TRIM($2))
    ),
    used AS (
      SELECT p.email, p.uid FROM paid p JOIN coupon_orders co ON co.wp_order_id = p.wp_order_id
    ),
    used_emails AS (SELECT DISTINCT email FROM used),
    used_uids AS (SELECT DISTINCT uid FROM used WHERE uid IS NOT NULL),
    clients AS (
      SELECT email,
             (ARRAY_AGG(fn ORDER BY d DESC) FILTER (WHERE fn IS NOT NULL))[1] AS first_name,
             (ARRAY_AGG(ln ORDER BY d DESC) FILTER (WHERE ln IS NOT NULL))[1] AS last_name,
             (ARRAY_AGG(c  ORDER BY d DESC) FILTER (WHERE c  IS NOT NULL))[1] AS country,
             (ARRAY_AGG(uid ORDER BY d DESC) FILTER (WHERE uid IS NOT NULL))[1] AS uid,
             MIN(d) AS first_order,
             MAX(d) AS last_order,
             COUNT(*)::int AS nb_orders
      FROM paid
      GROUP BY email
    )
    SELECT cl.email, cl.first_name, cl.last_name, cl.country, cl.uid AS wp_user_id,
           cl.first_order, cl.last_order, cl.nb_orders, cu.user_registered
    FROM clients cl
    LEFT JOIN customers cu ON cu.wp_user_id = cl.uid
    -- Anti-jointures : un « NOT IN (sous-requête) » sur l'e-mail n'est pas haché par
    -- PostgreSQL et relisait la liste pour chaque client (57 s mesurées, contre 2 s).
    WHERE NOT EXISTS (SELECT 1 FROM used_emails ue WHERE ue.email = cl.email)
      AND NOT EXISTS (SELECT 1 FROM used_uids uu WHERE uu.uid = cl.uid)
      AND NOT EXISTS (
        SELECT 1 FROM customer_dishonest_flags f
        WHERE f.removed_at IS NULL AND f.wp_user_id = cl.uid
      )
      ${where.map((w) => `AND ${w}`).join('\n      ')}
    ORDER BY ${refCol} DESC NULLS LAST, cl.email
  `;
  return { sql, params };
}

async function list(opts) {
  const { sql, params } = buildQuery(opts);
  const { rows } = await pool.query(sql, params);
  return rows;
}

module.exports = { list, buildQuery, REF_COLUMNS };
