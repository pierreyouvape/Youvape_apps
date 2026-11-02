/**
 * Clients ayant été malhonnêtes : signalement depuis la fiche client, et
 * reconnaissance de leurs commandes futures, même sous un nouveau compte.
 *
 * Le blocage au Picking est recalculé à chaque lecture (matchOrders) : une
 * commande payée entre deux passages du cron ne doit pas partir dans une vague
 * automatique. Le cron (dishonestOrderService) ne fait qu'ouvrir les tickets.
 *
 * Seules les commandes PAYÉES, créées APRÈS le signalement et d'un montant non
 * nul (un renvoi SAV à 0 €, c'est nous qui le créons) sont reconnues. Elles
 * restent hors des règles tant que le client est signalé — fermer le ticket ne
 * les libère pas (décision Pierre du 02/11/2026).
 *
 * Critères de reconnaissance : utils/customerIdentity.
 */

const pool = require('../config/database');
const { CRITERIA, buildSignature, matchSignature } = require('../utils/customerIdentity');
const { PAID_STATUSES } = require('./orderDuplicateModel');

const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status });

const fullName = (first, last) => [first, last].filter(Boolean).join(' ').trim();

/**
 * Signalements en cours, chacun avec sa signature (emails, téléphones, noms
 * du compte et de toutes ses commandes).
 */
const activeFlags = async () => {
  const { rows: flags } = await pool.query(
    `SELECT f.id, f.wp_user_id::text AS wp_user_id, f.reason, f.flagged_at,
            (f.flagged_at AT TIME ZONE 'Europe/Paris') AS flagged_local,
            u.name AS flagged_by_name, c.first_name, c.last_name, c.email
       FROM customer_dishonest_flags f
       LEFT JOIN users u ON u.id = f.flagged_by
       LEFT JOIN customers c ON c.wp_user_id = f.wp_user_id
      WHERE f.removed_at IS NULL
      ORDER BY f.flagged_at`
  );
  if (flags.length === 0) return [];

  const { rows: orders } = await pool.query(
    `SELECT wp_customer_id::text AS wp_user_id, billing_email, billing_phone, shipping_phone,
            billing_first_name, billing_last_name
       FROM orders
      WHERE wp_customer_id = ANY($1::bigint[])`,
    [flags.map(f => f.wp_user_id)]
  );
  const byUser = new Map();
  for (const o of orders) {
    if (!byUser.has(o.wp_user_id)) byUser.set(o.wp_user_id, []);
    byUser.get(o.wp_user_id).push(o);
  }

  return flags.map((f) => {
    const own = byUser.get(f.wp_user_id) || [];
    return {
      id: f.id,
      wpUserId: f.wp_user_id,
      customerName: fullName(f.first_name, f.last_name) || f.email || `#${f.wp_user_id}`,
      reason: f.reason,
      flaggedAt: f.flagged_at,
      flaggedLocal: f.flagged_local,
      flaggedBy: f.flagged_by_name || null,
      signature: buildSignature({
        wpUserId: f.wp_user_id,
        emails: [f.email, ...own.map(o => o.billing_email)],
        phones: own.flatMap(o => [o.billing_phone, o.shipping_phone]),
        names: [[f.first_name, f.last_name], ...own.map(o => [o.billing_first_name, o.billing_last_name])]
      })
    };
  });
};

const orderIdentity = (o) => ({
  wpUserId: o.wp_customer_id,
  emails: [o.billing_email],
  phones: [o.billing_phone, o.shipping_phone],
  names: [[o.billing_first_name, o.billing_last_name], [o.shipping_first_name, o.shipping_last_name]]
});

/**
 * Le meilleur signalement qui reconnaît la commande (critère le plus sûr en
 * premier), ou null. La commande doit être payée, non nulle et postérieure au
 * signalement.
 */
const matchOrderRow = (order, flags) => {
  if (!PAID_STATUSES.includes(order.post_status) || !(Number(order.order_total) > 0)) return null;
  let best = null;
  for (const flag of flags) {
    if (new Date(order.post_date) < new Date(flag.flaggedLocal)) continue;
    const m = matchSignature(orderIdentity(order), flag.signature);
    if (m && (!best || CRITERIA.indexOf(m.matchedBy) < CRITERIA.indexOf(best.matchedBy))) {
      best = { ...m, flag };
    }
  }
  return best;
};

const ORDER_COLUMNS = `o.wp_order_id::text AS order_number, o.wp_order_id, o.wp_customer_id::text AS wp_customer_id,
  o.post_status, o.post_date, o.order_total, o.billing_email, o.billing_phone, o.shipping_phone,
  o.billing_first_name, o.billing_last_name, o.shipping_first_name, o.shipping_last_name`;

/** Ce que le Picking, le Packing et le ticket disent d'une commande reconnue. */
const toAlert = (m, ticketId = null) => ({
  flagId: m.flag.id,
  wpUserId: m.flag.wpUserId,
  customerName: m.flag.customerName,
  reason: m.flag.reason,
  flaggedAt: m.flag.flaggedAt,
  flaggedBy: m.flag.flaggedBy,
  matchedBy: m.matchedBy,
  matchedValue: m.matchedValue,
  ticketId
});

/**
 * Commandes de ce lot passées par un client signalé.
 * @param {Array<string|number>} orderNumbers
 * @returns {Promise<Map<string, object>>} n° de commande → alerte (toAlert)
 */
const matchOrders = async (orderNumbers) => {
  const byOrder = new Map();
  const numbers = [...new Set(orderNumbers.map(String))].filter(n => /^\d+$/.test(n));
  if (numbers.length === 0) return byOrder;
  const flags = await activeFlags();
  if (flags.length === 0) return byOrder;

  const { rows } = await pool.query(
    `SELECT ${ORDER_COLUMNS}, d.ticket_id
       FROM orders o
       LEFT JOIN dishonest_orders d ON d.wp_order_id = o.wp_order_id
      WHERE o.wp_order_id = ANY($1::bigint[])`,
    [numbers]
  );
  for (const o of rows) {
    const m = matchOrderRow(o, flags);
    if (m) byOrder.set(o.order_number, toAlert(m, o.ticket_id));
  }
  return byOrder;
};

/**
 * Commandes payées récentes (créées depuis `days` jours au plus) reconnues et
 * pas encore enregistrées : ce que le cron doit traiter.
 */
const findNewMatches = async ({ days = 7 } = {}) => {
  const flags = await activeFlags();
  if (flags.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT ${ORDER_COLUMNS}, o.payment_method_title, o.shipping_method,
            to_char(o.post_date, 'DD/MM/YYYY HH24:MI') AS created_label
       FROM orders o
      WHERE o.post_status = ANY($1::text[])
        AND o.order_total > 0
        AND o.post_date >= GREATEST($2::timestamp, (NOW() AT TIME ZONE 'Europe/Paris') - make_interval(days => $3))
        AND NOT EXISTS (SELECT 1 FROM dishonest_orders d WHERE d.wp_order_id = o.wp_order_id)`,
    [PAID_STATUSES, flags[0].flaggedLocal, days]
  );
  return rows.map(o => ({ order: o, match: matchOrderRow(o, flags) })).filter(r => r.match);
};

/**
 * Pour la fiche client : son signalement en cours, et les clients signalés
 * dont ce compte semble être un autre compte.
 */
const forCustomer = async (wpUserId) => {
  const id = String(wpUserId);
  const flags = await activeFlags();
  const own = flags.find(f => f.wpUserId === id) || null;

  const others = flags.filter(f => f.wpUserId !== id);
  let related = [];
  if (others.length > 0) {
    const [{ rows: [c] }, { rows: orders }] = await Promise.all([
      pool.query('SELECT email, first_name, last_name FROM customers WHERE wp_user_id = $1', [id]),
      pool.query(
        `SELECT billing_email, billing_phone, shipping_phone, billing_first_name, billing_last_name,
                shipping_first_name, shipping_last_name
           FROM orders WHERE wp_customer_id = $1`,
        [id]
      )
    ]);
    const identity = {
      wpUserId: id,
      emails: [c?.email, ...orders.map(o => o.billing_email)],
      phones: orders.flatMap(o => [o.billing_phone, o.shipping_phone]),
      names: [[c?.first_name, c?.last_name],
        ...orders.flatMap(o => [[o.billing_first_name, o.billing_last_name], [o.shipping_first_name, o.shipping_last_name]])]
    };
    related = others
      .map(f => ({ flag: f, m: matchSignature(identity, f.signature) }))
      .filter(r => r.m)
      .map(({ flag, m }) => ({
        wpUserId: flag.wpUserId, customerName: flag.customerName, reason: flag.reason,
        flaggedAt: flag.flaggedAt, flaggedBy: flag.flaggedBy, matchedBy: m.matchedBy, matchedValue: m.matchedValue
      }));
  }

  return {
    flag: own ? { id: own.id, reason: own.reason, flaggedAt: own.flaggedAt, flaggedBy: own.flaggedBy } : null,
    related
  };
};

/**
 * Pour le SAV : les tickets dont le client est signalé, ou semble l'être sous
 * un autre compte. Tout ce que le ticket sait compte (compte, email, téléphone,
 * nom du ticket et de sa commande), sans condition de date : un ticket d'un
 * client signalé est toujours à lire avec prudence.
 *
 * @param {Array<number>} ticketIds
 * @returns {Promise<Map<number, object>>} id du ticket → { wpUserId, customerName,
 *   reason, flaggedAt, flaggedBy, matchedBy, matchedValue }
 */
const matchTickets = async (ticketIds) => {
  const byTicket = new Map();
  const ids = [...new Set(ticketIds.map(Number))].filter(Number.isInteger);
  if (ids.length === 0) return byTicket;
  const flags = await activeFlags();
  if (flags.length === 0) return byTicket;

  const { rows } = await pool.query(
    `SELECT t.id, c.wp_user_id::text AS c_wp, o.wp_customer_id::text AS o_wp,
            t.customer_email, c.email AS c_email, o.billing_email,
            t.customer_phone, o.billing_phone, o.shipping_phone,
            t.customer_first_name, t.customer_last_name, c.first_name, c.last_name,
            o.billing_first_name, o.billing_last_name, o.shipping_first_name, o.shipping_last_name
       FROM sav_tickets t
       LEFT JOIN customers c ON c.id = t.customer_id
       LEFT JOIN orders o ON o.wp_order_id::text = t.order_id
      WHERE t.id = ANY($1::int[])`,
    [ids]
  );
  for (const t of rows) {
    const base = {
      emails: [t.customer_email, t.c_email, t.billing_email],
      phones: [t.customer_phone, t.billing_phone, t.shipping_phone],
      names: [[t.customer_first_name, t.customer_last_name], [t.first_name, t.last_name],
        [t.billing_first_name, t.billing_last_name], [t.shipping_first_name, t.shipping_last_name]]
    };
    const accounts = [...new Set([t.c_wp, t.o_wp].filter(Boolean))];
    let best = null;
    for (const flag of flags) {
      for (const wpUserId of accounts.length ? accounts : [null]) {
        const m = matchSignature({ ...base, wpUserId }, flag.signature);
        if (m && (!best || CRITERIA.indexOf(m.matchedBy) < CRITERIA.indexOf(best.matchedBy))) best = { ...m, flag };
      }
    }
    if (best) byTicket.set(t.id, toAlert(best));
  }
  return byTicket;
};

const flagCustomer = async (wpUserId, reason, userId) => {
  const text = String(reason ?? '').trim();
  if (!text) throw httpError(400, 'Le motif est obligatoire.');
  if (text.length > 1000) throw httpError(400, 'Le motif : 1 000 caractères au plus.');
  const { rows: [c] } = await pool.query('SELECT 1 FROM customers WHERE wp_user_id = $1', [wpUserId]);
  if (!c) throw httpError(404, 'Client introuvable.');
  try {
    await pool.query(
      'INSERT INTO customer_dishonest_flags (wp_user_id, reason, flagged_by) VALUES ($1, $2, $3)',
      [wpUserId, text, userId || null]
    );
  } catch (error) {
    if (error.code === '23505') throw httpError(409, 'Ce client est déjà signalé.');
    throw error;
  }
};

const unflagCustomer = async (wpUserId, userId) => {
  const { rowCount } = await pool.query(
    `UPDATE customer_dishonest_flags SET removed_at = NOW(), removed_by = $2
      WHERE wp_user_id = $1 AND removed_at IS NULL`,
    [wpUserId, userId || null]
  );
  if (rowCount === 0) throw httpError(404, 'Ce client n\'est pas signalé.');
};

module.exports = {
  activeFlags, matchOrderRow, matchOrders, matchTickets, findNewMatches, forCustomer, flagCustomer, unflagCustomer
};
