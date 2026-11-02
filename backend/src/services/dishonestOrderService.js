/**
 * Commandes de clients ayant été malhonnêtes — ticket SAV.
 *
 * Toutes les 5 min (cronService), chaque commande payée reconnue comme passée
 * par un client signalé (dishonestCustomerModel) est enregistrée une fois dans
 * `dishonest_orders` et ouvre un ticket SAV « nouveau » sur la commande, avec
 * une note privée — sans mail au client. Le blocage au Picking ne dépend pas
 * de ce cron : il est recalculé à chaque lecture.
 */

const pool = require('../config/database');
const { createTicket } = require('../models/pickingPackingModel');
const { findNewMatches, matchOrders } = require('../models/dishonestCustomerModel');
const { describeMatch } = require('../utils/customerIdentity');

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const euros = (v) => `${Number(v || 0).toFixed(2).replace('.', ',')} €`;
const frDate = (d) => new Date(d).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });

const buildNote = (order, alert) => {
  const customer = `<a href="/customers/${escapeHtml(alert.wpUserId)}">${escapeHtml(alert.customerName)} (#${escapeHtml(alert.wpUserId)})</a>`;
  const how = alert.matchedBy === 'compte'
    ? `Commande passée depuis le compte du client signalé ${customer}.`
    : `Reconnue par ${escapeHtml(describeMatch(alert))} avec le client signalé ${customer}, sous un autre compte.`;

  return `<p><strong>Commande d'un client ayant été malhonnête.</strong></p>`
    + `<p>Commande n°${escapeHtml(order.wp_order_id)} — créée le ${escapeHtml(order.created_label)} — `
    + `${euros(order.order_total)}${order.payment_method_title ? ` (${escapeHtml(order.payment_method_title)})` : ''}`
    + `${order.shipping_method ? ` — ${escapeHtml(order.shipping_method)}` : ''}</p>`
    + `<p>${how}</p>`
    + `<p>Motif du signalement : « ${escapeHtml(alert.reason)} »`
    + ` — signalé${alert.flaggedBy ? ` par ${escapeHtml(alert.flaggedBy)}` : ''} le ${frDate(alert.flaggedAt)}.</p>`
    + `<p>Cette commande n'entre pas dans les règles de vague du Picking : vague manuelle seulement, `
    + `après vérification. Fermer ce ticket ne la libère pas ; seul le retrait du signalement, `
    + `sur la fiche du client, le fait.</p>`;
};

const openTicket = async (row, order, alert) => {
  try {
    const subject = `Client ayant été malhonnête : commande ${order.wp_order_id}`;
    const ticket = await createTicket(order, subject, buildNote(order, alert), 'Clients signalés');
    await pool.query('UPDATE dishonest_orders SET ticket_id = $2, ticket_error = NULL WHERE id = $1', [row.id, ticket.id]);
    return ticket.id;
  } catch (error) {
    await pool.query('UPDATE dishonest_orders SET ticket_error = $2 WHERE id = $1', [row.id, error.message]);
    console.error('[Clients signalés] Ticket non créé pour', order.wp_order_id, error.message);
    return null;
  }
};

let running = false;

/**
 * Passage du cron : enregistre les commandes nouvellement reconnues et ouvre
 * leurs tickets ; retente les tickets en échec du dernier jour.
 */
const run = async () => {
  if (running) return { skipped: true };
  running = true;
  try {
    const toOpen = [];

    for (const { order, match } of await findNewMatches()) {
      const { rows: [row] } = await pool.query(
        `INSERT INTO dishonest_orders (wp_order_id, flag_id, matched_by, matched_value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (wp_order_id) DO NOTHING
         RETURNING id`,
        [order.wp_order_id, match.flag.id, match.matchedBy, match.matchedValue]
      );
      if (row) toOpen.push({ row, orderId: order.wp_order_id });
    }
    const { rows: retry } = await pool.query(
      `SELECT id, wp_order_id FROM dishonest_orders
        WHERE ticket_id IS NULL AND ticket_error IS NOT NULL AND detected_at > NOW() - interval '1 day'`
    );
    toOpen.push(...retry.map(r => ({ row: r, orderId: r.wp_order_id })));
    if (toOpen.length === 0) return { detected: 0, retried: 0, tickets: 0 };

    // Relu au moment d'écrire : le signalement a pu être retiré entre-temps.
    const alerts = await matchOrders(toOpen.map(t => t.orderId));
    const { rows: orders } = await pool.query(
      `SELECT o.wp_order_id, o.billing_email, o.billing_first_name, o.billing_last_name, o.billing_phone,
              o.order_total, o.payment_method_title, o.shipping_method,
              to_char(o.post_date, 'DD/MM/YYYY HH24:MI') AS created_label
         FROM orders o WHERE o.wp_order_id = ANY($1::bigint[])`,
      [toOpen.map(t => t.orderId)]
    );
    const byId = new Map(orders.map(o => [String(o.wp_order_id), o]));

    let tickets = 0;
    for (const { row, orderId } of toOpen) {
      const alert = alerts.get(String(orderId));
      const order = byId.get(String(orderId));
      if (!alert || !order) continue;
      if (await openTicket(row, order, alert)) tickets++;
    }
    console.log(`[Clients signalés] ${toOpen.length - retry.length} commande(s) reconnue(s), ${tickets} ticket(s) ouvert(s)`);
    return { detected: toOpen.length - retry.length, retried: retry.length, tickets };
  } finally {
    running = false;
  }
};

module.exports = { run, buildNote };
