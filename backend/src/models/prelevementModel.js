/**
 * Prélèvements du stock du site par la boutique (EMC → EMC2) — 10/11/2026.
 *
 * Un prélèvement s'enregistre TOUJOURS, tout de suite : le vendeur n'est jamais
 * bloqué. La sortie du stock du site et l'entrée dans Nextore partent ensuite
 * par la file (prelevementPushService). La ligne elle-même est la refacturation
 * EMC → EMC2, au coût d'achat du site figé au moment du prélèvement.
 *
 * Produit caisse d'un produit du site : lien enregistré (rattaché à la main ou
 * créé par l'app), sinon UN produit Nextore portant un de ses codes-barres.
 * Sans produit caisse, l'entrée Nextore attend (`waiting`) qu'on le rattache ou
 * qu'on le crée ; la sortie du site et la refacturation, elles, n'attendent pas.
 */

const pool = require('../config/database');
const nextoreApi = require('../services/nextoreApiClient');
const pdaProductModel = require('./pdaProductModel');
const rules = require('../services/prelevementRules');
const { costsAtDates } = require('../services/costAtDate');
const siteStock = require('../services/siteStock');

const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status });
const kick = () => require('../services/prelevementPushService').kick();

// ── Produit du site + son produit caisse ────────────────────────────────────

const SITE_SQL = `
  SELECT p.id, p.sku, p.post_title AS name, p.wp_product_id, p.regular_price, p.price,
         p.computed_cost, p.wc_cog_cost, p.product_type, p.post_status,
         COALESCE(p.image_url, pp.image_url) AS image_url,
         COALESCE(NULLIF(p.brand, ''), pp.brand) AS brand,
         array_remove(ARRAY(SELECT b.barcode FROM product_barcodes b WHERE b.product_id = p.id AND b.type = 'unit' ORDER BY b.id), NULL) AS barcodes
    FROM products p
    LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id
   WHERE p.id = $1`;

const loadSite = async (productId, db = pool) => {
  const { rows: [p] } = await db.query(SITE_SQL, [productId]);
  if (!p) throw httpError(404, 'Produit du site introuvable.');
  return p;
};

const loadNx = async (nxId, warehouseId, db = pool) => {
  if (!nxId) return null;
  const { rows: [r] } = await db.query(
    `SELECT np.product_id AS id, np.name, np.code, np.barcode, np.price::float AS price, np.cost::float AS cost,
            np.status, c.name AS category_name, st.stock::float AS stock
       FROM nextore_products np
       LEFT JOIN nextore_categories c ON c.id = np.category_id
       LEFT JOIN nextore_stock st ON st.product_id = np.product_id AND st.warehouse_id = $2
      WHERE np.product_id = $1`,
    [nxId, warehouseId]
  );
  return r || null;
};

/** Produit caisse d'un produit du site : { nxProductId, how, candidates? }. */
const resolveNxFor = async (productId, db = pool) => {
  const [{ rows: [link] }, { rows: ean }] = await Promise.all([
    db.query('SELECT nx_product_id, source FROM boutique_site_links WHERE product_id = $1', [productId]),
    db.query(
      `SELECT DISTINCT nb.product_id
         FROM product_barcodes b
         JOIN nextore_product_barcodes nb ON nb.barcode = b.barcode
         JOIN nextore_products np ON np.product_id = nb.product_id AND COALESCE(np.status, '') <> 'deleted'
        WHERE b.product_id = $1`,
      [productId]
    ),
  ]);
  return rules.resolveNx(link, ean.map((r) => r.product_id));
};

/**
 * Stock du site disponible pour un prélèvement : disponible en direct (hors
 * réservé par les commandes internet en cours) moins les prélèvements déjà
 * validés mais pas encore sortis. `null` + error si le stock est illisible :
 * dans ce cas on ne bloque pas (la panne est chez nous, pas chez le vendeur).
 */
const siteAvailability = async (productId, sku) => {
  if (!sku) return { error: 'Produit sans SKU.' };
  try {
    const [s, { rows: [q] }] = await Promise.all([
      siteStock.readSiteStock(sku),
      pool.query(
        `SELECT COALESCE(sum(qty), 0)::int AS pending FROM boutique_prelevements
          WHERE product_id = $1 AND site_status IN ('queued', 'sending')`,
        [productId]
      ),
    ]);
    return { ...s, pending: q.pending, free: Math.max(0, s.available - q.pending) };
  } catch (error) {
    return { error: error.message };
  }
};

/** Fiche affichée au scan : produit du site, stock du site, coût, et produit caisse. */
const productView = async (productId, warehouseId, userId = null) => {
  const p = await loadSite(productId);
  const res = await resolveNxFor(productId);
  const nx = await loadNx(res.nxProductId, warehouseId);
  const candidates = res.how === 'ambiguous'
    ? (await Promise.all(res.candidates.map((id) => loadNx(id, warehouseId)))).filter(Boolean)
    : [];
  // Garde-fou doublon : la même pièce prélevée par la logistique PUIS par le
  // vendeur sortirait deux fois du site. Fenêtre courte (2 h) et seulement les
  // prélèvements d'une AUTRE personne, sinon l'alerte sonne à chaque booster et
  // plus personne ne la lit (décision Maxime, 10/11/2026). On montre, on ne bloque pas.
  const { rows: recent } = await pool.query(
    `SELECT b.qty, b.origin, b.created_at, u.name AS user_name
       FROM boutique_prelevements b LEFT JOIN users u ON u.id = b.created_by
      WHERE b.product_id = $1 AND b.warehouse_id = $2 AND b.created_at > NOW() - INTERVAL '2 hours'
        AND b.created_by IS DISTINCT FROM $3
      ORDER BY b.created_at DESC LIMIT 5`,
    [p.id, warehouseId, userId ?? null]
  );
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    imageUrl: p.image_url,
    barcodes: p.barcodes,
    sitePrice: Number(p.regular_price) > 0 ? Number(p.regular_price) : (Number(p.price) || null),
    unitCost: rules.siteUnitCost(p),
    nx: nx ? { ...nx, how: res.how, perSiteUnit: rules.boutiqueQty(1, p.name, nx) } : null,
    nxHow: res.how,
    candidates,
    recent,
    siteStock: await siteAvailability(p.id, p.sku),
  };
};

/** Scan ou recherche : un seul produit → sa fiche ; sinon la liste. */
const lookup = async (warehouseId, code, userId = null) => {
  const found = await pdaProductModel.search(code);
  if (found.results.length === 1) {
    const r = found.results[0];
    const packQty = r.matched?.type === 'pack' ? Number(r.matched.quantity) || 1 : 1;
    return { product: await productView(r.id, warehouseId, userId), qty: packQty, by: found.by };
  }
  return { results: found.results, by: found.by };
};

/** Recherche dans la caisse, pour rattacher un produit du site à la main. */
const searchNextore = async (warehouseId, q) => {
  const words = String(q || '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return [];
  const cond = words.map((_, i) => `concat_ws(' ', np.name, np.code, np.brand, np.barcode) ILIKE $${i + 2}`);
  const { rows } = await pool.query(
    `SELECT np.product_id AS id, np.name, np.code, np.barcode, np.price::float AS price, c.name AS category_name,
            st.stock::float AS stock
       FROM nextore_products np
       LEFT JOIN nextore_categories c ON c.id = np.category_id
       LEFT JOIN nextore_stock st ON st.product_id = np.product_id AND st.warehouse_id = $1
      WHERE COALESCE(np.status, '') <> 'deleted' AND ${cond.join(' AND ')}
      ORDER BY np.name LIMIT 30`,
    [warehouseId, ...words.map((w) => `%${w}%`)]
  );
  return rows;
};

// ── Enregistrer ─────────────────────────────────────────────────────────────

/**
 * Enregistre un prélèvement (écran boutique ou PDA › Prélèvement boutique).
 * `siteDone` = sortie du site déjà faite : { ref } (n'a servi qu'à l'ancien PDA
 * « Vente boutique », retiré le 10/11/2026 ; `origin = 'pda'` = son historique).
 */
const record = async ({ warehouseId, productId, qty, userId, origin, note, siteDone, pdaLogId }) => {
  const n = Number(qty);
  if (!Number.isInteger(n) || n < 1 || n > 500) throw httpError(400, 'Quantité invalide.');
  const p = await loadSite(productId);
  if (!p.sku) throw httpError(400, 'Produit sans SKU : inconnu du stock du site.');
  if (p.product_type === 'variable' || p.product_type === 'woosb') {
    throw httpError(400, 'Choisissez la déclinaison ou le produit du pack : ce produit n\'a pas de stock à lui.');
  }
  // Une pièce réservée par une commande internet en cours n'est pas à prendre
  // (décision Maxime, 10/11/2026). Stock illisible : on laisse passer.
  if (!siteDone) {
    const s = await siteAvailability(p.id, p.sku);
    if (!s.error && s.free < n) {
      throw httpError(409, s.free > 0
        ? `Non disponible : seulement ${s.free} pièce(s) libre(s) au site, le reste est réservé pour des commandes internet en cours.`
        : 'Non disponible : plus aucune pièce libre au site (stock à 0 ou réservé pour des commandes internet en cours).');
    }
  }
  const res = await resolveNxFor(productId);
  const nx = await loadNx(res.nxProductId, warehouseId);
  // Coût d'achat DU JOUR (PMP FIFO, même calcul que la reprise de l'historique).
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const unitCost = (await costsAtDates([{ productId: p.id, date: day }])).get(`${p.id}|${day}`) ?? rules.siteUnitCost(p);
  const { rows: [row] } = await pool.query(
    `INSERT INTO boutique_prelevements
       (warehouse_id, product_id, sku, name, qty, unit_cost_ht, origin, note, created_by,
        site_status, site_ref, site_at, nx_product_id, nx_qty, nx_status, pda_log_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      warehouseId, p.id, p.sku, p.name, n, unitCost, origin, note || null, userId || null,
      siteDone ? 'sent' : 'queued', siteDone?.ref ?? null, siteDone ? new Date() : null,
      nx ? nx.id : null, nx ? rules.boutiqueQty(n, p.name, nx) : null, nx ? 'queued' : 'waiting',
      pdaLogId ?? null,
    ]
  );
  kick();
  return row;
};

/** Les prélèvements en attente d'un produit caisse partent dès qu'il en a un. */
const releaseWaiting = async (productId, warehouseIdForQty = 2) => {
  const res = await resolveNxFor(productId);
  if (!res.nxProductId) return 0;
  const p = await loadSite(productId);
  const nx = await loadNx(res.nxProductId, warehouseIdForQty);
  const per = rules.boutiqueQty(1, p.name, nx);
  const { rowCount } = await pool.query(
    `UPDATE boutique_prelevements SET nx_product_id = $2, nx_qty = qty * $3, nx_status = 'queued', nx_error = NULL
      WHERE product_id = $1 AND nx_status = 'waiting'`,
    [productId, res.nxProductId, per]
  );
  if (rowCount) kick();
  return rowCount;
};

// ── Rattacher / créer dans la caisse ────────────────────────────────────────

/**
 * Ajoute à la fiche Nextore les codes-barres du site qu'elle n'a pas : sans
 * eux, la caisse ne reconnaît pas le produit au scan (→ article libre).
 * Échec = signalé, le rattachement reste fait.
 */
const addSiteBarcodesToNx = async (nxId, siteBarcodes) => {
  const nx = await loadNx(nxId, 0);
  const add = rules.barcodesToAdd(nx?.barcode, siteBarcodes);
  if (!add.length) return { added: [] };
  const merged = [...rules.splitBarcodes(nx?.barcode), ...add].join(';');
  try {
    await nextoreApi.updateProduct(nxId, { barcode: merged });
  } catch (error) {
    return { added: [], warning: `Codes-barres non ajoutés dans la caisse : ${error.message}` };
  }
  await pool.query('UPDATE nextore_products SET barcode = $2 WHERE product_id = $1', [nxId, merged]);
  for (const b of add) {
    await pool.query(
      'INSERT INTO nextore_product_barcodes (product_id, barcode) VALUES ($1, $2) ON CONFLICT DO NOTHING', [nxId, b]
    );
  }
  return { added: add };
};

const link = async (warehouseId, productId, nxProductId, userId) => {
  const p = await loadSite(productId);
  const nx = await loadNx(String(nxProductId), warehouseId);
  if (!nx || nx.status === 'deleted') throw httpError(404, 'Produit caisse introuvable.');
  await pool.query(
    `INSERT INTO boutique_site_links (product_id, nx_product_id, source, created_by)
     VALUES ($1, $2, 'manual', $3)
     ON CONFLICT (product_id) DO UPDATE SET nx_product_id = EXCLUDED.nx_product_id, source = 'manual',
       created_by = EXCLUDED.created_by, created_at = NOW()`,
    [p.id, nx.id, userId || null]
  );
  const barcodes = await addSiteBarcodesToNx(nx.id, p.barcodes);
  const released = await releaseWaiting(p.id, warehouseId);
  return { product: await productView(p.id, warehouseId), barcodes, released };
};

const creating = new Set();

/** Id de la fiche créée : dans la réponse si elle le donne, sinon relu au catalogue. */
const findCreatedId = async (response, barcodes) => {
  const direct = response && typeof response === 'object'
    ? (response.id ?? response.product_id ?? response.data?.id)
    : (/^\d+$/.test(String(response)) ? response : null);
  if (direct) return String(direct);
  await require('./nextoreModel').syncCatalog();
  const { rows } = await pool.query(
    `SELECT product_id FROM nextore_product_barcodes WHERE barcode = ANY($1::text[])
      ORDER BY product_id::bigint DESC LIMIT 1`,
    [barcodes]
  );
  return rows[0]?.product_id || null;
};

const createInNextore = async (warehouseId, productId, categoryId, userId) => {
  if (creating.has(productId)) throw httpError(409, 'Création déjà en cours pour ce produit.');
  creating.add(productId);
  try {
    const p = await loadSite(productId);
    const res = await resolveNxFor(productId);
    if (res.nxProductId) throw httpError(409, 'Ce produit a déjà un produit caisse.');
    // Sans code-barres, le SKU en tient lieu : la fiche se retrouve en caisse par sa saisie.
    const barcodes = p.barcodes.length ? p.barcodes : [p.sku].filter(Boolean);
    if (!barcodes.length) throw httpError(400, 'Produit sans code-barres ni SKU.');
    const payload = rules.nextoreProductPayload(p, { categoryId, barcodes });
    const response = await nextoreApi.createProduct(payload);
    const nxId = await findCreatedId(response, barcodes);
    if (!nxId) {
      throw httpError(502, 'Nextore a répondu mais la fiche est introuvable : VÉRIFIEZ dans la caisse avant de recréer.');
    }
    if (!(await loadNx(nxId, warehouseId))) await require('./nextoreModel').syncCatalog();
    await pool.query(
      `INSERT INTO boutique_site_links (product_id, nx_product_id, source, created_by)
       VALUES ($1, $2, 'created', $3)
       ON CONFLICT (product_id) DO UPDATE SET nx_product_id = EXCLUDED.nx_product_id, source = 'created',
         created_by = EXCLUDED.created_by, created_at = NOW()`,
      [p.id, nxId, userId || null]
    );
    const released = await releaseWaiting(p.id, warehouseId);
    return { product: await productView(p.id, warehouseId), released, nxProductId: nxId };
  } finally {
    creating.delete(productId);
  }
};

// ── Liste, reprise, export ──────────────────────────────────────────────────

const LIST_SQL = `
  SELECT b.*, u.name AS user_name, np.name AS nx_name
    FROM boutique_prelevements b
    LEFT JOIN users u ON u.id = b.created_by
    LEFT JOIN nextore_products np ON np.product_id = b.nx_product_id`;

const list = async (warehouseId, { from, to, problems } = {}) => {
  const where = ['b.warehouse_id = $1'];
  const args = [warehouseId];
  if (from) { args.push(from); where.push(`(b.created_at AT TIME ZONE 'Europe/Paris')::date >= $${args.length}::date`); }
  if (to) { args.push(to); where.push(`(b.created_at AT TIME ZONE 'Europe/Paris')::date <= $${args.length}::date`); }
  if (problems) where.push(`(b.site_status = 'error' OR b.nx_status IN ('error', 'waiting'))`);
  const { rows } = await pool.query(
    `${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY b.created_at DESC LIMIT 500`, args
  );
  const { rows: [counts] } = await pool.query(
    `SELECT count(*) FILTER (WHERE site_status = 'error')::int AS site_errors,
            count(*) FILTER (WHERE nx_status = 'error')::int AS nx_errors,
            count(*) FILTER (WHERE nx_status = 'waiting')::int AS nx_waiting,
            count(DISTINCT product_id) FILTER (WHERE nx_status = 'waiting')::int AS nx_waiting_products
       FROM boutique_prelevements WHERE warehouse_id = $1`,
    [warehouseId]
  );
  return { rows, counts };
};

/**
 * Reprise d'une étape en erreur : `retry` la renvoie (après vérification dans
 * BMS / la caisse si le message dit VÉRIFIEZ), `done` la déclare faite à la main.
 */
const resolveStep = async (warehouseId, id, step, action) => {
  const col = step === 'site' ? 'site' : step === 'nx' ? 'nx' : null;
  if (!col || !['retry', 'done'].includes(action)) throw httpError(400, 'Action inconnue.');
  const set = action === 'retry'
    ? `${col}_status = 'queued', ${col}_error = NULL`
    : `${col}_status = 'sent', ${col}_error = NULL, ${col}_at = NOW()${col === 'site' ? ", site_ref = COALESCE(site_ref, 'manuel')" : ''}`;
  const { rows: [row] } = await pool.query(
    `UPDATE boutique_prelevements SET ${set}
      WHERE id = $1 AND warehouse_id = $2 AND ${col}_status = 'error' RETURNING id`,
    [id, warehouseId]
  );
  if (!row) throw httpError(409, 'Cette étape n\'est pas en erreur.');
  if (action === 'retry') kick();
  return row;
};

/** Refacturation EMC → EMC2 : une ligne par prélèvement, coût d'achat HT du site. */
const exportRows = async (warehouseId, from, to) => {
  const { rows } = await pool.query(
    `SELECT to_char(b.created_at AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY HH24:MI') AS date,
            to_char(b.created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM') AS month,
            COALESCE(NULLIF(p.category, ''), pp.category) AS category,
            COALESCE(NULLIF(p.brand, ''), pp.brand) AS brand,
            COALESCE(NULLIF(p.sub_brand, ''), pp.sub_brand) AS sub_brand,
            b.sku, b.name, b.qty, b.unit_cost_ht, round(b.qty * b.unit_cost_ht, 2) AS total_ht,
            p.regular_price AS site_price_ttc,
            b.origin, b.nx_status, u.name AS user_name, b.site_status
       FROM boutique_prelevements b
       LEFT JOIN users u ON u.id = b.created_by
       LEFT JOIN products p ON p.id = b.product_id
       LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id
      WHERE b.warehouse_id = $1 AND (b.created_at AT TIME ZONE 'Europe/Paris')::date BETWEEN $2::date AND $3::date
      ORDER BY b.created_at`,
    [warehouseId, from, to]
  );
  return rows;
};

module.exports = {
  lookup, productView, searchNextore, record, link, createInNextore, list, resolveStep, exportRows, releaseWaiting,
};
