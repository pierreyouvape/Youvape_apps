/**
 * Commandes de clients ayant été malhonnêtes — blocage, ticket SAV, mail.
 *
 * Toutes les 5 min (cronService), chaque commande payée reconnue comme passée
 * par un client signalé (dishonestCustomerModel) est enregistrée une fois dans
 * `dishonest_orders`, puis :
 *   1. si le signalement est coché « bloquer automatiquement » (fiche client)
 *      ET que la commande porte SON TÉLÉPHONE (autoBlockMatch) : BLOQUÉE au
 *      Picking (picking_blocks). Un fraudeur change d'email et de compte
 *      PayPal, rarement de numéro (Mary Obeun, 09/11/2026 : 4 comptes PayPal
 *      en 50 min, un seul numéro). Une commande déjà étiquetée n'est pas
 *      bloquée (trop tard), un blocage posé à la main n'est pas touché ;
 *   2. un ticket SAV « nouveau » sur la commande, avec note privée, sans mail
 *      au client (tous les signalements, cochés ou non) ;
 *   3. pour les commandes du 1. seulement, un mail d'alerte à contact@, UN par
 *      passage (quota Mailgun : un client qui enchaîne les commandes ne doit
 *      pas le vider).
 *
 * Entre deux passages, la commande est déjà hors des règles de vague : c'est
 * recalculé à chaque lecture du Picking (matchOrders). Débloquer une commande
 * à la main la libère pour de bon : elle n'est traitée qu'une fois.
 */

const pool = require('../config/database');
const { createTicket, CONTACT_EMAIL } = require('../models/pickingPackingModel');
const { blockIfNotBlocked } = require('../models/pickingModel');
const { activeFlags, autoBlockMatch, findNewMatches, matchOrders } = require('../models/dishonestCustomerModel');
const { describeMatch } = require('../utils/customerIdentity');
const { sendMail } = require('./alertService');

const APP_URL = process.env.APP_BASE_URL || 'https://apps.youvape.fr';

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const euros = (v) => `${Number(v || 0).toFixed(2).replace('.', ',')} €`;
const frDate = (d) => new Date(d).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });

const blockReason = (auto) => `Client signalé malhonnête (même téléphone ${auto.phone}) : ${auto.flag.reason}`.slice(0, 500);

const NOT_IN_RULES = 'Elle n\'entre pas dans les règles de vague du Picking (vague manuelle seulement, après vérification).';

/** Ce que le ticket dit du blocage ; `block` null = signalement sans blocage automatique. */
const blockSentence = (block) => {
  if (!block) return NOT_IN_RULES;
  if (block.blocked) {
    return `Bloquée automatiquement au Picking (même téléphone ${block.phone}) : ni vague, ni étiquette tant `
      + 'qu\'elle n\'est pas débloquée (Picking, onglet « Bloquée », ou fiche commande).';
  }
  return `Pas bloquée automatiquement${block.note ? ` — ${block.note}` : ''}. ${NOT_IN_RULES}`;
};

const buildNote = (order, alert, block = null) => {
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
    + `<p>${escapeHtml(blockSentence(block))}</p>`
    + `<p>Fermer ce ticket ne change rien à la commande ; seul le retrait du signalement, `
    + `sur la fiche du client, cesse de reconnaître ses commandes suivantes.</p>`;
};

/** Bloque la commande (signalement coché, même téléphone) ; enregistre ce qui a été fait. */
const blockOrder = async (row, order, auto) => {
  let blocked = false;
  let note = null;
  try {
    const { rows: [label] } = await pool.query(
      `SELECT 1 FROM shipment_labels WHERE order_number = $1 AND status = 'active' LIMIT 1`,
      [String(order.wp_order_id)]
    );
    if (label) note = 'étiquette déjà faite';
    else if (await blockIfNotBlocked(order.wp_order_id, blockReason(auto))) blocked = true;
    else note = 'déjà bloquée au Picking';
  } catch (error) {
    note = `blocage impossible : ${error.message}`;
    console.error('[Clients signalés] Blocage impossible pour', order.wp_order_id, error.message);
  }
  await pool.query(
    'UPDATE dishonest_orders SET blocked_at = CASE WHEN $2 THEN NOW() END, block_note = $3 WHERE id = $1',
    [row.id, blocked, note]
  );
  return { blocked, note, phone: auto.phone };
};

const openTicket = async (row, order, alert, block) => {
  try {
    const subject = `Client ayant été malhonnête : commande ${order.wp_order_id}`;
    const ticket = await createTicket(order, subject, buildNote(order, alert, block), 'Clients signalés');
    await pool.query('UPDATE dishonest_orders SET ticket_id = $2, ticket_error = NULL WHERE id = $1', [row.id, ticket.id]);
    return ticket.id;
  } catch (error) {
    await pool.query('UPDATE dishonest_orders SET ticket_error = $2 WHERE id = $1', [row.id, error.message]);
    console.error('[Clients signalés] Ticket non créé pour', order.wp_order_id, error.message);
    return null;
  }
};

/**
 * Le mail d'alerte, pour toutes les commandes du passage.
 * @param {Array<{ id, order, alert, block, ticketId }>} items
 */
const buildAlertMail = (items) => {
  const blocked = items.filter(i => i.block?.blocked).length;
  const names = [...new Set(items.map(i => i.alert.customerName))];
  const subject = `Client malhonnête : ${items.length} commande${items.length > 1 ? 's' : ''}`
    + ` (${blocked} bloquée${blocked > 1 ? 's' : ''}) — ${names.join(', ')}`;

  const rows = items.map(({ order, alert, block, ticketId }) => '<tr>'
    + `<td><a href="${APP_URL}/orders/${escapeHtml(order.wp_order_id)}">${escapeHtml(order.wp_order_id)}</a></td>`
    + `<td>${escapeHtml(order.created_label)}</td>`
    + `<td>${escapeHtml([order.billing_first_name, order.billing_last_name].filter(Boolean).join(' '))}<br>`
    + `${escapeHtml(order.billing_email)}<br>${escapeHtml(order.billing_phone)}</td>`
    + `<td>${euros(order.order_total)}<br>${escapeHtml(order.payment_method_title)}</td>`
    + `<td>même téléphone (${escapeHtml(block?.phone)})<br>que <a href="${APP_URL}/customers/${escapeHtml(alert.wpUserId)}">`
    + `${escapeHtml(alert.customerName)}</a> — « ${escapeHtml(alert.reason)} »</td>`
    + `<td>${block?.blocked ? '<strong style="color:#B91C1C">Bloquée</strong>' : `Pas bloquée${block?.note ? ` : ${escapeHtml(block.note)}` : ''}`}</td>`
    + `<td>${ticketId ? `#${escapeHtml(ticketId)}` : '—'}</td>`
    + '</tr>').join('');

  const html = `<p>${items.length} commande${items.length > 1 ? 's' : ''} payée${items.length > 1 ? 's' : ''} `
    + `par un client signalé comme malhonnête.</p>`
    + `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-size:13px">`
    + `<tr><th>Commande</th><th>Créée le</th><th>Client</th><th>Montant</th><th>Reconnue par</th><th>Picking</th><th>Ticket SAV</th></tr>`
    + `${rows}</table>`
    + `<p>Une commande bloquée ne part ni en vague ni à l'étiquette. Après vérification : débloquer `
    + `(Picking, onglet « Bloquée », ou fiche commande), ou annuler et rembourser dans WooCommerce.</p>`;

  const text = items.map(({ order, alert, block }) => `Commande ${order.wp_order_id} du ${order.created_label}, `
    + `${euros(order.order_total)} (${order.payment_method_title || '?'}) — `
    + `${alert.customerName} (même téléphone ${block?.phone || '?'}) — ${block?.blocked ? 'BLOQUÉE' : `pas bloquée${block?.note ? ` (${block.note})` : ''}`}`
  ).join('\n');

  return { subject, html, text: `Commandes d'un client signalé comme malhonnête :\n${text}\n\n${APP_URL}/picking` };
};

const sendAlertMail = async (items) => {
  if (items.length === 0) return false;
  const ids = items.map(i => i.id);
  try {
    const result = await sendMail({ to: CONTACT_EMAIL, ...buildAlertMail(items) });
    if (result.success) {
      await pool.query('UPDATE dishonest_orders SET alert_sent_at = NOW(), alert_error = NULL WHERE id = ANY($1::int[])', [ids]);
      return true;
    }
    await pool.query('UPDATE dishonest_orders SET alert_error = $2 WHERE id = ANY($1::int[])', [ids, result.error || 'Envoi refusé']);
  } catch (error) {
    await pool.query('UPDATE dishonest_orders SET alert_error = $2 WHERE id = ANY($1::int[])', [ids, error.message]);
  }
  console.error('[Clients signalés] Mail d\'alerte NON envoyé pour', ids.length, 'commande(s)');
  return false;
};

let running = false;

/**
 * Passage du cron : enregistre les commandes nouvellement reconnues, les
 * bloque, ouvre leurs tickets et envoie le mail ; retente pendant un jour les
 * tickets et les mails en échec.
 */
const run = async () => {
  if (running) return { skipped: true };
  running = true;
  try {
    const fresh = [];
    for (const { order, match } of await findNewMatches()) {
      const { rows: [row] } = await pool.query(
        `INSERT INTO dishonest_orders (wp_order_id, flag_id, matched_by, matched_value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (wp_order_id) DO NOTHING
         RETURNING id, wp_order_id`,
        [order.wp_order_id, match.flag.id, match.matchedBy, match.matchedValue]
      );
      if (row) fresh.push(row);
    }
    const { rows: retry } = await pool.query(
      `SELECT id, wp_order_id, ticket_id, blocked_at, block_note,
              (ticket_id IS NULL AND ticket_error IS NOT NULL) AS retry_ticket,
              (alert_sent_at IS NULL AND alert_error IS NOT NULL) AS retry_alert
         FROM dishonest_orders
        WHERE detected_at > NOW() - interval '1 day'
          AND ((ticket_id IS NULL AND ticket_error IS NOT NULL)
            OR (alert_sent_at IS NULL AND alert_error IS NOT NULL))`
    );
    const freshIds = new Set(fresh.map(r => r.id));
    const retryOnly = retry.filter(r => !freshIds.has(r.id));
    if (fresh.length === 0 && retryOnly.length === 0) return { detected: 0, blocked: 0, retried: 0, tickets: 0, mailed: false };

    // Relu au moment d'écrire : le signalement a pu être retiré entre-temps.
    const orderIds = [...fresh, ...retryOnly].map(r => r.wp_order_id);
    const [alerts, flags] = await Promise.all([matchOrders(orderIds), activeFlags()]);
    const { rows: orders } = await pool.query(
      `SELECT o.wp_order_id, o.billing_email, o.billing_first_name, o.billing_last_name, o.billing_phone,
              o.shipping_phone, o.post_status, o.post_date, o.order_total, o.payment_method_title, o.shipping_method,
              to_char(o.post_date, 'DD/MM/YYYY HH24:MI') AS created_label
         FROM orders o WHERE o.wp_order_id = ANY($1::bigint[])`,
      [orderIds]
    );
    const byId = new Map(orders.map(o => [String(o.wp_order_id), o]));

    let tickets = 0;
    let blocked = 0;
    const toMail = [];

    for (const row of fresh) {
      const alert = alerts.get(String(row.wp_order_id));
      const order = byId.get(String(row.wp_order_id));
      if (!alert || !order) continue;
      const auto = autoBlockMatch(order, flags);
      const block = auto ? await blockOrder(row, order, auto) : null;
      if (block?.blocked) blocked++;
      const ticketId = await openTicket(row, order, alert, block);
      if (ticketId) tickets++;
      if (block) toMail.push({ id: row.id, order, alert, block, ticketId });
    }

    for (const row of retryOnly) {
      const alert = alerts.get(String(row.wp_order_id));
      const order = byId.get(String(row.wp_order_id));
      if (!alert || !order) continue;
      const auto = autoBlockMatch(order, flags);
      const block = (row.blocked_at || row.block_note)
        ? { blocked: !!row.blocked_at, note: row.block_note, phone: auto?.phone || order.billing_phone }
        : null;
      let ticketId = row.ticket_id;
      if (row.retry_ticket) {
        ticketId = await openTicket(row, order, alert, block);
        if (ticketId) tickets++;
      }
      if (row.retry_alert && block) toMail.push({ id: row.id, order, alert, block, ticketId });
    }

    const mailed = await sendAlertMail(toMail);
    console.log(`[Clients signalés] ${fresh.length} commande(s) reconnue(s), ${blocked} bloquée(s), `
      + `${tickets} ticket(s) ouvert(s), mail ${toMail.length ? (mailed ? 'envoyé' : 'EN ÉCHEC') : 'sans objet'}`);
    return { detected: fresh.length, blocked, retried: retryOnly.length, tickets, mailed };
  } finally {
    running = false;
  }
};

module.exports = { run, buildNote, buildAlertMail };
