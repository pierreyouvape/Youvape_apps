/**
 * Avoir des frais de port en points WPLoyalty, depuis la fiche commande
 * (`/orders/:id`, Pierre 05/11/2026).
 *
 * Montant = port TTC payé (même formule que les Retours), 100 points = 1 €.
 * C'est le SERVEUR qui le calcule : le navigateur n'envoie rien.
 *
 * Refusé (bouton grisé) quand :
 *   - le port a été offert (TTC = 0) ;
 *   - la commande n'est pas payée, ou n'a pas d'email ;
 *   - un avoir de port a déjà été fait pour la commande (UNIQUE) ;
 *   - un retour de la commande a déjà rendu le port en points
 *     (`customer_returns.loyalty_shipping`) ;
 *   - un remboursement WooCommerce a déjà rendu le port (`refund_items`).
 *
 * Motif WPLoyalty : « Avoir frais de port commande N°… », sous le type
 * « avoir » du plugin youvape-loyalty (choix Pierre : pas de nouveau type).
 * Note privée sur le ticket SAV le plus récent de la commande, s'il y en a un.
 */

const pool = require('../config/database');
const savModel = require('./savModel');
const loyaltyService = require('../services/loyaltyService');
const refundLinesService = require('../services/refundLinesService');
const { pointsBreakdown } = require('../services/returnRules');

const PAID_STATUSES = [
  'wc-completed', 'wc-delivered', 'wc-processing',
  'wc-awaiting-delivery', 'wc-shipped', 'wc-being-delivered',
];

const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status });
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const euro = (n) => `${Number(n).toFixed(2).replace('.', ',')} €`;

// Port TTC payé : même formule que customerReturnModel (SHIPPING_PAID_SQL).
const SHIPPING_TTC_SQL = `COALESCE(o.order_shipping, 0) + COALESCE((
    SELECT SUM(t.line_tax) FROM order_items t WHERE t.wp_order_id = o.wp_order_id AND t.order_item_type = 'tax'
  ), 0)`;

/**
 * État de l'avoir de port d'une commande, pour la fiche.
 * @returns {null | {
 *   shipping_ttc, points, credit: {points, amount_ttc, email, by, at} | null,
 *   blocked: string | null   // raison du bouton grisé
 * }}
 */
const getState = async (wpOrderId) => {
  const { rows: [o] } = await pool.query(
    `SELECT o.wp_order_id, o.post_status, o.billing_email, ${SHIPPING_TTC_SQL} AS shipping_ttc
       FROM orders o WHERE o.wp_order_id = $1`,
    [wpOrderId]
  );
  if (!o) return null;

  const { rows: [credit] } = await pool.query(
    `SELECT c.points, c.amount_ttc, c.email, c.credited_at AS at, u.name AS by
       FROM order_shipping_credits c LEFT JOIN users u ON u.id = c.credited_by
      WHERE c.wp_order_id = $1`,
    [wpOrderId]
  );

  const shippingTtc = Number(o.shipping_ttc) || 0;
  const { points } = pointsBreakdown([], { shippingPaid: shippingTtc, withShipping: true });
  const state = {
    shipping_ttc: shippingTtc,
    points,
    credit: credit ? { ...credit, amount_ttc: Number(credit.amount_ttc) } : null,
    blocked: null,
  };
  if (credit) {
    state.blocked = 'Avoir de port déjà fait.';
    return state;
  }
  if (points < 1) {
    state.blocked = 'Frais de port offerts.';
    return state;
  }
  if (!PAID_STATUSES.includes(o.post_status)) {
    state.blocked = 'Commande non payée.';
    return state;
  }
  if (!o.billing_email) {
    state.blocked = 'Commande sans email client.';
    return state;
  }

  const { rows: [ret] } = await pool.query(
    `SELECT id FROM customer_returns
      WHERE wp_order_id = $1 AND cancelled_at IS NULL AND loyalty_shipping > 0
      ORDER BY id LIMIT 1`,
    [wpOrderId]
  );
  if (ret) {
    state.blocked = `Port déjà rendu en points par le retour n°${ret.id}.`;
    return state;
  }

  // Les lignes d'un remboursement se lisent chez WC à son arrivée ; la fiche
  // commande les relit si ce n'est pas fait (même règle que refunds-detail).
  try {
    const { rows: [pending] } = await pool.query(
      'SELECT 1 FROM refunds WHERE wp_order_id = $1 AND lines_synced_at IS NULL LIMIT 1',
      [wpOrderId]
    );
    if (pending) await refundLinesService.syncOrder(wpOrderId);
  } catch (error) {
    console.error(`[Avoir port] Lignes des remboursements de ${wpOrderId} non relues :`, error.message);
  }
  const { rows: [refunded] } = await pool.query(
    `SELECT SUM(total + total_tax) AS amount FROM refund_items
      WHERE wp_order_id = $1 AND item_type = 'shipping'`,
    [wpOrderId]
  );
  if (Number(refunded?.amount) > 0) {
    state.blocked = `Port déjà remboursé dans WooCommerce (${euro(refunded.amount)}).`;
    return state;
  }
  const { rows: [unread] } = await pool.query(
    'SELECT 1 FROM refunds WHERE wp_order_id = $1 AND lines_synced_at IS NULL LIMIT 1',
    [wpOrderId]
  );
  if (unread) state.blocked = 'Détail des remboursements WooCommerce illisible : impossible de vérifier le port.';
  return state;
};

/** Le port de la commande a-t-il été rendu par la fiche commande ? (lu par les Retours) */
const isCredited = async (wpOrderId) => {
  const { rows: [row] } = await pool.query('SELECT 1 FROM order_shipping_credits WHERE wp_order_id = $1', [wpOrderId]);
  return !!row;
};

const findTicket = async (wpOrderId) => {
  const { rows: [row] } = await pool.query(
    `SELECT id FROM sav_tickets
      WHERE order_id = $1 AND merged_into_id IS NULL AND COALESCE(is_spam, false) = false
      ORDER BY created_at DESC LIMIT 1`,
    [String(wpOrderId)]
  );
  return row?.id || null;
};

const credit = async (wpOrderId, user) => {
  const state = await getState(wpOrderId);
  if (!state) throw httpError(404, 'Commande introuvable.');
  if (state.blocked) throw httpError(409, state.blocked);

  const { rows: [o] } = await pool.query('SELECT billing_email FROM orders WHERE wp_order_id = $1', [wpOrderId]);
  const email = o.billing_email;

  // Verrou avant l'appel : un double clic ne crédite pas deux fois.
  const { rows: [row] } = await pool.query(
    `INSERT INTO order_shipping_credits (wp_order_id, points, amount_ttc, email, credited_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (wp_order_id) DO NOTHING RETURNING id`,
    [wpOrderId, state.points, state.shipping_ttc, email, user.id]
  );
  if (!row) throw httpError(409, 'Avoir de port déjà fait.');

  let result;
  try {
    result = await loyaltyService.addPoints(email, state.points, {
      type: 'avoir', note: `Avoir frais de port commande N°${wpOrderId}`, orderId: wpOrderId,
    });
  } catch (error) {
    await pool.query('DELETE FROM order_shipping_credits WHERE id = $1', [row.id]);
    throw httpError(422, `WPLoyalty a refusé le crédit : ${error.response?.data?.message || error.message}`);
  }

  const ticketId = await findTicket(wpOrderId).catch(() => null);
  await pool.query('UPDATE order_shipping_credits SET via = $2, ticket_id = $3 WHERE id = $1', [row.id, result.via, ticketId]);
  if (ticketId) {
    try {
      await savModel.addMessage(ticketId, {
        from: user.name || user.email,
        body: `<p><strong>Avoir frais de port commande N°${wpOrderId} : ${state.points} points (${euro(state.shipping_ttc)})</strong> crédités à ${escapeHtml(email)}</p>`,
        is_agent: true,
        is_private: true,
      });
    } catch (error) {
      console.error(`[Avoir port] Note du ticket #${ticketId} non écrite :`, error.message);
    }
  }
  return getState(wpOrderId);
};

module.exports = { getState, credit, isCredited };
