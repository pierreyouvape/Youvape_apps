const pool = require('../config/database');

/**
 * Valeur de stock en achat HT — évolution dans le temps.
 *
 * RÉFÉRENCE : le catalogue fait foi (`productModel.countForCatalog` → `totalStockValue`,
 * affiché en haut de /catalog). À la date du jour, ce module renvoie EXACTEMENT le même
 * chiffre : même périmètre de produits, même coût unitaire courant.
 *
 * Aux dates passées, on garde ce périmètre mais on remonte le temps :
 *  1. Quantité à D (rollback des mouvements depuis aujourd'hui) :
 *       qty(D) = stock_actuel − reçu_après_D + vendu_après_D
 *  2. Coût unitaire à D = PMP FIFO borné à D — exactement l'algorithme de
 *     `computedCostModel.recalculateAll`, qui produit `computed_cost` aujourd'hui.
 *     Un produit sans historique d'achat ≤ D retombe sur son coût courant.
 *
 *  valeur(D) = Σ qty(D) × coût(D)
 *
 * TROIS INVARIANTS À NE PAS CASSER (chacun a déjà produit un écart avec le catalogue) :
 *  • `units_per_qty` : chez les fournisseurs facturés au PACK (LCA, Highbuy, Levest,
 *    MG Vape, lignes BMS laissées en packs), `qty_received` est un nombre de PACKS et
 *    `unit_price` le prix DU PACK. Tout calcul de stock ou de coût doit ramener les deux
 *    à l'unité, sinon le lot est units_per_qty fois trop petit ET units_per_qty fois trop
 *    cher (cf. migration add_units_per_qty_purchase_order_items.sql).
 *  • Statuts de vente : liste BLANCHE des 6 statuts payés (règle CLAUDE.md). Jamais de
 *    liste noire : le shop a des statuts custom qui passeraient au travers et décaleraient
 *    le pointeur FIFO.
 *  • Périmètre : strictement celui du catalogue (`STOCK_VALUE_SCOPE`). Sinon les deux
 *    pages ne parlent pas du même stock.
 *
 * Le cron quotidien vérifie l'égalité avec le catalogue et alerte en cas de dérive
 * (cf. cronService.setupStockValuationSnapshotCron).
 *
 * Limites connues :
 *  - l'historique des bons de commande commence ~octobre 2025 (pas de coût d'époque avant) ;
 *  - le rollback ignore les ajustements manuels d'inventaire non tracés (légère dérive).
 */

// Liste blanche des 6 statuts payés — identique à computedCostModel et au reste de l'app.
const PAID_STATUSES = [
  'wc-completed', 'wc-delivered', 'wc-processing',
  'wc-awaiting-delivery', 'wc-shipped', 'wc-being-delivered'
];

const PO_EXCLUDED_STATUSES = ['draft', 'cancelled'];

/**
 * Périmètre du stock valorisé — miroir de productModel.countForCatalog (filtres par défaut) :
 * produits publiés, packs (woosb) exclus car leur coût est déjà porté par leurs composants,
 * parents 'variable' exclus car le stock est sur les déclinaisons.
 *  - simple    : valorisé s'il est suivi en stock (track_stock) ;
 *  - variation : le catalogue valorise toutes les déclinaisons publiées d'un parent retenu
 *                (parent publié + au moins une déclinaison suivie en stock).
 */
const STOCK_VALUE_SCOPE = `
  p.post_status = 'publish'
  AND (
    (p.product_type = 'simple' AND p.track_stock = true)
    OR (
      p.product_type = 'variation'
      AND EXISTS (
        SELECT 1 FROM products par
        WHERE par.wp_product_id = p.wp_parent_id
          AND par.post_status = 'publish'
          AND par.product_type = 'variable'
          AND EXISTS (
            SELECT 1 FROM products v
            WHERE v.wp_parent_id = par.wp_product_id
              AND v.product_type = 'variation'
              AND v.track_stock = true
          )
      )
    )
  )
`;

// Coût unitaire courant : même expression que le catalogue.
const CURRENT_COST = `COALESCE(p.computed_cost, p.wc_cog_cost, 0)`;

// Lots d'achat ramenés à l'UNITÉ de stock (cf. invariant units_per_qty).
const LOT_QTY = `poi.qty_received * COALESCE(poi.units_per_qty, 1)`;
const LOT_UNIT_PRICE = `poi.unit_price / COALESCE(NULLIF(poi.units_per_qty, 0), 1)
                        * (1 - COALESCE(poi.discount_percent, 0) / 100.0)`;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => fmtDate(new Date());

/**
 * Charge la base commune : produits valorisables, lots FIFO, ventes totales.
 * Réutilisé par computeAt (date libre) et computeSeries (courbe mensuelle).
 */
async function loadBase() {
  const productsRes = await pool.query(`
    SELECT p.id,
           GREATEST(COALESCE(p.stock, 0), 0)::bigint AS stock,
           ${CURRENT_COST}::numeric AS current_cost
    FROM products p
    WHERE ${STOCK_VALUE_SCOPE}
  `);

  // Lots reçus (FIFO), triés par date d'arrivée, en unités de stock.
  const lotsRes = await pool.query(`
    SELECT poi.product_id,
           (${LOT_QTY})::int AS qty,
           (${LOT_UNIT_PRICE})::numeric AS price,
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
    WHERE o.post_status IN (${PAID_STATUSES.map((_, i) => `$${i + 1}`).join(', ')})
    GROUP BY p.id
  `, PAID_STATUSES);

  const products = new Map();
  for (const r of productsRes.rows) {
    products.set(r.id, {
      stock: Number(r.stock),
      currentCost: parseFloat(r.current_cost) || 0,
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
 * `dateStr` = 'YYYY-MM-DD' (borne FIFO).
 * `useCurrentCost` : à aujourd'hui, on prend le coût courant (computed_cost) pour rendre
 * le chiffre rigoureusement identique au catalogue ; aux dates passées, le coût d'époque.
 */
function valuate({ base, dateStr, soldAfter, receivedAfter, useCurrentCost = false }) {
  const { products, lotsByProduct, totalSold } = base;
  let total = 0, withPo = 0, withoutPo = 0, units = 0, count = 0;

  for (const [pid, prod] of products) {
    const soldA = soldAfter.get(pid) || 0;
    const recvA = receivedAfter.get(pid) || 0;
    const qtyAtD = prod.stock - recvA + soldA; // rollback
    if (qtyAtD <= 0) continue;

    const allLots = lotsByProduct.get(pid);
    const lotsUpto = allLots ? allLots.filter((l) => l.lotDate <= dateStr) : null;
    const hasPo = !!(lotsUpto && lotsUpto.length > 0);

    let unitCost;
    if (useCurrentCost || !hasPo) {
      unitCost = prod.currentCost;
    } else {
      const soldUpto = (totalSold.get(pid) || 0) - soldA;
      unitCost = fifoCostAsOf(lotsUpto, Math.max(0, soldUpto));
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
    WHERE o.post_status IN (${PAID_STATUSES.map((_, i) => `$${i + 2}`).join(', ')})
      AND o.post_date::date > $1
    GROUP BY p.id
  `, [dateStr, ...PAID_STATUSES]);

  const receivedAfterRes = await pool.query(`
    SELECT poi.product_id, COALESCE(SUM(${LOT_QTY}), 0)::bigint AS qty
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.purchase_order_id
    WHERE poi.qty_received > 0
      AND po.status NOT IN (${PO_EXCLUDED_STATUSES.map((_, i) => `$${i + 2}`).join(', ')})
      AND COALESCE(po.received_date, po.order_date, po.created_at)::date > $1
    GROUP BY poi.product_id
  `, [dateStr, ...PO_EXCLUDED_STATUSES]);

  const soldAfter = new Map(soldAfterRes.rows.map((r) => [r.product_id, Number(r.qty)]));
  const receivedAfter = new Map(receivedAfterRes.rows.map((r) => [r.product_id, Number(r.qty)]));

  return valuate({ base, dateStr, soldAfter, receivedAfter, useCurrentCost: dateStr >= todayStr() });
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
    WHERE o.post_status IN (${PAID_STATUSES.map((_, i) => `$${i + 1}`).join(', ')})
    GROUP BY p.id, ym
  `, PAID_STATUSES);

  const recvMonthRes = await pool.query(`
    SELECT poi.product_id,
           to_char(DATE_TRUNC('month', COALESCE(po.received_date, po.order_date, po.created_at)), 'YYYY-MM') AS ym,
           COALESCE(SUM(${LOT_QTY}), 0)::bigint AS qty
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
            products_count, total_units, method
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

  const nowStr = fmtDate(today);

  const series = points.map((ds) => {
    // Snapshot déjà enregistré (sauf aujourd'hui : on recalcule pour rester collé au catalogue)
    const snap = ds < nowStr ? snapshots.get(ds) : null;
    if (snap) {
      return {
        date: ds,
        total_value_ht: parseFloat(snap.total_value_ht),
        value_with_po_history: parseFloat(snap.value_with_po_history),
        value_without_po_history: parseFloat(snap.value_without_po_history),
        total_units: Number(snap.total_units),
        products_count: snap.products_count,
        source: snap.method === 'snapshot' ? 'snapshot' : 'reconstructed',
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
    const point = valuate({ base, dateStr: ds, soldAfter, receivedAfter, useCurrentCost: ds >= nowStr });
    point.source = ds >= nowStr ? 'snapshot' : 'reconstructed';
    return point;
  });

  return series;
}

/**
 * Enregistre la valeur du stock d'aujourd'hui (exacte, = chiffre du catalogue). Idempotent par jour.
 */
async function snapshotToday(base = null) {
  const today = todayStr();
  base = base || await loadBase();
  // "Aujourd'hui" : aucun mouvement après aujourd'hui → qty = stock actuel, coût courant.
  const point = valuate({ base, dateStr: today, soldAfter: new Map(), receivedAfter: new Map(), useCurrentCost: true });
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

/**
 * Contrôle d'alignement : la valeur du jour doit être égale au chiffre du catalogue.
 * Renvoie { report, catalog, delta, aligned }.
 */
async function checkAlignmentWithCatalog(base = null) {
  const productModel = require('./productModel');
  const point = await computeAt(todayStr(), base);
  const { totalStockValue } = await productModel.countForCatalog();
  const catalog = round2(parseFloat(totalStockValue) || 0);
  const delta = round2(point.total_value_ht - catalog);
  return { report: point.total_value_ht, catalog, delta, aligned: Math.abs(delta) <= 0.01 };
}

module.exports = { loadBase, computeAt, computeSeries, snapshotToday, checkAlignmentWithCatalog, PAID_STATUSES };
