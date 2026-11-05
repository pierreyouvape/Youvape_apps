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

/**
 * Trie une liste d'adresses (fichier Probance) : pour chacune, a-t-elle déjà utilisé
 * le code (cette adresse, ou un compte WordPress qui a commandé avec elle), est-elle
 * un client signalé malhonnête, est-elle connue de nos commandes payées ?
 * @returns {Promise<Map<string, {used, dishonest, known}>>}
 */
async function classifyEmails(code, emails) {
  const { rows } = await pool.query(`
    WITH input AS (SELECT DISTINCT UNNEST($3::text[]) AS email),
    paid AS (
      SELECT o.wp_order_id, LOWER(TRIM(o.billing_email)) AS email, NULLIF(o.wp_customer_id, 0) AS uid
      FROM orders o
      WHERE o.post_status = ANY($1) AND o.order_total > 0 AND o.billing_email LIKE '%@%'
    ),
    coupon_orders AS (
      SELECT DISTINCT wp_order_id FROM order_items
      WHERE order_item_type = 'coupon' AND LOWER(TRIM(order_item_name)) = LOWER(TRIM($2))
    ),
    used AS (SELECT p.email, p.uid FROM paid p JOIN coupon_orders co ON co.wp_order_id = p.wp_order_id),
    used_emails AS (SELECT DISTINCT email FROM used),
    used_uids AS (SELECT DISTINCT uid FROM used WHERE uid IS NOT NULL),
    input_uids AS (
      SELECT DISTINCT p.email, p.uid FROM paid p JOIN input i ON i.email = p.email WHERE p.uid IS NOT NULL
    ),
    dishonest_uids AS (SELECT wp_user_id AS uid FROM customer_dishonest_flags WHERE removed_at IS NULL),
    -- Jointures (hachées) plutôt que des EXISTS par adresse sur un CTE : 12 s pour
    -- 952 adresses en EXISTS, le fichier Probance en compte des dizaines de milliers.
    used_by_account AS (SELECT DISTINCT iu.email FROM input_uids iu JOIN used_uids uu ON uu.uid = iu.uid),
    dishonest_emails AS (SELECT DISTINCT iu.email FROM input_uids iu JOIN dishonest_uids d ON d.uid = iu.uid),
    known_emails AS (SELECT DISTINCT email FROM paid)
    SELECT i.email,
           (ue.email IS NOT NULL OR ua.email IS NOT NULL) AS used,
           (de.email IS NOT NULL) AS dishonest,
           (ke.email IS NOT NULL) AS known
    FROM input i
    LEFT JOIN used_emails ue ON ue.email = i.email
    LEFT JOIN used_by_account ua ON ua.email = i.email
    LEFT JOIN dishonest_emails de ON de.email = i.email
    LEFT JOIN known_emails ke ON ke.email = i.email
  `, [PAID_STATUSES, code, emails]);
  return new Map(rows.map((r) => [r.email, r]));
}

/* ─── Suivi des envois ─────────────────────────────────── */

/** Enregistre une campagne et ses destinataires (adresses dédoublonnées). */
async function createCampaign({ code, source, label, filters, sentAt, emails, userId }) {
  const unique = [...new Set(emails.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [c] } = await client.query(`
      INSERT INTO relance_campaigns (code, source, label, filters, sent_at, recipients, created_by)
      VALUES ($1, $2, $3, $4, COALESCE($5::timestamp, (NOW() AT TIME ZONE 'Europe/Paris')), $6, $7)
      RETURNING id, TO_CHAR(sent_at, 'YYYY-MM-DD"T"HH24:MI') AS sent_at
    `, [code, source, label || null, filters ? JSON.stringify(filters) : null, sentAt || null, unique.length, userId || null]);
    await client.query(`
      INSERT INTO relance_campaign_recipients (campaign_id, email)
      SELECT $1, UNNEST($2::text[]) ON CONFLICT DO NOTHING
    `, [c.id, unique]);
    await client.query('COMMIT');
    return { id: c.id, sent_at: c.sent_at, recipients: unique.length };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function updateCampaign(id, { label, sentAt }) {
  const { rowCount } = await pool.query(`
    UPDATE relance_campaigns
    SET label = COALESCE($2, label), sent_at = COALESCE($3::timestamp, sent_at)
    WHERE id = $1
  `, [id, label ?? null, sentAt || null]);
  return rowCount > 0;
}

async function deleteCampaign(id) {
  const { rowCount } = await pool.query('DELETE FROM relance_campaigns WHERE id = $1', [id]);
  return rowCount > 0;
}

/**
 * Clients fidélisés par campagne : destinataires qui ont passé au moins une commande
 * payée APRÈS l'envoi, dont ceux qui l'ont passée avec le code de la campagne.
 * Plus une ligne « total » en adresses distinctes (un client relancé deux fois compte
 * une fois, à partir de son 1er envoi).
 */
async function campaignStats() {
  const { rows } = await pool.query(`
    WITH c AS (SELECT * FROM relance_campaigns),
    r AS (
      SELECT r.campaign_id, r.email, c.sent_at, c.code
      FROM relance_campaign_recipients r JOIN c ON c.id = r.campaign_id
    ),
    o AS (
      SELECT o.wp_order_id, LOWER(TRIM(o.billing_email)) AS email,
             COALESCE(o.paid_date, o.post_date) AS d, o.order_total
      FROM orders o
      WHERE o.post_status = ANY($1) AND o.order_total > 0
        AND o.post_date >= (SELECT MIN(sent_at) FROM c) - INTERVAL '2 days'
        AND COALESCE(o.paid_date, o.post_date) >= (SELECT MIN(sent_at) FROM c)
    ),
    coupons AS (
      SELECT DISTINCT i.wp_order_id, LOWER(TRIM(i.order_item_name)) AS code
      FROM order_items i JOIN o ON o.wp_order_id = i.wp_order_id
      WHERE i.order_item_type = 'coupon'
    ),
    hits AS (
      SELECT r.campaign_id, r.email, o.wp_order_id, o.order_total, o.d, r.sent_at,
             EXISTS (SELECT 1 FROM coupons k WHERE k.wp_order_id = o.wp_order_id AND k.code = LOWER(TRIM(r.code))) AS with_code
      FROM r JOIN o ON o.email = r.email AND o.d > r.sent_at
    ),
    per AS (
      SELECT campaign_id,
             COUNT(DISTINCT email) AS reordered,
             COUNT(DISTINCT email) FILTER (WHERE with_code) AS with_code,
             COUNT(DISTINCT wp_order_id) AS orders,
             COALESCE(SUM(order_total), 0) AS revenue,
             COALESCE(SUM(order_total) FILTER (WHERE with_code), 0) AS revenue_with_code
      FROM hits GROUP BY campaign_id
    ),
    first_send AS (SELECT email, MIN(sent_at) AS sent_at FROM r GROUP BY email),
    tot AS (
      SELECT COUNT(DISTINCT h.email) AS reordered,
             COUNT(DISTINCT h.email) FILTER (WHERE h.with_code) AS with_code,
             COUNT(DISTINCT h.wp_order_id) AS orders
      FROM hits h JOIN first_send f ON f.email = h.email AND h.d > f.sent_at
    )
    -- Dates en texte (heure de Paris telle quelle) : un Date JS serait relu en UTC.
    SELECT c.id, c.code, c.source, c.label, c.filters,
           TO_CHAR(c.sent_at, 'YYYY-MM-DD"T"HH24:MI') AS sent_at, c.recipients, c.created_at,
           u.email AS created_by_email,
           COALESCE(p.reordered, 0)::int AS reordered, COALESCE(p.with_code, 0)::int AS with_code,
           COALESCE(p.orders, 0)::int AS orders, COALESCE(p.revenue, 0)::float AS revenue,
           COALESCE(p.revenue_with_code, 0)::float AS revenue_with_code,
           (SELECT COUNT(*) FROM first_send)::int AS total_recipients,
           (SELECT reordered FROM tot)::int AS total_reordered,
           (SELECT with_code FROM tot)::int AS total_with_code,
           (SELECT orders FROM tot)::int AS total_orders
    FROM c
    LEFT JOIN per p ON p.campaign_id = c.id
    LEFT JOIN users u ON u.id = c.created_by
    ORDER BY c.sent_at DESC, c.id DESC
  `, [PAID_STATUSES]);
  return rows;
}

module.exports = {
  list, buildQuery, REF_COLUMNS, classifyEmails,
  createCampaign, updateCampaign, deleteCampaign, campaignStats,
};
