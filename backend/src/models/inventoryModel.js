/**
 * Inventaire — côté PC (/inventaire, droit `inventaire`). Lot 1, validé avec
 * Pierre le 06/10/2026.
 *
 * Un inventaire est partiel (catégories, sous-catégories, marques) ou global
 * (tout le périmètre de la valeur de stock du catalogue, STOCK_VALUE_SCOPE).
 * Sa liste de références est FIGÉE à la création, avec l'emplacement de
 * chacune : on sait à tout moment ce qu'il reste à compter, et « 100 % » veut
 * dire que tout ce périmètre a été vu.
 *
 * Un seul inventaire ouvert à la fois (index unique) : le PDA n'a pas à
 * demander lequel.
 *
 * Le comptage au PDA est dans inventoryPdaModel ; le relevé du stock
 * théorique et la décision de recomptage dans services/inventoryRefService.
 */

const pool = require('../config/database');
const { STOCK_VALUE_SCOPE } = require('./stockValuationModel');

const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status });

// Catégorie, sous-catégorie et marque : celles de la déclinaison, sinon du parent.
const DIM = {
  category: `COALESCE(NULLIF(p.category, ''), par.category)`,
  subCategory: `COALESCE(NULLIF(p.sub_category, ''), par.sub_category)`,
  brand: `COALESCE(NULLIF(p.brand, ''), par.brand)`,
};

const SCOPE_FROM = `
  FROM products p
  LEFT JOIN products par ON p.product_type = 'variation' AND par.wp_product_id = p.wp_parent_id
 WHERE ${STOCK_VALUE_SCOPE}`;

const LIST_KEYS = { categories: 'category', subCategories: 'subCategory', brands: 'brand' };

const cleanFilters = (filters = {}) => Object.fromEntries(Object.keys(LIST_KEYS).map(k => [
  k, [...new Set((Array.isArray(filters[k]) ? filters[k] : []).map(v => String(v)).filter(Boolean))],
]));

/**
 * Filtre SQL d'un inventaire partiel : OU à l'intérieur d'une liste (deux
 * marques), ET entre les listes (telle marque dans telle sous-catégorie).
 */
const filterSql = (kind, filters, params) => {
  if (kind === 'global') return '';
  const parts = [];
  for (const [key, dim] of Object.entries(LIST_KEYS)) {
    if (!filters[key].length) continue;
    params.push(filters[key]);
    parts.push(`${DIM[dim]} = ANY($${params.length}::text[])`);
  }
  if (!parts.length) throw httpError(400, 'Choisissez au moins une catégorie, sous-catégorie ou marque.');
  return ` AND ${parts.join(' AND ')}`;
};

const checkKind = (kind) => {
  if (!['global', 'partial'].includes(kind)) throw httpError(400, 'Type d\'inventaire inconnu.');
};

/** Catégories (avec leurs sous-catégories) et marques du périmètre, avec leur nombre de références. */
const options = async () => {
  const { rows: cats } = await pool.query(
    `SELECT ${DIM.category} AS category, ${DIM.subCategory} AS sub_category, count(*)::int AS n
       ${SCOPE_FROM}
      GROUP BY 1, 2`
  );
  const { rows: brands } = await pool.query(
    `SELECT ${DIM.brand} AS brand, count(*)::int AS n ${SCOPE_FROM} GROUP BY 1 ORDER BY 1`
  );
  const byCat = new Map();
  for (const r of cats) {
    if (!r.category) continue;
    const c = byCat.get(r.category) || { name: r.category, count: 0, subCategories: [] };
    c.count += r.n;
    if (r.sub_category) c.subCategories.push({ name: r.sub_category, count: r.n });
    byCat.set(r.category, c);
  }
  const sortFr = (a, b) => a.name.localeCompare(b.name, 'fr');
  return {
    categories: [...byCat.values()].sort(sortFr).map(c => ({ ...c, subCategories: c.subCategories.sort(sortFr) })),
    brands: brands.filter(b => b.brand).map(b => ({ name: b.brand, count: b.n })),
  };
};

/** « X références, Y emplacements » avant de créer. */
const preview = async ({ kind, filters }) => {
  checkKind(kind);
  const params = [];
  const where = filterSql(kind, cleanFilters(filters), params);
  const { rows: [r] } = await pool.query(
    `SELECT count(*)::int AS refs,
            count(DISTINCT COALESCE(btrim(p.shelf_location), ''))::int AS locations,
            count(*) FILTER (WHERE COALESCE(btrim(p.shelf_location), '') = '')::int AS without_location
       ${SCOPE_FROM}${where}`,
    params
  );
  return { refs: r.refs, locations: r.locations, withoutLocation: r.without_location };
};

const create = async ({ name, kind, filters }, userId) => {
  checkKind(kind);
  const title = String(name || '').trim().slice(0, 120);
  if (!title) throw httpError(400, 'Donnez un nom à l\'inventaire.');
  const clean = cleanFilters(filters);
  const params = [];
  const where = filterSql(kind, clean, params);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let inventoryId;
    try {
      const { rows: [inv] } = await client.query(
        `INSERT INTO inventories (name, kind, filters, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
        [title, kind, kind === 'global' ? {} : clean, userId]
      );
      inventoryId = inv.id;
    } catch (error) {
      if (error.code !== '23505') throw error;
      const { rows: [open] } = await pool.query(`SELECT name FROM inventories WHERE status = 'open'`);
      throw httpError(409, `Un inventaire est déjà en cours : « ${open?.name} ». Terminez-le ou annulez-le d'abord.`);
    }

    const shifted = where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 1}`);
    const { rowCount } = await client.query(
      `INSERT INTO inventory_items (inventory_id, product_id, sku, name, expected_location)
       SELECT $1, p.id, p.sku, p.post_title, COALESCE(btrim(p.shelf_location), '')
         ${SCOPE_FROM}${shifted}`,
      [inventoryId, ...params]
    );
    if (rowCount === 0) throw httpError(400, 'Aucune référence ne correspond : rien à inventorier.');

    await client.query(
      `INSERT INTO inventory_locations (inventory_id, location)
       SELECT DISTINCT $1, expected_location FROM inventory_items WHERE inventory_id = $1`,
      [inventoryId]
    );
    await client.query(
      `INSERT INTO inventory_events (inventory_id, user_id, action, qty) VALUES ($1, $2, 'create', $3)`,
      [inventoryId, userId, rowCount]
    );
    await client.query('COMMIT');
    return { id: inventoryId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const list = async () => {
  const { rows } = await pool.query(
    `SELECT v.id, v.name, v.kind, v.filters, v.status, v.created_at, v.cancelled_at, u.name AS created_by_name,
            (SELECT count(*)::int FROM inventory_items i WHERE i.inventory_id = v.id) AS total,
            (SELECT count(*)::int FROM inventory_items i WHERE i.inventory_id = v.id
                AND i.status IN ('counted', 'recounted')) AS done
       FROM inventories v
       LEFT JOIN users u ON u.id = v.created_by
      ORDER BY (v.status = 'open') DESC, v.created_at DESC`
  );
  return rows.map(r => ({
    id: r.id, name: r.name, kind: r.kind, filters: r.filters, status: r.status,
    createdAt: r.created_at, cancelledAt: r.cancelled_at, createdBy: r.created_by_name,
    total: r.total, done: r.done,
  }));
};

/** Tableau de bord : avancement global, par emplacement, par compteur, recomptages. */
const get = async (id) => {
  const { rows: [v] } = await pool.query(
    `SELECT v.*, u.name AS created_by_name FROM inventories v LEFT JOIN users u ON u.id = v.created_by WHERE v.id = $1`,
    [id]
  );
  if (!v) throw httpError(404, 'Inventaire introuvable.');

  const { rows: [s] } = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'counted')::int AS counted,
            count(*) FILTER (WHERE status = 'recounted')::int AS recounted,
            count(*) FILTER (WHERE status = 'recount')::int AS recount,
            count(*) FILTER (WHERE status = 'pending')::int AS pending,
            count(*) FILTER (WHERE ref_needed)::int AS ref_waiting,
            count(*) FILTER (WHERE ref_error IS NOT NULL)::int AS ref_errors,
            count(*) FILTER (WHERE added_by_scan)::int AS added_by_scan
       FROM inventory_items WHERE inventory_id = $1`,
    [id]
  );

  const { rows: locations } = await pool.query(
    `SELECT l.id, l.location, l.status, l.assigned_at, l.closed_at, l.validated_at,
            ua.name AS assigned_name, uc.name AS closed_name,
            (SELECT count(*)::int FROM inventory_items i
              WHERE i.inventory_id = l.inventory_id AND i.expected_location = l.location AND NOT i.added_by_scan) AS expected,
            (SELECT count(*)::int FROM inventory_items i
               JOIN inventory_counts c ON c.location_id = l.id AND c.product_id = i.product_id
              WHERE i.inventory_id = l.inventory_id AND i.expected_location = l.location AND NOT i.added_by_scan) AS counted,
            (SELECT count(*)::int FROM inventory_counts c
               JOIN inventory_items i ON i.inventory_id = c.inventory_id AND i.product_id = c.product_id
              WHERE c.location_id = l.id AND (i.expected_location <> l.location OR i.added_by_scan)) AS found_here
       FROM inventory_locations l
       LEFT JOIN users ua ON ua.id = l.assigned_to
       LEFT JOIN users uc ON uc.id = l.closed_by
      WHERE l.inventory_id = $1`,
    [id]
  );

  const { rows: counters } = await pool.query(
    `SELECT u.id, u.name,
            count(DISTINCT c.location_id) FILTER (WHERE l.status = 'validated')::int AS locations_validated,
            count(DISTINCT c.location_id) FILTER (WHERE l.status IN ('counting', 'closed'))::int AS locations_open,
            count(*)::int AS refs,
            COALESCE(sum(c.qty), 0)::int AS pieces
       FROM inventory_counts c
       JOIN inventory_locations l ON l.id = c.location_id
       JOIN users u ON u.id = c.counted_by
      WHERE c.inventory_id = $1
      GROUP BY u.id, u.name
      ORDER BY refs DESC`,
    [id]
  );

  const { rows: recounts } = await pool.query(
    `SELECT i.id, i.product_id, i.sku, i.name, i.expected_location, i.status,
            ul.name AS locked_name, ur.name AS recount_name, i.recount_at
       FROM inventory_items i
       LEFT JOIN users ul ON ul.id = i.recount_locked_by
       LEFT JOIN users ur ON ur.id = i.recount_by
      WHERE i.inventory_id = $1 AND i.status IN ('recount', 'recounted')
      ORDER BY (i.status = 'recount') DESC, i.name`,
    [id]
  );

  return {
    id: v.id, name: v.name, kind: v.kind, filters: v.filters, status: v.status,
    createdAt: v.created_at, createdBy: v.created_by_name,
    stats: {
      total: s.total, counted: s.counted, recounted: s.recounted, recount: s.recount, pending: s.pending,
      refWaiting: s.ref_waiting, refErrors: s.ref_errors, addedByScan: s.added_by_scan,
    },
    locations: locations.map(l => ({
      id: l.id, location: l.location, status: l.status,
      assignedTo: l.assigned_name, closedBy: l.closed_name,
      assignedAt: l.assigned_at, closedAt: l.closed_at, validatedAt: l.validated_at,
      expected: l.expected, counted: l.counted, foundHere: l.found_here,
    })),
    counters: counters.map(c => ({
      id: c.id, name: c.name, locationsValidated: c.locations_validated, locationsOpen: c.locations_open,
      refs: c.refs, pieces: c.pieces,
    })),
    recounts: recounts.map(r => ({
      id: r.id, productId: r.product_id, sku: r.sku, name: r.name, expectedLocation: r.expected_location,
      status: r.status, lockedBy: r.locked_name, recountBy: r.recount_name, recountAt: r.recount_at,
    })),
  };
};

const log = (inventoryId, userId, action, extra = {}) => pool.query(
  `INSERT INTO inventory_events (inventory_id, location_id, product_id, user_id, action, qty, code)
   VALUES ($1, $2, $3, $4, $5, $6, $7)`,
  [inventoryId, extra.locationId || null, extra.productId || null, userId, action, extra.qty ?? null, extra.code || null]
);

/** « Libérer » un emplacement pris : il redevient libre, ses comptages restent. */
const releaseLocation = async (inventoryId, locationId, userId) => {
  const { rows: [l] } = await pool.query(
    `UPDATE inventory_locations SET status = 'free', assigned_to = NULL, assigned_at = NULL
      WHERE id = $1 AND inventory_id = $2 AND status = 'counting' RETURNING id`,
    [locationId, inventoryId]
  );
  if (!l) throw httpError(400, 'Seul un emplacement en cours de comptage peut être libéré.');
  await log(inventoryId, userId, 'release', { locationId });
};

/** Libère un recomptage pris par quelqu'un (PDA perdu, personne partie). */
const releaseRecount = async (inventoryId, itemId, userId) => {
  const { rows: [i] } = await pool.query(
    `UPDATE inventory_items SET recount_locked_by = NULL
      WHERE id = $1 AND inventory_id = $2 AND status = 'recount' AND recount_locked_by IS NOT NULL
      RETURNING product_id`,
    [itemId, inventoryId]
  );
  if (!i) throw httpError(400, 'Ce recomptage n\'est pris par personne.');
  await log(inventoryId, userId, 'recount_release', { productId: i.product_id });
};

const cancel = async (inventoryId, userId) => {
  const { rows: [v] } = await pool.query(
    `UPDATE inventories SET status = 'cancelled', cancelled_by = $2, cancelled_at = NOW()
      WHERE id = $1 AND status = 'open' RETURNING id`,
    [inventoryId, userId]
  );
  if (!v) throw httpError(400, 'Seul un inventaire en cours peut être annulé.');
  await log(inventoryId, userId, 'cancel');
};

module.exports = { options, preview, create, list, get, releaseLocation, releaseRecount, cancel, log };
