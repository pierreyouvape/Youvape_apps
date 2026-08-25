/**
 * Boutiques Nextore — COMPTAGE (inventaire). 1er module d'ÉCRITURE.
 *
 * Écriture via PUT /stocks = DELTA. Pour poser un stock compté C sur une réf :
 *   delta = C − S_ref, où S_ref = stock Nextore LIVE capturé au comptage de la réf.
 * Le delta absorbe les ventes survenues APRÈS le comptage (stock Nextore temps réel).
 */

const pool = require('../config/database');
const api = require('../services/nextoreApiClient');

const COOLDOWN_DAYS = 14;         // une réf comptée n'est pas reproposée avant 14 j
const OVERSTOCK_DAYS = 60;        // "anormalement élevé" : > 60 j de ventes
const LOW_HABITUAL_MIN = 10;      // "anormalement bas" : habituel >= 10 …
const LOW_CURRENT_RATIO = 0.2;    // … et actuel <= 20 % de l'habituel

// --- Sélection de l'inventaire tournant (10 réfs, ordre de priorité) --------
async function getRollingProposal(warehouseId, limit = 10) {
  const wh = [warehouseId];

  const q = (sql) => pool.query(sql, wh).then((r) => r.rows.map((x) => x.product_id));

  // Réfs à exclure (comptées & poussées depuis < 14 j)
  const cooldownRows = await pool.query(
    `SELECT DISTINCT ci.product_id
     FROM nextore_comptage_items ci
     JOIN nextore_comptages c ON c.id = ci.comptage_id
     WHERE c.warehouse_id = $1 AND ci.pushed_at >= NOW() - INTERVAL '${COOLDOWN_DAYS} days'`,
    wh,
  );
  const cooldown = new Set(cooldownRows.rows.map((r) => r.product_id));

  // 1. Stock négatif (le plus négatif d'abord)
  const negatifs = await q(
    `SELECT product_id FROM nextore_stock WHERE warehouse_id = $1 AND stock < 0 ORDER BY stock ASC`,
  );
  // 2. Vendus souvent (31 j)
  const bestsellers = await q(
    `SELECT product_id FROM nextore_sales
     WHERE warehouse_id = $1 AND sold_at >= NOW() - INTERVAL '31 days'
     GROUP BY product_id ORDER BY SUM(quantity) DESC LIMIT 100`,
  );
  // 3. Anormalement bas (habituel >= 10 ET actuel <= 20 %)
  const bas = await q(
    `WITH hist AS (
        SELECT product_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY stock) AS habitual
        FROM nextore_stock_history
        WHERE warehouse_id = $1 AND captured_at >= NOW() - INTERVAL '45 days'
        GROUP BY product_id
     )
     SELECT st.product_id FROM nextore_stock st JOIN hist h ON h.product_id = st.product_id
     WHERE st.warehouse_id = $1 AND st.stock >= 0
       AND h.habitual >= ${LOW_HABITUAL_MIN}
       AND st.stock <= h.habitual * ${LOW_CURRENT_RATIO}
     ORDER BY (h.habitual - st.stock) DESC`,
  );
  // 4. Anormalement élevé (> 60 j de ventes)
  const eleves = await q(
    `WITH vel AS (
        SELECT product_id, SUM(quantity) / 31.0 AS daily FROM nextore_sales
        WHERE warehouse_id = $1 AND sold_at >= NOW() - INTERVAL '31 days'
        GROUP BY product_id
     )
     SELECT st.product_id FROM nextore_stock st JOIN vel v ON v.product_id = st.product_id
     WHERE st.warehouse_id = $1 AND v.daily > 0 AND st.stock > ${OVERSTOCK_DAYS} * v.daily
     ORDER BY st.stock DESC`,
  );

  // Remplissage prioritaire
  const picked = [];
  const seen = new Set();
  const add = (ids, reason) => {
    for (const id of ids) {
      if (picked.length >= limit) return;
      if (seen.has(id) || cooldown.has(id)) continue;
      seen.add(id);
      picked.push({ product_id: id, reason });
    }
  };
  add(negatifs, 'negatif');
  add(bestsellers, 'vendu_souvent');
  add(bas, 'anormalement_bas');
  add(eleves, 'anormalement_eleve');

  return picked; // [{ product_id, reason }]
}

// --- Infos produit pour l'affichage ----------------------------------------
async function productInfo(productIds) {
  if (!productIds.length) return new Map();
  const { rows } = await pool.query(
    `SELECT p.product_id, p.name, p.code AS sku, p.barcode, c.name AS category_name
     FROM nextore_products p LEFT JOIN nextore_categories c ON c.id = p.category_id
     WHERE p.product_id = ANY($1::text[])`,
    [productIds],
  );
  return new Map(rows.map((r) => [r.product_id, r]));
}

// --- Création d'une session -------------------------------------------------
async function createComptage(warehouseId, { type, name, filterType, filterId, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO nextore_comptages (warehouse_id, type, name, filter_type, filter_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [warehouseId, type, name || null, filterType || null, filterId || null, createdBy || null],
  );
  const comptage = rows[0];

  // Inventaire tournant : pré-remplir les 10 réfs proposées (à compter)
  if (type === 'tournant') {
    const proposal = await getRollingProposal(warehouseId, 10);
    for (const { product_id } of proposal) {
      await pool.query(
        `INSERT INTO nextore_comptage_items (comptage_id, product_id)
         VALUES ($1, $2) ON CONFLICT (comptage_id, product_id) DO NOTHING`,
        [comptage.id, product_id],
      );
    }
  }
  // Inventaire par catégorie : pré-remplir tous les produits de la catégorie
  // (le "à compter exhaustif") → non scanné = counted_qty NULL.
  if (type === 'categorie' && filterType && filterId) {
    const col = filterType === 'subcategory' ? 'subcategory_id' : 'category_id';
    await pool.query(
      `INSERT INTO nextore_comptage_items (comptage_id, product_id)
       SELECT $1, p.product_id FROM nextore_products p
       JOIN nextore_stock st ON st.product_id = p.product_id AND st.warehouse_id = $2
       WHERE p.${col} = $3 AND (p.name IS NULL OR p.name NOT ILIKE 'produit non cr%')
       ON CONFLICT (comptage_id, product_id) DO NOTHING`,
      [comptage.id, warehouseId, filterId],
    );
  }
  return getComptage(comptage.id);
}

// --- Lecture d'une session + lignes -----------------------------------------
async function getComptage(comptageId) {
  const { rows: cs } = await pool.query('SELECT * FROM nextore_comptages WHERE id = $1', [comptageId]);
  if (!cs.length) return null;
  const comptage = cs[0];
  const { rows: items } = await pool.query(
    `SELECT * FROM nextore_comptage_items WHERE comptage_id = $1 ORDER BY id ASC`,
    [comptageId],
  );
  const info = await productInfo(items.map((i) => i.product_id));
  const enriched = items.map((i) => ({
    ...i,
    counted_qty: i.counted_qty == null ? null : Number(i.counted_qty),
    s_ref: i.s_ref == null ? null : Number(i.s_ref),
    ...(info.get(i.product_id) || {}),
  }));
  return { ...comptage, items: enriched };
}

/** Résout un code-barres → produit de la boutique. */
async function resolveBarcode(warehouseId, barcode) {
  const { rows } = await pool.query(
    `SELECT p.product_id, p.name, p.code AS sku, p.barcode
     FROM nextore_products p
     JOIN nextore_stock st ON st.product_id = p.product_id AND st.warehouse_id = $1
     WHERE p.barcode = $2 AND p.barcode <> '' LIMIT 1`,
    [warehouseId, String(barcode).trim()],
  );
  return rows[0] || null;
}

/**
 * Enregistre un comptage sur une réf. mode 'scan' → +qty (défaut 1) ; 'set' → =qty.
 * À la 1re saisie d'une réf, capture S_ref = stock Nextore LIVE.
 */
async function recordCount(comptageId, warehouseId, productId, { qty = 1, mode = 'scan' }) {
  const { rows: ex } = await pool.query(
    'SELECT * FROM nextore_comptage_items WHERE comptage_id = $1 AND product_id = $2',
    [comptageId, productId],
  );
  const existing = ex[0];

  // S_ref : capturé au premier comptage effectif de la réf (proche du comptage physique)
  let sRef = existing?.s_ref;
  if (sRef == null) {
    sRef = await api.getLiveStock(warehouseId, productId);
  }

  let counted;
  if (mode === 'set') counted = qty;
  else counted = (existing?.counted_qty != null ? Number(existing.counted_qty) : 0) + qty;

  await pool.query(
    `INSERT INTO nextore_comptage_items (comptage_id, product_id, s_ref, counted_qty)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (comptage_id, product_id)
     DO UPDATE SET counted_qty = $4, s_ref = COALESCE(nextore_comptage_items.s_ref, $3)`,
    [comptageId, productId, sRef, counted],
  );
  const { rows: pinfo } = await pool.query(
    'SELECT name, code AS sku, barcode FROM nextore_products WHERE product_id = $1',
    [productId],
  );
  return { product_id: productId, counted_qty: counted, s_ref: sRef, ...(pinfo[0] || {}) };
}

/**
 * Valide et POUSSE dans Nextore. mode 'partial' → pousse les lignes comptées non
 * encore poussées, session reste ouverte. mode 'final' → idem + clôture ;
 * `zeroProductIds` = réfs non comptées à mettre à 0 (type catégorie).
 */
async function validateComptage(comptageId, warehouseId, { mode = 'partial', zeroProductIds = [] }) {
  const comptage = await getComptage(comptageId);
  if (!comptage) throw new Error('Comptage introuvable');

  const results = [];
  const toPush = comptage.items.filter((i) => !i.pushed && i.counted_qty != null);

  for (const item of toPush) {
    try {
      const live = await api.getLiveStock(warehouseId, item.product_id);
      const sRef = item.s_ref != null ? item.s_ref : live;
      const delta = item.counted_qty - sRef;
      const moved = live != null && sRef != null && live !== sRef;
      if (delta !== 0) {
        await api.putStock(item.product_id, warehouseId, delta, `Comptage #${comptageId} (${comptage.type})`);
      }
      await pool.query(
        `UPDATE nextore_comptage_items SET pushed = TRUE, pushed_at = NOW(), delta_pushed = $2, moved = $3
         WHERE id = $1`,
        [item.id, delta, moved],
      );
      results.push({ product_id: item.product_id, name: item.name, counted: item.counted_qty, delta, moved, ok: true });
    } catch (e) {
      results.push({ product_id: item.product_id, name: item.name, ok: false, error: e.message });
    }
  }

  // Type catégorie : réfs confirmées "pas de stock" → mettre à 0
  for (const productId of zeroProductIds) {
    try {
      const live = await api.getLiveStock(warehouseId, productId);
      if (live != null && live !== 0) {
        await api.putStock(productId, warehouseId, -live, `Comptage #${comptageId} (mise à 0)`);
      }
      await pool.query(
        `INSERT INTO nextore_comptage_items (comptage_id, product_id, s_ref, counted_qty, pushed, pushed_at, delta_pushed)
         VALUES ($1, $2, $3, 0, TRUE, NOW(), $4)
         ON CONFLICT (comptage_id, product_id)
         DO UPDATE SET counted_qty = 0, pushed = TRUE, pushed_at = NOW(), delta_pushed = $4`,
        [comptageId, productId, live, live != null ? -live : 0],
      );
      results.push({ product_id: productId, counted: 0, delta: live != null ? -live : 0, ok: true });
    } catch (e) {
      results.push({ product_id: productId, ok: false, error: e.message });
    }
  }

  if (mode === 'final') {
    await pool.query(
      `UPDATE nextore_comptages SET status = 'valide', validated_at = NOW() WHERE id = $1`,
      [comptageId],
    );
  }
  return { mode, results };
}

/** Liste des sessions d'une boutique. */
async function listComptages(warehouseId) {
  const { rows } = await pool.query(
    `SELECT c.*,
            (SELECT name FROM users u WHERE u.email = c.created_by LIMIT 1) AS created_by_name,
            (SELECT COUNT(*) FROM nextore_comptage_items ci WHERE ci.comptage_id = c.id AND ci.counted_qty IS NOT NULL)::int AS counted_count,
            (SELECT COUNT(*) FROM nextore_comptage_items ci WHERE ci.comptage_id = c.id)::int AS items_count
     FROM nextore_comptages c
     WHERE c.warehouse_id = $1
     ORDER BY c.created_at DESC LIMIT 100`,
    [warehouseId],
  );
  return rows;
}

module.exports = {
  getRollingProposal,
  createComptage,
  getComptage,
  resolveBarcode,
  recordCount,
  validateComptage,
  listComptages,
};
