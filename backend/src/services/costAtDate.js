/**
 * Coût d'achat HT d'un produit du site À UNE DATE : le PMP FIFO de ce jour-là,
 * exactement comme la valeur de stock aux dates passées (stockValuationModel) —
 * lots reçus jusqu'au jour J, consommés par les ventes payées jusqu'au jour J.
 * Sans aucun lot reçu avant J : coût courant (computed_cost, sinon coût WC).
 *
 * costsAtDates([{ productId, date: 'YYYY-MM-DD' }]) → Map('<id>|<date>' → coût | null)
 */

const pool = require('../config/database');
const {
  fifoCostAsOf, LOT_QTY, LOT_UNIT_PRICE, PO_EXCLUDED_STATUSES, PAID_STATUSES, CURRENT_COST,
} = require('../models/stockValuationModel');

const round4 = (n) => Math.round(n * 10000) / 10000;

const costsAtDates = async (pairs) => {
  const ids = [...new Set(pairs.map((p) => p.productId))];
  const out = new Map();
  if (!ids.length) return out;

  const [{ rows: lots }, { rows: sales }, { rows: current }] = await Promise.all([
    pool.query(
      `SELECT poi.product_id, (${LOT_QTY})::int AS qty, (${LOT_UNIT_PRICE})::numeric AS price,
              to_char(COALESCE(po.received_date, po.order_date, po.created_at)::date, 'YYYY-MM-DD') AS lot_date
         FROM purchase_order_items poi
         JOIN purchase_orders po ON po.id = poi.purchase_order_id
        WHERE poi.product_id = ANY($1::int[]) AND poi.units_received > 0
          AND po.status <> ALL($2::text[]) AND poi.unit_price IS NOT NULL AND poi.unit_price >= 0
        ORDER BY poi.product_id, lot_date, poi.id`,
      [ids, PO_EXCLUDED_STATUSES]
    ),
    pool.query(
      `SELECT p.id AS product_id, to_char(o.post_date::date, 'YYYY-MM-DD') AS day, SUM(oi.qty)::bigint AS qty
         FROM products p
         JOIN order_items oi ON (oi.product_id = p.wp_product_id OR oi.variation_id = p.wp_product_id)
         JOIN orders o ON o.wp_order_id = oi.wp_order_id
        WHERE p.id = ANY($1::int[]) AND o.post_status = ANY($2::text[])
        GROUP BY 1, 2`,
      [ids, PAID_STATUSES]
    ),
    pool.query(`SELECT p.id, (${CURRENT_COST})::numeric AS cost FROM products p WHERE p.id = ANY($1::int[])`, [ids]),
  ]);

  const lotsBy = new Map();
  for (const l of lots) {
    const qty = Number(l.qty);
    const price = Number(l.price);
    if (!(qty > 0) || !(price >= 0)) continue;
    if (!lotsBy.has(l.product_id)) lotsBy.set(l.product_id, []);
    lotsBy.get(l.product_id).push({ qty, price, lotDate: l.lot_date });
  }
  const salesBy = new Map();
  for (const s of sales) {
    if (!salesBy.has(s.product_id)) salesBy.set(s.product_id, []);
    salesBy.get(s.product_id).push({ day: s.day, qty: Number(s.qty) });
  }
  const currentBy = new Map(current.map((r) => [r.id, Number(r.cost) || 0]));

  for (const { productId, date } of pairs) {
    const lotsUpto = (lotsBy.get(productId) || []).filter((l) => l.lotDate <= date);
    let cost;
    if (lotsUpto.length) {
      const soldUpto = (salesBy.get(productId) || []).filter((s) => s.day <= date).reduce((n, s) => n + s.qty, 0);
      cost = fifoCostAsOf(lotsUpto, soldUpto);
    } else {
      cost = currentBy.get(productId);
    }
    out.set(`${productId}|${date}`, cost > 0 ? round4(cost) : null);
  }
  return out;
};

module.exports = { costsAtDates };
