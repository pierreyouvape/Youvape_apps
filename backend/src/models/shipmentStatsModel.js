/**
 * Stats d'expédition — app du groupe « Prépa de commande ».
 *
 * Règles arrêtées avec Pierre le 29/09/2026 :
 *
 *   - **Colis** = étiquette non annulée de l'app, OU expédition emballée dans
 *     BMS (bms_shipments : seules les expéditions signées d'un préparateur y
 *     sont, celles que l'app confirme par API arrivent sans nom — pas de
 *     doublon). Créé dans la période, heure de Paris. La personne BMS est
 *     rattachée à son compte par bms_packer_map ; sans correspondance, son nom
 *     BMS s'affiche tel quel.
 *   - **Articles** = ce qui part dans le carton, avec la règle du Packing : un
 *     lot `woosb` compte par ses composants (lignes à 0 €), pas en plus ; les
 *     manquants d'une commande « envoyée incomplète » sont retirés. Comptés UNE
 *     fois par commande, sur sa première étiquette : une réexpédition est un
 *     colis de plus, pas des articles de plus.
 *   - **Temps par colis** = intervalle entre deux colis successifs d'une même
 *     personne, le même jour, DANS LA MÊME VAGUE, qu'ils sortent de l'app ou de
 *     BMS. Un intervalle couvre un cycle complet (fin d'emballage du précédent,
 *     scan, emballage du suivant) : 10 colis donnent 9 intervalles, et c'est
 *     par 9 qu'on divise. Au-delà de PAUSE_S, c'est une pause : l'intervalle
 *     est écarté. Le total se calcule sur tous les intervalles, jamais en
 *     moyennant les moyennes de chacun.
 *   - **Changement de vague** (07/10/2026) : la série est coupée, l'écart n'est
 *     ni compté ni pris pour une pause. Médiane 5 min 21 contre 1 min 07 dans
 *     une vague : c'est une autre activité (aller chercher le bac, se
 *     réinstaller), et le seuil de pause la triait au hasard. Les colis sans
 *     vague de l'app (BMS, étiquettes d'avant le 29/09, expédition manuelle)
 *     forment ensemble un groupe « sans vague » : chacun isolé, tout
 *     l'historique d'avant la bascule perdait ses écarts.
 *
 *   - **Picking / article** (07/10/2026) = temps actif des vagues terminées
 *     ÷ articles pickés (scannés + validés, PAS les manquants) : la moyenne par
 *     vague pondérée au nombre d'articles. Temps actif = somme des écarts entre
 *     actions successives de la vague (prise au PDA, dernière action de chaque
 *     ligne, « Terminer »), un écart de plus de PAUSE_S étant une pause. La
 *     vague revient à qui l'a terminée, le jour où elle l'a été.
 *
 * Heures : les étiquettes sont en UTC (NOW() sur un serveur UTC),
 * `orders.paid_date` en heure de Paris (WooCommerce) — ramené en UTC ici.
 */

const pool = require('../config/database');
const { BMS_SANS_DOUBLON } = require('../services/bmsShipmentSyncService');

/** Au-delà, l'écart entre deux colis est une pause (Pierre : 10 min le 29/09, 4 min le 07/10/2026). */
const PAUSE_S = 240;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Période : $1, $2 = jours de Paris inclus. */
const PERIODE = (col) => `
  ${col} >= ($1::date::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC'
  AND ${col} < (($2::date + 1)::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC'`;

/**
 * Colis de la période, des deux sources. `who` identifie la personne : son
 * compte de l'app, ou à défaut son nom BMS.
 */
const LAB = `
  lab AS (
    SELECT src.*,
           COALESCE('u' || src.user_id, 'b:' || src.bms_name, '?') AS who,
           (src.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris' AS local_at
      FROM (
        SELECT 'app' AS source, 'a' || l.id AS uid, l.order_number, l.packed_by AS user_id,
               NULL::text AS bms_name, l.carrier_code, l.account_code, l.created_at
          FROM shipment_labels l
         WHERE l.status = 'active' AND ${PERIODE('l.created_at')}
        UNION ALL
        SELECT 'bms', 'b' || b.bms_id, b.order_number, pm.user_id,
               b.packer_name, b.carrier_code, b.account_code, b.created_at
          FROM bms_shipments b
          LEFT JOIN bms_packer_map pm ON pm.packer_name = b.packer_name
         WHERE ${PERIODE('b.created_at')} AND ${BMS_SANS_DOUBLON}
      ) src
  )`;

/** Les étiquettes qui portent les articles : la première de chaque commande. */
const COUNTED = `
  first_lab AS (
    SELECT DISTINCT ON (order_number) uid
      FROM (
        SELECT 'a' || id AS uid, order_number, created_at FROM shipment_labels
         WHERE status = 'active' AND order_number IN (SELECT order_number FROM lab)
        UNION ALL
        SELECT 'b' || b.bms_id, b.order_number, b.created_at FROM bms_shipments b
         WHERE b.order_number IN (SELECT order_number FROM lab) AND ${BMS_SANS_DOUBLON}
      ) x
     ORDER BY order_number, created_at, uid
  ),
  counted AS (SELECT lab.* FROM lab JOIN first_lab f ON f.uid = lab.uid),
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
    SELECT c.uid, c.order_number, c.who, c.created_at,
           GREATEST(COALESCE(it.qty, 0) - COALESCE(mi.qty, 0), 0)::int AS qty
      FROM counted c
      LEFT JOIN items it ON it.order_number = c.order_number
      LEFT JOIN missing mi ON mi.order_number = c.order_number
  )`;

/**
 * Intervalles entre deux colis successifs d'une même personne, le même jour,
 * dans la même vague. La vague d'une étiquette est la dernière vague non
 * annulée créée avant elle (même règle que l'Historique).
 */
const INTERVALS = `
  order_waves AS (
    SELECT wo.order_number, w.id AS wave_id, w.created_at
      FROM picking_wave_orders wo
      JOIN picking_waves w ON w.id = wo.wave_id AND w.status <> 'cancelled'
     WHERE wo.order_number IN (SELECT order_number FROM lab WHERE source = 'app')
  ),
  waved AS (
    SELECT DISTINCT ON (l.uid) l.who, l.uid, l.created_at, l.local_at,
           COALESCE('w' || ow.wave_id, 'sans') AS wave_key
      FROM lab l
      LEFT JOIN order_waves ow
        ON l.source = 'app' AND ow.order_number = l.order_number AND ow.created_at <= l.created_at
     WHERE l.who <> '?'
     ORDER BY l.uid, ow.created_at DESC NULLS LAST
  ),
  seq AS (
    SELECT who, created_at, wave_key,
           LAG(created_at) OVER w AS prev,
           LAG(wave_key) OVER w AS prev_wave_key
      FROM waved
    WINDOW w AS (PARTITION BY who, local_at::date ORDER BY created_at, uid)
  ),
  intervals AS (
    SELECT who, EXTRACT(EPOCH FROM created_at - prev) AS s
      FROM seq WHERE prev IS NOT NULL AND wave_key = prev_wave_key
  )`;

/** Picking par personne : vagues terminées dans la période ($1, $2), pause $3. */
const PICKING_SQL = `
  WITH pick_waves AS (
    SELECT w.id, w.picked_by, w.assigned_at, w.picked_at
      FROM picking_waves w
     WHERE w.status IN ('picked', 'closed') AND w.picked_by IS NOT NULL
       AND w.assigned_at IS NOT NULL AND ${PERIODE('w.picked_at')}
  ),
  pick_events AS (
    SELECT id AS wave_id, assigned_at AS t FROM pick_waves
    UNION ALL
    SELECT l.wave_id, COALESCE(l.done_at, l.updated_at)
      FROM picking_wave_lines l JOIN pick_waves w ON w.id = l.wave_id
    UNION ALL
    SELECT id, picked_at FROM pick_waves
  ),
  pick_gaps AS (
    SELECT wave_id, EXTRACT(EPOCH FROM t - LAG(t) OVER (PARTITION BY wave_id ORDER BY t)) AS s
      FROM pick_events
  ),
  per_wave AS (
    SELECT w.id, w.picked_by,
           COALESCE(SUM(g.s) FILTER (WHERE g.s <= $3), 0) AS seconds,
           COUNT(*) FILTER (WHERE g.s > $3) AS pauses
      FROM pick_waves w JOIN pick_gaps g ON g.wave_id = w.id
     GROUP BY w.id, w.picked_by
  ),
  arts AS (
    SELECT l.wave_id, SUM(l.qty_scanned + l.qty_manual) AS articles
      FROM picking_wave_lines l JOIN pick_waves w ON w.id = l.wave_id
     GROUP BY 1
  )
  SELECT 'u' || pw.picked_by AS who, pw.picked_by AS user_id, u.name,
         COUNT(*)::int AS waves, COALESCE(SUM(a.articles), 0)::int AS articles,
         SUM(pw.seconds)::float AS seconds, SUM(pw.pauses)::int AS pauses
    FROM per_wave pw
    LEFT JOIN arts a ON a.wave_id = pw.id
    LEFT JOIN users u ON u.id = pw.picked_by
   GROUP BY pw.picked_by, u.name`;

/**
 * Ajoute le picking aux lignes par personne. Qui a pické sans packer sur la
 * période a sa ligne aussi, à zéro colis.
 */
const mergePicking = (people, picking) => {
  const byWho = new Map(people.map(p => [p.who, { ...p, picking: null }]));
  for (const k of picking) {
    const pick = { waves: k.waves, articles: k.articles, seconds: k.seconds, pauses: k.pauses };
    const row = byWho.get(k.who);
    if (row) row.picking = pick;
    else {
      byWho.set(k.who, {
        who: k.who, user_id: k.user_id, name: k.name || 'Inconnu', unmapped: false,
        parcels: 0, bms_parcels: 0, articles: 0, intervals: 0, pauses: 0, seconds: 0,
        first_at: null, last_at: null, picking: pick,
      });
    }
  }
  return [...byWho.values()];
};

const get = async ({ from, to }) => {
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) {
    const err = new Error('Période invalide');
    err.statusCode = 400;
    throw err;
  }
  const params = [from, to, PAUSE_S];

  const [people, carriers, hours, totals, incidents, picking] = await Promise.all([
    pool.query(
      `WITH ${LAB}, ${COUNTED}, ${INTERVALS},
       colis AS (
         SELECT who, MAX(user_id) AS user_id, MAX(bms_name) AS bms_name,
                COUNT(*)::int AS parcels,
                COUNT(*) FILTER (WHERE source = 'bms')::int AS bms_parcels,
                MIN(local_at) AS first_at, MAX(local_at) AS last_at
           FROM lab GROUP BY 1
       ),
       arts AS (SELECT who, SUM(qty)::int AS articles FROM articles GROUP BY 1),
       temps AS (
         SELECT who,
                COUNT(*) FILTER (WHERE s <= $3)::int AS intervals,
                COUNT(*) FILTER (WHERE s > $3)::int AS pauses,
                COALESCE(SUM(s) FILTER (WHERE s <= $3), 0)::float AS seconds
           FROM intervals GROUP BY 1
       )
       SELECT c.who, c.user_id, COALESCE(u.name, c.bms_name, 'Inconnu') AS name,
              (c.user_id IS NULL AND c.bms_name IS NOT NULL) AS unmapped,
              c.parcels, c.bms_parcels,
              COALESCE(a.articles, 0) AS articles,
              COALESCE(t.intervals, 0) AS intervals, COALESCE(t.pauses, 0) AS pauses,
              COALESCE(t.seconds, 0) AS seconds,
              to_char(c.first_at, 'HH24:MI') AS first_at, to_char(c.last_at, 'HH24:MI') AS last_at
         FROM colis c
         LEFT JOIN arts a ON a.who = c.who
         LEFT JOIN temps t ON t.who = c.who
         LEFT JOIN users u ON u.id = c.user_id
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
              (SELECT COUNT(*) FROM lab WHERE source = 'bms')::int AS bms_parcels,
              (SELECT COALESCE(SUM(qty), 0) FROM articles)::int AS articles,
              (SELECT COUNT(*) FILTER (WHERE s <= $3) FROM intervals)::int AS intervals,
              (SELECT COALESCE(SUM(s) FILTER (WHERE s <= $3), 0) FROM intervals)::float AS seconds,
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s) FROM delais WHERE s >= 0)::float AS delay_median_s,
              (SELECT COUNT(*) FROM delais WHERE s >= 0)::int AS delay_orders`,
      params
    ),
    pool.query(
      // Les incidents et annulations n'existent que dans l'app : BMS ne les connaît pas.
      `SELECT 'cancelled' AS kind, COUNT(*)::int AS n
         FROM shipment_labels
        WHERE status = 'cancelled'
          AND ${PERIODE('created_at')}
       UNION ALL
       SELECT action, COUNT(*)::int
         FROM picking_packing_incidents
        WHERE ${PERIODE('created_at')}
        GROUP BY action`,
      params.slice(0, 2)
    ),
    pool.query(PICKING_SQL, params),
  ]);

  const byKind = Object.fromEntries(incidents.rows.map(r => [r.kind, r.n]));

  return {
    from, to, pauseSeconds: PAUSE_S,
    totals: totals.rows[0],
    people: mergePicking(people.rows, picking.rows),
    carriers: carriers.rows,
    hours: hours.rows,
    incidents: {
      cancelled: byKind.cancelled || 0,
      incomplete: byKind.incomplete || 0,
      setAside: byKind.set_aside || 0,
    },
  };
};

module.exports = { get, PAUSE_S, mergePicking };

/**
 * Noms de préparateur vus dans BMS, et le compte de l'app auquel chacun est
 * rattaché — pour l'écran de correspondance.
 */
const listPackers = async () => {
  const [packers, users] = await Promise.all([
    pool.query(
      `SELECT b.packer_name, COUNT(*)::int AS parcels, MAX(b.created_at) AS last_at,
              pm.user_id, u.name AS user_name
         FROM bms_shipments b
         LEFT JOIN bms_packer_map pm ON pm.packer_name = b.packer_name
         LEFT JOIN users u ON u.id = pm.user_id
        GROUP BY b.packer_name, pm.user_id, u.name
        ORDER BY (pm.user_id IS NULL) DESC, last_at DESC`
    ),
    pool.query('SELECT id, name FROM users WHERE disabled_at IS NULL ORDER BY name'),
  ]);
  return { packers: packers.rows, users: users.rows };
};

/** Rattache (ou détache, `userId` nul) un nom BMS à un compte de l'app. */
const setPacker = async (packerName, userId, updatedBy) => {
  await pool.query(
    `INSERT INTO bms_packer_map (packer_name, user_id, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (packer_name) DO UPDATE
       SET user_id = EXCLUDED.user_id, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [packerName, userId, updatedBy]
  );
};

module.exports.listPackers = listPackers;
module.exports.setPacker = setPacker;
