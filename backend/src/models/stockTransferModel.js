/**
 * Transferts de stock entre le site et les boutiques — app « Transferts » (27/11/2026).
 *
 * Un transfert se compose en brouillon (rien ne bouge), puis s'ENVOIE :
 *   1. le stock SORT de l'origine tout de suite, ligne par ligne, par la file
 *      (transferPushService : BMS pour le site, Nextore pour une boutique) ;
 *   2. une commande « en attente de réception » est créée chez le destinataire :
 *        site → boutique : commande boutique (fournisseur Nextore SARL EMC), reçue
 *                          dans Boutique › Commandes ; la validation crée l'achat
 *                          REÇU Nextore, c'est elle qui met en stock ;
 *        boutique → site : commande d'achat BMS (fournisseur YouVape Montpelliier /
 *                          YouVape Castelnau), reçue dans l'app Réception.
 *      Un écart à la réception se traite comme pour une commande classique.
 *
 * Le coût est TOUJOURS celui du site : PMP FIFO du jour de l'envoi (costAtDate,
 * même calcul que les prélèvements), figé sur la ligne. C'est la refacturation.
 *
 * Produit : le produit du SITE est le pivot (c'est lui qui porte le coût) ; son
 * produit caisse se trouve comme pour les prélèvements (lien, sinon code-barres
 * unique). Sans produit caisse, la ligne est refusée : il faut le rattacher ou le
 * créer dans Boutique › Catalogue caisse.
 */

const pool = require('../config/database');
const nextoreApi = require('../services/nextoreApiClient');
const pdaProductModel = require('./pdaProductModel');
const prelevementModel = require('./prelevementModel');
const prelevementRules = require('../services/prelevementRules');
const rules = require('../services/transferRules');
const { costsAtDates } = require('../services/costAtDate');
const { resolveWarehouse } = require('../config/nextore');

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { statusCode: status, ...extra });
const kick = () => require('../services/transferPushService').kick();
const parisDay = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

const shopLabel = (warehouseId) => resolveWarehouse(warehouseId)?.name || `boutique ${warehouseId}`;
const transferLabel = (t) => (t.direction === 'site_to_shop'
  ? `Site → ${shopLabel(t.warehouse_id)}`
  : `${shopLabel(t.warehouse_id)} → site`);
const reference = (t) => `TRF-${t.id}`;
// Coût courant du site (même ordre que la valeur de stock), pour l'estimation d'un brouillon
const CURRENT_COST_SQL = 'COALESCE(NULLIF(p.computed_cost, 0), NULLIF(p.wc_cog_cost, 0))';

// ── Lecture ─────────────────────────────────────────────────────────────────

const getRow = async (id, db = pool, lock = false) => {
  const { rows: [t] } = await db.query(
    `SELECT * FROM stock_transfers WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [parseInt(id, 10) || 0]
  );
  if (!t) throw httpError(404, 'Transfert introuvable.');
  return t;
};

/**
 * Réception des commandes créées par des transferts, lue sur la commande :
 * pièces attendues / reçues et statut. → Map(transfer_id → order).
 */
const ordersOf = async (transfers) => {
  const out = new Map();
  const bIds = transfers.map((t) => t.boutique_order_id).filter(Boolean);
  const pIds = transfers.map((t) => t.purchase_order_id).filter(Boolean);
  const [{ rows: bo }, { rows: po }] = await Promise.all([
    bIds.length ? pool.query(
      `SELECT o.id, o.reference, o.status,
              COALESCE(SUM(i.qty_ordered), 0)::int AS ordered,
              COALESCE(SUM(i.qty_received), 0)::int AS received,
              COALESCE(SUM(CASE WHEN i.closed_reason IS NOT NULL THEN 0
                                ELSE GREATEST(i.qty_ordered - i.qty_received, 0) END), 0)::int AS remaining
         FROM boutique_orders o LEFT JOIN boutique_order_items i ON i.order_id = o.id
        WHERE o.id = ANY($1::int[]) GROUP BY o.id`, [bIds]
    ) : { rows: [] },
    pIds.length ? pool.query(
      `SELECT po.id, po.order_number AS reference, po.status, po.bms_po_id,
              COALESCE(SUM(poi.qty_ordered * COALESCE(poi.units_per_qty, 1))
                       FILTER (WHERE poi.item_type IS DISTINCT FROM 'discount'), 0)::int AS ordered,
              COALESCE(SUM(poi.units_received) FILTER (WHERE poi.item_type IS DISTINCT FROM 'discount'), 0)::int AS received
         FROM purchase_orders po LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
        WHERE po.id = ANY($1::int[]) GROUP BY po.id`, [pIds]
    ) : { rows: [] },
  ]);
  const bBy = new Map(bo.map((o) => [o.id, { ...o, kind: 'boutique' }]));
  const pBy = new Map(po.map((o) => [o.id, { ...o, kind: 'achat' }]));
  for (const t of transfers) {
    const order = t.boutique_order_id ? bBy.get(t.boutique_order_id) : (t.purchase_order_id ? pBy.get(t.purchase_order_id) : null);
    out.set(t.id, order || null);
  }
  return out;
};

const LIST_SQL = `
  SELECT t.*, cu.name AS created_by_name, su.name AS sent_by_name,
         COUNT(i.id)::int AS lines,
         COALESCE(SUM(i.qty_site), 0)::int AS qty_site,
         COALESCE(SUM(i.qty_shop), 0)::int AS qty_shop,
         ROUND(SUM(i.qty_site * i.unit_cost_ht), 2)::float AS total_ht,
         COUNT(*) FILTER (WHERE i.out_status = 'error')::int AS out_errors,
         COUNT(*) FILTER (WHERE i.out_status IN ('queued', 'sending'))::int AS out_pending
    FROM stock_transfers t
    LEFT JOIN users cu ON cu.id = t.created_by
    LEFT JOIN users su ON su.id = t.sent_by
    LEFT JOIN stock_transfer_items i ON i.transfer_id = t.id`;

const decorate = async (rows) => {
  const orders = await ordersOf(rows);
  return rows.map((t) => {
    const order = orders.get(t.id);
    return { ...t, label: transferLabel(t), reference: reference(t), order, reception: t.status === 'sent' ? rules.receptionState(order) : null };
  });
};

/** Brouillons + transferts envoyés (filtres : boutique, sens, dates d'envoi). */
const list = async ({ warehouseId, direction, from, to } = {}) => {
  const where = ["t.status <> 'cancelled'"];
  const args = [];
  if (warehouseId) { args.push(warehouseId); where.push(`t.warehouse_id = $${args.length}`); }
  if (direction) { args.push(direction); where.push(`t.direction = $${args.length}`); }
  if (from) { args.push(from); where.push(`(t.status = 'draft' OR (t.sent_at AT TIME ZONE 'Europe/Paris')::date >= $${args.length}::date)`); }
  if (to) { args.push(to); where.push(`(t.status = 'draft' OR (t.sent_at AT TIME ZONE 'Europe/Paris')::date <= $${args.length}::date)`); }
  const { rows } = await pool.query(
    `${LIST_SQL} WHERE ${where.join(' AND ')}
      GROUP BY t.id, cu.name, su.name
      ORDER BY (t.status = 'draft') DESC, COALESCE(t.sent_at, t.created_at) DESC
      LIMIT 300`,
    args
  );
  return decorate(rows);
};

/** Un transfert et ses lignes. */
const get = async (id) => {
  const { rows: [head] } = await pool.query(`${LIST_SQL} WHERE t.id = $1 GROUP BY t.id, cu.name, su.name`, [parseInt(id, 10) || 0]);
  if (!head) throw httpError(404, 'Transfert introuvable.');
  const [t] = await decorate([head]);
  const { rows: items } = await pool.query(
    `SELECT i.*, i.unit_cost_ht::float AS unit_cost_ht,
            COALESCE(p.image_url, pp.image_url) AS image_url,
            COALESCE(NULLIF(p.brand, ''), pp.brand) AS brand,
            (${CURRENT_COST_SQL})::float AS current_cost,
            p.stock AS site_stock,
            np.name AS nx_name, st.stock::float AS shop_stock
       FROM stock_transfer_items i
       JOIN products p ON p.id = i.product_id
       LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id
       LEFT JOIN nextore_products np ON np.product_id = i.nx_product_id
       LEFT JOIN nextore_stock st ON st.product_id = i.nx_product_id AND st.warehouse_id = $2
      WHERE i.transfer_id = $1
      ORDER BY i.id`,
    [t.id, t.warehouse_id]
  );
  return { ...t, items };
};

// ── Brouillon ───────────────────────────────────────────────────────────────

const createDraft = async ({ direction, warehouseId, note, userId }) => {
  if (!rules.DIRECTIONS.includes(direction)) throw httpError(400, 'Sens du transfert inconnu.');
  if (!resolveWarehouse(warehouseId)) throw httpError(400, 'Boutique inconnue.');
  const { rows: [t] } = await pool.query(
    `INSERT INTO stock_transfers (direction, warehouse_id, note, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [direction, Number(warehouseId), String(note || '').trim().slice(0, 500) || null, userId || null]
  );
  return get(t.id);
};

const updateDraft = async (id, { note }) => {
  const t = await getRow(id);
  if (!rules.isEditable(t)) throw httpError(409, 'Ce transfert est déjà envoyé.');
  await pool.query('UPDATE stock_transfers SET note = $2 WHERE id = $1', [t.id, String(note || '').trim().slice(0, 500) || null]);
  return get(t.id);
};

/** Abandonne un brouillon (rien n'a bougé). Un transfert envoyé ne s'annule pas ici. */
const cancelDraft = async (id) => {
  const { rowCount } = await pool.query(
    "UPDATE stock_transfers SET status = 'cancelled' WHERE id = $1 AND status = 'draft'", [parseInt(id, 10) || 0]
  );
  if (!rowCount) throw httpError(409, 'Seul un brouillon s\'abandonne : ce transfert est déjà parti.');
};

/** Pièces déjà engagées dans des sorties pas encore faites (pour ne pas promettre deux fois la même). */
const pendingOut = async ({ direction, productId, nxProductId, warehouseId, exceptTransferId = 0 }) => {
  const { rows: [r] } = direction === 'site_to_shop'
    ? await pool.query(
      `SELECT COALESCE(SUM(i.qty_site), 0)::int AS n FROM stock_transfer_items i
         JOIN stock_transfers t ON t.id = i.transfer_id
        WHERE t.direction = 'site_to_shop' AND i.product_id = $1 AND i.out_status IN ('queued', 'sending')
          AND t.id <> $2`,
      [productId, exceptTransferId]
    )
    : await pool.query(
      `SELECT COALESCE(SUM(i.qty_shop), 0)::int AS n FROM stock_transfer_items i
         JOIN stock_transfers t ON t.id = i.transfer_id
        WHERE t.direction = 'shop_to_site' AND t.warehouse_id = $2 AND i.nx_product_id = $1
          AND i.out_status IN ('queued', 'sending') AND t.id <> $3`,
      [String(nxProductId), warehouseId, exceptTransferId]
    );
  return r.n;
};

/** Produit du site + produit caisse + conversion, pour une ligne de ce transfert. */
const productFor = async (t, productId) => {
  const p = await prelevementModel.loadSite(productId);
  const res = await prelevementModel.resolveNxFor(p.id);
  const nx = await prelevementModel.loadNx(res.nxProductId, t.warehouse_id);
  const per = nx ? prelevementRules.boutiqueQty(1, p.name, nx) : 1;
  return { p, res, nx, per };
};

/** Fiche affichée au scan, dans le contexte du transfert (sens, boutique). */
const productView = async (t, productId) => {
  const { p, res, nx, per } = await productFor(t, productId);
  const candidates = res.how === 'ambiguous'
    ? (await Promise.all(res.candidates.map((cid) => prelevementModel.loadNx(cid, t.warehouse_id)))).filter(Boolean)
    : [];
  const { rows: [inDraft] } = await pool.query(
    'SELECT qty_site, qty_shop FROM stock_transfer_items WHERE transfer_id = $1 AND product_id = $2', [t.id, p.id]
  );
  let siteStock = null;
  if (t.direction === 'site_to_shop') {
    const s = await prelevementModel.siteAvailability(p.id, p.sku);
    if (!s.error) {
      const pending = await pendingOut({ direction: t.direction, productId: p.id, exceptTransferId: t.id });
      siteStock = { ...s, transfers: pending, free: Math.max(0, s.free - pending) };
    } else {
      siteStock = s;
    }
  }
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    imageUrl: p.image_url,
    productType: p.product_type,
    unitCost: prelevementRules.siteUnitCost(p),
    nx: nx ? { id: nx.id, name: nx.name, category: nx.category_name, stock: nx.stock } : null,
    nxHow: res.how,
    candidates: candidates.map((c) => ({ id: c.id, name: c.name, stock: c.stock })),
    per,
    siteStock,
    inDraft: inDraft || null,
  };
};

/**
 * Scan ou recherche. Le site d'abord (code-barres, SKU, texte) ; un code-barres
 * connu de la caisse seulement retombe sur le produit du site rattaché à cette fiche.
 */
const lookup = async (id, q) => {
  const t = await getRow(id);
  const found = await pdaProductModel.search(q);
  let results = found.results;
  let by = found.by;
  if (!results.length) {
    const { rows } = await pool.query(
      `SELECT DISTINCT p.id, p.sku, p.post_title AS name, COALESCE(p.image_url, pp.image_url) AS "imageUrl",
              COALESCE(NULLIF(p.brand, ''), pp.brand) AS brand
         FROM nextore_product_barcodes nb
         JOIN boutique_site_links l ON l.nx_product_id = nb.product_id
         JOIN products p ON p.id = l.product_id
         LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id
        WHERE nb.barcode = $1 AND p.wc_deleted_at IS NULL`,
      [String(q || '').trim()]
    );
    results = rows;
    by = 'nextore';
  }
  if (results.length === 1) {
    const r = results[0];
    const packQty = r.matched?.type === 'pack' ? Number(r.matched.quantity) || 1 : 1;
    return { product: await productView(t, r.id), qty: packQty, by };
  }
  return { results, by };
};

/**
 * Pose la quantité d'une ligne du brouillon (0 = retire la ligne). `qty` est dans
 * l'unité de l'ORIGINE : articles du site (site → boutique) ou pièces boutique
 * (boutique → site).
 */
const setLine = async (id, productId, qty) => {
  const t = await getRow(id);
  if (!rules.isEditable(t)) throw httpError(409, 'Ce transfert est déjà envoyé : ses lignes ne bougent plus.');
  const pid = parseInt(productId, 10) || 0;
  if (Number(qty) === 0) {
    await pool.query('DELETE FROM stock_transfer_items WHERE transfer_id = $1 AND product_id = $2', [t.id, pid]);
    return get(t.id);
  }
  const { p, res, nx, per } = await productFor(t, pid);
  if (p.product_type === 'variable' || p.product_type === 'woosb') {
    throw httpError(400, 'Choisissez la déclinaison ou les produits du pack : ce produit n\'a pas de stock à lui.');
  }
  if (!p.sku) throw httpError(400, 'Produit sans SKU : inconnu du stock du site.');
  if (!nx) {
    throw httpError(400, res.how === 'ambiguous'
      ? 'Plusieurs fiches caisse portent les codes-barres de ce produit : rattachez la bonne dans Boutique › Catalogue caisse.'
      : 'Ce produit n\'a pas de fiche caisse : rattachez-le ou créez-le dans Boutique › Catalogue caisse.');
  }
  const q = rules.lineQuantities(t.direction, qty, per);
  if (q.error) throw httpError(400, q.error);
  const { rows: same } = await pool.query(
    `SELECT name FROM stock_transfer_items WHERE transfer_id = $1 AND nx_product_id = $2 AND product_id <> $3`,
    [t.id, nx.id, p.id]
  );
  if (same.length) {
    throw httpError(409, `« ${same[0].name} » est déjà sur ce transfert avec la même fiche caisse (${nx.name}) : une seule ligne par fiche.`);
  }
  await pool.query(
    `INSERT INTO stock_transfer_items (transfer_id, product_id, sku, name, nx_product_id, qty_site, qty_shop)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (transfer_id, product_id) DO UPDATE SET
       sku = EXCLUDED.sku, name = EXCLUDED.name, nx_product_id = EXCLUDED.nx_product_id,
       qty_site = EXCLUDED.qty_site, qty_shop = EXCLUDED.qty_shop`,
    [t.id, p.id, p.sku, p.name, nx.id, q.qtySite, q.qtyShop]
  );
  return get(t.id);
};

// ── Envoi ───────────────────────────────────────────────────────────────────

/** Contrôles avant envoi : produit caisse, conversion, stock à l'origine. → liste de problèmes. */
const checkLines = async (t, items) => {
  const problems = [];
  for (const it of items) {
    let f;
    try {
      f = await productFor(t, it.product_id);
    } catch (error) {
      problems.push(`${it.name} : ${error.message}`);
      continue;
    }
    if (!f.nx || f.nx.id !== it.nx_product_id) {
      problems.push(`${it.name} : sa fiche caisse a changé depuis la saisie, retirez puis rajoutez la ligne.`);
      continue;
    }
    const q = rules.lineQuantities(t.direction, t.direction === 'site_to_shop' ? it.qty_site : it.qty_shop, f.per);
    if (q.error || q.qtySite !== it.qty_site || q.qtyShop !== it.qty_shop) {
      problems.push(`${it.name} : la conversion site / boutique a changé, retirez puis rajoutez la ligne.`);
      continue;
    }
    if (t.direction === 'site_to_shop') {
      // Stock illisible (panne BMS) : on laisse passer, la sortie revérifie le physique
      const s = await prelevementModel.siteAvailability(f.p.id, f.p.sku);
      if (!s.error) {
        const free = s.free - await pendingOut({ direction: t.direction, productId: f.p.id, exceptTransferId: t.id });
        if (free < it.qty_site) {
          problems.push(`${it.name} : seulement ${Math.max(0, free)} libre(s) au site (le reste est réservé par des commandes internet ou déjà engagé), ${it.qty_site} demandé(s).`);
        }
      }
    } else {
      let live;
      try { live = await nextoreApi.getLiveStock(t.warehouse_id, it.nx_product_id); } catch (e) { live = null; }
      if (!Number.isFinite(live)) {
        problems.push(`${it.name} : stock de la caisse illisible pour l'instant, réessayez.`);
        continue;
      }
      const free = live - await pendingOut({ direction: t.direction, nxProductId: it.nx_product_id, warehouseId: t.warehouse_id, exceptTransferId: t.id });
      if (free < it.qty_shop) {
        problems.push(`${it.name} : ${Math.max(0, free)} en stock en boutique, ${it.qty_shop} demandé(s).`);
      }
    }
  }
  return problems;
};

const BMS_LOCK_SQL = "SELECT config_value FROM app_config WHERE config_key = 'bms_pack_migration'";

/**
 * Envoie un brouillon : coûts figés, sorties de stock en file, commande de
 * destination créée. Les contrôles (stock, fiches) passent avant tout : un seul
 * problème et rien ne part.
 */
const send = async (id, user) => {
  const t0 = await getRow(id);
  if (!rules.isEditable(t0)) throw httpError(409, 'Ce transfert est déjà envoyé.');
  const { rows: items } = await pool.query('SELECT * FROM stock_transfer_items WHERE transfer_id = $1 ORDER BY id', [t0.id]);
  if (!items.length) throw httpError(400, 'Ajoutez au moins un produit avant d\'envoyer.');
  if (t0.direction === 'shop_to_site') {
    const { rows: [lock] } = await pool.query(BMS_LOCK_SQL);
    if (lock?.config_value === 'on') throw httpError(423, 'Bascule des conditionnements BMS en cours : réessayez dans quelques minutes.');
  }

  const problems = await checkLines(t0, items);
  const day = parisDay();
  const costs = await costsAtDates(items.map((i) => ({ productId: i.product_id, date: day })));
  const { rows: current } = await pool.query(
    `SELECT p.id, ${CURRENT_COST_SQL}::numeric AS cost FROM products p WHERE p.id = ANY($1::int[])`,
    [items.map((i) => i.product_id)]
  );
  const currentBy = new Map(current.map((r) => [r.id, Number(r.cost) || null]));
  const costOf = new Map();
  for (const it of items) {
    const c = costs.get(`${it.product_id}|${day}`) ?? currentBy.get(it.product_id);
    if (!(c > 0)) problems.push(`${it.name} : coût d'achat du site inconnu, impossible de valoriser le transfert.`);
    else costOf.set(it.id, rules.round4(c));
  }
  if (problems.length) throw httpError(409, 'Transfert non envoyé :\n• ' + problems.join('\n• '), { problems });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = await getRow(t0.id, client, true);
    if (!rules.isEditable(t)) throw httpError(409, 'Ce transfert vient d\'être envoyé par quelqu\'un d\'autre.');
    const { rows: now } = await client.query('SELECT id FROM stock_transfer_items WHERE transfer_id = $1', [t.id]);
    if (now.length !== items.length || now.some((r) => !costOf.has(r.id))) {
      throw httpError(409, 'Les lignes ont changé pendant l\'envoi : vérifiez et renvoyez.');
    }
    for (const it of items) {
      await client.query(
        "UPDATE stock_transfer_items SET unit_cost_ht = $2, out_status = 'queued', out_error = NULL WHERE id = $1",
        [it.id, costOf.get(it.id)]
      );
    }
    await client.query(
      `UPDATE stock_transfers SET status = 'sent', sent_by = $2, sent_at = NOW(), order_status = 'pending', order_error = NULL
        WHERE id = $1`,
      [t.id, user?.id || null]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  kick();
  await createDestinationOrder(t0.id, user).catch(() => {}); // l'échec est rangé sur le transfert
  return get(t0.id);
};

const creatingOrder = new Set();

/**
 * Crée (ou reprend) la commande de destination d'un transfert envoyé. Idempotent :
 * une commande déjà créée n'est jamais refaite ; une commande boutique ou d'achat
 * portant déjà la référence TRF-<id> est reprise (création interrompue).
 * L'échec est rangé sur le transfert (order_status = 'error') puis relevé.
 */
const createDestinationOrder = async (id, user) => {
  const key = parseInt(id, 10) || 0;
  if (creatingOrder.has(key)) throw httpError(409, 'Création de la commande déjà en cours.');
  creatingOrder.add(key);
  try {
    const t = await getRow(key);
    if (t.status !== 'sent') throw httpError(409, 'Ce transfert n\'est pas envoyé.');
    if (t.order_status === 'created') return get(t.id);
    const { rows: items } = await pool.query(
      `SELECT i.*, p.wp_product_id FROM stock_transfer_items i JOIN products p ON p.id = i.product_id
        WHERE i.transfer_id = $1 ORDER BY i.id`,
      [t.id]
    );
    const done = (fields) => pool.query(
      `UPDATE stock_transfers SET order_status = 'created', order_error = NULL,
              boutique_order_id = COALESCE($2, boutique_order_id), purchase_order_id = COALESCE($3, purchase_order_id)
        WHERE id = $1`,
      [t.id, fields.boutiqueOrderId || null, fields.purchaseOrderId || null]
    );
    const fail = (message, fields = {}) => pool.query(
      `UPDATE stock_transfers SET order_status = 'error', order_error = $2,
              purchase_order_id = COALESCE($3, purchase_order_id)
        WHERE id = $1`,
      [t.id, String(message || 'Erreur inconnue').slice(0, 2000), fields.purchaseOrderId || null]
    );

    try {
      if (t.direction === 'site_to_shop') {
        await createBoutiqueOrder(t, items, user, done);
      } else {
        await createSitePurchaseOrder(t, items, user, done, fail);
      }
    } catch (error) {
      await fail(error.message, { purchaseOrderId: error.purchaseOrderId });
      throw httpError(error.statusCode || 502, `Commande de réception non créée : ${error.message}`);
    }
    return get(t.id);
  } finally {
    creatingOrder.delete(key);
  }
};

/** Site → boutique : commande boutique « en attente de réception », au coût du site. */
const createBoutiqueOrder = async (t, items, user, done) => {
  const boutiqueOrderModel = require('./boutiqueOrderModel');
  const warehouse = resolveWarehouse(t.warehouse_id);
  const { rows: [existing] } = await pool.query(
    "SELECT id FROM boutique_orders WHERE reference = $1 AND source = 'transfert' AND warehouse_id = $2 LIMIT 1",
    [reference(t), t.warehouse_id]
  );
  if (existing) return done({ boutiqueOrderId: existing.id });
  const r = await boutiqueOrderModel.createOrder({
    warehouse,
    supplierId: rules.NEXTORE_SITE_SUPPLIER_ID,
    reference: reference(t),
    source: 'transfert',
    userEmail: user?.email || null,
    lines: items.map((i) => ({
      product_id: i.nx_product_id,
      quantity: i.qty_shop,
      unit_cost: rules.shopUnitCost(i.unit_cost_ht, i.qty_site, i.qty_shop),
    })),
  });
  return done({ boutiqueOrderId: r.orderId });
};

/**
 * Boutique → site : commande d'achat chez la boutique qui envoie, envoyée à BMS
 * (statut attendu : elle apparaît dans l'app Réception). Pas d'envoi partiel :
 * une ligne qui ne part pas dans BMS ne rentrerait jamais au site alors qu'elle
 * est déjà sortie de la boutique. Produit absent de BMS → à créer, puis « Réessayer ».
 */
const createSitePurchaseOrder = async (t, items, user, done, fail) => {
  const purchaseOrderModel = require('./purchaseOrderModel');
  const supplierId = rules.SITE_SUPPLIER_BY_WAREHOUSE[t.warehouse_id];
  let poId = t.purchase_order_id;
  if (!poId) {
    const { rows: [existing] } = await pool.query(
      'SELECT id FROM purchase_orders WHERE order_number = $1 AND supplier_id = $2 LIMIT 1', [reference(t), supplierId]
    );
    poId = existing?.id || null;
  }

  if (!poId) {
    const created = await purchaseOrderModel.create({
      order_number: reference(t),
      supplier_id: supplierId,
      supplier_reference: `Transfert ${transferLabel(t)} n°${t.id}`,
      notes: `Transfert de stock n°${t.id} (${transferLabel(t)}), app Transferts.${t.note ? ` ${t.note}` : ''}`,
      send_to_bms: true,
      items: items.map((i) => ({
        product_id: i.wp_product_id,
        product_name: i.name,
        supplier_sku: i.sku,
        qty_ordered: i.qty_site,
        unit_price: Number(i.unit_cost_ht),
        units_per_qty: 1,
      })),
    }, user?.id || null);
    if (created.bms_po_id) return done({ purchaseOrderId: created.id });
    await fail(created.bms_error?.message || 'Commande créée mais non envoyée à BMS.', { purchaseOrderId: created.id });
    throw httpError(502, created.bms_error?.message || 'Commande créée mais non envoyée à BMS.');
  }

  // Commande déjà créée chez nous : envoyée à BMS ? sinon on la renvoie
  const po = await purchaseOrderModel.getById(poId);
  if (!po) throw httpError(404, 'La commande d\'achat de ce transfert a disparu.');
  if (po.bms_po_id) return done({ purchaseOrderId: po.id });
  const { rows: lines } = await pool.query(
    `SELECT poi.*, p.sku, p.product_type, 1 AS pack_qty
       FROM purchase_order_items poi JOIN products p ON p.id = poi.product_id
      WHERE poi.purchase_order_id = $1`,
    [po.id]
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await purchaseOrderModel.createInBMS(client, po, po.supplier_id, lines, null, {});
    if (!r.bms_po_id) throw new Error('BMS n\'a pas renvoyé de numéro de commande.');
    await client.query("UPDATE purchase_orders SET bms_po_id = $2, status = 'sent' WHERE id = $1", [po.id, r.bms_po_id]);
    if (r.bms_totals && Number.isFinite(r.bms_totals.ttc)) {
      await client.query('UPDATE purchase_orders SET total_amount = $2 WHERE id = $1', [po.id, r.bms_totals.ttc]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw Object.assign(error, { purchaseOrderId: po.id });
  } finally {
    client.release();
  }
  return done({ purchaseOrderId: po.id });
};

/**
 * Reprise d'une sortie de stock en erreur : `retry` la renvoie (après vérification
 * si le message dit VÉRIFIEZ), `done` la déclare faite à la main.
 */
const resolveOut = async (transferId, itemId, action) => {
  if (!['retry', 'done'].includes(action)) throw httpError(400, 'Action inconnue.');
  const set = action === 'retry'
    ? "out_status = 'queued', out_error = NULL"
    : "out_status = 'sent', out_error = NULL, out_at = NOW(), out_ref = COALESCE(out_ref, 'manuel')";
  const { rowCount } = await pool.query(
    `UPDATE stock_transfer_items SET ${set} WHERE id = $1 AND transfer_id = $2 AND out_status = 'error'`,
    [parseInt(itemId, 10) || 0, parseInt(transferId, 10) || 0]
  );
  if (!rowCount) throw httpError(409, 'Cette sortie n\'est pas en erreur.');
  if (action === 'retry') kick();
  return get(transferId);
};

// ── Export (refacturation) ──────────────────────────────────────────────────

const exportRows = async (from, to) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.direction, t.warehouse_id,
            to_char(t.sent_at AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY HH24:MI') AS date,
            to_char(t.sent_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM') AS month,
            COALESCE(NULLIF(p.category, ''), pp.category) AS category,
            COALESCE(NULLIF(p.brand, ''), pp.brand) AS brand,
            i.sku, i.name, i.qty_site, i.qty_shop, i.unit_cost_ht,
            ROUND(i.qty_site * i.unit_cost_ht, 2) AS total_ht, i.out_status,
            u.name AS user_name
       FROM stock_transfers t
       JOIN stock_transfer_items i ON i.transfer_id = t.id
       JOIN products p ON p.id = i.product_id
       LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id
       LEFT JOIN users u ON u.id = t.sent_by
      WHERE t.status = 'sent'
        AND (t.sent_at AT TIME ZONE 'Europe/Paris')::date BETWEEN $1::date AND $2::date
      ORDER BY t.sent_at, i.id`,
    [from, to]
  );
  return rows.map((r) => ({ ...r, label: transferLabel(r), reference: reference(r) }));
};

module.exports = {
  list, get, createDraft, updateDraft, cancelDraft, lookup, productView, setLine, send,
  createDestinationOrder, resolveOut, exportRows, transferLabel, reference,
};
