const pool = require('../config/database');

/**
 * ATB — Anthony Tool Box : accès données.
 *
 * Liste blanche des 6 statuts payés (règle projet, cf. CLAUDE.md) : jamais de
 * liste noire, le shop a des statuts custom + `wc-checkout-draft` très volumineux.
 */
const PAID_STATUSES = [
  'wc-completed',
  'wc-delivered',
  'wc-processing',
  'wc-awaiting-delivery',
  'wc-shipped',
  'wc-being-delivered',
];

/**
 * Nombre de commandes par jour sur une fenêtre [dateFrom, dateTo] (bornes incluses).
 *
 * Rattachement au jour par `COALESCE(paid_date, post_date)` — date de paiement
 * réelle, repli sur la création. Même convention que Financier, donc les chiffres
 * se recoupent d'un écran à l'autre.
 *
 * WooCommerce stocke en heure Paris locale : aucune conversion de fuseau ici,
 * la date est déjà celle attendue.
 *
 * @param {{ dateFrom: string, dateTo: string, statuses?: string[] }} params  dates en 'YYYY-MM-DD'
 * @returns {Promise<Map<string, number>>} jour 'YYYY-MM-DD' → nombre de commandes
 */
async function dailyOrderCounts({ dateFrom, dateTo, statuses = PAID_STATUSES }) {
  const { rows } = await pool.query(
    `SELECT to_char(COALESCE(o.paid_date, o.post_date), 'YYYY-MM-DD') AS day,
            COUNT(*)::int AS orders
       FROM orders o
      WHERE o.post_status = ANY($1::varchar[])
        AND COALESCE(o.paid_date, o.post_date) >= $2::timestamp
        AND COALESCE(o.paid_date, o.post_date) <  ($3::date + INTERVAL '1 day')
      GROUP BY 1`,
    [statuses, dateFrom, dateTo],
  );

  return new Map(rows.map((r) => [r.day, r.orders]));
}

module.exports = { PAID_STATUSES, dailyOrderCounts };
