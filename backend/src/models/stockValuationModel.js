const pool = require('../config/database');

/**
 * Valeur de stock en achat HT — évolution dans le temps.
 *
 * Principe : à une date D, on veut la valeur du stock aux COÛTS D'ACHAT DE L'ÉPOQUE
 * (pas le coût actuel figé). Pour ça :
 *
 *  1. Quantité en stock à D (rollback des mouvements depuis aujourd'hui) :
 *       qty(D) = stock_actuel − reçu_après_D + vendu_après_D
 *     (reçu = lignes de bon de commande reçues ; vendu = ventes qui ont décrémenté le stock)
 *
 *  2. Coût unitaire à D (PMP FIFO borné à D — même logique que computedCostModel mais
 *     en ne gardant que les lots reçus jusqu'à D et les ventes jusqu'à D) :
 *       - produits AVEC historique d'achat ≤ D → coût FIFO d'époque
 *       - produits SANS historique d'achat      → coût actuel (fallback, ~10% de la valeur)
 *
 *  valeur(D) = Σ qty(D) × coût(D), bundles woosb et parents 'variable' exclus (double comptage).
 *
 * Limites connues :
 *  - l'historique des bons de commande commence ~octobre 2025 (pas de coût d'époque avant) ;
 *  - le rollback ignore les ajustements manuels d'inventaire non tracés (légère dérive).
 */

// Statuts de commande qui ont DÉCRÉMENTÉ le stock (mêmes exclusions que computedCostModel :
// cancelled / refunded / failed / on-hold / pending / brouillons restaurent ou n'engagent pas le stock).
const SOLD_EXCLUDED_STATUSES = [
  'wc-cancelled', 'wc-refunded', 'wc-failed', 'wc-on-hold', 'wc-pending',
  'wc-checkout-draft', 'wc-auto-draft', 'wc-trash'
];

const PO_EXCLUDED_STATUSES = ['draft', 'cancelled'];

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Charge la base commune : produits valorisables, lots FIFO, ventes totales.
 * Réutilisé par computeAt (date libre) et computeSeries (courbe mensuelle).
 */
async function loadBase() {
  // Produits valorisables : simples + variations, on exclut les bundles woosb
  // (leur stock double celui des composants) et les parents 'variable' (pas de stock propre).
  const productsRes = await pool.query(`
    SELECT p.id,
           GREATEST(p.stock, 0)::bigint AS stock,
           COALESCE(p.computed_cost, NULLIF(p.wc_cog_cost, 0), 0)::numeric AS fallback_cost
    FROM products p
    WHERE (p.product_type IS NULL OR p.product_type NOT IN ('woosb', 'variable'))
  `);

  // Lots reçus (FIFO), triés par date d'arrivée. unit_price = prix unitaire déjà net de pack.
  const lotsRes = await pool.query(`
    SELECT poi.product_id,
           poi.qty_received::int AS qty,
           (poi.unit_price * (1 - COALESCE(poi.discount_percent, 0) / 100.0))::numeric AS price,
           to_char(COALESCE(po.received_date, po.order_date, po.created_at)::date, 'YYYY-MM-DD') AS lot_date
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.purchase_order_id
    WHERE poi.qty_received > 0
      AND po.status NOT IN (${PO_EXCLUDED_STATUSES.map((_, i) => `$${i + 1}`).join(', ')})
      AND poi.unit_price IS NOT NULL
      AND poi.unit_price > 0
    ORDER BY poi.product_id, lot_date ASC, poi.id ASC
  `, PO_EXCLUDED_STATUSES);

  // Ventes totales par produit (unités qui ont décrémenté le stock)
  const soldRes = await pool.query(`
    SELECT p.id AS product_id, COALESCE(SUM(oi.qty), 0)::bigint AS qty
    FROM products p
    JOIN order_items oi ON (oi.product_id = p.wp_product_id OR oi.variation_id = p.wp_product_id)
    JOIN orders o ON o.wp_order_id = oi.wp_order_id
    WHERE o.post_status NOT IN (${SOLD_EXCLUDED_STATUSES.map((_, i) => `$${i + 1}`).join(', ')})
    GROUP BY p.id
  `, SOLD_EXCLUDED_STATUSES);

  const products = new Map();
  for (const r of productsRes.rows) {
    products.set(r.id, {
      stock: Number(r.stock),
      fallbackCost: parseFloat(r.fallback_cost) || 0,
    });
  }

  const lotsByProduct = new Map();
  for (const l of lotsRes.rows) {
    const pid = l.product_id;
    const qty = parseInt(l.qty);
    const price = parseFloat(l.price);
    if (!qty || qty <= 0 || isNaN(price) || price <= 0) continue;
    if (!lotsByProduct.has(pid)) lotsByProduct.set(pid, []);
    lotsByProduct.get(pid).push({ qty, price, lotDate: l.lot_date });
  }

  const totalSold = new Map();
  for (const r of soldRes.rows) totalSold.set(r.product_id, Number(r.qty));

  return { products, lotsByProduct, totalSold };
}

/**
 * PMP FIFO d'époque : consomme `soldUpto` unités des lots (jusqu'à D, ordre ancien→récent),
 * renvoie le coût unitaire moyen pondéré des lots restants. `null` si aucun lot ≤ D.
 */
function fifoCostAsOf(lots, soldUpto) {
  if (!lots || lots.length === 0) return null;
  let remaining = soldUpto;
  const work = lots.map((l) => ({ qty: l.qty, price: l.price }));
  for (const lot of work) {
    if (remaining <= 0) break;
    const consumed = Math.min(remaining, lot.qty);
    lot.qty -= consumed;
    remaining -= consumed;
  }
  const rem = work.filter((l) => l.qty > 0);
  if (rem.length > 0) {
    const tv = rem.reduce((s, l) => s + l.qty * l.price, 0);
    const tq = rem.reduce((s, l) => s + l.qty, 0);
    return tv / tq;
  }
  // Tout consommé : prendre le prix du dernier lot (comme computedCostModel)
  return work[work.length - 1].price;
}

/**
 * Valorise le stock à une date D à partir de deltas (reçu/vendu APRÈS D) déjà agrégés par produit.
 * `dateStr` = 'YYYY-MM-DD' (borne FIFO). Renvoie l'agrégat total.
 */
function valuate({ base, dateStr, soldAfter, receivedAfter }) {
  const { products, lotsByProduct, totalSold } = base;
  let total = 0, withPo = 0, withoutPo = 0, units = 0, count = 0;

  for (const [pid, prod] of products) {
    const soldA = soldAfter.get(pid) || 0;
    const recvA = receivedAfter.get(pid) || 0;
    const qtyAtD = prod.stock - recvA + soldA; // rollback
    if (qtyAtD <= 0) continue;

    const allLots = lotsByProduct.get(pid);
    const lotsUpto = allLots ? allLots.filter((l) => l.lotDate <= dateStr) : null;

    let unitCost;
    let hasPo = false;
    if (lotsUpto && lotsUpto.length > 0) {
      const soldUpto = (totalSold.get(pid) || 0) - soldA;
      unitCost = fifoCostAsOf(lotsUpto, Math.max(0, soldUpto));
      hasPo = true;
    } else {
      unitCost = prod.fallbackCost;
    }
    if (!unitCost || unitCost <= 0) continue;

    const value = qtyAtD * unitCost;
    total += value;
    units += qtyAtD;
    count += 1;
    if (hasPo) withPo += value; else withoutPo += value;
  }

  return {
    date: dateStr,
    total_value_ht: round2(total),
    value_with_po_history: round2(withPo),
    value_without_po_history: round2(withoutPo),
    total_units: units,
    products_count: count,
  };
}

/**
 * Valeur de stock à une date précise (jour), à la volée. Utilisé par le sélecteur de date.
 */
async function computeAt(dateStr, base = null) {
  base = base || await loadBase();

  const soldAfterRes = await pool.query(`
    SELECT p.id AS product_id, COALESCE(SUM(oi.qty), 0)::bigint AS qty
    FROM products p
    JOIN order_items oi ON (oi.product_id = p.wp_product_id OR oi.variation_id = p.wp_product_id)
    JOIN orders o ON o.wp_order_id = oi.wp_order_id
    WHERE o.post_status NOT IN (${SOLD_EXCLUDED_STATUSES.map((_, i) => `$${i + 2}`).join(', ')})
      AND o.post_date::date > $1
    GROUP BY p.id
  `, [dateStr, ...SOLD_EXCLUDED_STATUSES]);

  const receivedAfterRes = await pool.query(`
    SELECT poi.product_id, COALESCE(SUM(poi.qty_received), 0)::bigint AS qty
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.purchase_order_id
    WHERE poi.qty_received > 0
      AND po.status NOT IN (${PO_EXCLUDED_STATUSES.map((_, i) => `$${i + 2}`).join(', ')})
      AND COALESCE(po.received_date, po.order_date, po.created_at)::date > $1
    GROUP BY poi.product_id
  `, [dateStr, ...PO_EXCLUDED_STATUSES]);

  const soldAfter = new Map(soldAfterRes.rows.map((r) => [r.product_id, Number(r.qty)]));
  const receivedAfter = new Map(receivedAfterRes.rows.map((r) => [r.product_id, Number(r.qty)]));

  return valuate({ base, dateStr, soldAfter, receivedAfter });
}

/**
 * Courbe d'évolution : un point par fin de mois entre `from` et `to` (+ point à `to`).
 * Reconstruit les mois passés ; remplace par le snapshot exact quand il existe.
 */
async function computeSeries(fromStr, toStr) {
  const base = await loadBase();

  // Agrégats mensuels reçu/vendu par produit (un seul scan chacun)
  const soldMonthRes = await pool.query(`
    SELECT p.id AS product_id,
           to_char(DATE_TRUNC('month', o.post_date), 'YYYY-MM') AS ym,
           COALESCE(SUM(oi.qty), 0)::bigint AS qty
    FROM products p
    JOIN order_items oi ON (oi.product_id = p.wp_product_id OR oi.variation_id = p.wp_product_id)
    JOIN orders o ON o.wp_order_id = oi.wp_order_id
    WHERE o.post_status NOT IN (${SOLD_EXCLUDED_STATUSES.map((_, i) => `$${i + 1}`).join(', ')})
    GROUP BY p.id, ym
  `, SOLD_EXCLUDED_STATUSES);

  const recvMonthRes = await pool.query(`
    SELECT poi.product_id,
           to_char(DATE_TRUNC('month', COALESCE(po.received_date, po.order_date, po.created_at)), 'YYYY-MM') AS ym,
           COALESCE(SUM(poi.qty_received), 0)::bigint AS qty
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.purchase_order_id
    WHERE poi.qty_received > 0
      AND po.status NOT IN (${PO_EXCLUDED_STATUSES.map((_, i) => `$${i + 1}`).join(', ')})
    GROUP BY poi.product_id, ym
  `, PO_EXCLUDED_STATUSES);

  // Indexer : product_id -> [{ monthKey, qty }]
  const soldByProduct = new Map();
  for (const r of soldMonthRes.rows) {
    if (!soldByProduct.has(r.product_id)) soldByProduct.set(r.product_id, []);
    soldByProduct.get(r.product_id).push({ month: r.ym, qty: Number(r.qty) });
  }
  const recvByProduct = new Map();
  for (const r of recvMonthRes.rows) {
    if (!recvByProduct.has(r.product_id)) recvByProduct.set(r.product_id, []);
    recvByProduct.get(r.product_id).push({ month: r.ym, qty: Number(r.qty) });
  }

  // Snapshots exacts déjà stockés
  const snapRes = await pool.query(
    `SELECT to_char(snapshot_date, 'YYYY-MM-DD') AS snapshot_date,
            total_value_ht, value_with_po_history, value_without_po_history,
            products_count, total_units
     FROM stock_valuation_snapshots
     WHERE snapshot_date >= $1 AND snapshot_date <= $2`,
    [fromStr, toStr]
  );
  const snapshots = new Map(snapRes.rows.map((r) => [r.snapshot_date, r]));

  // Points = fin de chaque mois dans [from, to], borné à aujourd'hui, + le point 'to' exact.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const from = new Date(fromStr + 'T00:00:00');
  const to = new Date(toStr + 'T00:00:00');
  const points = [];
  const cur = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cur <= to) {
    let endOfMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 0); // dernier jour du mois
    if (endOfMonth > to) endOfMonth = new Date(to);
    if (endOfMonth > today) endOfMonth = new Date(today);
    const ds = fmtDate(endOfMonth);
    if (!points.includes(ds)) points.push(ds);
    cur.setMonth(cur.getMonth() + 1);
  }
  const toDs = fmtDate(to > today ? today : to);
  if (!points.includes(toDs)) points.push(toDs);

  const series = points.map((ds) => {
    // Snapshot exact si dispo
    const snap = snapshots.get(ds);
    if (snap) {
      return {
        date: ds,
        total_value_ht: parseFloat(snap.total_value_ht),
        value_with_po_history: parseFloat(snap.value_with_po_history),
        value_without_po_history: parseFloat(snap.value_without_po_history),
        total_units: Number(snap.total_units),
        products_count: snap.products_count,
        source: 'snapshot',
      };
    }
    // Reconstruction : deltas depuis les buckets mensuels (mois > mois(ds))
    const dsMonth = ds.slice(0, 7);
    const soldAfter = new Map();
    for (const [pid, arr] of soldByProduct) {
      let q = 0;
      for (const b of arr) if (b.month > dsMonth) q += b.qty;
      if (q) soldAfter.set(pid, q);
    }
    const receivedAfter = new Map();
    for (const [pid, arr] of recvByProduct) {
      let q = 0;
      for (const b of arr) if (b.month > dsMonth) q += b.qty;
      if (q) receivedAfter.set(pid, q);
    }
    const point = valuate({ base, dateStr: ds, soldAfter, receivedAfter });
    point.source = 'reconstructed';
    return point;
  });

  return series;
}

/**
 * Enregistre la valeur du stock d'aujourd'hui (exacte). Idempotent par jour.
 */
async function snapshotToday() {
  const today = fmtDate(new Date());
  const base = await loadBase();
  // "Aujourd'hui" : aucun mouvement après aujourd'hui → qty = stock actuel, coût FIFO à jour.
  const point = valuate({ base, dateStr: today, soldAfter: new Map(), receivedAfter: new Map() });
  await pool.query(`
    INSERT INTO stock_valuation_snapshots
      (snapshot_date, total_value_ht, value_with_po_history, value_without_po_history, products_count, total_units, method)
    VALUES ($1, $2, $3, $4, $5, $6, 'snapshot')
    ON CONFLICT (snapshot_date) DO UPDATE SET
      total_value_ht = EXCLUDED.total_value_ht,
      value_with_po_history = EXCLUDED.value_with_po_history,
      value_without_po_history = EXCLUDED.value_without_po_history,
      products_count = EXCLUDED.products_count,
      total_units = EXCLUDED.total_units,
      method = 'snapshot',
      created_at = CURRENT_TIMESTAMP
  `, [today, point.total_value_ht, point.value_with_po_history, point.value_without_po_history,
      point.products_count, point.total_units]);
  return point;
}

module.exports = { loadBase, computeAt, computeSeries, snapshotToday };
