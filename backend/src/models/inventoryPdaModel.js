/**
 * Inventaire au PDA (/pda/inventaire, droit `picking` comme les autres apps
 * PDA). Lot 1, validé avec Pierre le 06/10/2026.
 *
 *   - on prend un emplacement (une personne à la fois : l'UPDATE conditionnel
 *     est le verrou, comme pour les vagues) ;
 *   - comptage À L'AVEUGLE : le PDA ne montre jamais le stock théorique ;
 *     scan = +1, carton = son contenu, ou saisie de la quantité ;
 *   - chaque référence attendue doit être comptée ou déclarée absente (0)
 *     avant de terminer l'emplacement : c'est ce qui garantit que tout a été vu ;
 *   - un produit trouvé ailleurs que prévu se compte là où il est ;
 *   - « Terminer » lance le relevé du stock théorique (inventoryRefService) ;
 *     l'emplacement reste rouvrable par son compteur jusqu'à « Valider ma
 *     journée », qui le rend définitif ;
 *   - recomptage : une référence à la fois, comptée en entier (tous ses
 *     emplacements), et c'est ce chiffre qui fait foi.
 *
 * TOUT l'avancement est en base : un PDA qui plante ou qu'on change ne perd rien.
 */

const pool = require('../config/database');
const productModel = require('./productModel');
const inventoryModel = require('./inventoryModel');
const inventoryRefService = require('../services/inventoryRefService');
const { aisleOf, compareLocations } = require('../services/inventoryRules');

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { statusCode: status }, extra);

const openInventory = async () => {
  const { rows: [v] } = await pool.query(`SELECT id, name, kind FROM inventories WHERE status = 'open'`);
  if (!v) throw httpError(404, 'Aucun inventaire en cours.');
  return v;
};

// Photo de la déclinaison, sinon du parent ; marque idem.
const PRODUCT_EXTRAS = `
  COALESCE(p.image_url, pp.image_url) AS image_url,
  COALESCE(NULLIF(p.brand, ''), pp.brand) AS brand`;
const PRODUCT_JOIN = `
  JOIN products p ON p.id = i.product_id
  LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id`;

// ── Accueil ─────────────────────────────────────────────────────────────────

const current = async (userId) => {
  const { rows: [v] } = await pool.query(`SELECT id, name, kind FROM inventories WHERE status = 'open'`);
  if (!v) return { inventory: null };

  const { rows } = await pool.query(
    `SELECT l.id, l.location, l.status, l.assigned_to, l.closed_by, u.name AS assigned_name,
            (SELECT count(*)::int FROM inventory_items i
              WHERE i.inventory_id = l.inventory_id AND i.expected_location = l.location AND NOT i.added_by_scan) AS expected,
            (SELECT count(*)::int FROM inventory_items i
               JOIN inventory_counts c ON c.location_id = l.id AND c.product_id = i.product_id
              WHERE i.inventory_id = l.inventory_id AND i.expected_location = l.location AND NOT i.added_by_scan) AS counted
       FROM inventory_locations l
       LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.inventory_id = $1`,
    [v.id]
  );
  const { rows: [s] } = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status IN ('counted', 'recounted'))::int AS done,
            count(*) FILTER (WHERE status = 'recount')::int AS recount
       FROM inventory_items WHERE inventory_id = $1`,
    [v.id]
  );

  const locations = rows
    .map(l => ({
      id: l.id,
      location: l.location,
      aisle: aisleOf(l.location),
      status: l.status,
      assignedTo: l.assigned_name,
      mine: (l.status === 'counting' && l.assigned_to === userId) || (l.status === 'closed' && l.closed_by === userId),
      locked: l.status === 'counting' && l.assigned_to !== userId,
      expected: l.expected,
      counted: l.counted,
    }))
    .sort((a, b) => compareLocations(a.location, b.location));

  return {
    inventory: { id: v.id, name: v.name, kind: v.kind },
    progress: { total: s.total, done: s.done, recount: s.recount },
    locations,
    myClosed: rows.filter(l => l.status === 'closed' && l.closed_by === userId).length,
    myCounting: rows.filter(l => l.status === 'counting' && l.assigned_to === userId).length,
  };
};

/** Étiquette de rayon scannée : « e5-3 », « E5-3 » et « E 5-3 » désignent E 5-3. */
const findLocation = async (code) => {
  const v = await openInventory();
  const { rows } = await pool.query('SELECT id, location FROM inventory_locations WHERE inventory_id = $1', [v.id]);
  const spaced = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const compact = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const exact = rows.find(r => r.location && spaced(r.location) === spaced(code));
  if (exact) return { id: exact.id };
  const key = compact(code);
  const candidates = key ? rows.filter(r => compact(r.location) === key) : [];
  if (candidates.length === 1) return { id: candidates[0].id };
  throw httpError(404, `Emplacement « ${code} » absent de cet inventaire.`);
};

// ── Un emplacement ──────────────────────────────────────────────────────────

const loadLocation = async (locationId) => {
  const { rows: [l] } = await pool.query(
    `SELECT l.*, v.status AS inventory_status, v.kind, u.name AS assigned_name
       FROM inventory_locations l
       JOIN inventories v ON v.id = l.inventory_id
       LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.id = $1`,
    [locationId]
  );
  if (!l || l.inventory_status !== 'open') throw httpError(404, 'Emplacement introuvable dans l\'inventaire en cours.');
  return l;
};

const getLocation = async (locationId, userId) => {
  const l = await loadLocation(locationId);
  const { rows } = await pool.query(
    `SELECT i.product_id, i.sku, i.name, i.expected_location, ${PRODUCT_EXTRAS},
            c.qty, (i.expected_location = $2 AND NOT i.added_by_scan) AS expected,
            EXISTS (SELECT 1 FROM product_barcodes pb WHERE pb.product_id = i.product_id) AS has_barcode
       FROM inventory_items i
       ${PRODUCT_JOIN}
       LEFT JOIN inventory_counts c ON c.location_id = $1 AND c.product_id = i.product_id
      WHERE i.inventory_id = $3 AND (i.expected_location = $2 OR c.id IS NOT NULL)
      ORDER BY i.name`,
    [locationId, l.location, l.inventory_id]
  );
  return {
    id: l.id,
    location: l.location,
    status: l.status,
    assignedTo: l.assigned_name,
    mine: (l.status === 'counting' && l.assigned_to === userId) || (l.status === 'closed' && l.closed_by === userId),
    canCount: l.status === 'counting' && l.assigned_to === userId,
    canReopen: l.status === 'closed' && l.closed_by === userId,
    lines: rows.map(r => ({
      productId: r.product_id,
      sku: r.sku,
      name: r.name,
      brand: r.brand,
      imageUrl: r.image_url || null,
      expected: r.expected,
      expectedLocation: r.expected_location,
      qty: r.qty,
      hasBarcode: r.has_barcode,
    })),
  };
};

/** « Je prends cet emplacement » : une personne à la fois. */
const take = async (locationId, userId) => {
  const l = await loadLocation(locationId);
  const { rows: [won] } = await pool.query(
    `UPDATE inventory_locations SET status = 'counting', assigned_to = $2, assigned_at = NOW()
      WHERE id = $1 AND (status = 'free' OR (status = 'counting' AND assigned_to = $2))
      RETURNING id`,
    [locationId, userId]
  );
  if (!won) {
    const now = await loadLocation(locationId); // relu : un autre PDA vient peut-être de le prendre
    if (now.status === 'counting') throw httpError(409, `Emplacement déjà en cours par ${now.assigned_name || 'quelqu\'un d\'autre'}.`);
    if (now.status === 'closed') throw httpError(409, 'Emplacement déjà terminé.');
    throw httpError(409, 'Emplacement déjà validé.');
  }
  await inventoryModel.log(l.inventory_id, userId, 'take', { locationId });
  return getLocation(locationId, userId);
};

const assertCounting = async (locationId, userId) => {
  const l = await loadLocation(locationId);
  if (l.status !== 'counting' || l.assigned_to !== userId) {
    throw httpError(403, 'Prenez l\'emplacement avant de compter.');
  }
  return l;
};

/**
 * Ce que désigne un code scanné : codes-barres (unité, carton) puis SKU.
 * @returns {{productId, type, quantity}[]}
 */
const lookupCode = async (code) => {
  const { rows } = await pool.query(
    `SELECT pb.product_id, pb.type, pb.quantity FROM product_barcodes pb WHERE pb.barcode = $1
     UNION ALL
     SELECT p.id, 'sku', NULL FROM products p
      WHERE lower(p.sku) = lower($1) AND p.product_type IN ('simple', 'variation') AND p.wc_deleted_at IS NULL`,
    [code]
  );
  return rows.map(r => ({ productId: r.product_id, type: r.type, quantity: r.quantity }));
};

/** Pièces que vaut un code pour un produit : 1 à l'unité, le contenu d'un carton. */
const piecesFor = (matches, productId, code, name) => {
  const mine = matches.filter(m => m.productId === productId);
  if (mine.some(m => m.type !== 'pack')) return 1;
  const carton = mine[0];
  if (!carton.quantity) {
    throw httpError(409, `Combien d'unités dans ce carton de « ${name} » ?`, {
      code: 'PACK_QTY_UNKNOWN', productId, barcode: code,
    });
  }
  return carton.quantity;
};

const productNames = async (ids) => {
  const { rows } = await pool.query('SELECT id, sku, post_title FROM products WHERE id = ANY($1::int[])', [ids]);
  return rows.map(r => ({ productId: r.id, sku: r.sku, name: r.post_title }));
};

const addToCount = async (l, productId, qty, userId, action, code) => {
  await pool.query(
    `INSERT INTO inventory_counts (inventory_id, location_id, product_id, qty, counted_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (location_id, product_id)
     DO UPDATE SET qty = inventory_counts.qty + EXCLUDED.qty, counted_by = EXCLUDED.counted_by, updated_at = NOW()`,
    [l.inventory_id, l.id, productId, qty, userId]
  );
  await inventoryModel.log(l.inventory_id, userId, action, { locationId: l.id, productId, qty, code });
};

/**
 * Scan dans un emplacement. Un code peut désigner plusieurs produits (21 codes
 * partagés en base) : on préfère celui attendu ici, puis un produit de
 * l'inventaire ; s'il en reste plusieurs, le PDA fait choisir (`productId`).
 * Un produit hors de la liste figée n'entre que dans un inventaire GLOBAL :
 * il est physiquement là, il doit être compté.
 */
const scan = async (locationId, userId, code, chosenProductId) => {
  const l = await assertCounting(locationId, userId);
  const value = String(code || '').trim();
  if (!value) throw httpError(400, 'Code vide.');

  let matches = await lookupCode(value);
  if (chosenProductId) matches = matches.filter(m => m.productId === Number(chosenProductId));
  if (matches.length === 0) throw httpError(404, `Code inconnu (${value}).`);

  const ids = [...new Set(matches.map(m => m.productId))];
  const { rows: items } = await pool.query(
    `SELECT product_id, name, expected_location FROM inventory_items WHERE inventory_id = $1 AND product_id = ANY($2::int[])`,
    [l.inventory_id, ids]
  );
  const here = items.filter(i => i.expected_location === l.location);
  let candidates = here.length ? here.map(i => i.product_id) : items.map(i => i.product_id);

  if (candidates.length === 0) {
    if (l.kind !== 'global') throw httpError(404, `Ce produit n'est pas dans cet inventaire (${value}).`);
    const { rows: countable } = await pool.query(
      `SELECT id FROM products WHERE id = ANY($1::int[]) AND product_type IN ('simple', 'variation')`, [ids]
    );
    candidates = countable.map(r => r.id);
    if (candidates.length === 0) throw httpError(404, `Ce code désigne un pack, comptez ses articles (${value}).`);
  }
  if (candidates.length > 1) {
    throw httpError(409, 'Ce code désigne plusieurs produits : lequel avez-vous en main ?', {
      code: 'AMBIGUOUS', barcode: value, choices: await productNames(candidates),
    });
  }

  const productId = candidates[0];
  const item = items.find(i => i.product_id === productId);
  const { rows: [p] } = await pool.query('SELECT sku, post_title FROM products WHERE id = $1', [productId]);
  // Carton au contenu inconnu : on le demande AVANT de rien écrire.
  const qty = piecesFor(matches, productId, value, item?.name || p.post_title);
  if (!item) {
    await pool.query(
      `INSERT INTO inventory_items (inventory_id, product_id, sku, name, expected_location, added_by_scan)
       VALUES ($1, $2, $3, $4, $5, true) ON CONFLICT (inventory_id, product_id) DO NOTHING`,
      [l.inventory_id, productId, p.sku, p.post_title, l.location]
    );
  }
  await addToCount(l, productId, qty, userId, 'scan', value);
  const loc = await getLocation(locationId, userId);
  return { ...loc, scanned: { productId, qty } };
};

/** Contenu d'un carton inconnu, saisi au PDA : enregistré une fois pour toutes. */
const setPackQuantity = async (userId, code, productId, quantity) => {
  const qty = parseInt(quantity, 10);
  if (!(qty >= 2)) throw httpError(400, 'Un carton contient au moins 2 unités.');
  const value = String(code || '').trim();
  const { rows: [b] } = await pool.query(
    `SELECT id FROM product_barcodes WHERE product_id = $1 AND barcode = $2 AND type = 'pack'`,
    [productId, value]
  );
  if (!b) throw httpError(404, 'Carton inconnu.');
  await productModel.addBarcode(productId, value, 'pack', qty, userId);
};

/** Quantité saisie (ou 0 = « absent »). */
const setQty = async (locationId, userId, productId, qty) => {
  const l = await assertCounting(locationId, userId);
  const n = Number(qty);
  if (!Number.isInteger(n) || n < 0 || n > 100000) throw httpError(400, 'Quantité invalide.');
  const { rows: [item] } = await pool.query(
    'SELECT 1 FROM inventory_items WHERE inventory_id = $1 AND product_id = $2', [l.inventory_id, productId]
  );
  if (!item) throw httpError(404, 'Produit hors inventaire.');
  await pool.query(
    `INSERT INTO inventory_counts (inventory_id, location_id, product_id, qty, counted_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (location_id, product_id)
     DO UPDATE SET qty = EXCLUDED.qty, counted_by = EXCLUDED.counted_by, updated_at = NOW()`,
    [l.inventory_id, l.id, productId, n, userId]
  );
  await inventoryModel.log(l.inventory_id, userId, n === 0 ? 'absent' : 'set', { locationId, productId, qty: n });
  return getLocation(locationId, userId);
};

/** Retire un produit trouvé ici par erreur (seulement s'il n'y est pas attendu). */
const removeLine = async (locationId, userId, productId) => {
  const l = await assertCounting(locationId, userId);
  const { rows: [item] } = await pool.query(
    'SELECT expected_location, added_by_scan FROM inventory_items WHERE inventory_id = $1 AND product_id = $2',
    [l.inventory_id, productId]
  );
  if (!item) throw httpError(404, 'Produit hors inventaire.');
  if (item.expected_location === l.location && !item.added_by_scan) {
    throw httpError(400, 'Produit attendu ici : mettez 0 s\'il est absent.');
  }
  await pool.query('DELETE FROM inventory_counts WHERE location_id = $1 AND product_id = $2', [locationId, productId]);
  // Ajouté au scan et compté nulle part ailleurs : il sort de l'inventaire.
  if (item.added_by_scan) {
    await pool.query(
      `DELETE FROM inventory_items i WHERE i.inventory_id = $1 AND i.product_id = $2 AND i.added_by_scan
          AND NOT EXISTS (SELECT 1 FROM inventory_counts c WHERE c.inventory_id = i.inventory_id AND c.product_id = i.product_id)`,
      [l.inventory_id, productId]
    );
  }
  await inventoryModel.log(l.inventory_id, userId, 'remove', { locationId, productId });
  return getLocation(locationId, userId);
};

/** « Terminer l'emplacement » : tout ce qui est attendu a été compté ou déclaré absent. */
const close = async (locationId, userId) => {
  const l = await assertCounting(locationId, userId);
  const { rows: [{ missing }] } = await pool.query(
    `SELECT count(*)::int AS missing FROM inventory_items i
      WHERE i.inventory_id = $1 AND i.expected_location = $2
        AND NOT EXISTS (SELECT 1 FROM inventory_counts c WHERE c.location_id = $3 AND c.product_id = i.product_id)`,
    [l.inventory_id, l.location, l.id]
  );
  if (missing > 0) throw httpError(400, `Il reste ${missing} référence(s) à compter ou à déclarer absentes.`);

  await pool.query(
    `UPDATE inventory_locations SET status = 'closed', closed_by = $2, closed_at = NOW() WHERE id = $1`,
    [locationId, userId]
  );
  // Relevé du stock théorique MAINTENANT, au plus près du comptage.
  await pool.query(
    `UPDATE inventory_items i SET ref_needed = true
      WHERE i.inventory_id = $1 AND i.status IN ('pending', 'counted')
        AND EXISTS (SELECT 1 FROM inventory_counts c WHERE c.location_id = $2 AND c.product_id = i.product_id)`,
    [l.inventory_id, locationId]
  );
  await inventoryModel.log(l.inventory_id, userId, 'close', { locationId });
  inventoryRefService.kick();
};

/** Rouvrir un emplacement terminé, tant que la journée n'est pas validée. */
const reopen = async (locationId, userId) => {
  const l = await loadLocation(locationId);
  const { rows: [r] } = await pool.query(
    `UPDATE inventory_locations SET status = 'counting', assigned_to = $2, assigned_at = NOW()
      WHERE id = $1 AND status = 'closed' AND closed_by = $2 RETURNING id`,
    [locationId, userId]
  );
  if (!r) throw httpError(409, 'Seul celui qui l\'a terminé peut rouvrir un emplacement, avant d\'avoir validé sa journée.');
  await inventoryModel.log(l.inventory_id, userId, 'reopen', { locationId });
  return getLocation(locationId, userId);
};

/** « Valider ma journée » : mes emplacements terminés deviennent définitifs. */
const validateDay = async (userId) => {
  const v = await openInventory();
  const { rows } = await pool.query(
    `UPDATE inventory_locations SET status = 'validated', validated_at = NOW()
      WHERE inventory_id = $1 AND status = 'closed' AND closed_by = $2 RETURNING id`,
    [v.id, userId]
  );
  if (rows.length) {
    const { rows: products } = await pool.query(
      'SELECT DISTINCT product_id FROM inventory_counts WHERE location_id = ANY($1::int[])',
      [rows.map(r => r.id)]
    );
    await inventoryRefService.evaluate(v.id, products.map(p => p.product_id));
  }
  await inventoryModel.log(v.id, userId, 'validate', { qty: rows.length });
  const { rows: [{ counting }] } = await pool.query(
    `SELECT count(*)::int AS counting FROM inventory_locations
      WHERE inventory_id = $1 AND status = 'counting' AND assigned_to = $2`,
    [v.id, userId]
  );
  return { validated: rows.length, stillCounting: counting };
};

// ── Recomptage ──────────────────────────────────────────────────────────────

const RECOUNT_SQL = `
  SELECT i.id, i.product_id, i.sku, i.name, i.expected_location, i.status, i.recount_qty,
         i.recount_locked_by, u.name AS locked_name, ${PRODUCT_EXTRAS},
         ARRAY(SELECT DISTINCT l.location FROM inventory_counts c JOIN inventory_locations l ON l.id = c.location_id
                WHERE c.inventory_id = i.inventory_id AND c.product_id = i.product_id AND c.qty > 0) AS found_in
    FROM inventory_items i
    ${PRODUCT_JOIN}
    LEFT JOIN users u ON u.id = i.recount_locked_by`;

const recountFromRow = (r, userId) => {
  const locations = [...new Set([r.expected_location, ...r.found_in])].sort(compareLocations);
  return {
    id: r.id,
    productId: r.product_id,
    sku: r.sku,
    name: r.name,
    brand: r.brand,
    imageUrl: r.image_url || null,
    locations,
    lockedBy: r.locked_name,
    mine: r.recount_locked_by === userId,
    locked: r.recount_locked_by !== null && r.recount_locked_by !== userId,
    qty: r.recount_locked_by === userId ? r.recount_qty : null,
  };
};

const listRecounts = async (userId) => {
  const v = await openInventory();
  const { rows } = await pool.query(
    `${RECOUNT_SQL} WHERE i.inventory_id = $1 AND i.status = 'recount' ORDER BY i.expected_location, i.name`,
    [v.id]
  );
  return rows
    .map(r => recountFromRow(r, userId))
    .sort((a, b) => compareLocations(a.locations[0], b.locations[0]) || a.name.localeCompare(b.name, 'fr'));
};

const getRecount = async (itemId, userId) => {
  const { rows: [r] } = await pool.query(
    `${RECOUNT_SQL} JOIN inventories v ON v.id = i.inventory_id AND v.status = 'open' WHERE i.id = $1`,
    [itemId]
  );
  if (!r) throw httpError(404, 'Recomptage introuvable.');
  return recountFromRow(r, userId);
};

const takeRecount = async (itemId, userId) => {
  const { rows: [won] } = await pool.query(
    `UPDATE inventory_items i SET recount_locked_by = $2, recount_qty = COALESCE(recount_qty, 0)
       FROM inventories v
      WHERE i.id = $1 AND v.id = i.inventory_id AND v.status = 'open' AND i.status = 'recount'
        AND (i.recount_locked_by IS NULL OR i.recount_locked_by = $2)
      RETURNING i.inventory_id, i.product_id`,
    [itemId, userId]
  );
  if (!won) {
    const r = await getRecount(itemId, userId);
    throw httpError(409, r.lockedBy ? `Recomptage déjà pris par ${r.lockedBy}.` : 'Ce produit n\'est plus à recompter.');
  }
  await inventoryModel.log(won.inventory_id, userId, 'recount_take', { productId: won.product_id });
  return getRecount(itemId, userId);
};

const assertRecountMine = async (itemId, userId) => {
  const { rows: [i] } = await pool.query(
    `SELECT i.inventory_id, i.product_id, i.name FROM inventory_items i
       JOIN inventories v ON v.id = i.inventory_id AND v.status = 'open'
      WHERE i.id = $1 AND i.status = 'recount' AND i.recount_locked_by = $2`,
    [itemId, userId]
  );
  if (!i) throw httpError(403, 'Prenez ce recomptage avant de compter.');
  return i;
};

const scanRecount = async (itemId, userId, code) => {
  const i = await assertRecountMine(itemId, userId);
  const value = String(code || '').trim();
  const matches = (await lookupCode(value)).filter(m => m.productId === i.product_id);
  if (matches.length === 0) throw httpError(404, `Ce n'est pas le produit à recompter (${value}).`);
  const qty = piecesFor(matches, i.product_id, value, i.name);
  await pool.query('UPDATE inventory_items SET recount_qty = recount_qty + $2 WHERE id = $1', [itemId, qty]);
  await inventoryModel.log(i.inventory_id, userId, 'recount_scan', { productId: i.product_id, qty, code: value });
  return { ...(await getRecount(itemId, userId)), scanned: { qty } };
};

const setRecountQty = async (itemId, userId, qty) => {
  const i = await assertRecountMine(itemId, userId);
  const n = Number(qty);
  if (!Number.isInteger(n) || n < 0 || n > 100000) throw httpError(400, 'Quantité invalide.');
  await pool.query('UPDATE inventory_items SET recount_qty = $2 WHERE id = $1', [itemId, n]);
  await inventoryModel.log(i.inventory_id, userId, 'recount_set', { productId: i.product_id, qty: n });
  return getRecount(itemId, userId);
};

/** Fin du recomptage : il fait foi, et le stock théorique est relevé à nouveau. */
const finishRecount = async (itemId, userId) => {
  const i = await assertRecountMine(itemId, userId);
  await pool.query(
    `UPDATE inventory_items
        SET status = 'recounted', recount_by = $2, recount_at = NOW(), recount_locked_by = NULL, ref_needed = true
      WHERE id = $1`,
    [itemId, userId]
  );
  await inventoryModel.log(i.inventory_id, userId, 'recount_finish', { productId: i.product_id });
  inventoryRefService.kick();
};

module.exports = {
  current,
  findLocation,
  getLocation,
  take,
  scan,
  setPackQuantity,
  setQty,
  removeLine,
  close,
  reopen,
  validateDay,
  listRecounts,
  getRecount,
  takeRecount,
  scanRecount,
  setRecountQty,
  finishRecount,
};
