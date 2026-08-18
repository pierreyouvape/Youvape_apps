/**
 * Boutiques physiques (Nextore) — synchro + requêtes.
 *
 * Cloisonné par warehouse_id (1 = Montpellier, 2 = Castelnau). Catalogue global,
 * stock par boutique. L'historique est un JOURNAL DES CHANGEMENTS
 * (nextore_stock_history) : une ligne seulement quand le stock d'un produit
 * change → on reconstruit le stock à n'importe quel instant T. Voir
 * docs/nextore-api.md pour les pièges API.
 */

const pool = require('../config/database');
const api = require('../services/nextoreApiClient');
const { WAREHOUSES } = require('../config/nextore');

// --- Nettoyage des valeurs Nextore (tout est string, vide = 'None' ou '') ---
function s(v) {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === '' || t === 'None' ? null : t;
}
function num(v) {
  const c = s(v);
  if (c === null) return null;
  const n = Number(c);
  return Number.isNaN(n) ? null : n;
}
function ts(v) {
  const c = s(v);
  if (c === null || c.startsWith('0000-00-00')) return null;
  return c;
}

/** Upsert en masse, par lots (Postgres limite ~65535 paramètres par requête). */
async function bulkUpsert(client, table, cols, conflictKeys, rows) {
  if (!rows.length) return 0;
  const updateCols = cols.filter((c) => !conflictKeys.includes(c));
  const setClause = updateCols.map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  const perRow = cols.length;
  const chunkSize = Math.max(1, Math.floor(60000 / perRow));
  let count = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = [];
    const placeholders = chunk.map((row, r) => {
      const ph = row.map((_, c) => `$${r * perRow + c + 1}`);
      values.push(...row);
      return `(${ph.join(', ')})`;
    });
    await client.query(
      `INSERT INTO ${table} (${cols.join(', ')})
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (${conflictKeys.join(', ')})
       DO UPDATE SET ${setClause}`,
      values
    );
    count += chunk.length;
  }
  return count;
}

/** Insert en masse, par lots (pas d'upsert : on purge la fenêtre avant). */
async function bulkInsert(client, table, cols, rows) {
  if (!rows.length) return 0;
  const perRow = cols.length;
  const chunkSize = Math.max(1, Math.floor(60000 / perRow));
  let count = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = [];
    const placeholders = chunk.map((row, r) => {
      const ph = row.map((_, c) => `$${r * perRow + c + 1}`);
      values.push(...row);
      return `(${ph.join(', ')})`;
    });
    await client.query(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${placeholders.join(', ')}`,
      values
    );
    count += chunk.length;
  }
  return count;
}

async function setConfig(client, key) {
  await client.query(
    `INSERT INTO app_config (config_key, config_value, updated_at)
     VALUES ($1, NOW()::text, NOW())
     ON CONFLICT (config_key) DO UPDATE SET config_value = NOW()::text, updated_at = NOW()`,
    [key]
  );
}

// --- Synchro CATALOGUE (produits + catégories, global) ---------------------
async function syncCatalog() {
  const started = Date.now();
  const [products, categories, subcategories] = await Promise.all([
    api.getProducts(),
    api.getCategories(),
    api.getSubcategories(),
  ]);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (Array.isArray(categories)) {
      await bulkUpsert(client, 'nextore_categories', ['id', 'code', 'name'], ['id'],
        categories.map((c) => [s(c.id), s(c.code), s(c.name)]));
    }
    if (Array.isArray(subcategories)) {
      await bulkUpsert(client, 'nextore_subcategories', ['id', 'category_id', 'code', 'name'], ['id'],
        subcategories.map((c) => [s(c.id), s(c.category_id), s(c.code), s(c.name)]));
    }

    const productRows = (products || []).map((p) => [
      s(p.id), s(p.code), s(p.name), s(p.unit), num(p.cost), num(p.price),
      s(p.category_id), s(p.subcategory_id), s(p.subsubcategory_id),
      s(p.barcode), s(p.tax_rate), s(p.type), s(p.status), ts(p.date_update),
    ]);
    const nbProducts = await bulkUpsert(client, 'nextore_products',
      ['product_id', 'code', 'name', 'unit', 'cost', 'price', 'category_id',
       'subcategory_id', 'subsubcategory_id', 'barcode', 'tax_rate', 'type',
       'status', 'date_update'],
      ['product_id'], productRows);

    await setConfig(client, 'nextore_last_catalog_sync_at');
    await setConfig(client, 'nextore_last_sync_at');
    await client.query('COMMIT');
    return {
      products: nbProducts,
      categories: Array.isArray(categories) ? categories.length : 0,
      subcategories: Array.isArray(subcategories) ? subcategories.length : 0,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// --- Synchro STOCK (par boutique) + journal des changements ----------------
async function syncStock() {
  const started = Date.now();
  const stockByWh = {};

  // On récupère hors transaction (appels réseau), puis on écrit par boutique.
  const fetched = {};
  for (const wh of WAREHOUSES) {
    fetched[wh.id] = await api.getWarehouseStock(wh.id);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const changes = {};

    for (const wh of WAREHOUSES) {
      const rows = (fetched[wh.id] || []).map((r) => [s(r.product_id), wh.id, num(r.stock) ?? 0, s(r.rack)]);
      await bulkUpsert(client, 'nextore_stock',
        ['product_id', 'warehouse_id', 'stock', 'rack'],
        ['product_id', 'warehouse_id'], rows);
      stockByWh[wh.id] = rows.length;

      // Journal : on n'insère un point que si le stock diffère du dernier connu.
      // Premier passage (historique vide) → baseline complète.
      const res = await client.query(
        `INSERT INTO nextore_stock_history (captured_at, warehouse_id, product_id, stock)
         SELECT NOW(), st.warehouse_id, st.product_id, st.stock
         FROM nextore_stock st
         LEFT JOIN LATERAL (
           SELECT h.stock AS last_stock
           FROM nextore_stock_history h
           WHERE h.warehouse_id = st.warehouse_id AND h.product_id = st.product_id
           ORDER BY h.captured_at DESC LIMIT 1
         ) last ON true
         WHERE st.warehouse_id = $1
           AND (last.last_stock IS NULL OR last.last_stock <> st.stock)`,
        [wh.id]
      );
      changes[wh.id] = res.rowCount;
    }

    await setConfig(client, 'nextore_last_stock_sync_at');
    await setConfig(client, 'nextore_last_sync_at');
    await client.query('COMMIT');
    return { stock: stockByWh, changes, durationMs: Date.now() - started };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// --- Synchro complète (catalogue puis stock) -------------------------------
async function syncAll() {
  const cat = await syncCatalog();
  const stk = await syncStock();
  return { ...cat, stock: stk.stock, changes: stk.changes, durationMs: cat.durationMs + stk.durationMs };
}

// --- Historique de VENTES (base prévision d'achat) -------------------------
const SALES_COLS = [
  'sale_id', 'sale_reference', 'warehouse_id', 'product_id', 'product_name',
  'quantity', 'unit_price', 'real_unit_price', 'unit_cost', 'tax_rate',
  'item_discount', 'payments', 'biller_id', 'biller_name', 'customer_id', 'sold_at',
];

function saleRow(r) {
  return [
    s(r.sale_id), s(r.sale_reference), num(r.warehouse_id), s(r.product_id),
    s(r.product_name), num(r.quantity) ?? 0, num(r.unit_price), num(r.real_unit_price),
    num(r.unit_cost), num(r.tax_rate), num(r.item_discount), s(r.payments),
    s(r.biller_id), s(r.biller_name), s(r.customer_id), ts(r.date),
  ];
}

/**
 * Importe les ventes d'une fenêtre [startDate, endDate] (dates 'YYYY-MM-DD',
 * inclusives). Idempotent : purge la fenêtre puis réinsère.
 */
async function syncSalesRange(startDate, endDate) {
  const items = await api.getSaleItems(startDate, endDate);
  const list = Array.isArray(items) ? items : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM nextore_sales WHERE sold_at::date >= $1::date AND sold_at::date <= $2::date`,
      [startDate, endDate]
    );
    const inserted = await bulkInsert(client, 'nextore_sales', SALES_COLS, list.map(saleRow));
    await setConfig(client, 'nextore_last_sales_sync_at');
    await client.query('COMMIT');
    return { range: [startDate, endDate], fetched: list.length, inserted };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Backfill mois par mois depuis `fromDate` jusqu'au mois courant. */
async function backfillSales(fromDate = '2023-12-01') {
  const start = new Date(`${fromDate}T00:00:00`);
  const now = new Date();
  const results = [];
  let y = start.getFullYear();
  let mo = start.getMonth(); // 0-based
  while (y < now.getFullYear() || (y === now.getFullYear() && mo <= now.getMonth())) {
    const mm = String(mo + 1).padStart(2, '0');
    const first = `${y}-${mm}-01`;
    const lastDay = new Date(y, mo + 1, 0).getDate();
    const last = `${y}-${mm}-${String(lastDay).padStart(2, '0')}`;
    const r = await syncSalesRange(first, last);
    results.push(r);
    mo += 1;
    if (mo > 11) { mo = 0; y += 1; }
  }
  return {
    months: results.length,
    totalInserted: results.reduce((a, r) => a + r.inserted, 0),
    results,
  };
}

/** Réimporte les N derniers jours (cron quotidien, rattrape retours/édits). */
async function syncRecentSales(days = 3) {
  const now = new Date();
  const from = new Date(now.getTime() - days * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return syncSalesRange(fmt(from), fmt(now));
}

// --- Relevé de stock d'une boutique ----------------------------------------
async function getStockDashboard(warehouseId, opts = {}) {
  const params = [warehouseId];
  const where = ['s.warehouse_id = $1'];

  if (opts.search) {
    params.push(`%${opts.search}%`);
    where.push(`(p.name ILIKE $${params.length} OR p.code ILIKE $${params.length} OR p.barcode ILIKE $${params.length})`);
  }
  if (opts.onlyInStock) where.push('s.stock <> 0');

  const { rows } = await pool.query(
    `SELECT
        p.product_id,
        p.name,
        p.code,
        p.barcode,
        p.category_id,
        c.name AS category_name,
        s.stock::float             AS stock,
        s.rack,
        p.cost::float              AS cost,
        p.price::float             AS price,
        (s.stock * COALESCE(p.cost, 0))::float AS stock_value,
        prev.stock::float          AS prev_stock,
        (s.stock - COALESCE(prev.stock, s.stock))::float AS stock_delta
     FROM nextore_stock s
     JOIN nextore_products p ON p.product_id = s.product_id
     LEFT JOIN nextore_categories c ON c.id = p.category_id
     LEFT JOIN LATERAL (
        -- dernier état connu AVANT le début de la journée Paris = stock d'hier soir
        SELECT h.stock FROM nextore_stock_history h
        WHERE h.warehouse_id = s.warehouse_id
          AND h.product_id = s.product_id
          AND h.captured_at < date_trunc('day', NOW() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        ORDER BY h.captured_at DESC LIMIT 1
     ) prev ON true
     WHERE ${where.join(' AND ')}
     ORDER BY p.name ASC`,
    params
  );
  return rows;
}

async function getStockSummary(warehouseId) {
  const { rows } = await pool.query(
    `SELECT
        COUNT(*)::int                                            AS total_products,
        COUNT(*) FILTER (WHERE s.stock > 0)::int                 AS in_stock,
        COUNT(*) FILTER (WHERE s.stock = 0)::int                 AS out_of_stock,
        COUNT(*) FILTER (WHERE s.stock < 0)::int                 AS negative,
        COALESCE(SUM(s.stock * COALESCE(p.cost, 0)), 0)::float   AS total_value,
        COALESCE(SUM(GREATEST(s.stock, 0)), 0)::float            AS total_units
     FROM nextore_stock s
     JOIN nextore_products p ON p.product_id = s.product_id
     WHERE s.warehouse_id = $1`,
    [warehouseId]
  );
  return rows[0];
}

/**
 * Historique d'un produit dans une boutique (points de changement, plus récent
 * d'abord). Permet de tracer l'évolution du stock dans le temps.
 */
async function getProductStockHistory(warehouseId, productId, limit = 200) {
  const { rows } = await pool.query(
    `SELECT captured_at, stock::float AS stock
     FROM nextore_stock_history
     WHERE warehouse_id = $1 AND product_id = $2
     ORDER BY captured_at DESC
     LIMIT $3`,
    [warehouseId, productId, limit]
  );
  return rows;
}

async function getLastSyncAt() {
  const { rows } = await pool.query(
    "SELECT config_value FROM app_config WHERE config_key = 'nextore_last_sync_at'"
  );
  return rows[0]?.config_value || null;
}

module.exports = {
  syncCatalog,
  syncStock,
  syncAll,
  syncSalesRange,
  backfillSales,
  syncRecentSales,
  getStockDashboard,
  getStockSummary,
  getProductStockHistory,
  getLastSyncAt,
};
