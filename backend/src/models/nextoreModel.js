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
// Moteur de tendance PARTAGÉ avec WooCommerce (régression + moyenne mobile
// pondérée). Fonctions pures réutilisées telles quelles, sans les modifier.
// La logique de déclenchement V2 (seuil/couverture) est portée ici (comme
// NeedsTabV2), sans délai de réappro (inutile pour les boutiques).
const { calculateTrendCoefficient } = require('../services/needsCalculator');

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
  const [products, categories, subcategories, suppliers] = await Promise.all([
    api.getProducts(),
    api.getCategories(),
    api.getSubcategories(),
    api.getSuppliers(),
  ]);

  // Fournisseurs d'un produit : principal (supplier1) + liste dédupliquée
  const supplierIds = (p) => {
    const ids = [s(p.supplier1), s(p.supplier2), s(p.supplier3), s(p.supplier4), s(p.supplier5)].filter(Boolean);
    return [...new Set(ids)];
  };
  // Réf + prix par fournisseur : { "<id>": { ref, price } }
  const supplierRefs = (p) => {
    const out = {};
    for (let i = 1; i <= 5; i += 1) {
      const id = s(p[`supplier${i}`]);
      if (!id) continue;
      out[id] = { ref: s(p[`supplier${i}ref`]), price: num(p[`supplier${i}price`]) };
    }
    return out;
  };

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
    if (Array.isArray(suppliers)) {
      await bulkUpsert(client, 'nextore_suppliers', ['id', 'company'], ['id'],
        suppliers.map((sp) => [s(sp.id), s(sp.company)]));
    }

    const productRows = (products || []).map((p) => [
      s(p.id), s(p.code), s(p.name), s(p.unit), num(p.cost), num(p.price),
      s(p.category_id), s(p.subcategory_id), s(p.subsubcategory_id),
      s(p.barcode), s(p.tax_rate), s(p.type), s(p.status), ts(p.date_update),
      s(p.supplier1), supplierIds(p), JSON.stringify(supplierRefs(p)),
    ]);
    const nbProducts = await bulkUpsert(client, 'nextore_products',
      ['product_id', 'code', 'name', 'unit', 'cost', 'price', 'category_id',
       'subcategory_id', 'subsubcategory_id', 'barcode', 'tax_rate', 'type',
       'status', 'date_update', 'supplier_id', 'supplier_ids', 'supplier_refs'],
      ['product_id'], productRows);

    await setConfig(client, 'nextore_last_catalog_sync_at');
    await setConfig(client, 'nextore_last_sync_at');
    await client.query('COMMIT');
    return {
      products: nbProducts,
      categories: Array.isArray(categories) ? categories.length : 0,
      subcategories: Array.isArray(subcategories) ? subcategories.length : 0,
      suppliers: Array.isArray(suppliers) ? suppliers.length : 0,
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
  const otherId = Number(warehouseId) === 1 ? 2 : 1; // l'autre boutique
  const params = [warehouseId, otherId];
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
        (s.stock - COALESCE(prev.stock, s.stock))::float AS stock_delta,
        other.stock::float         AS other_stock,
        wcs.wc_stock::float        AS wc_stock,
        lnk.aligned_cost::float    AS aligned_cost,
        (s.stock * lnk.aligned_cost)::float AS aligned_value,
        lnk.pack_qty               AS link_pack_qty,
        lnk.wc_title               AS link_wc_title,
        lnk.link_status            AS link_status
     FROM nextore_stock s
     JOIN nextore_products p ON p.product_id = s.product_id
     LEFT JOIN nextore_categories c ON c.id = p.category_id
     LEFT JOIN nextore_stock other ON other.product_id = s.product_id AND other.warehouse_id = $2
     LEFT JOIN LATERAL (
        -- dernier état connu AVANT le début de la journée Paris = stock d'hier soir
        SELECT h.stock FROM nextore_stock_history h
        WHERE h.warehouse_id = s.warehouse_id
          AND h.product_id = s.product_id
          AND h.captured_at < date_trunc('day', NOW() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        ORDER BY h.captured_at DESC LIMIT 1
     ) prev ON true
     LEFT JOIN LATERAL (
        -- coût aligné sur le site : lien APPROUVÉ uniquement, coût site / pack_qty
        SELECT (COALESCE(pr.computed_cost, pr.wc_cog_cost) / NULLIF(l.pack_qty, 0)) AS aligned_cost,
               l.pack_qty, l.status AS link_status, pr.post_title AS wc_title
        FROM nextore_product_links l
        JOIN products pr ON pr.id = l.wc_product_id
        WHERE l.nx_product_id = s.product_id AND l.status = 'approved'
     ) lnk ON true
     LEFT JOIN LATERAL (
        -- stock WooCommerce rapproché par EAN (somme des produits WC ayant ce code-barres)
        SELECT SUM(w.stock)::float AS wc_stock FROM (
          SELECT DISTINCT pr.id, pr.stock
          FROM product_barcodes pb
          JOIN products pr ON pr.id = pb.product_id
          WHERE p.barcode <> '' AND pb.barcode = p.barcode
        ) w
     ) wcs ON true
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
        COALESCE(SUM(GREATEST(s.stock, 0)), 0)::float            AS total_units,
        -- Valeur alignée : coût du site (/ pack) sur les lignes au lien APPROUVÉ,
        -- coût caisse sur les autres → un total directement comparable à total_value.
        COALESCE(SUM(s.stock * COALESCE(lnk.aligned_cost, p.cost, 0)), 0)::float AS total_value_aligned,
        COUNT(*) FILTER (WHERE lnk.aligned_cost IS NOT NULL)::int                AS aligned_products
     FROM nextore_stock s
     JOIN nextore_products p ON p.product_id = s.product_id
     LEFT JOIN LATERAL (
        SELECT (COALESCE(pr.computed_cost, pr.wc_cog_cost) / NULLIF(l.pack_qty, 0)) AS aligned_cost
        FROM nextore_product_links l
        JOIN products pr ON pr.id = l.wc_product_id
        WHERE l.nx_product_id = s.product_id AND l.status = 'approved'
     ) lnk ON true
     WHERE s.warehouse_id = $1`,
    [warehouseId]
  );
  return rows[0];
}

/**
 * Calcul des BESOINS (prévision d'achat) pour une boutique — logique V2 (comme
 * NeedsTabV2), SANS délai de réappro :
 *   - dailyRate      = ventes sur la période d'analyse / nb de jours
 *   - stockWillLast  = stock / dailyRate
 *   - SEUIL de déclenchement (alertDays) : on commande seulement si le stock ne
 *     tient plus jusqu'à ce seuil (casse la boucle « 1 vente/j = +1 chaque jour »)
 *   - COUVERTURE (coverageDays) : niveau cible auquel on remonte le stock
 *   - garde-fou : couverture >= seuil
 *   - tendance : réutilise calculateTrendCoefficient (partagé WooCommerce)
 * Filtre fournisseur optionnel (supplier_ids du produit).
 */
async function getNeeds(warehouseId, opts = {}) {
  const analysisDays = Math.min(Math.max(parseInt(opts.analysisDays, 10) || 31, 1), 365);
  const alertDays = Math.min(Math.max(parseInt(opts.alertDays, 10) || 15, 0), 365);
  let coverageDays = Math.min(Math.max(parseInt(opts.coverageDays, 10) || 45, 0), 365);
  coverageDays = Math.max(coverageDays, alertDays); // couverture >= seuil
  const supplierId = opts.supplierId ? String(opts.supplierId) : null;

  const prodParams = [warehouseId];
  let supplierFilter = '';
  if (supplierId) {
    prodParams.push(supplierId);
    supplierFilter = `AND p.supplier_ids @> ARRAY[$${prodParams.length}]`; // index GIN
  }

  // Map fournisseur id → nom (pour afficher le fournisseur filtré, option B)
  const { rows: supRows } = await pool.query('SELECT id, company FROM nextore_suppliers');
  const supMap = new Map(supRows.map((r) => [r.id, r.company]));

  const { rows: prods } = await pool.query(
    `SELECT p.product_id, p.name, p.code, p.barcode, c.name AS category_name, st.rack,
            st.stock::float AS stock, p.cost::float AS cost,
            p.supplier_id, p.supplier_refs
     FROM nextore_stock st
     JOIN nextore_products p ON p.product_id = st.product_id
     LEFT JOIN nextore_categories c ON c.id = p.category_id
     WHERE st.warehouse_id = $1
       AND (p.name IS NULL OR p.name NOT ILIKE 'produit non cr%')
       ${supplierFilter}`,
    prodParams
  );

  const { rows: sales } = await pool.query(
    `SELECT product_id, sold_at::date::text AS date, SUM(quantity)::float AS total_qty
     FROM nextore_sales
     WHERE warehouse_id = $1
       AND sold_at >= (NOW() AT TIME ZONE 'Europe/Paris') - make_interval(days => $2::int)
     GROUP BY product_id, sold_at::date`,
    [warehouseId, analysisDays]
  );
  const salesByProduct = new Map();
  for (const row of sales) {
    if (!salesByProduct.has(row.product_id)) salesByProduct.set(row.product_id, []);
    salesByProduct.get(row.product_id).push({ date: row.date, total_qty: row.total_qty });
  }

  const items = [];
  let unitsProjected = 0, valueProjected = 0, negativeCount = 0;

  for (const p of prods) {
    const daily = salesByProduct.get(p.product_id) || [];
    if (!daily.length) continue;

    const salesInPeriod = daily.reduce((a, d) => a + (d.total_qty || 0), 0);
    const dailyRate = salesInPeriod / analysisDays;
    if (dailyRate <= 0) continue;

    const stockWillLast = p.stock / dailyRate;
    // DÉCLENCHEUR : on ne commande que si le stock ne tient plus jusqu'au seuil
    if (stockWillLast >= alertDays) continue;

    // Tendance : agrégation hebdo puis coefficient partagé
    const weeklyMap = new Map();
    for (const d of daily) {
      const dt = new Date(d.date);
      const dow = (dt.getDay() + 6) % 7;
      const monday = new Date(dt);
      monday.setDate(dt.getDate() - dow);
      const key = monday.toISOString().slice(0, 10);
      weeklyMap.set(key, (weeklyMap.get(key) || 0) + (d.total_qty || 0));
    }
    const weekly = [...weeklyMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, q]) => ({ total_qty: q }));
    const coef = calculateTrendCoefficient(weekly).coefficient;
    const dir = coef > 1.1 ? 'up' : coef < 0.9 ? 'down' : 'stable';

    const targetDays = coverageDays; // pas de délai
    const theoProposal = Math.max(0, Math.ceil(dailyRate * targetDays) - p.stock);
    const suppProposal = Math.max(0, Math.ceil(dailyRate * coef * targetDays) - p.stock);
    if (theoProposal <= 0 && suppProposal <= 0) continue;

    const value = suppProposal * (p.cost || 0);
    if (suppProposal > 0) { unitsProjected += suppProposal; valueProjected += value; }
    if (p.stock < 0) negativeCount += 1;

    // Fournisseur affiché : le filtré si filtre actif, sinon le principal (B)
    const displaySupId = supplierId || p.supplier_id;
    const meta = (displaySupId && p.supplier_refs && p.supplier_refs[displaySupId]) || {};

    items.push({
      product_id: p.product_id,
      name: p.name,
      sku: p.code,
      barcode: p.barcode,
      category_name: p.category_name,
      rack: p.rack,
      stock: p.stock,
      supplier_name: displaySupId ? (supMap.get(displaySupId) || null) : null,
      supplier_ref: meta.ref || null,
      sales_period: salesInPeriod,
      sales_per_month: Math.round(dailyRate * 30 * 100) / 100,
      daily_rate: Math.round(dailyRate * 1000) / 1000,
      stock_will_last: Math.round(stockWillLast),
      trend_coefficient: Math.round(coef * 100) / 100,
      trend_direction: dir,
      to_order_theoretical: theoProposal,
      to_order: suppProposal,          // projeté (tendance) = principal
    });
  }

  items.sort((a, b) => (a.stock_will_last - b.stock_will_last) || (b.to_order - a.to_order));

  return {
    params: { analysisDays, alertDays, coverageDays },
    summary: {
      to_order_count: items.length,
      total_units: unitsProjected,
      total_value: Math.round(valueProjected * 100) / 100,
      negative_count: negativeCount,
    },
    items,
  };
}

/**
 * Données BRUTES pour l'écran Besoins style V2 (calcul côté client) :
 * par produit → stock, fournisseur(s), réf(s), + ventes journalières (90 j).
 * On ne garde que les produits en stock (<>0) OU ayant vendu récemment.
 */
async function getNeedsData(warehouseId) {
  const { rows: prods } = await pool.query(
    `SELECT p.product_id, p.name, p.code AS sku, st.stock::float AS stock,
            p.category_id, c.name AS category_name, p.cost::float AS cost,
            p.supplier_id, p.supplier_ids, p.supplier_refs, sup.company AS supplier_name
     FROM nextore_stock st
     JOIN nextore_products p ON p.product_id = st.product_id
     LEFT JOIN nextore_categories c ON c.id = p.category_id
     LEFT JOIN nextore_suppliers sup ON sup.id = p.supplier_id
     WHERE st.warehouse_id = $1
       AND (p.name IS NULL OR p.name NOT ILIKE 'produit non cr%')`,
    [warehouseId]
  );

  // Ventes journalières sur 90 j (fenêtre max des périodes d'analyse)
  const { rows: sales } = await pool.query(
    `SELECT product_id, sold_at::date::text AS date, SUM(quantity)::float AS total_qty
     FROM nextore_sales
     WHERE warehouse_id = $1
       AND sold_at >= (NOW() AT TIME ZONE 'Europe/Paris') - make_interval(days => 90)
     GROUP BY product_id, sold_at::date`,
    [warehouseId]
  );
  const salesByProduct = new Map();
  for (const s of sales) {
    if (!salesByProduct.has(s.product_id)) salesByProduct.set(s.product_id, []);
    salesByProduct.get(s.product_id).push({ date: s.date, total_qty: s.total_qty });
  }

  // On ne renvoie que les produits pertinents : en stock OU avec ventes récentes
  const products = [];
  for (const p of prods) {
    const daily = salesByProduct.get(p.product_id) || [];
    if (p.stock === 0 && daily.length === 0) continue;
    products.push({
      id: p.product_id,
      name: p.name,
      sku: p.sku,
      stock: p.stock,
      category_id: p.category_id,
      category_name: p.category_name,
      cost: p.cost,
      supplier_id: p.supplier_id,
      supplier_name: p.supplier_name,
      supplier_ids: p.supplier_ids || [],
      supplier_refs: p.supplier_refs || {},
      daily_sales: daily,
    });
  }
  return products;
}

/**
 * Rapprochement WC → boutiques par EAN : pour une liste d'id produits WC
 * (products.id), renvoie le stock par boutique (MTP=1, CAST=2).
 * Map { wc_id: { 1: stockMtp, 2: stockCast } }. Dédoublonne les matchs
 * multiples (un même produit Nextore atteint via 2 codes-barres WC).
 */
async function getBoutiqueStockByWcIds(wcIds) {
  if (!Array.isArray(wcIds) || wcIds.length === 0) return {};
  const ids = wcIds.map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n));
  if (!ids.length) return {};
  const { rows } = await pool.query(
    `SELECT wc_id, warehouse_id, SUM(stock)::float AS stock FROM (
        SELECT DISTINCT pb.product_id AS wc_id, np.product_id AS nx_id, ns.warehouse_id, ns.stock
        FROM product_barcodes pb
        JOIN nextore_products np ON np.barcode = pb.barcode AND np.barcode <> ''
        JOIN nextore_stock ns ON ns.product_id = np.product_id
        WHERE pb.product_id = ANY($1::int[])
     ) t
     GROUP BY wc_id, warehouse_id`,
    [ids]
  );
  const map = {};
  for (const r of rows) {
    if (!map[r.wc_id]) map[r.wc_id] = {};
    map[r.wc_id][r.warehouse_id] = r.stock;
  }
  return map;
}

/** Catégories ayant des produits en stock dans cette boutique (pour le filtre). */
async function getCategoriesForShop(warehouseId) {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, COUNT(DISTINCT p.product_id)::int AS product_count
     FROM nextore_categories c
     JOIN nextore_products p ON p.category_id = c.id
     JOIN nextore_stock st ON st.product_id = p.product_id AND st.warehouse_id = $1
     WHERE (p.name IS NULL OR p.name NOT ILIKE 'produit non cr%')
     GROUP BY c.id, c.name
     ORDER BY c.name NULLS LAST`,
    [warehouseId]
  );
  return rows;
}

/** Sous-catégories ayant des produits en stock dans cette boutique. */
async function getSubcategoriesForShop(warehouseId) {
  const { rows } = await pool.query(
    `SELECT sc.id, sc.name, sc.category_id, COUNT(DISTINCT p.product_id)::int AS product_count
     FROM nextore_subcategories sc
     JOIN nextore_products p ON p.subcategory_id = sc.id
     JOIN nextore_stock st ON st.product_id = p.product_id AND st.warehouse_id = $1
     WHERE (p.name IS NULL OR p.name NOT ILIKE 'produit non cr%')
     GROUP BY sc.id, sc.name, sc.category_id
     ORDER BY sc.name NULLS LAST`,
    [warehouseId],
  );
  return rows;
}

/** Fournisseurs ayant des produits en stock dans cette boutique (pour le filtre). */
async function getSuppliersForShop(warehouseId) {
  const { rows } = await pool.query(
    `SELECT sup.id, sup.company, COUNT(DISTINCT p.product_id)::int AS product_count
     FROM nextore_suppliers sup
     JOIN nextore_products p ON sup.id = ANY(p.supplier_ids)
     JOIN nextore_stock st ON st.product_id = p.product_id AND st.warehouse_id = $1
     WHERE (p.name IS NULL OR p.name NOT ILIKE 'produit non cr%')
     GROUP BY sup.id, sup.company
     ORDER BY sup.company NULLS LAST`,
    [warehouseId]
  );
  return rows;
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
  getNeeds,
  getNeedsData,
  getSuppliersForShop,
  getCategoriesForShop,
  getSubcategoriesForShop,
  getBoutiqueStockByWcIds,
  getProductStockHistory,
  getLastSyncAt,
};
