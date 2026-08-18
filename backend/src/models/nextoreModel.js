/**
 * Boutiques physiques (Nextore) — synchro + requêtes.
 *
 * Cloisonné par warehouse_id (1 = Montpellier, 2 = Castelnau). Catalogue global,
 * stock + historique par boutique. Voir docs/nextore-api.md pour les pièges API.
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
  // Nextore renvoie '0000-00-00 00:00:00' pour "jamais"
  if (c === null || c.startsWith('0000-00-00')) return null;
  return c;
}

/**
 * Upsert en masse, par lots (Postgres limite ~65535 paramètres par requête).
 * @param {string} table
 * @param {string[]} cols  colonnes insérées
 * @param {string[]} conflictKeys  colonnes du PK / ON CONFLICT
 * @param {Array<Array>} rows  valeurs alignées sur cols
 */
async function bulkUpsert(client, table, cols, conflictKeys, rows) {
  if (!rows.length) return 0;
  const updateCols = cols.filter((c) => !conflictKeys.includes(c));
  const setClause = updateCols.map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  const perRow = cols.length;
  const maxParams = 60000;
  const chunkSize = Math.max(1, Math.floor(maxParams / perRow));
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

// --- Synchro complète (catalogue + stock 2 boutiques + snapshot) -----------
async function syncAll() {
  const started = Date.now();
  const [products, categories, subcategories] = await Promise.all([
    api.getProducts(),
    api.getCategories(),
    api.getSubcategories(),
  ]);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Catégories
    if (Array.isArray(categories)) {
      await bulkUpsert(
        client, 'nextore_categories',
        ['id', 'code', 'name'], ['id'],
        categories.map((c) => [s(c.id), s(c.code), s(c.name)])
      );
    }
    if (Array.isArray(subcategories)) {
      await bulkUpsert(
        client, 'nextore_subcategories',
        ['id', 'category_id', 'code', 'name'], ['id'],
        subcategories.map((c) => [s(c.id), s(c.category_id), s(c.code), s(c.name)])
      );
    }

    // Produits
    const productRows = (products || []).map((p) => [
      s(p.id), s(p.code), s(p.name), s(p.unit), num(p.cost), num(p.price),
      s(p.category_id), s(p.subcategory_id), s(p.subsubcategory_id),
      s(p.barcode), s(p.tax_rate), s(p.type), s(p.status), ts(p.date_update),
    ]);
    const nbProducts = await bulkUpsert(
      client, 'nextore_products',
      ['product_id', 'code', 'name', 'unit', 'cost', 'price', 'category_id',
       'subcategory_id', 'subsubcategory_id', 'barcode', 'tax_rate', 'type',
       'status', 'date_update'],
      ['product_id'], productRows
    );

    // Stock par boutique + snapshot du jour (date Europe/Paris)
    const stockByWh = {};
    for (const wh of WAREHOUSES) {
      const stock = await api.getWarehouseStock(wh.id);
      const rows = (stock || []).map((r) => [s(r.product_id), wh.id, num(r.stock) ?? 0, s(r.rack)]);
      await bulkUpsert(
        client, 'nextore_stock',
        ['product_id', 'warehouse_id', 'stock', 'rack'],
        ['product_id', 'warehouse_id'], rows
      );
      stockByWh[wh.id] = rows.length;

      // Snapshot : recopie l'état courant de la boutique à la date Paris du jour
      await client.query(
        `INSERT INTO nextore_stock_snapshots (snapshot_date, warehouse_id, product_id, stock)
         SELECT (NOW() AT TIME ZONE 'Europe/Paris')::date, warehouse_id, product_id, stock
         FROM nextore_stock WHERE warehouse_id = $1
         ON CONFLICT (snapshot_date, warehouse_id, product_id)
         DO UPDATE SET stock = EXCLUDED.stock`,
        [wh.id]
      );
    }

    await client.query(
      `INSERT INTO app_config (config_key, config_value, updated_at)
       VALUES ('nextore_last_sync_at', NOW()::text, NOW())
       ON CONFLICT (config_key) DO UPDATE SET config_value = NOW()::text, updated_at = NOW()`
    );

    await client.query('COMMIT');
    return {
      products: nbProducts,
      categories: Array.isArray(categories) ? categories.length : 0,
      stock: stockByWh,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// --- Relevé de stock d'une boutique ----------------------------------------
/**
 * @param {number} warehouseId
 * @param {object} opts { search, onlyInStock }
 */
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
        SELECT stock FROM nextore_stock_snapshots ns
        WHERE ns.warehouse_id = s.warehouse_id
          AND ns.product_id = s.product_id
          AND ns.snapshot_date < (NOW() AT TIME ZONE 'Europe/Paris')::date
        ORDER BY ns.snapshot_date DESC LIMIT 1
     ) prev ON true
     WHERE ${where.join(' AND ')}
     ORDER BY p.name ASC`,
    params
  );
  return rows;
}

/** Résumé chiffré pour l'en-tête du relevé. */
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

async function getLastSyncAt() {
  const { rows } = await pool.query(
    "SELECT config_value FROM app_config WHERE config_key = 'nextore_last_sync_at'"
  );
  return rows[0]?.config_value || null;
}

module.exports = {
  syncAll,
  getStockDashboard,
  getStockSummary,
  getLastSyncAt,
};
