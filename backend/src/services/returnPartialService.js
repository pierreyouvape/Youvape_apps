/**
 * Retours partiels (14/10/2026) : ce que le Packing et le Picking doivent
 * savoir d'une commande de renvoi dont un article n'est revenu qu'en partie.
 * SQL seul, sans le modèle des retours : le Packing et le Picking ne doivent
 * pas dépendre de WooCommerce, BMS ou des transporteurs pour le lire.
 */

const pool = require('../config/database');

/** Consignes par article d'une commande de renvoi : [{sku, note, returnId, originOrder}]. */
const partialAlertsForOrder = async (wpOrderId) => {
  const { rows } = await pool.query(
    `SELECT p.sku, l.partial_note AS note, r.id AS "returnId", r.wp_order_id::text AS "originOrder"
       FROM customer_returns r
       JOIN customer_return_lines l ON l.return_id = r.id
       LEFT JOIN products p ON p.id = l.product_id
      WHERE r.replacement_order_id = $1 AND r.cancelled_at IS NULL AND l.partial`,
    [wpOrderId]
  );
  return rows;
};

/** N° des commandes de renvoi qui portent au moins un article en retour partiel. */
const partialReplacementOrders = async () => {
  const { rows } = await pool.query(
    `SELECT DISTINCT r.replacement_order_id::text AS n
       FROM customer_returns r
       JOIN customer_return_lines l ON l.return_id = r.id
      WHERE l.partial AND r.cancelled_at IS NULL AND r.replacement_order_id > 0`
  );
  return new Set(rows.map(r => r.n));
};

module.exports = { partialAlertsForOrder, partialReplacementOrders };
