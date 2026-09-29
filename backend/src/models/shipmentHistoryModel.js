/**
 * Historique d'expédition — app du groupe « Prépa de commande ».
 *
 * Un colis = une étiquette (`shipment_labels`). Autour d'elle, on recolle ce
 * que les autres tables savent du même colis : la commande, la vague de
 * picking, les incidents du packing, le bordereau de dépôt.
 *
 * Deux conventions d'heure cohabitent, et il faut les ramener à une seule :
 *   - les tables de l'app (étiquettes, vagues, bordereaux) sont remplies par
 *     `NOW()` sur un serveur en UTC → UTC sans fuseau ;
 *   - `orders.paid_date` / `post_date` arrivent de WooCommerce en heure de
 *     Paris → convertis ici en UTC, sinon le parcours d'un colis afficherait
 *     un paiement deux heures après son étiquette en été.
 */

const pool = require('../config/database');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 50;

/** Heure de Paris (WooCommerce) → UTC sans fuseau, comme le reste de l'app. */
const parisVersUtc = (col) => `((${col}) AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC'`;

/**
 * Une ligne par étiquette de l'app, enrichie. La vague retenue est la dernière
 * qui ait précédé l'étiquette (une commande mise de côté puis remise dans une
 * autre vague en a deux) ; une vague annulée n'a préparé personne.
 */
const BASE_APP = `
  SELECT 'app' AS source, 'a' || l.id AS uid, l.id, l.created_at, l.order_number, l.carrier_code, l.account_code, l.method_code,
         l.tracking_number, l.weight_g, l.status, l.cancelled_at, l.packed_by,
         l.bms_ship_status, l.bms_last_error, l.bms_attempts, l.bms_confirmed_at,
         (l.cn23_data IS NOT NULL) AS has_cn23,
         CASE WHEN l.carrier_code = 'chronopost' AND l.account_code = '2shop'
              THEN 'chronopost_2shop' ELSE l.carrier_code END AS carrier_key,
         pu.name AS packer_name,
         COALESCE(NULLIF(o.shipping_country, ''), o.billing_country) AS country,
         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', o.shipping_first_name, o.shipping_last_name)), ''),
                  TRIM(CONCAT_WS(' ', o.billing_first_name, o.billing_last_name))) AS customer_name,
         o.shipping_method,
         l.bordereau_id, b.bordereau_number, b.created_at AS bordereau_at,
         w.id AS wave_id, w.wave_number, w.picker_id, w.picker_name,
         inc.actions AS incidents
    FROM shipment_labels l
    LEFT JOIN users pu ON pu.id = l.packed_by
    LEFT JOIN orders o
      ON o.wp_order_id = CASE WHEN l.order_number ~ '^[0-9]{1,18}$' THEN l.order_number::bigint END
    LEFT JOIN shipment_bordereaux b ON b.id = l.bordereau_id
    LEFT JOIN LATERAL (
      SELECT pw.id, pw.wave_number,
             COALESCE(pw.picked_by, pw.assigned_to) AS picker_id, ku.name AS picker_name
        FROM picking_wave_orders wo
        JOIN picking_waves pw ON pw.id = wo.wave_id
        LEFT JOIN users ku ON ku.id = COALESCE(pw.picked_by, pw.assigned_to)
       WHERE wo.order_number = l.order_number
         AND pw.status <> 'cancelled'
         AND pw.created_at <= l.created_at
       ORDER BY pw.created_at DESC
       LIMIT 1
    ) w ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(DISTINCT i.action) AS actions
        FROM picking_packing_incidents i
       WHERE i.order_number = l.order_number
    ) inc ON true`;

/**
 * Les colis emballés dans BMS (bms_shipments), aux mêmes colonnes. Ni vague,
 * ni incident, ni bordereau de l'app : BMS ne nous les dit pas, et ils ne
 * s'annulent ni ne se réimpriment ici.
 */
const BASE_BMS = `
  SELECT 'bms' AS source, 'b' || b.bms_id AS uid, b.bms_id AS id, b.created_at, b.order_number,
         b.carrier_code, b.account_code, b.method_code, b.tracking_number, NULL::int AS weight_g,
         'active'::varchar AS status, NULL::timestamp AS cancelled_at, pm.user_id AS packed_by,
         'bms'::varchar AS bms_ship_status, NULL::text AS bms_last_error, 0 AS bms_attempts,
         NULL::timestamp AS bms_confirmed_at, false AS has_cn23,
         CASE WHEN b.carrier_code = 'chronopost' AND b.account_code = '2shop'
              THEN 'chronopost_2shop' ELSE b.carrier_code END AS carrier_key,
         COALESCE(pu.name, b.packer_name) AS packer_name,
         COALESCE(NULLIF(o.shipping_country, ''), o.billing_country) AS country,
         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', o.shipping_first_name, o.shipping_last_name)), ''),
                  TRIM(CONCAT_WS(' ', o.billing_first_name, o.billing_last_name))) AS customer_name,
         COALESCE(o.shipping_method, b.method_description) AS shipping_method,
         NULL::int AS bordereau_id, NULL::varchar AS bordereau_number, NULL::timestamp AS bordereau_at,
         NULL::int AS wave_id, NULL::varchar AS wave_number, NULL::int AS picker_id, NULL::varchar AS picker_name,
         NULL::varchar[] AS incidents
    FROM bms_shipments b
    LEFT JOIN bms_packer_map pm ON pm.packer_name = b.packer_name
    LEFT JOIN users pu ON pu.id = pm.user_id
    LEFT JOIN orders o
      ON o.wp_order_id = CASE WHEN b.order_number ~ '^[0-9]{1,18}$' THEN b.order_number::bigint END`;

const BASE = `${BASE_APP} UNION ALL ${BASE_BMS}`;

/**
 * Filtres → clause WHERE sur la CTE `base`.
 *
 * La recherche (n° de commande, de suivi, nom) porte sur TOUT l'historique :
 * on cherche un colis précis sans savoir quand il est parti.
 *
 * @param {object} f
 * @param {string[]} depositCarriers - transporteurs qui ont un bordereau : pour
 *        les autres (lettre suivie, retrait), « pas encore déposé » n'a pas de sens
 */
const buildWhere = (f, depositCarriers, { withUser = true } = {}) => {
  const conds = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };

  const q = String(f.q || '').trim();
  if (q) {
    const like = p(`%${q}%`);
    conds.push(`(order_number ILIKE ${like} OR tracking_number ILIKE ${like} OR customer_name ILIKE ${like})`);
  } else {
    // Bornes en heure de Paris, converties en UTC : le serveur est en UTC et
    // les colis du soir basculeraient sur le lendemain.
    if (DATE_RE.test(f.from || '')) {
      conds.push(`created_at >= (${p(f.from)}::date::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC'`);
    }
    if (DATE_RE.test(f.to || '')) {
      conds.push(`created_at < ((${p(f.to)}::date + 1)::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC'`);
    }
  }

  if (f.carrier) conds.push(`carrier_key = ${p(String(f.carrier))}`);

  const userId = parseInt(f.user, 10);
  if (withUser && userId) {
    const u = p(userId);
    conds.push(`(packed_by = ${u} OR picker_id = ${u})`);
  }

  switch (f.status) {
    case 'cancelled': conds.push(`status = 'cancelled'`); break;
    case 'bms_pending': conds.push(`status = 'active' AND bms_ship_status = 'pending'`); break;
    case 'incident': conds.push('incidents IS NOT NULL'); break;
    // Un colis BMS part sur le manifeste BMS : il n'attend aucun bordereau de l'app.
    case 'not_deposited':
      conds.push(`source = 'app' AND status = 'active' AND bordereau_id IS NULL AND carrier_code = ANY(${p(depositCarriers)})`);
      break;
    case 'bms': conds.push(`source = 'bms'`); break;
    default: break;
  }

  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
};

/**
 * Page de colis + compteurs de la sélection.
 *
 * Les compteurs par préparateur ignorent le filtre préparateur : ce sont aussi
 * les choix du menu, qui ne doit pas se réduire à la personne choisie.
 */
const list = async (filters, depositCarriers) => {
  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const { where, params } = buildWhere(filters, depositCarriers);
  const sansUser = buildWhere(filters, depositCarriers, { withUser: false });

  const [rows, totals, byCarrier, users] = await Promise.all([
    pool.query(
      `WITH base AS (${BASE}) SELECT * FROM base ${where}
        ORDER BY created_at DESC, uid DESC
        LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
      params
    ),
    pool.query(
      `WITH base AS (${BASE})
       SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'active')::int AS active,
              COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
              COUNT(*) FILTER (WHERE status = 'active' AND bms_ship_status = 'pending')::int AS bms_pending,
              COUNT(*) FILTER (WHERE incidents IS NOT NULL)::int AS incidents,
              COUNT(*) FILTER (WHERE source = 'bms')::int AS bms
         FROM base ${where}`,
      params
    ),
    pool.query(
      `WITH base AS (${BASE})
       SELECT carrier_key, carrier_code, account_code, COUNT(*)::int AS n
         FROM base ${where} ${where ? 'AND' : 'WHERE'} status = 'active'
        GROUP BY 1, 2, 3 ORDER BY n DESC`,
      params
    ),
    pool.query(
      `WITH base AS (${BASE}),
       sel AS (SELECT * FROM base ${sansUser.where} ${sansUser.where ? 'AND' : 'WHERE'} status = 'active'),
       packs AS (SELECT packed_by AS id, packer_name AS name, COUNT(*)::int AS n
                   FROM sel WHERE packed_by IS NOT NULL GROUP BY 1, 2),
       picks AS (SELECT picker_id AS id, picker_name AS name, COUNT(*)::int AS n
                   FROM sel WHERE picker_id IS NOT NULL GROUP BY 1, 2)
       SELECT COALESCE(a.id, k.id) AS id, COALESCE(a.name, k.name) AS name,
              COALESCE(a.n, 0) AS packed, COALESCE(k.n, 0) AS picked
         FROM packs a FULL JOIN picks k ON k.id = a.id
        ORDER BY packed DESC, picked DESC, name`,
      sansUser.params
    ),
  ]);

  return {
    rows: rows.rows,
    page,
    pageSize: PAGE_SIZE,
    totals: totals.rows[0],
    byCarrier: byCarrier.rows,
    users: users.rows,
  };
};

/**
 * Tout ce qu'on sait d'un colis, pour le panneau « parcours ».
 *
 * @param {number} id - id de l'étiquette (app) ou de l'expédition BMS
 * @param {'app'|'bms'} [source]
 */
const getDetail = async (id, source = 'app') => {
  const { rows: [label] } = await pool.query(
    `WITH base AS (${source === 'bms' ? BASE_BMS : BASE_APP}) SELECT * FROM base WHERE id = $1`,
    [id]
  );
  if (!label) return null;

  const [order, wave, incidents, bordereau, others] = await Promise.all([
    pool.query(
      `SELECT post_status, ${parisVersUtc('post_date')} AS created_at,
              ${parisVersUtc('paid_date')} AS paid_at
         FROM orders
        WHERE wp_order_id = CASE WHEN $1 ~ '^[0-9]{1,18}$' THEN $1::bigint END`,
      [label.order_number]
    ),
    label.wave_id
      ? pool.query(
        `SELECT w.id, w.wave_number, w.status, w.created_at, cu.name AS created_by_name,
                w.first_printed_at, w.printed_at, pu.name AS printed_by_name, w.print_count,
                w.assigned_at, au.name AS assigned_to_name,
                w.picked_at, ku.name AS picked_by_name,
                wo.active, wo.removed_at, ru.name AS removed_by_name, wo.removed_reason
           FROM picking_waves w
           JOIN picking_wave_orders wo ON wo.wave_id = w.id AND wo.order_number = $2
           LEFT JOIN users cu ON cu.id = w.created_by
           LEFT JOIN users pu ON pu.id = w.printed_by
           LEFT JOIN users au ON au.id = w.assigned_to
           LEFT JOIN users ku ON ku.id = w.picked_by
           LEFT JOIN users ru ON ru.id = wo.removed_by
          WHERE w.id = $1`,
        [label.wave_id, label.order_number]
      )
      : { rows: [] },
    pool.query(
      `SELECT i.id, i.action, i.missing, i.ticket_id, i.created_at, u.name AS created_by_name
         FROM picking_packing_incidents i
         LEFT JOIN users u ON u.id = i.created_by
        WHERE i.order_number = $1
        ORDER BY i.created_at`,
      [label.order_number]
    ),
    label.bordereau_id
      ? pool.query(
        `SELECT b.bordereau_number, b.created_at, u.name AS created_by_name
           FROM shipment_bordereaux b LEFT JOIN users u ON u.id = b.created_by
          WHERE b.id = $1`,
        [label.bordereau_id]
      )
      : { rows: [] },
    pool.query(
      `SELECT * FROM (
         SELECT 'app' AS source, l.id, l.created_at, l.carrier_code, l.account_code, l.tracking_number, l.status
           FROM shipment_labels l WHERE l.order_number = $1
         UNION ALL
         SELECT 'bms', b.bms_id, b.created_at, b.carrier_code, b.account_code, b.tracking_number, 'active'
           FROM bms_shipments b WHERE b.order_number = $1
       ) x
       WHERE NOT (source = $3 AND id = $2)
       ORDER BY created_at DESC`,
      [label.order_number, label.id, source]
    ),
  ]);

  return {
    label,
    order: order.rows[0] || null,
    wave: wave.rows[0] || null,
    incidents: incidents.rows,
    bordereau: bordereau.rows[0] || null,
    otherLabels: others.rows,
  };
};

module.exports = { list, getDetail, buildWhere, PAGE_SIZE };
