/**
 * Stats boutiques — classements produits / marques / catégories des ventes
 * caisse Nextore (nextore_sales), par boutique et par période.
 *
 * CA HT d'une ligne = quantity × unit_price ÷ (1 + tax_rate / 100) :
 * `unit_price` est le prix TTC NET de remise (un article offert vaut 0, la
 * remise est dans `item_discount`). Les retours (quantités négatives) sont
 * déduits : tout est net.
 *
 * Les classements listent TOUT le catalogue actif de la boutique, même sans
 * vente sur la période (qté 0) : c'est le but, voir ce qu'on ne vend jamais.
 * « Produits dormants » (getDormants) en est la vue dédiée.
 *
 * Deux niveaux de lecture (droit `stats-boutiques`) : le conseiller reçoit la
 * quantité et la part du CA, jamais un montant ; le responsable reçoit aussi
 * le CA HT. Les montants sont retirés ICI, pas à l'écran — sinon ils restent
 * lisibles dans les outils du navigateur.
 */

const ExcelJS = require('exceljs');
const pool = require('../config/database');
const { activeSql } = require('../utils/nextoreActive');

// « Sans catégorie » / « Sans sous-catégorie » : valeur de filtre réservée.
const NONE = '__none__';

const DIMENSIONS = {
  products:      { key: 's.product_id', label: 'COALESCE(MAX(p.name), MAX(s.product_name))' },
  brands:        { key: "COALESCE(NULLIF(TRIM(p.brand), ''), 'Sans marque')", label: null },
  // Clé = l'id Nextore (ou NONE) : un clic sur la ligne la reprend telle quelle comme filtre.
  categories:    { key: `COALESCE(c.id, '${NONE}')`, label: "COALESCE(MAX(c.name), 'Sans catégorie')" },
  subcategories: { key: `COALESCE(sc.id, '${NONE}')`, label: "COALESCE(MAX(sc.name), 'Sans sous-catégorie')" },
};

const CA_HT = 'SUM(s.quantity * s.unit_price / (1 + COALESCE(s.tax_rate, 20) / 100))::float';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const BRAND = "COALESCE(NULLIF(TRIM(p.brand), ''), 'Sans marque')";

/** Mots de la recherche : 8 au plus, 100 caractères en tout. */
const searchWords = (search) => String(search || '').trim().slice(0, 100).split(/\s+/).filter(Boolean).slice(0, 8);

/**
 * Conditions de la recherche (chaque mot doit trouver sa place) : nom, marque,
 * catégorie, sous-catégorie en « contient » ; code et EAN en valeur EXACTE.
 * `pid` / `names` : colonnes du produit dans la requête appelante.
 */
function searchWhere(words, params, pid, names) {
  return words.map((w) => {
    params.push(`%${w.replace(/[\\%_]/g, (m) => `\\${m}`)}%`, w);
    const like = params.length - 1;
    const exact = params.length;
    return `(concat_ws(' ', ${names}, p.brand, c.name, sc.name) ILIKE $${like}
          OR lower(p.code) = lower($${exact})
          OR EXISTS (SELECT 1 FROM nextore_product_barcodes b WHERE b.product_id = ${pid} AND b.barcode = $${exact}))`;
  });
}

/** Filtre catégorie / sous-catégorie (id Nextore ou NONE). */
function categoryWhere(params, col, value) {
  if (!value) return [];
  if (value === NONE) return [`${col} IS NULL`];
  params.push(value);
  return [`${col} = $${params.length}`];
}

/**
 * @param {number} warehouseId 1 = Montpellier, 2 = Castelnau
 * @param {string} from AAAA-MM-JJ (inclus)
 * @param {string} to   AAAA-MM-JJ (inclus) — sold_at est en heure de Paris
 * @param {boolean} withAmounts true pour un responsable
 * @param {{ category?: string, subcategory?: string, search?: string }} filters
 *   category / subcategory : id Nextore ou NONE ; search : mots libres, TOUS
 *   présents dans le nom, la marque, la catégorie ou la sous-catégorie — ou
 *   égaux au code ou à l'un des codes-barres du produit. Code et EAN en
 *   valeur EXACTE : en « contient », « 10 » de « pulp 10 ml » prenait tous
 *   les codes et EAN où figure « 10 ».
 *
 * Les parts — du CA (`pct`) et des unités (`qtyPct`) — se calculent sur la
 * SÉLECTION filtrée ; `selectionPct` / `selectionQtyPct` donnent le poids de
 * cette sélection dans toute la boutique.
 */
async function getRankings(warehouseId, from, to, withAmounts, filters = {}) {
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) {
    const err = new Error('Période invalide (from/to attendus en AAAA-MM-JJ)');
    err.statusCode = 400;
    throw err;
  }
  const category = filters.category || null;
  // Une sous-catégorie n'a de sens que sous sa catégorie.
  const subcategory = category ? (filters.subcategory || null) : null;
  const search = String(filters.search || '').trim().slice(0, 100);
  const words = searchWords(search);

  // `catalogue` : les produits actifs de la boutique SANS aucune vente sur la
  // période, au lieu des lignes de vente. Mêmes paramètres dans les deux cas
  // ($1 boutique, $2-$3 période), donc mêmes numéros : les deux s'unissent.
  const base = (useCategory, useSubcategory, useSearch = false, catalogue = false) => {
    const params = [warehouseId, from, to];
    const where = catalogue
      ? ['st.warehouse_id = $1', activeSql('p', 'st'),
        `NOT EXISTS (SELECT 1 FROM nextore_sales s WHERE s.product_id = st.product_id AND s.warehouse_id = $1
           AND s.sold_at >= $2::date AND s.sold_at < $3::date + 1)`]
      : ['s.warehouse_id = $1', 's.sold_at >= $2::date', 's.sold_at < $3::date + 1'];
    if (useCategory) where.push(...categoryWhere(params, 'c.id', category));
    if (useSubcategory) where.push(...categoryWhere(params, 'sc.id', subcategory));
    if (useSearch) {
      where.push(...(catalogue
        ? searchWhere(words, params, 'p.product_id', 'p.name')
        : searchWhere(words, params, 's.product_id', 'p.name, s.product_name')));
    }
    return {
      params,
      sql: `${catalogue
        ? `FROM nextore_stock st
       JOIN nextore_products p ON p.product_id = st.product_id`
        : `FROM nextore_sales s
       LEFT JOIN nextore_products p ON p.product_id = s.product_id`}
       LEFT JOIN nextore_categories c ON c.id = p.category_id
       LEFT JOIN nextore_subcategories sc ON sc.id = p.subcategory_id
       WHERE ${where.join(' AND ')}`,
    };
  };

  const rank = async ({ key, label }) => {
    const { sql, params } = base(true, true, true);
    const { rows } = await pool.query(
      `SELECT ${key} AS id, ${label || key} AS name,
              SUM(s.quantity)::float AS qty, ${CA_HT} AS ca_ht
       ${sql}
       GROUP BY ${key}`,
      params
    );
    return rows;
  };

  // Produits actifs de la boutique sans vente sur la période : ils entrent
  // dans les classements à zéro.
  const unsold = async () => {
    const { sql, params } = base(true, true, true, true);
    const { rows } = await pool.query(
      `SELECT p.product_id AS id, p.name, ${BRAND} AS brand,
              COALESCE(c.id, '${NONE}') AS cat_id, COALESCE(c.name, 'Sans catégorie') AS cat_name,
              COALESCE(sc.id, '${NONE}') AS sub_id, COALESCE(sc.name, 'Sans sous-catégorie') AS sub_name
       ${sql}`,
      params
    );
    return rows;
  };

  // Options des listes : catégories vendues sur la période ou au catalogue de
  // la boutique (sans filtre), sous-catégories de la catégorie choisie.
  const options = async (idExpr, nameExpr, useCategory) => {
    const sold = base(useCategory, false);
    const listed = base(useCategory, false, false, true);
    const { rows } = await pool.query(
      `SELECT id, name FROM (
         SELECT ${idExpr} AS id, ${nameExpr} AS name ${sold.sql}
         UNION
         SELECT ${idExpr}, ${nameExpr} ${listed.sql}
       ) o
       GROUP BY 1, 2
       ORDER BY (id = '${NONE}'), 2`,
      sold.params
    );
    return rows;
  };

  const shopTotal = async () => {
    const { sql, params } = base(false, false);
    const { rows } = await pool.query(`SELECT ${CA_HT} AS ca_ht, SUM(s.quantity)::float AS qty ${sql}`, params);
    return { ca_ht: rows[0].ca_ht || 0, qty: rows[0].qty || 0 };
  };

  const [products, brands, categories, unsoldRows, categoryOptions, subcategoryOptions, boutique, sync] = await Promise.all([
    rank(DIMENSIONS.products),
    rank(DIMENSIONS.brands),
    // Une catégorie choisie : l'onglet détaille ses sous-catégories.
    rank(category ? DIMENSIONS.subcategories : DIMENSIONS.categories),
    unsold(),
    options(`COALESCE(c.id, '${NONE}')`, "COALESCE(c.name, 'Sans catégorie')", false),
    category
      ? options(`COALESCE(sc.id, '${NONE}')`, "COALESCE(sc.name, 'Sans sous-catégorie')", true)
      : Promise.resolve([]),
    shopTotal(),
    // timestamptz → date ISO dans le JSON (le texte brut de app_config ne se lit pas partout)
    pool.query("SELECT config_value::timestamptz AS at FROM app_config WHERE config_key = 'nextore_last_sales_sync_at'"),
  ]);

  const total = products.reduce((sum, r) => sum + r.ca_ht, 0);
  const totalQty = products.reduce((sum, r) => sum + r.qty, 0);
  const soldRefs = products.length;

  // Le catalogue sans vente rejoint chaque classement à zéro (une marque ou une
  // catégorie n'y entre que si elle n'a rien vendu du tout).
  const addUnsold = (rows, idOf, nameOf) => {
    const seen = new Set(rows.map((r) => String(r.id)));
    for (const u of unsoldRows) {
      const id = String(idOf(u));
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({ id, name: nameOf(u), qty: 0, ca_ht: 0 });
    }
  };
  addUnsold(products, (u) => u.id, (u) => u.name);
  addUnsold(brands, (u) => u.brand, (u) => u.brand);
  if (category) addUnsold(categories, (u) => u.sub_id, (u) => u.sub_name);
  else addUnsold(categories, (u) => u.cat_id, (u) => u.cat_name);

  const part = (value, of, decimals) => (of ? Math.round((value / of) * 10 ** (decimals + 2)) / 10 ** decimals : 0);
  const shape = (rows) => [...rows]
    .sort((a, b) => b.ca_ht - a.ca_ht || b.qty - a.qty || String(a.name).localeCompare(String(b.name), 'fr'))
    .map((r) => ({
      id: String(r.id),
      name: r.name,
      qty: r.qty,
      pct: part(r.ca_ht, total, 2),
      qtyPct: part(r.qty, totalQty, 2),
      ...(withAmounts ? { ca_ht: Math.round(r.ca_ht * 100) / 100 } : {}),
    }));

  return {
    from,
    to,
    lastSalesSyncAt: sync.rows[0]?.at || null,
    filters: { category, subcategory, search },
    options: { categories: categoryOptions, subcategories: subcategoryOptions },
    totals: {
      qty: totalQty,
      soldRefs,
      unsoldRefs: products.length - soldRefs,
      selectionPct: part(total, boutique.ca_ht, 1),
      selectionQtyPct: part(totalQty, boutique.qty, 1),
      ...(withAmounts ? { ca_ht: Math.round(total * 100) / 100 } : {}),
    },
    products: shape(products),
    brands: shape(brands),
    categories: shape(categories),
    categoriesAreSubcategories: Boolean(category),
  };
}

/**
 * Produits dormants : le catalogue actif de la boutique qui n'a fait AUCUNE
 * vente (quantité positive : un retour n'est pas une vente) depuis `since`
 * inclus. Avec, pour chacun, le stock et la date de sa dernière vente dans
 * cette boutique, en AAAA-MM-JJ (null = jamais depuis le début de l'historique
 * Nextore, `historyStart`).
 *
 * Un produit sans stock au DÉBUT de la période n'est pas dormant : il n'a
 * simplement pas pu se vendre (ex. 15142, reçu la veille). Il est écarté et
 * compté dans `totals.excludedNoStock`. Le stock au début de la période se lit :
 *  - dans `nextore_stock_history` quand elle couvre la date (relevé complet le
 *    18/08/2026, puis une ligne à chaque changement) → `stockCheck: 'history'` ;
 *  - avant, il se RECONSTITUE à partir du relevé complet : stock relevé − achats
 *    reçus + ventes nettes entre le début de la période et le relevé
 *    → `stockCheck: 'rebuilt'`. Approché : les corrections d'inventaire de
 *    cet intervalle n'y sont pas.
 *
 * Responsable : + coût HT et valeur du stock immobilisé (stock × coût, stock
 * négatif compté 0). Le conseiller ne reçoit aucun montant.
 *
 * @param {{ category?: string, subcategory?: string, search?: string, inStock?: boolean }} filters
 */
async function getDormants(warehouseId, since, withAmounts, filters = {}) {
  if (!DATE_RE.test(since || '')) {
    const err = new Error('Date invalide (since attendu en AAAA-MM-JJ)');
    err.statusCode = 400;
    throw err;
  }
  const category = filters.category || null;
  const subcategory = category ? (filters.subcategory || null) : null;
  const search = String(filters.search || '').trim().slice(0, 100);

  // Début de la période : minuit, heure de Paris.
  const START = "($2::date)::timestamp AT TIME ZONE 'Europe/Paris'";
  // Achats et ventes sont datés en heure de Paris, sans fuseau.
  const SNAPSHOT_LOCAL = "hist.started_at AT TIME ZONE 'Europe/Paris'";
  const HAD_STOCK = `(CASE WHEN ${START} > hist.started_at THEN COALESCE(hs.stock, 0) > 0
    ELSE COALESCE(s0.stock, 0)
      - COALESCE((SELECT SUM(pi.quantity_received) FROM nextore_purchase_items pi
          WHERE pi.warehouse_id = $1 AND pi.product_id = st.product_id
            AND pi.purchased_at >= $2::date AND pi.purchased_at < ${SNAPSHOT_LOCAL}), 0)
      + COALESCE((SELECT SUM(sa.quantity) FROM nextore_sales sa
          WHERE sa.warehouse_id = $1 AND sa.product_id = st.product_id
            AND sa.sold_at >= $2::date AND sa.sold_at < ${SNAPSHOT_LOCAL}), 0) > 0
    END)`;

  const params = [warehouseId, since];
  const where = ['st.warehouse_id = $1', activeSql('p', 'st'), '(ls.last_sold_at IS NULL OR ls.last_sold_at < $2::date)'];
  // Les listes ne proposent que ce qui reste affichable ; la requête principale
  // garde les écartés pour les compter.
  const optionsWhere = [...where, HAD_STOCK];
  where.push(...categoryWhere(params, 'c.id', category));
  const optionsParams = [...params]; // sous-catégories : celles de la catégorie choisie
  const subOptionsWhere = [...where, HAD_STOCK];
  where.push(...categoryWhere(params, 'sc.id', subcategory));
  where.push(...searchWhere(searchWords(search), params, 'p.product_id', 'p.name'));
  if (filters.inStock) where.push('st.stock > 0');

  const from = `FROM nextore_stock st
     JOIN nextore_products p ON p.product_id = st.product_id
     LEFT JOIN nextore_categories c ON c.id = p.category_id
     LEFT JOIN nextore_subcategories sc ON sc.id = p.subcategory_id
     LEFT JOIN (
       SELECT product_id, MAX(sold_at) AS last_sold_at
       FROM nextore_sales
       WHERE warehouse_id = $1 AND quantity > 0
       GROUP BY product_id
     ) ls ON ls.product_id = st.product_id
     CROSS JOIN (
       SELECT MIN(captured_at) AS started_at FROM nextore_stock_history WHERE warehouse_id = $1
     ) hist
     LEFT JOIN LATERAL (
       SELECT h.stock FROM nextore_stock_history h
       WHERE h.warehouse_id = $1 AND h.product_id = st.product_id AND h.captured_at < ${START}
       ORDER BY h.captured_at DESC LIMIT 1
     ) hs ON true
     -- Relevé complet de départ : toutes ses lignes portent l'instant du premier relevé.
     LEFT JOIN nextore_stock_history s0
       ON s0.warehouse_id = $1 AND s0.product_id = st.product_id AND s0.captured_at = hist.started_at`;

  const options = (whereList, optParams, idExpr, nameExpr) => pool.query(
    `SELECT ${idExpr} AS id, ${nameExpr} AS name ${from}
     WHERE ${whereList.join(' AND ')}
     GROUP BY 1, 2 ORDER BY (${idExpr} = '${NONE}'), 2`,
    optParams
  );

  const [{ rows: all }, categoryOptions, subcategoryOptions, history, stockHistory] = await Promise.all([
    pool.query(
      `SELECT p.product_id AS id, p.name, p.code, ${BRAND} AS brand,
              COALESCE(c.name, 'Sans catégorie') AS category, sc.name AS subcategory,
              COALESCE(st.stock, 0)::float AS stock,
              to_char(ls.last_sold_at, 'YYYY-MM-DD') AS last_sold_at, -- heure de Paris, jamais convertie
              p.cost::float AS cost,
              ${HAD_STOCK} AS had_stock
       ${from}
       WHERE ${where.join(' AND ')}`,
      params
    ),
    options(optionsWhere, [warehouseId, since], `COALESCE(c.id, '${NONE}')`, "COALESCE(c.name, 'Sans catégorie')"),
    category
      ? options(subOptionsWhere, optionsParams, `COALESCE(sc.id, '${NONE}')`, "COALESCE(sc.name, 'Sans sous-catégorie')")
      : Promise.resolve({ rows: [] }),
    pool.query("SELECT to_char(MIN(sold_at), 'YYYY-MM-DD') AS at FROM nextore_sales WHERE warehouse_id = $1", [warehouseId]),
    pool.query(
      "SELECT to_char(MIN(captured_at) AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS at FROM nextore_stock_history WHERE warehouse_id = $1",
      [warehouseId]
    ),
  ]);
  const rows = all.filter((r) => r.had_stock);
  const stockHistoryStart = stockHistory.rows[0]?.at || null;

  const value = (r) => Math.max(0, r.stock) * (r.cost || 0);
  const products = rows.map((r) => ({
    id: String(r.id),
    name: r.name,
    code: r.code,
    brand: r.brand,
    category: r.category,
    subcategory: r.subcategory,
    stock: r.stock,
    lastSoldAt: r.last_sold_at,
    ...(withAmounts ? { cost: r.cost, stockValue: Math.round(value(r) * 100) / 100 } : {}),
  }));

  return {
    since,
    historyStart: history.rows[0]?.at || null,
    stockHistoryStart,
    // Le relevé du premier jour est pris en cours de journée : il couvre le lendemain.
    stockCheck: stockHistoryStart && since > stockHistoryStart ? 'history' : 'rebuilt',
    filters: { category, subcategory, search, inStock: Boolean(filters.inStock) },
    options: { categories: categoryOptions.rows, subcategories: subcategoryOptions.rows },
    totals: {
      products: products.length,
      excludedNoStock: all.length - rows.length,
      inStock: products.filter((r) => r.stock > 0).length,
      units: products.reduce((sum, r) => sum + Math.max(0, r.stock), 0),
      ...(withAmounts ? { stockValue: Math.round(rows.reduce((sum, r) => sum + value(r), 0) * 100) / 100 } : {}),
    },
    products,
  };
}

/**
 * Tri des dormants, le même qu'à l'écran (DormantsTab) : « Jamais vendu » passe
 * avant toute date, les ex aequo par ordre alphabétique.
 */
const DORMANT_SORTS = {
  name: (r) => String(r.name || ''),
  brand: (r) => String(r.brand || ''),
  stock: (r) => r.stock,
  lastSoldAt: (r) => r.lastSoldAt || '',
  stockValue: (r) => r.stockValue || 0,
};

function sortDormants(products, sort, dir) {
  const key = DORMANT_SORTS[sort] || DORMANT_SORTS.stock;
  const d = dir === 'asc' ? 1 : -1;
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'fr', { numeric: true });
  return [...products].sort((a, b) => {
    const va = key(a);
    const vb = key(b);
    const c = typeof va === 'string' ? va.localeCompare(vb, 'fr', { numeric: true }) : va - vb;
    return d * c || byName(a, b);
  });
}

/**
 * Export Excel des produits dormants : exactement le tableau de l'écran
 * (mêmes filtres, même tri, mêmes colonnes selon le niveau). Un .xlsx s'ouvre
 * dans Excel et s'importe tel quel dans Google Sheets. Une 2e feuille rappelle
 * les critères, pour qu'un fichier ressorti plus tard se relise seul.
 *
 * @param {{ id: number, name: string, slug: string }} shop
 * @param {{ sort?: string, dir?: string }} order
 */
async function exportDormants(shop, since, withAmounts, filters = {}, order = {}) {
  const data = await getDormants(shop.id, since, withAmounts, filters);
  const rows = sortDormants(data.products, order.sort, order.dir);
  const dateCell = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Produits dormants', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Produit', key: 'name', width: 55 },
    { header: 'Code', key: 'code', width: 12 },
    { header: 'Marque', key: 'brand', width: 22 },
    { header: 'Catégorie', key: 'category', width: 22 },
    { header: 'Sous-catégorie', key: 'subcategory', width: 18 },
    { header: 'Stock', key: 'stock', width: 9 },
    { header: 'Dernière vente', key: 'lastSoldAt', width: 15 },
    ...(withAmounts ? [
      { header: 'Coût HT', key: 'cost', width: 11 },
      { header: 'Valeur stock HT', key: 'stockValue', width: 16 },
    ] : []),
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow({
      ...r,
      subcategory: r.subcategory || '',
      lastSoldAt: r.lastSoldAt ? dateCell(r.lastSoldAt) : 'Jamais vendu',
    });
  }
  ws.getColumn('lastSoldAt').numFmt = 'dd/mm/yyyy';
  if (withAmounts) {
    ws.getColumn('cost').numFmt = '#,##0.00 €';
    ws.getColumn('stockValue').numFmt = '#,##0.00 €';
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

  const fr = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
  const optionName = (list, id) => (id ? (list.find((o) => o.id === id)?.name || id) : 'Toutes');
  const info = wb.addWorksheet('Critères');
  info.columns = [{ key: 'k', width: 26 }, { key: 'v', width: 50 }];
  [
    ['Boutique', shop.name],
    ['Aucune vente depuis le', fr(since)],
    ['Catégorie', optionName(data.options.categories, data.filters.category)],
    ['Sous-catégorie', data.filters.category ? optionName(data.options.subcategories, data.filters.subcategory) : 'Toutes'],
    ['Recherche', data.filters.search || '—'],
    ['En stock seulement', data.filters.inStock ? 'Oui' : 'Non'],
    ['Écartés (pas de stock au début)', data.totals.excludedNoStock],
    ['Produits', data.totals.products],
    ['Dont en stock', data.totals.inStock],
    ['Unités en stock', data.totals.units],
    ...(withAmounts ? [['Stock immobilisé HT', data.totals.stockValue]] : []),
    ['Historique des ventes depuis le', fr(data.historyStart)],
    ['Exporté le', new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }).format(new Date())],
  ].forEach(([k, v]) => info.addRow({ k, v }));
  info.getColumn('k').font = { bold: true };
  if (withAmounts) info.getCell(`B${info.rowCount - 2}`).numFmt = '#,##0.00 €';

  return {
    buffer: await wb.xlsx.writeBuffer(),
    filename: `produits_dormants_${shop.slug}_depuis_${since}.xlsx`,
  };
}

module.exports = { getRankings, getDormants, exportDormants, NONE };
