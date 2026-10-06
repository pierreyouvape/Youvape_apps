/**
 * App PDA « Produit » (/pda/produit) — validée avec Pierre le 05/10/2026.
 *
 * On scanne ou on cherche un produit, et sa fiche montre ce qu'il faut en
 * rayon : photo, marque, stock disponible et physique (lus EN DIRECT dans BMS),
 * emplacement, codes-barres. Trois gestes :
 *   - l'emplacement se change dans BMS, uniquement vers un emplacement que BMS
 *     connaît (on scanne l'étiquette du rayon) ; on relit BMS avant d'y croire ;
 *   - les codes-barres (unité et packs) ne vivent que CHEZ NOUS : c'est notre
 *     table que lisent le Packing et le Picking ;
 *   - un mouvement de stock part dans BMS avec sa raison (vente boutique,
 *     ajustement, défectueux).
 * Chaque geste est journalisé dans `pda_product_log` : BMS ne sait pas qui,
 * chez nous, l'a fait.
 */

const pool = require('../config/database');
const bmsApiModel = require('./bmsApiModel');

const BMS_WAREHOUSE_ID = 270;

const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status });

/** Raisons de mouvement, et le sens qu'elles autorisent. */
const REASONS = {
  vente_boutique: { label: 'Vente boutique', category: 'miscellaneous', directions: ['out'] },
  ajustement: { label: 'Ajustement', category: 'adjustment', directions: ['in', 'out'] },
  defectueux: { label: 'Défectueux', category: 'defective', directions: ['out'] },
};

// Marque, sous-marque et photo vivent souvent sur le parent d'une déclinaison.
const PRODUCT_SQL = `
  SELECT p.id, p.sku, p.post_title AS name, p.post_status, p.product_type, p.stock, p.shelf_location,
         COALESCE(NULLIF(p.brand, ''), pp.brand) AS brand,
         COALESCE(NULLIF(p.sub_brand, ''), pp.sub_brand) AS sub_brand,
         COALESCE(p.image_url, pp.image_url) AS image_url
    FROM products p
    LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id`;

// On ne cherche que ce qui a un stock à soi : ni parent variable, ni pack woosb.
const IN_SCOPE = `p.product_type IN ('simple', 'variation') AND p.wc_deleted_at IS NULL AND p.post_status <> 'trash'`;

const summary = (r) => ({
  id: r.id,
  sku: r.sku,
  name: r.name,
  brand: r.brand || null,
  subBrand: r.sub_brand || null,
  imageUrl: r.image_url || null,
  status: r.post_status,
  stock: r.stock,
  location: r.shelf_location || null,
});

const loadProduct = async (productId) => {
  const { rows: [r] } = await pool.query(`${PRODUCT_SQL} WHERE p.id = $1`, [productId]);
  if (!r) throw httpError(404, 'Produit introuvable.');
  return r;
};

// ── Recherche ───────────────────────────────────────────────────────────────

/**
 * Un code scanné (code-barres ou SKU exact) désigne un produit ; sinon on
 * cherche dans le nom, le SKU et la marque, mot par mot.
 */
const search = async (query) => {
  const q = String(query || '').trim();
  if (!q) throw httpError(400, 'Recherche vide.');

  const { rows: byBarcode } = await pool.query(
    `${PRODUCT_SQL}
       JOIN product_barcodes pb ON pb.product_id = p.id
      WHERE pb.barcode = $1`,
    [q]
  );
  if (byBarcode.length > 0) {
    const { rows: codes } = await pool.query(
      'SELECT product_id, type, quantity FROM product_barcodes WHERE barcode = $1', [q]
    );
    return {
      by: 'barcode',
      results: byBarcode.map(r => {
        const c = codes.find(x => x.product_id === r.id);
        return { ...summary(r), matched: { type: c.type, quantity: c.quantity } };
      }),
    };
  }

  const { rows: bySku } = await pool.query(
    `${PRODUCT_SQL} WHERE lower(p.sku) = lower($1) AND p.wc_deleted_at IS NULL`, [q]
  );
  if (bySku.length > 0) return { by: 'sku', results: bySku.map(summary) };

  const words = q.split(/\s+/).filter(w => w.length > 0).slice(0, 6);
  if (q.length < 2) return { by: 'text', results: [] };
  const conditions = words.map((_, i) =>
    `concat_ws(' ', p.post_title, p.sku, p.brand, p.sub_brand, pp.brand, pp.sub_brand) ILIKE $${i + 1}`);
  const { rows } = await pool.query(
    `${PRODUCT_SQL}
      WHERE ${IN_SCOPE} AND ${conditions.join(' AND ')}
      ORDER BY (p.post_status = 'publish') DESC, p.post_title
      LIMIT 40`,
    words.map(w => `%${w}%`)
  );
  return { by: 'text', results: rows.map(summary) };
};

// ── Stock BMS ───────────────────────────────────────────────────────────────

/** Stock et emplacement de l'entrepôt, lus à l'instant dans BMS. */
const readBmsStock = async (sku) => {
  let stocks;
  try {
    stocks = await bmsApiModel.apiCall(`/advanced-stock/product/${encodeURIComponent(sku)}/stocks`);
  } catch (error) {
    if (/Too Many Attempts/i.test(error.message)) throw httpError(503, 'BMS est saturé, réessayez dans une minute.');
    if (/^BMS API error: 40[04]/.test(error.message)) throw httpError(404, 'Produit inconnu de BMS.');
    throw error;
  }
  const w = (Array.isArray(stocks) ? stocks : []).find(s => s.w_id === BMS_WAREHOUSE_ID);
  if (!w) throw httpError(404, 'Produit absent de l\'entrepôt BMS.');
  return {
    available: w.wi_available_quantity,
    physical: w.wi_physical_quantity,
    reserved: w.wi_reserved_quantity,
    toShip: w.wi_quantity_to_ship,
    location: w.wi_shelf_location ? String(w.wi_shelf_location).trim() : null,
  };
};

const getProduct = async (productId) => {
  const r = await loadProduct(productId);
  const { rows: barcodes } = await pool.query(
    `SELECT id, barcode, type, quantity FROM product_barcodes
      WHERE product_id = $1
      ORDER BY (type = 'unit') DESC, quantity NULLS LAST, barcode`,
    [productId]
  );
  let bms = null;
  let bmsError = null;
  if (!r.sku) bmsError = 'Produit sans SKU : inconnu de BMS.';
  else {
    try {
      bms = await readBmsStock(r.sku);
    } catch (error) {
      bmsError = error.message;
    }
  }
  return { ...summary(r), barcodes, bms, bmsError };
};

// ── Emplacements ────────────────────────────────────────────────────────────

// La liste des emplacements BMS (383 au 05/10/2026) bouge rarement : 1 h de cache.
let locationsCache = { list: null, expiry: 0 };

const listLocations = async () => {
  if (locationsCache.list && Date.now() < locationsCache.expiry) return locationsCache.list;
  const limit = 200;
  let list = [];
  for (let offset = 0; ; offset += limit) {
    const page = await bmsApiModel.apiCall(`/v2/warehouses/${BMS_WAREHOUSE_ID}/locations?limit=${limit}&offset=${offset}`);
    list = list.concat((page.data || []).map(l => String(l.location_code || '').trim()).filter(Boolean));
    if (offset + limit >= (page.meta?.total || 0)) break;
  }
  list.sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
  locationsCache = { list, expiry: Date.now() + 60 * 60 * 1000 };
  return list;
};

const spaced = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
const compact = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * L'emplacement BMS que désigne un code scanné ou tapé, ou null. « e 5-3 »,
 * « E5-3 » et « E 5-3 » désignent tous E 5-3 ; la forme sans séparateur n'est
 * retenue que si elle ne désigne qu'un seul emplacement.
 */
const resolveLocation = (list, raw) => {
  const exact = list.find(l => spaced(l) === spaced(raw));
  if (exact) return exact;
  const key = compact(raw);
  const candidates = key ? list.filter(l => compact(l) === key) : [];
  return candidates.length === 1 ? candidates[0] : null;
};

const log = (entry) => pool.query(
  `INSERT INTO pda_product_log (product_id, sku, user_id, action, old_value, new_value, reason, qty, comment, bms_movement_id)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
  [entry.productId, entry.sku, entry.userId, entry.action, entry.oldValue ?? null, entry.newValue ?? null,
    entry.reason ?? null, entry.qty ?? null, entry.comment ?? null, entry.bmsMovementId ?? null]
);

/**
 * Change l'emplacement dans BMS puis chez nous. On relit BMS avant de
 * l'écrire chez nous : un PUT BMS peut répondre 200 sans rien appliquer.
 */
const setLocation = async (productId, rawCode, user) => {
  const r = await loadProduct(productId);
  if (!r.sku) throw httpError(400, 'Produit sans SKU : inconnu de BMS.');
  const code = resolveLocation(await listLocations(), rawCode);
  if (!code) throw httpError(400, `Emplacement inconnu de BMS : « ${String(rawCode || '').trim()} ».`);

  const before = await readBmsStock(r.sku);
  if (before.location !== code) {
    await bmsApiModel.apiCall(
      `/advanced-stock/product/${encodeURIComponent(r.sku)}/warehouse/${BMS_WAREHOUSE_ID}`, 'PUT',
      { shelf_location: code }
    );
    const after = await readBmsStock(r.sku);
    if (after.location !== code) {
      throw httpError(502, `BMS n'a pas pris l'emplacement (il indique encore « ${after.location || 'aucun'} »).`);
    }
  }

  await pool.query(
    'UPDATE products SET shelf_location = $2, shelf_location_synced_at = NOW() WHERE id = $1',
    [productId, code]
  );
  await log({ productId, sku: r.sku, userId: user.id, action: 'location', oldValue: before.location, newValue: code });
  return getProduct(productId);
};

// ── Codes-barres (chez nous uniquement) ─────────────────────────────────────

const describeCode = (type, quantity) => (type === 'pack' ? `pack x${quantity}` : 'unité');

const checkCodeFields = (type, quantity) => {
  if (!['unit', 'pack'].includes(type)) throw httpError(400, 'Type de code inconnu.');
  if (type === 'pack') {
    const n = Number(quantity);
    if (!Number.isInteger(n) || n < 2) throw httpError(400, 'Un pack contient au moins 2 unités.');
    return n;
  }
  return null;
};

const addBarcode = async (productId, { barcode, type, quantity }, user) => {
  const r = await loadProduct(productId);
  const code = String(barcode || '').trim();
  if (!code) throw httpError(400, 'Code-barres vide.');
  if (code.length > 50) throw httpError(400, 'Code-barres trop long.');
  const qty = checkCodeFields(type, quantity);

  // Un code d'étiquette de rayon scanné par erreur ne doit pas devenir un code produit.
  const locations = await listLocations().catch(() => []);
  if (resolveLocation(locations, code)) throw httpError(400, `« ${code} » est un code d'emplacement, pas un code produit.`);

  const { rows: owners } = await pool.query(
    `SELECT p.id, p.post_title, p.sku FROM product_barcodes pb
       JOIN products p ON p.id = pb.product_id
      WHERE pb.barcode = $1`,
    [code]
  );
  if (owners.some(o => o.id === productId)) throw httpError(409, 'Ce code est déjà sur ce produit.');
  if (owners.length > 0) {
    throw httpError(409, `Ce code est déjà porté par « ${owners[0].post_title} » (SKU ${owners[0].sku || '?'}).`);
  }

  await pool.query(
    `INSERT INTO product_barcodes (product_id, barcode, type, quantity, confirmed_at, confirmed_by)
     VALUES ($1, $2, $3, $4, NOW(), $5)`,
    [productId, code, type, qty, user.id]
  );
  await log({ productId, sku: r.sku, userId: user.id, action: 'barcode_add', newValue: `${code} (${describeCode(type, qty)})` });
  return getProduct(productId);
};

const editBarcode = async (productId, barcodeId, { type, quantity }, user) => {
  const r = await loadProduct(productId);
  const qty = checkCodeFields(type, quantity);
  const { rows: [old] } = await pool.query(
    'SELECT barcode, type, quantity FROM product_barcodes WHERE id = $1 AND product_id = $2', [barcodeId, productId]
  );
  if (!old) throw httpError(404, 'Code-barres introuvable.');
  await pool.query(
    `UPDATE product_barcodes SET type = $2, quantity = $3, confirmed_at = NOW(), confirmed_by = $4 WHERE id = $1`,
    [barcodeId, type, qty, user.id]
  );
  await log({
    productId, sku: r.sku, userId: user.id, action: 'barcode_edit',
    oldValue: `${old.barcode} (${describeCode(old.type, old.quantity)})`,
    newValue: `${old.barcode} (${describeCode(type, qty)})`,
  });
  return getProduct(productId);
};

const deleteBarcode = async (productId, barcodeId, user) => {
  const r = await loadProduct(productId);
  const { rows: [old] } = await pool.query(
    'DELETE FROM product_barcodes WHERE id = $1 AND product_id = $2 RETURNING barcode, type, quantity',
    [barcodeId, productId]
  );
  if (!old) throw httpError(404, 'Code-barres introuvable.');
  await log({
    productId, sku: r.sku, userId: user.id, action: 'barcode_delete',
    oldValue: `${old.barcode} (${describeCode(old.type, old.quantity)})`,
  });
  return getProduct(productId);
};

// ── Mouvement de stock (BMS) ────────────────────────────────────────────────

/** BMS désigne un produit par son id à lui, jamais par le SKU. */
const findBmsProductId = async (sku) => {
  const res = await bmsApiModel.apiCall(`/v2/products/search/${encodeURIComponent(sku)}`);
  const match = (res.data || []).find(p => p.sku === sku);
  if (!match) throw httpError(404, `BMS ne connaît aucun produit portant le SKU ${sku}.`);
  return match.id;
};

/**
 * Numéro du mouvement que l'on vient de créer. La réponse du POST ne le porte
 * pas (constaté au 1er mouvement réel, 06/10/2026) : on relit le dernier
 * mouvement du produit portant notre commentaire. Le mouvement est déjà fait,
 * un échec ici ne doit pas le faire passer pour raté.
 */
const findMovementId = async (created, bmsProductId, comments, qty) => {
  const direct = (created?.data || created)?.id;
  if (direct) return direct;
  try {
    const res = await bmsApiModel.apiCall(
      `/v2/stock-movements?limit=10&sorts[id]=desc&filters[product_id]=${bmsProductId}`
    );
    return (res.data || []).find(m => m.comments === comments && Number(m.qty) === qty)?.id ?? null;
  } catch (error) {
    console.error('[PDA Produit] Numéro du mouvement BMS introuvable :', error.message);
    return null;
  }
};

const createMovement = async (productId, { reason, direction, qty, comment }, user) => {
  const r = await loadProduct(productId);
  if (!r.sku) throw httpError(400, 'Produit sans SKU : inconnu de BMS.');
  const def = REASONS[reason];
  if (!def) throw httpError(400, 'Raison inconnue.');
  if (!def.directions.includes(direction)) throw httpError(400, `« ${def.label} » ne peut être qu'une sortie.`);
  const n = Number(qty);
  if (!Number.isInteger(n) || n < 1) throw httpError(400, 'Quantité invalide.');

  if (direction === 'out') {
    const stock = await readBmsStock(r.sku);
    if (n > stock.physical) throw httpError(400, `Stock physique BMS insuffisant : ${stock.physical}.`);
  }

  const note = String(comment || '').trim();
  const comments = ['PDA', user.name || user.email, def.label, note].filter(Boolean).join(' · ').slice(0, 100);
  const bmsProductId = await findBmsProductId(r.sku);
  const created = await bmsApiModel.apiCall('/v2/stock-movements', 'POST', {
    product_id: bmsProductId,
    ...(direction === 'in' ? { to_warehouse_id: BMS_WAREHOUSE_ID } : { from_warehouse_id: BMS_WAREHOUSE_ID }),
    qty: n,
    category: def.category,
    comments,
  });

  await log({
    productId, sku: r.sku, userId: user.id, action: 'movement', reason,
    qty: direction === 'in' ? n : -n, comment: note || null,
    bmsMovementId: await findMovementId(created, bmsProductId, comments, n),
  });
  return getProduct(productId);
};

module.exports = {
  REASONS,
  search,
  getProduct,
  listLocations,
  resolveLocation,
  setLocation,
  addBarcode,
  editBarcode,
  deleteBarcode,
  createMovement,
};
