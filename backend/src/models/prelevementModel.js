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
         COALESCE(NULLIF(p.sub_brand, ''), pp.sub_brand) AS sub_brand,
         array_remove(ARRAY(SELECT b.barcode FROM product_barcodes b WHERE b.product_id = p.id AND b.type = 'unit' AND ${rules.uniqueSiteBarcodeSql('b')} ORDER BY b.id), NULL) AS barcodes
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
        WHERE b.product_id = $1 AND ${rules.uniqueSiteBarcodeSql('b')}`,
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
        AND b.created_by IS DISTINCT FROM $3 AND b.cancelled_at IS NULL
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
  await closeReviews(p.id, 'linked', userId);
  return { product: await productView(p.id, warehouseId), barcodes, released };
};

/**
 * « Pas le même article » : défait un rattachement manuel faux. Retire de la
 * fiche caisse les codes-barres de CE produit du site (ajoutés au rattachement :
 * sinon la caisse continue de le prendre pour l'autre), oublie la comparaison de
 * prix, et remet le produit dans « Existants absents » pour être rattaché à la
 * bonne fiche ou créé. Une fiche CRÉÉE par l'app pour ce produit n'est pas concernée.
 */
const unlink = async (productId, userId) => {
  const { rows: [l] } = await pool.query(
    'SELECT nx_product_id, source FROM boutique_site_links WHERE product_id = $1', [productId]
  );
  if (!l) throw httpError(404, 'Ce produit n\'est rattaché à aucune fiche caisse à la main.');
  if (l.source !== 'manual') throw httpError(409, 'Cette fiche caisse a été créée pour ce produit : à corriger dans la caisse.');
  const { rows: mine } = await pool.query(
    `SELECT barcode FROM product_barcodes WHERE product_id = $1 AND type = 'unit'`, [productId]
  );
  const nx = await loadNx(l.nx_product_id, 0);
  const remove = new Set(mine.map((b) => b.barcode));
  const before = rules.splitBarcodes(nx?.barcode);
  const kept = before.filter((b) => !remove.has(b));
  const removed = before.filter((b) => remove.has(b));
  if (removed.length) {
    await nextoreApi.updateProduct(l.nx_product_id, { barcode: kept.join(';') });
    await pool.query('UPDATE nextore_products SET barcode = $2 WHERE product_id = $1', [l.nx_product_id, kept.join(';')]);
    await pool.query(
      'DELETE FROM nextore_product_barcodes WHERE product_id = $1 AND barcode = ANY($2::text[])', [l.nx_product_id, removed]
    );
  }
  await pool.query('DELETE FROM boutique_site_links WHERE product_id = $1', [productId]);
  await pool.query('DELETE FROM boutique_nx_sync WHERE product_id = $1', [productId]);
  await pool.query(
    `UPDATE boutique_catalog_reviews SET status = 'done', resolution = 'unlinked', resolved_by = $2, resolved_at = NOW()
      WHERE product_id = $1 AND reason = 'prix' AND status = 'open'`,
    [productId, userId || null]
  );
  await pool.query(
    `INSERT INTO boutique_catalog_reviews (product_id, reason, candidates) VALUES ($1, 'absent', '[]'::jsonb)
     ON CONFLICT (product_id, reason) DO UPDATE SET status = 'open', resolution = NULL, resolved_by = NULL, resolved_at = NULL`,
    [productId]
  );
  return { unlinked: l.nx_product_id, nxName: nx?.name || null, removedBarcodes: removed };
};

/**
 * Produit désormais dans la caisse : ses lignes « à vérifier » de catalogue sont
 * réglées (sauf le prix, comparé au passage suivant de la synchro).
 */
const closeReviews = (productId, resolution, userId) => pool.query(
  `UPDATE boutique_catalog_reviews SET status = 'done', resolution = $2, resolved_by = $3, resolved_at = NOW()
    WHERE product_id = $1 AND status = 'open' AND reason <> 'prix'`,
  [productId, resolution, userId || null]
);

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

/**
 * `quiet` : création en masse — ne relit pas la fiche complète à la fin (elle lit
 * le stock BMS en direct : 2 000 appels satureraient BMS).
 */
const createInNextore = async (warehouseId, productId, categoryId, userId, { quiet = false } = {}) => {
  if (creating.has(productId)) throw httpError(409, 'Création déjà en cours pour ce produit.');
  creating.add(productId);
  try {
    const p = await loadSite(productId);
    const res = await resolveNxFor(productId);
    if (res.nxProductId) throw httpError(409, 'Ce produit a déjà un produit caisse.');
    // Sans code-barres, le SKU en tient lieu : la fiche se retrouve en caisse par sa saisie.
    const barcodes = p.barcodes.length ? p.barcodes : [p.sku].filter(Boolean);
    if (!barcodes.length) throw httpError(400, 'Produit sans code-barres ni SKU.');
    // Marque (champ Nextore cf1) : orthographe Nextore reprise si elle existe déjà.
    const { rows: nxBrands } = await pool.query(
      `SELECT DISTINCT brand FROM nextore_products WHERE COALESCE(brand, '') <> '' AND COALESCE(status, '') <> 'deleted'`
    );
    const brand = require('../services/catalogSyncRules').pickBrand(p, nxBrands.map((r) => r.brand));
    const payload = rules.nextoreProductPayload(p, { categoryId, barcodes, brand });
    const response = await nextoreApi.createProduct(payload);
    const nxId = await findCreatedId(response, barcodes);
    if (!nxId) {
      throw httpError(502, 'Nextore a répondu mais la fiche est introuvable : VÉRIFIEZ dans la caisse avant de recréer.');
    }
    // Nextore renvoie la fiche créée (constaté le 10/11/2026) : on la range dans le
    // miroir local tout de suite, au lieu de relire tout le catalogue (5 000 fiches).
    if (response && typeof response === 'object' && String(response.id) === String(nxId)) {
      await pool.query(
        `INSERT INTO nextore_products (product_id, code, name, unit, cost, price, category_id, barcode, tax_rate, type, status, brand, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
         ON CONFLICT (product_id) DO NOTHING`,
        [nxId, response.code ?? null, response.name ?? payload.name, response.unit ?? null,
          Number(response.cost ?? payload.cost) || null, Number(response.price ?? payload.price) || null,
          String(response.category_id ?? payload.category_id), response.barcode ?? payload.barcode ?? null,
          String(response.tax_rate ?? payload.tax_rate), response.type ?? 'standard', response.status ?? '', response.cf1 ?? payload.cf1 ?? null]
      );
      for (const b of rules.splitBarcodes(response.barcode ?? payload.barcode)) {
        await pool.query('INSERT INTO nextore_product_barcodes (product_id, barcode) VALUES ($1, $2) ON CONFLICT DO NOTHING', [nxId, b]);
      }
    } else if (!(await loadNx(nxId, warehouseId))) {
      await require('./nextoreModel').syncCatalog();
    }
    await pool.query(
      `INSERT INTO boutique_site_links (product_id, nx_product_id, source, created_by)
       VALUES ($1, $2, 'created', $3)
       ON CONFLICT (product_id) DO UPDATE SET nx_product_id = EXCLUDED.nx_product_id, source = 'created',
         created_by = EXCLUDED.created_by, created_at = NOW()`,
      [p.id, nxId, userId || null]
    );
    const released = await releaseWaiting(p.id, warehouseId);
    await closeReviews(p.id, 'created', userId);
    // Fiche créée au prix normal du site : c'est le prix « aligné » de départ.
    await pool.query(
      `INSERT INTO boutique_nx_sync (product_id, nx_product_id, price_pushed) VALUES ($1, $2, $3)
       ON CONFLICT (product_id) DO UPDATE SET nx_product_id = EXCLUDED.nx_product_id, price_pushed = EXCLUDED.price_pushed,
         price_locked = false, updated_at = NOW()`,
      [p.id, nxId, payload.price]
    );
    if (quiet) return { released, nxProductId: nxId };
    return { product: await productView(p.id, warehouseId), released, nxProductId: nxId };
  } finally {
    creating.delete(productId);
  }
};

// ── Rapprochement avec les ventes de la caisse ──────────────────────────────

const SALES_TOLERANCE_MIN = 30;
const LIVE_SALES_TTL_MS = 60000;
let liveSalesCache = null; // { key, at, items }

const parisDay = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

/**
 * Ventes Nextore lues en direct (la synchro locale n'a lieu qu'à 23h40). Un jour
 * sans vente, Nextore répond `false` (constaté le 13/11/2026) ; toute autre
 * réponse qu'une liste est une erreur. Cache d'une minute : l'écran se
 * rafraîchit toutes les 4 s tant qu'une écriture est en cours.
 */
const liveSaleItems = async (from, to, fresh) => {
  const key = `${from}|${to}`;
  if (!fresh && liveSalesCache?.key === key && Date.now() - liveSalesCache.at < LIVE_SALES_TTL_MS) {
    return liveSalesCache.items;
  }
  const r = await nextoreApi.getSaleItems(from, to);
  if (r !== false && !Array.isArray(r)) throw new Error('Réponse inattendue de Nextore pour les ventes.');
  const items = r || [];
  liveSalesCache = { key, at: Date.now(), items };
  return items;
};

/**
 * Pièces boutique vendues en caisse de chaque prélèvement en cours (non annulé,
 * entré ou à entrer en caisse) des produits caisse `nxIds`. Ventes : base locale
 * jusqu'au jour de la dernière synchro, Nextore en direct à partir de ce jour.
 * Lève si Nextore est illisible : sans ventes, on ne sait pas, on n'annule pas.
 */
const soldByPrelevement = async (warehouseId, nxIds, { fresh = false } = {}) => {
  const ids = [...new Set(nxIds.filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const { rows: prels } = await pool.query(
    `SELECT id, nx_product_id, nx_qty,
            to_char(created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD HH24:MI:SS') AS at
       FROM boutique_prelevements
      WHERE warehouse_id = $1 AND nx_product_id = ANY($2::text[])
        AND cancelled_at IS NULL AND nx_status NOT IN ('skipped', 'cancelled')`,
    [warehouseId, ids]
  );
  if (!prels.length) return new Map();
  const { rows: [cfg] } = await pool.query(
    `SELECT config_value FROM app_config WHERE config_key = 'nextore_last_sales_sync_at'`
  );
  const today = parisDay(Date.now());
  const synced = cfg?.config_value ? parisDay(cfg.config_value) : today;
  const liveFrom = synced < today ? synced : today;
  const oldest = prels.reduce((m, p) => (p.at < m ? p.at : m), prels[0].at);
  const [{ rows: local }, live] = await Promise.all([
    pool.query(
      `SELECT product_id, quantity, to_char(sold_at, 'YYYY-MM-DD HH24:MI:SS') AS at
         FROM nextore_sales
        WHERE warehouse_id = $1 AND product_id = ANY($2::text[])
          AND sold_at >= $3::timestamp - make_interval(mins => $4) AND sold_at < $5::date`,
      [warehouseId, ids, oldest, SALES_TOLERANCE_MIN, liveFrom]
    ),
    liveSaleItems(liveFrom, today, fresh),
  ]);
  const wanted = new Set(ids);
  const liveRows = live
    .filter((s) => Number(s.warehouse_id) === warehouseId && wanted.has(String(s.product_id)))
    .map((s) => ({ product_id: s.product_id, quantity: s.quantity, at: s.date }));
  return rules.allocateSales(prels, [...local, ...liveRows], { toleranceMin: SALES_TOLERANCE_MIN });
};

// ── Liste, reprise, export ──────────────────────────────────────────────────

const LIST_SQL = `
  SELECT b.*, u.name AS user_name, cu.name AS cancelled_by_name, np.name AS nx_name
    FROM boutique_prelevements b
    LEFT JOIN users u ON u.id = b.created_by
    LEFT JOIN users cu ON cu.id = b.cancelled_by
    LEFT JOIN nextore_products np ON np.product_id = b.nx_product_id`;

const list = async (warehouseId, { from, to, problems } = {}) => {
  const where = ['b.warehouse_id = $1'];
  const args = [warehouseId];
  if (from) { args.push(from); where.push(`(b.created_at AT TIME ZONE 'Europe/Paris')::date >= $${args.length}::date`); }
  if (to) { args.push(to); where.push(`(b.created_at AT TIME ZONE 'Europe/Paris')::date <= $${args.length}::date`); }
  if (problems) {
    where.push(`(b.site_status = 'error' OR b.nx_status IN ('error', 'waiting')
                 OR b.site_undo_status = 'error' OR b.nx_undo_status = 'error')`);
  }
  const { rows } = await pool.query(
    `${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY b.created_at DESC LIMIT 500`, args
  );
  const { rows: [counts] } = await pool.query(
    `SELECT count(*) FILTER (WHERE site_status = 'error')::int AS site_errors,
            count(*) FILTER (WHERE nx_status = 'error')::int AS nx_errors,
            count(*) FILTER (WHERE nx_status = 'waiting')::int AS nx_waiting,
            count(DISTINCT product_id) FILTER (WHERE nx_status = 'waiting')::int AS nx_waiting_products,
            count(*) FILTER (WHERE site_undo_status = 'error' OR nx_undo_status = 'error')::int AS undo_errors
       FROM boutique_prelevements WHERE warehouse_id = $1`,
    [warehouseId]
  );
  // Pièces vendues en caisse : seul un prélèvement dont rien n'est vendu s'annule.
  let salesError = null;
  try {
    const sold = await soldByPrelevement(warehouseId, rows.filter((r) => !r.cancelled_at).map((r) => r.nx_product_id));
    for (const r of rows) r.sold_qty = sold.get(r.id) ?? 0;
  } catch (error) {
    salesError = `Ventes de la caisse illisibles pour l'instant : annulation indisponible (${error.message}).`;
  }
  return { rows, counts, salesError };
};

/**
 * Annule un prélèvement : le client a changé d'avis, la pièce retourne au site.
 * Ce qui est déjà parti est défait par la file (remise au site, retrait de la
 * caisse) ; ce qui ne l'est pas encore ne partira pas. Règles : rules.cancelPlan.
 * La ligne sort de la refacturation. Verrou sur la ligne : la file, qui réclame
 * une étape par UPDATE … WHERE status = 'queued', attend puis la trouve annulée.
 */
const cancel = async (warehouseId, id, userId) => {
  // Ventes relues en direct (pas de cache), avant le verrou : pas d'appel HTTP
  // pendant qu'on tient la ligne.
  const { rows: [pre] } = await pool.query(
    'SELECT nx_product_id FROM boutique_prelevements WHERE id = $1 AND warehouse_id = $2', [id, warehouseId]
  );
  if (!pre) throw httpError(404, 'Prélèvement introuvable.');
  let sold;
  try {
    sold = (await soldByPrelevement(warehouseId, [pre.nx_product_id], { fresh: true })).get(id) ?? 0;
  } catch (error) {
    throw httpError(503, `Ventes de la caisse illisibles, impossible de vérifier que rien n'est vendu : réessayez (${error.message}).`);
  }
  if (sold > 0) {
    throw httpError(409, `Déjà vendu en caisse (${sold} pièce${sold > 1 ? 's' : ''}) : ce prélèvement ne s'annule plus.`);
  }
  const client = await pool.connect();
  let plan;
  let row;
  try {
    await client.query('BEGIN');
    const { rows: [r] } = await client.query(
      'SELECT * FROM boutique_prelevements WHERE id = $1 AND warehouse_id = $2 FOR UPDATE', [id, warehouseId]
    );
    if (!r) throw httpError(404, 'Prélèvement introuvable.');
    plan = rules.cancelPlan(r);
    const set = ['cancelled_at = NOW()', 'cancelled_by = $3'];
    for (const step of ['site', 'nx']) {
      if (plan[step] === 'cancel') set.push(`${step}_status = 'cancelled', ${step}_error = NULL`);
      if (plan[step] === 'undo') set.push(`${step}_undo_status = 'queued', ${step}_undo_error = NULL`);
    }
    ({ rows: [row] } = await client.query(
      `UPDATE boutique_prelevements SET ${set.join(', ')} WHERE id = $1 AND warehouse_id = $2 RETURNING *`,
      [id, warehouseId, userId || null]
    ));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  if (plan.site === 'undo' || plan.nx === 'undo') kick();
  return { row, plan };
};

const RESOLVABLE_STEPS = ['site', 'nx', 'site_undo', 'nx_undo'];

/**
 * Reprise d'une étape en erreur : `retry` la renvoie (après vérification dans
 * BMS / la caisse si le message dit VÉRIFIEZ), `done` la déclare faite à la main.
 * Vaut aussi pour les étapes d'annulation (site_undo, nx_undo).
 */
const resolveStep = async (warehouseId, id, step, action) => {
  const col = RESOLVABLE_STEPS.includes(step) ? step : null;
  if (!col || !['retry', 'done'].includes(action)) throw httpError(400, 'Action inconnue.');
  const hasRef = col === 'site' || col === 'site_undo';
  const set = action === 'retry'
    ? `${col}_status = 'queued', ${col}_error = NULL`
    : `${col}_status = 'sent', ${col}_error = NULL, ${col}_at = NOW()${hasRef ? `, ${col}_ref = COALESCE(${col}_ref, 'manuel')` : ''}`;
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
        AND b.cancelled_at IS NULL
      ORDER BY b.created_at`,
    [warehouseId, from, to]
  );
  return rows;
};

module.exports = {
  lookup, productView, searchNextore, record, link, createInNextore, list, cancel, resolveStep, exportRows, releaseWaiting,
  addSiteBarcodesToNx, unlink,
};
