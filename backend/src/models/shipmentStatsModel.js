/**
 * Stats d'expédition — app du groupe « Prépa de commande ».
 *
 * Règles arrêtées avec Pierre le 29/09/2026 :
 *
 *   - **Colis** = étiquette non annulée, créée dans la période (heure de Paris).
 *   - **Articles** = ce qui part dans le carton, avec la règle du Packing : un
 *     lot `woosb` compte par ses composants (lignes à 0 €), pas en plus ; les
 *     manquants d'une commande « envoyée incomplète » sont retirés. Comptés UNE
 *     fois par commande, sur sa première étiquette : une réexpédition est un
 *     colis de plus, pas des articles de plus.
 *   - **Temps par colis** = intervalle entre deux étiquettes successives d'une
 *     même personne, le même jour. Un intervalle couvre un cycle complet (fin
 *     d'emballage du précédent, scan, emballage du suivant) : 10 colis donnent
 *     9 intervalles, et c'est par 9 qu'on divise. Au-delà de PAUSE_S, c'est une
 *     pause : l'intervalle est écarté. Le total se calcule sur tous les
 *     intervalles, jamais en moyennant les moyennes de chacun.
 *
 * Heures : les étiquettes sont en UTC (NOW() sur un serveur UTC),
 * `orders.paid_date` en heure de Paris (WooCommerce) — ramené en UTC ici.
 */

const pool = require('../config/database');

/** Au-delà, l'écart entre deux étiquettes est une pause (Pierre, 29/09/2026). */
const PAUSE_S = 600;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Étiquettes non annulées de la période ($1, $2 = jours de Paris inclus). */
const LAB = `
  lab AS (
    SELECT l.id, l.order_number, l.packed_by, l.carrier_code, l.account_code, l.created_at,
           (l.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris' AS local_at
      FROM shipment_labels l
     WHERE l.status = 'active'
       AND l.created_at >= ($1::date::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC'
       AND l.created_at <  (($2::date + 1)::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC'
  )`;

/** Les étiquettes qui portent les articles : la première de chaque commande. */
const COUNTED = `
  first_lab AS (
    SELECT DISTINCT ON (l.order_number) l.id
      FROM shipment_labels l
     WHERE l.status = 'active' AND l.order_number IN (SELECT order_number FROM lab)
     ORDER BY l.order_number, l.created_at, l.id
  ),
  counted AS (SELECT lab.* FROM lab JOIN first_lab f ON f.id = lab.id),
  lines AS (
    SELECT oi.wp_order_id, oi.qty, p.product_type,
           bool_or(p.product_type IS DISTINCT FROM 'woosb' AND oi.line_total = 0)
             OVER (PARTITION BY oi.wp_order_id) AS has_components
      FROM order_items oi
      LEFT JOIN products p ON p.wp_product_id = COALESCE(NULLIF(oi.variation_id, 0), oi.product_id)
     WHERE oi.order_item_type = 'line_item'
       AND oi.wp_order_id IN (SELECT CASE WHEN order_number ~ '^[0-9]{1,18}$' THEN order_number::bigint END FROM counted)
  ),
  items AS (
    SELECT wp_order_id::text AS order_number,
           SUM(qty) FILTER (WHERE NOT (product_type = 'woosb' AND has_components)) AS qty
      FROM lines GROUP BY 1
  ),
  missing AS (
    SELECT i.order_number, SUM((m->>'qty')::int) AS qty
      FROM picking_packing_incidents i
      CROSS JOIN LATERAL jsonb_array_elements(i.missing) m
     WHERE i.action = 'incomplete' AND i.order_number IN (SELECT order_number FROM counted)
     GROUP BY 1
  ),
  articles AS (
    SELECT c.id, c.order_number, c.packed_by, c.created_at,
           GREATEST(COALESCE(it.qty, 0) - COALESCE(mi.qty, 0), 0)::int AS qty
      FROM counted c
      LEFT JOIN items it ON it.order_number = c.order_number
      LEFT JOIN missing mi ON mi.order_number = c.order_number
  )`;

/** Intervalles entre deux étiquettes successives d'une même personne, le même jour. */
const INTERVALS = `
  seq AS (
    SELECT packed_by, created_at,
           LAG(created_at) OVER (PARTITION BY packed_by, local_at::date ORDER BY created_at, id) AS prev
      FROM lab WHERE packed_by IS NOT NULL
  ),
  intervals AS (
    SELECT packed_by, EXTRACT(EPOCH FROM created_at - prev) AS s
      FROM seq WHERE prev IS NOT NULL
  )`;

const get = async ({ from, to }) => {
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) {
    const err = new Error('Période invalide');
    err.statusCode = 400;
    throw err;
  }
  const params = [from, to, PAUSE_S];

  const [people, carriers, hours, totals, incidents] = await Promise.all([
    pool.query(
      `WITH ${LAB}, ${COUNTED}, ${INTERVALS},
       colis AS (
         SELECT packed_by, COUNT(*)::int AS parcels,
                MIN(local_at) AS first_at, MAX(local_at) AS last_at
           FROM lab GROUP BY 1
       ),
       arts AS (SELECT packed_by, SUM(qty)::int AS articles FROM articles GROUP BY 1),
       temps AS (
         SELECT packed_by,
                COUNT(*) FILTER (WHERE s <= $3)::int AS intervals,
                COUNT(*) FILTER (WHERE s > $3)::int AS pauses,
                COALESCE(SUM(s) FILTER (WHERE s <= $3), 0)::float AS seconds
           FROM intervals GROUP BY 1
       )
       SELECT c.packed_by AS user_id, COALESCE(u.name, 'Inconnu') AS name, c.parcels,
              COALESCE(a.articles, 0) AS articles,
              COALESCE(t.intervals, 0) AS intervals, COALESCE(t.pauses, 0) AS pauses,
              COALESCE(t.seconds, 0) AS seconds,
              to_char(c.first_at, 'HH24:MI') AS first_at, to_char(c.last_at, 'HH24:MI') AS last_at
         FROM colis c
         LEFT JOIN arts a ON a.packed_by IS NOT DISTINCT FROM c.packed_by
         LEFT JOIN temps t ON t.packed_by IS NOT DISTINCT FROM c.packed_by
         LEFT JOIN users u ON u.id = c.packed_by
        ORDER BY c.parcels DESC, name`,
      params
    ),
    pool.query(
      `WITH ${LAB}
       SELECT CASE WHEN carrier_code = 'chronopost' AND account_code = '2shop'
                   THEN 'chronopost_2shop' ELSE carrier_code END AS carrier_key,
              carrier_code, account_code, COUNT(*)::int AS parcels
         FROM lab GROUP BY 1, 2, 3 ORDER BY parcels DESC`,
      params.slice(0, 2)
    ),
    pool.query(
      `WITH ${LAB}
       SELECT EXTRACT(HOUR FROM local_at)::int AS hour, COUNT(*)::int AS parcels
         FROM lab GROUP BY 1 ORDER BY 1`,
      params.slice(0, 2)
    ),
    pool.query(
      `WITH ${LAB}, ${COUNTED}, ${INTERVALS},
       delais AS (
         SELECT EXTRACT(EPOCH FROM a.created_at
                  - (o.paid_date AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC') AS s
           FROM articles a
           JOIN orders o ON o.wp_order_id = CASE WHEN a.order_number ~ '^[0-9]{1,18}$'
                                                 THEN a.order_number::bigint END
          WHERE o.paid_date IS NOT NULL
       )
       SELECT (SELECT COUNT(*) FROM lab)::int AS parcels,
              (SELECT COALESCE(SUM(qty), 0) FROM articles)::int AS articles,
              (SELECT COUNT(*) FILTER (WHERE s <= $3) FROM intervals)::int AS intervals,
              (SELECT COALESCE(SUM(s) FILTER (WHERE s <= $3), 0) FROM intervals)::float AS seconds,
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s) FROM delais WHERE s >= 0)::float AS delay_median_s,
              (SELECT COUNT(*) FROM delais WHERE s >= 0)::int AS delay_orders`,
      params
    ),
    pool.query(
      `SELECT 'cancelled' AS kind, COUNT(*)::int AS n
         FROM shipment_labels
        WHERE status = 'cancelled'
          AND created_at >= ($1::date::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC'
          AND created_at <  (($2::date + 1)::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC'
       UNION ALL
       SELECT action, COUNT(*)::int
         FROM picking_packing_incidents
        WHERE created_at >= ($1::date::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC'
          AND created_at <  (($2::date + 1)::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC'
        GROUP BY action`,
      params.slice(0, 2)
    ),
  ]);

  const byKind = Object.fromEntries(incidents.rows.map(r => [r.kind, r.n]));

  return {
    from, to, pauseSeconds: PAUSE_S,
    totals: totals.rows[0],
    people: people.rows,
    carriers: carriers.rows,
    hours: hours.rows,
    incidents: {
      cancelled: byKind.cancelled || 0,
      incomplete: byKind.incomplete || 0,
      setAside: byKind.set_aside || 0,
    },
  };
};

module.exports = { get, PAUSE_S };
