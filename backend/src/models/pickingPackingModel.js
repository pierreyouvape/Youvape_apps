/**
 * Picking × packing (lot 4).
 *
 * Au scan d'une commande, le packing apprend : sa vague, ses manquants (la
 * part du manque du picking qui lui revient — les commandes payées en dernier
 * portent le manque), ses tickets SAV.
 *
 * Une commande à laquelle il manque des articles ne peut pas être étiquetée
 * normalement (le packing exige tous les scans). Deux sorties, décidées avec
 * Pierre le 28/09/2026 :
 *   - « Envoyer incomplète » : l'étiquette part sans les manquants ; BMS reçoit
 *     la commande comme entièrement expédiée (confirmation habituelle) ;
 *   - « Mettre de côté » : la commande sort de sa vague et est bloquée dans le
 *     Picking.
 * Dans les deux cas : un mail à contact@youvape.fr et un ticket SAV « nouveau »
 * avec une note privée, client et commande liés — pour traiter la suite dans le SAV.
 */

const pool = require('../config/database');
const pickingModel = require('./pickingModel');
const savModel = require('./savModel');
const { allocateMissing } = require('../services/pickingPlanner');
const { sendMail } = require('../services/alertService');
const { tagDuplicates } = require('../services/duplicateDetector');
const { syncTicketOrderTag } = require('../services/bmsOrderTagService');

const CONTACT_EMAIL = 'contact@youvape.fr';

const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status });

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** La vague (non annulée) la plus récente qui a porté la commande. */
const findWave = async (orderNumber) => {
  const { rows: [w] } = await pool.query(
    `SELECT w.id, w.wave_number, w.status, wo.active, wo.removed_at
       FROM picking_wave_orders wo
       JOIN picking_waves w ON w.id = wo.wave_id
      WHERE wo.order_number = $1 AND w.status <> 'cancelled'
      ORDER BY w.id DESC
      LIMIT 1`,
    [String(orderNumber)]
  );
  return w || null;
};

/** Manquants de la commande : sa part du manque de la vague. */
const missingForOrder = async (waveId, orderNumber) => {
  const { rows } = await pool.query(
    'SELECT line_key, qty_missing FROM picking_wave_lines WHERE wave_id = $1 AND qty_missing > 0',
    [waveId]
  );
  if (rows.length === 0) return [];
  const data = await pickingModel.getWavePrintData(waveId);
  const byOrder = allocateMissing(data.orders, new Map(rows.map(r => [r.line_key, r.qty_missing])));
  return byOrder.get(String(orderNumber)) || [];
};

const ticketsForOrder = async (orderNumber) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.subject, t.sav_status, s.label AS status_label
       FROM sav_tickets t
       LEFT JOIN sav_ticket_statuses s ON s.value = t.sav_status
      WHERE t.order_id = $1 AND NOT COALESCE(t.is_spam, false) AND t.merged_into_id IS NULL
      ORDER BY t.id DESC`,
    [String(orderNumber)]
  );
  return rows.map(r => ({ id: r.id, subject: r.subject, status: r.status_label || r.sav_status }));
};

/** Ce que le packing affiche au scan d'une commande. */
const getPackingInfo = async (orderNumber) => {
  const [wave, tickets] = await Promise.all([findWave(orderNumber), ticketsForOrder(orderNumber)]);
  const missing = wave ? await missingForOrder(wave.id, orderNumber) : [];
  const { rows: incidents } = wave
    ? await pool.query(
      'SELECT action, created_at, ticket_id FROM picking_packing_incidents WHERE order_number = $1 AND wave_id = $2',
      [String(orderNumber), wave.id]
    )
    : { rows: [] };
  return {
    wave: wave ? { id: wave.id, waveNumber: wave.wave_number, status: wave.status, setAside: !!wave.removed_at } : null,
    missing,
    tickets,
    incidents: incidents.map(i => ({ action: i.action, at: i.created_at, ticketId: i.ticket_id }))
  };
};

const missingText = (missing) => missing.map(m => `${m.qty} × ${m.name}${m.sku ? ` (SKU ${m.sku})` : ''}`);

/** Ticket SAV « nouveau », note privée, client et commande liés — sans mail au client. */
const createTicket = async (order, subject, noteHtml, agentName) => {
  const email = String(order.billing_email || '').toLowerCase() || `commande-${order.wp_order_id}@sans-email.youvape.fr`;
  let customerId = null;
  let name = [order.billing_first_name, order.billing_last_name].filter(Boolean).join(' ').trim();
  const { rows: [c] } = await pool.query('SELECT id, first_name, last_name FROM customers WHERE email = $1 LIMIT 1', [email]);
  if (c) {
    customerId = c.id;
    name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || name;
  }
  const ticket = await savModel.create({
    order_id: String(order.wp_order_id),
    customer_id: customerId,
    customer_name: name || email,
    customer_email: email,
    customer_phone: order.billing_phone || null,
    subject,
    description: null,
    source: 'manual'
  });
  await savModel.addMessage(ticket.id, {
    from: agentName || 'Picking',
    body: noteHtml,
    is_agent: true,
    is_private: true,
    attachments: []
  });
  // Même suite que la création manuelle d'un ticket dans le SAV.
  tagDuplicates(ticket).catch(e => console.warn('[Picking] tagDuplicates échoué:', e.message));
  syncTicketOrderTag(ticket);
  return ticket;
};

/**
 * « Envoyer incomplète » (action = 'incomplete') ou « Mettre de côté »
 * (action = 'set_aside'). Les manquants sont recalculés ici, jamais repris du
 * client. Un second appel pour la même commande ne refait rien.
 */
const recordIncident = async (orderNumber, action, user) => {
  if (!['incomplete', 'set_aside'].includes(action)) throw httpError(400, 'Action inconnue.');
  const number = String(orderNumber);

  const wave = await findWave(number);
  if (!wave) throw httpError(400, 'Cette commande n\'est dans aucune vague.');
  const missing = await missingForOrder(wave.id, number);
  if (missing.length === 0) throw httpError(400, 'Aucun article manquant pour cette commande.');

  const { rows: [order] } = await pool.query(
    `SELECT wp_order_id, billing_email, billing_first_name, billing_last_name, billing_phone, shipping_method
       FROM orders WHERE wp_order_id::text = $1`,
    [number]
  );
  if (!order) throw httpError(404, 'Commande introuvable.');

  let tracking = null;
  if (action === 'incomplete') {
    const { rows: [label] } = await pool.query(
      `SELECT tracking_number FROM shipment_labels
        WHERE order_number = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
      [number]
    );
    if (!label) throw httpError(400, 'Générez d\'abord l\'étiquette : aucune étiquette active pour cette commande.');
    tracking = label.tracking_number;
  }

  // La ligne d'incident est le verrou : un double clic s'arrête ici.
  const { rows: [incident] } = await pool.query(
    `INSERT INTO picking_packing_incidents (order_number, wave_id, action, missing, tracking_number, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (order_number, wave_id, action) DO NOTHING
     RETURNING id`,
    [number, wave.id, action, JSON.stringify(missing), tracking, user?.id || null]
  );
  if (!incident) return { already: true };

  const who = user?.name || user?.email || 'le packing';
  const lines = missingText(missing);

  if (action === 'set_aside') {
    const reason = `Mise de côté au packing : ${lines.join(', ')} manquant(s)`;
    await pool.query(
      `UPDATE picking_wave_orders
          SET active = false, removed_at = NOW(), removed_by = $3, removed_reason = $4
        WHERE wave_id = $1 AND order_number = $2`,
      [wave.id, number, user?.id || null, reason]
    );
    await pickingModel.block(number, reason, user?.id);
  }

  const incomplete = action === 'incomplete';
  const subject = incomplete
    ? `Commande n°${number} envoyée incomplète`
    : `Commande n°${number} mise de côté — contacter le client`;
  const intro = incomplete
    ? `La commande n°${number} a été envoyée sans ces articles :`
    : `La commande n°${number} a été mise de côté au packing, il manque :`;
  const context = [
    `Préparateur : ${who}`,
    `Vague : ${wave.wave_number}`,
    `Transporteur : ${order.shipping_method || '—'}`,
    ...(tracking ? [`N° de suivi : ${tracking}`] : [])
  ];
  const next = incomplete
    ? 'Le colis est parti ; BMS a enregistré la commande comme entièrement expédiée.'
    : 'Il faut contacter le client. La commande est bloquée dans le Picking (onglet « Bloquée »).';

  const html = `<p>${escapeHtml(intro)}</p><ul>${lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
    + `<p>${context.map(escapeHtml).join('<br>')}</p><p>${escapeHtml(next)}</p>`;
  const text = [intro, ...lines.map(l => `  - ${l}`), '', ...context, '', next].join('\n');

  let ticketId = null;
  try {
    ticketId = (await createTicket(order, subject, html, who)).id;
  } catch (error) {
    console.error('[Picking] Ticket SAV non créé pour', number, error.message);
  }

  const mail = await sendMail({
    to: CONTACT_EMAIL,
    subject,
    text: ticketId ? `${text}\n\nTicket SAV #${ticketId}` : text,
    html: ticketId ? `${html}<p>Ticket SAV #${ticketId}</p>` : html
  });

  await pool.query(
    'UPDATE picking_packing_incidents SET ticket_id = $2, mail_sent = $3, mail_error = $4 WHERE id = $1',
    [incident.id, ticketId, mail.success, mail.success ? null : mail.error]
  );

  return { already: false, ticketId, mailSent: mail.success, mailError: mail.success ? null : mail.error };
};

module.exports = { getPackingInfo, recordIncident, CONTACT_EMAIL };
