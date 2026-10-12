/**
 * Boutiques — commandes fournisseur et réception.
 *
 * La commande vit CHEZ NOUS : l'API Nextore ne sait pas réceptionner un achat
 * existant (essais du 12/10/2026). La réception crée dans Nextore un achat
 * DÉJÀ REÇU des pièces comptées — c'est ce qui met en stock, avec le coût.
 *
 * ⚠️ Un achat reçu ne se supprime pas, même dans l'interface Nextore : un
 * double envoi serait définitif. D'où le statut 'sending' posé AVANT l'appel
 * (verrou), et le rapprochement par référence quand l'appel a échoué sans
 * qu'on sache si Nextore l'a enregistré.
 *
 * Tout est compté en PIÈCES. Le surplus part en stock (les pièces sont dans la
 * boutique) ; un manquant exige un motif, gardé dans l'app (pas de mail).
 */

const pool = require('../config/database');
const api = require('../services/nextoreApiClient');

const MOTIFS = ['reliquat', 'solde', 'manquant', 'erreur_saisie'];
// Motifs qui soldent le reste d'une ligne ; un reliquat la laisse ouverte
const CLOSING_MOTIFS = ['solde', 'manquant', 'erreur_saisie'];

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Pièces encore attendues sur une ligne (0 si soldée par un motif). */
const REMAINING_SQL = `CASE WHEN i.closed_reason IS NOT NULL THEN 0
                            ELSE GREATEST(i.qty_ordered - i.qty_received, 0) END`;

// --- Commandes ------------------------------------------------------------

/** Référence lisible quand le document n'en donne pas : heure de Paris + fournisseur. */
function makeReference(warehouse, supplierId) {
  const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).slice(0, 16);
  return `APP-${warehouse.code}-${stamp.slice(0, 10)}_${stamp.slice(11, 13)}h${stamp.slice(14, 16)}-${supplierId}`;
}

/**
 * Crée une commande. lines = [{ product_id, quantity, unit_cost, supplier_sku?, pack? }]
 * en pièces, coût HT d'une pièce.
 */
async function createOrder({ warehouse, supplierId, reference, source, lines, userEmail }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO boutique_orders (warehouse_id, supplier_id, reference, source, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [warehouse.id, String(supplierId), reference, source, userEmail || null]
    );
    const orderId = rows[0].id;
    for (const l of lines) {
      await client.query(
        `INSERT INTO boutique_order_items (order_id, product_id, supplier_sku, pack_qty, qty_ordered, unit_cost)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orderId, String(l.product_id), l.supplier_sku || null, Math.max(parseInt(l.pack, 10) || 1, 1),
          parseInt(l.quantity, 10), Number(l.unit_cost) || 0]
      );
    }
    await client.query('COMMIT');
    return { orderId, reference, lines: lines.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Une commande de CETTE boutique, sinon 404 (le droit est vérifié par boutique). */
async function getOrderRow(orderId, warehouseId, db = pool, lock = false) {
  const { rows } = await db.query(
    `SELECT * FROM boutique_orders WHERE id = $1 AND warehouse_id = $2${lock ? ' FOR UPDATE' : ''}`,
    [parseInt(orderId, 10), warehouseId]
  );
  if (!rows[0]) throw httpError(404, 'Commande introuvable dans cette boutique');
  return rows[0];
}

/** Commandes ouvertes + les 50 dernières closes, avec leur avancement. */
async function listOrders(warehouseId) {
  const { rows } = await pool.query(
    `SELECT o.id, o.reference, o.source, o.status, o.created_at, o.closed_at,
            sup.company AS supplier_name,
            (SELECT name FROM users u WHERE u.email = o.created_by LIMIT 1) AS created_by_name,
            COUNT(i.id)::int AS lines,
            COALESCE(SUM(i.qty_ordered), 0)::int AS pieces_ordered,
            COALESCE(SUM(i.qty_received), 0)::int AS pieces_received,
            COALESCE(SUM(${REMAINING_SQL}), 0)::int AS pieces_remaining,
            EXISTS (SELECT 1 FROM boutique_reception_sessions s
                    WHERE s.order_id = o.id AND s.status IN ('counting', 'sending')) AS reception_open
     FROM boutique_orders o
     LEFT JOIN nextore_suppliers sup ON sup.id = o.supplier_id
     LEFT JOIN boutique_order_items i ON i.order_id = o.id
     WHERE o.warehouse_id = $1
       AND (o.status = 'open' OR o.id IN (
             SELECT id FROM boutique_orders WHERE warehouse_id = $1 AND status <> 'open'
             ORDER BY COALESCE(closed_at, created_at) DESC LIMIT 50))
     GROUP BY o.id, sup.company
     ORDER BY (o.status = 'open') DESC, o.created_at DESC`,
    [warehouseId]
  );
  return rows;
}

/**
 * Détail d'une commande : lignes (avec leurs codes-barres), réception en cours
 * (comptage), et historique des réceptions validées.
 */
async function getOrder(orderId, warehouseId) {
  const order = await getOrderRow(orderId, warehouseId);
  const { rows: sup } = await pool.query('SELECT company FROM nextore_suppliers WHERE id = $1', [order.supplier_id]);

  const { rows: items } = await pool.query(
    `SELECT i.id, i.product_id, i.supplier_sku, i.pack_qty, i.qty_ordered, i.qty_received,
            i.closed_reason, i.added_at_reception, ${REMAINING_SQL}::int AS remaining, i.unit_cost::float AS unit_cost,
            p.name, p.code, st.stock::float AS stock,
            COALESCE((SELECT array_agg(DISTINCT b.barcode) FROM nextore_product_barcodes b
                      WHERE b.product_id = i.product_id), '{}') AS barcodes,
            COALESCE((SELECT json_agg(json_build_object('barcode', r.barcode, 'kind', r.kind, 'pack_qty', r.pack_qty))
                      FROM nextore_reception_barcodes r WHERE r.product_id = i.product_id), '[]') AS reception_barcodes
     FROM boutique_order_items i
     JOIN nextore_products p ON p.product_id = i.product_id
     LEFT JOIN nextore_stock st ON st.product_id = i.product_id AND st.warehouse_id = $2
     WHERE i.order_id = $1
     ORDER BY i.added_at_reception, i.id`,
    [order.id, warehouseId]
  );

  const { rows: sessions } = await pool.query(
    `SELECT s.id, s.status, s.started_at, s.validated_at, s.nextore_reference, s.nextore_purchase_id, s.last_error,
            (SELECT name FROM users u WHERE u.email = s.started_by LIMIT 1) AS started_by_name,
            (SELECT name FROM users u WHERE u.email = s.validated_by LIMIT 1) AS validated_by_name,
            COALESCE((SELECT json_agg(json_build_object(
                        'order_item_id', c.order_item_id, 'units_counted', c.units_counted,
                        'units_expected', c.units_expected, 'motif', c.motif))
                      FROM boutique_reception_counts c WHERE c.session_id = s.id), '[]') AS counts
     FROM boutique_reception_sessions s
     WHERE s.order_id = $1 AND s.status <> 'abandoned'
     ORDER BY s.started_at`,
    [order.id]
  );

  return {
    order: { ...order, supplier_name: sup[0]?.company || null },
    items,
    session: sessions.find((s) => s.status === 'counting' || s.status === 'sending') || null,
    history: sessions.filter((s) => s.status === 'validated'),
  };
}

/**
 * Complète une commande ouverte (même document réimporté, comme le complément
 * du site) : seuls les produits absents de la commande y sont ajoutés.
 */
async function addItems(orderId, warehouseId, lines) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = await getOrderRow(orderId, warehouseId, client, true);
    if (order.status !== 'open') throw httpError(400, 'Cette commande est close');
    const { rows } = await client.query('SELECT product_id FROM boutique_order_items WHERE order_id = $1', [order.id]);
    const present = new Set(rows.map((r) => r.product_id));
    const added = [];
    const alreadyPresent = [];
    for (const l of lines) {
      const pid = String(l.product_id);
      if (present.has(pid)) { alreadyPresent.push(pid); continue; }
      await client.query(
        `INSERT INTO boutique_order_items (order_id, product_id, supplier_sku, pack_qty, qty_ordered, unit_cost)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, pid, l.supplier_sku || null, Math.max(parseInt(l.pack, 10) || 1, 1), parseInt(l.quantity, 10), Number(l.unit_cost) || 0]
      );
      present.add(pid);
      added.push(pid);
    }
    await client.query('COMMIT');
    return { orderId: order.id, reference: order.reference, added, already_present: alreadyPresent };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Supprime une commande sur laquelle rien n'a été reçu (ses pièces seraient déjà en stock Nextore). */
async function deleteOrder(orderId, warehouseId) {
  const order = await getOrderRow(orderId, warehouseId);
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM boutique_order_items WHERE order_id = $1 AND qty_received > 0) AS received,
            EXISTS (SELECT 1 FROM boutique_reception_sessions WHERE order_id = $1 AND status = 'validated') AS validated,
            EXISTS (SELECT 1 FROM boutique_reception_sessions WHERE order_id = $1 AND status IN ('counting', 'sending')) AS open`,
    [order.id]
  );
  if (rows[0].received || rows[0].validated) {
    throw httpError(400, 'Cette commande a déjà été réceptionnée : soldez ses lignes restantes à la réception');
  }
  if (rows[0].open) throw httpError(400, 'Une réception est en cours : abandonnez-la d\'abord');
  await pool.query('DELETE FROM boutique_orders WHERE id = $1', [order.id]);
}

/**
 * Modifie une commande ouverte : référence, et lignes = liste complète
 * [{ id?, product_id, qty_ordered, unit_cost }] (sans id = ajout, absente = retrait).
 * Pas pendant une réception : le comptage porte sur les lignes. Une quantité ne
 * descend pas sous le reçu ; une ligne reçue ou présente dans l'historique ne se
 * retire pas (on la solde à la réception). unit_cost vide sur un ajout = dernier
 * coût payé chez ce fournisseur, sinon coût de la fiche.
 */
async function updateOrder(orderId, warehouseId, { reference, lines }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Verrou sur la commande : une réception ne s'ouvre pas pendant la modification
    const order = await getOrderRow(orderId, warehouseId, client, true);
    if (order.status !== 'open') throw httpError(400, 'Cette commande est close');
    const { rows: open } = await client.query(
      "SELECT 1 FROM boutique_reception_sessions WHERE order_id = $1 AND status IN ('counting', 'sending')",
      [order.id]
    );
    if (open.length) throw httpError(400, 'Une réception est en cours : terminez-la ou abandonnez-la avant de modifier la commande');
    const ref = String(reference || '').trim();
    if (!ref) throw httpError(400, 'Référence requise');
    if (!Array.isArray(lines) || !lines.length) throw httpError(400, 'Une commande garde au moins une ligne');

    const { rows: current } = await client.query(
      `SELECT i.*, EXISTS (SELECT 1 FROM boutique_reception_counts c
                           JOIN boutique_reception_sessions s ON s.id = c.session_id
                           WHERE c.order_item_id = i.id AND s.status = 'validated') AS has_history,
              p.name
       FROM boutique_order_items i JOIN nextore_products p ON p.product_id = i.product_id
       WHERE i.order_id = $1`,
      [order.id]
    );
    const byId = new Map(current.map((i) => [i.id, i]));
    const kept = new Set();
    const productIds = new Set();

    for (const l of lines) {
      const qty = Number(l.qty_ordered);
      if (!Number.isInteger(qty) || qty < 0) throw httpError(400, 'Quantité invalide : un nombre entier de pièces est attendu');
      const cost = l.unit_cost === null || l.unit_cost === undefined || l.unit_cost === '' ? null : Number(l.unit_cost);
      if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw httpError(400, 'Coût invalide');
      if (l.id) {
        const cur = byId.get(parseInt(l.id, 10));
        if (!cur) throw httpError(400, `Ligne ${l.id} absente de cette commande`);
        if (qty < cur.qty_received) throw httpError(400, `${cur.name} : déjà ${cur.qty_received} pièce(s) reçue(s), la quantité ne peut pas descendre en dessous`);
        kept.add(cur.id);
        productIds.add(cur.product_id);
        // Quantité changée : la ligne redevient attendue, même si un motif l'avait soldée
        await client.query(
          `UPDATE boutique_order_items
           SET qty_ordered = $2, unit_cost = COALESCE($3, unit_cost),
               closed_reason = CASE WHEN qty_ordered = $2 THEN closed_reason ELSE NULL END
           WHERE id = $1`,
          [cur.id, qty, cost]
        );
      } else {
        const pid = String(l.product_id || '');
        if (productIds.has(pid) || current.some((c) => c.product_id === pid)) {
          throw httpError(400, 'Ce produit est déjà sur la commande : modifiez sa ligne');
        }
        if (qty <= 0) throw httpError(400, 'Une ligne ajoutée doit compter au moins une pièce');
        const { rows } = await client.query(
          `INSERT INTO boutique_order_items (order_id, product_id, qty_ordered, unit_cost)
           SELECT $1, p.product_id, $3,
                  COALESCE($4::numeric,
                    (SELECT pi.unit_cost FROM nextore_purchase_items pi
                     WHERE pi.product_id = p.product_id AND pi.supplier_id = $5
                       AND pi.quantity_received > 0 AND pi.unit_cost > 0
                     ORDER BY pi.purchased_at DESC, pi.id DESC LIMIT 1),
                    p.cost, 0)
           FROM nextore_products p WHERE p.product_id = $2
           RETURNING id`,
          [order.id, pid, qty, cost, order.supplier_id]
        );
        if (!rows[0]) throw httpError(404, `Produit Nextore introuvable (${pid})`);
        productIds.add(pid);
      }
    }

    for (const cur of current.filter((c) => !kept.has(c.id))) {
      if (cur.qty_received > 0 || cur.has_history) {
        throw httpError(400, `${cur.name} a déjà été réceptionné : soldez la ligne à la réception au lieu de la retirer`);
      }
      await client.query('DELETE FROM boutique_order_items WHERE id = $1', [cur.id]);
    }

    await client.query('UPDATE boutique_orders SET reference = $2 WHERE id = $1', [order.id, ref]);
    // Plus rien d'attendu (lignes restantes retirées) : la commande est close
    const { rows: left } = await client.query(
      `SELECT COALESCE(SUM(${REMAINING_SQL}), 0)::int AS remaining, BOOL_OR(i.qty_received > 0) AS received
       FROM boutique_order_items i WHERE i.order_id = $1`,
      [order.id]
    );
    if (left[0].remaining === 0 && left[0].received) {
      await client.query("UPDATE boutique_orders SET status = 'received', closed_at = NOW() WHERE id = $1", [order.id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getOrder(orderId, warehouseId);
}

// --- Réception --------------------------------------------------------------

async function getSessionForShop(sessionId, warehouseId, db = pool) {
  const { rows } = await db.query(
    `SELECT s.*, o.warehouse_id, o.supplier_id, o.reference, o.status AS order_status
     FROM boutique_reception_sessions s
     JOIN boutique_orders o ON o.id = s.order_id
     WHERE s.id = $1 AND o.warehouse_id = $2`,
    [parseInt(sessionId, 10), warehouseId]
  );
  if (!rows[0]) throw httpError(404, 'Réception introuvable dans cette boutique');
  return rows[0];
}

const assertCounting = (session) => {
  if (session.status === 'sending') throw httpError(409, 'Cette réception est en cours d\'envoi à Nextore');
  if (session.status !== 'counting') throw httpError(400, 'Cette réception est close');
};

/** Ouvre une réception, ou rend celle en cours. */
async function openSession(orderId, warehouseId, userEmail) {
  const order = await getOrderRow(orderId, warehouseId);
  if (order.status !== 'open') throw httpError(400, 'Cette commande est close');
  const { rows: open } = await pool.query(
    "SELECT * FROM boutique_reception_sessions WHERE order_id = $1 AND status IN ('counting', 'sending')",
    [order.id]
  );
  if (open[0]) {
    // Envoi interrompu : on tranche avec Nextore avant de rendre la main
    if (open[0].status === 'sending') await reconcileSending(open[0], warehouseId);
    return getOrder(order.id, warehouseId);
  }
  // Même verrou que updateOrder : on n'ouvre pas une réception sur une commande en cours de modification
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await getOrderRow(order.id, warehouseId, client, true);
    if (locked.status !== 'open') throw httpError(400, 'Cette commande est close');
    await client.query(
      'INSERT INTO boutique_reception_sessions (order_id, started_by) VALUES ($1, $2)',
      [order.id, userEmail || null]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getOrder(order.id, warehouseId);
}

/** Pose le nombre de pièces comptées d'une ligne (valeur absolue, pas un delta). */
async function setCount(sessionId, warehouseId, itemId, units) {
  const session = await getSessionForShop(sessionId, warehouseId);
  assertCounting(session);
  const n = parseInt(units, 10);
  if (!Number.isInteger(n) || n < 0) throw httpError(400, 'Quantité invalide');
  const { rowCount } = await pool.query(
    'SELECT 1 FROM boutique_order_items WHERE id = $1 AND order_id = $2',
    [parseInt(itemId, 10), session.order_id]
  );
  if (!rowCount) throw httpError(404, 'Ligne introuvable sur cette commande');
  await pool.query(
    `INSERT INTO boutique_reception_counts (session_id, order_item_id, units_counted)
     VALUES ($1, $2, $3)
     ON CONFLICT (session_id, order_item_id) DO UPDATE SET units_counted = EXCLUDED.units_counted`,
    [session.id, parseInt(itemId, 10), n]
  );
  return { order_item_id: parseInt(itemId, 10), units_counted: n };
}

/**
 * Ajoute à la commande un article absent du bon (qté commandée 0). Coût : le
 * dernier payé chez ce fournisseur, sinon le coût de la fiche Nextore.
 */
async function addLine(sessionId, warehouseId, productId) {
  const session = await getSessionForShop(sessionId, warehouseId);
  assertCounting(session);
  const { rows: prod } = await pool.query('SELECT product_id FROM nextore_products WHERE product_id = $1', [String(productId)]);
  if (!prod[0]) throw httpError(404, `Produit Nextore introuvable (${productId})`);
  const { rows: existing } = await pool.query(
    'SELECT id FROM boutique_order_items WHERE order_id = $1 AND product_id = $2 LIMIT 1',
    [session.order_id, String(productId)]
  );
  if (existing[0]) return { id: existing[0].id, existed: true };
  const { rows } = await pool.query(
    `INSERT INTO boutique_order_items (order_id, product_id, qty_ordered, unit_cost, added_at_reception)
     SELECT $1, p.product_id, 0,
            COALESCE(
              (SELECT pi.unit_cost FROM nextore_purchase_items pi
               WHERE pi.product_id = p.product_id AND pi.supplier_id = $3
                 AND pi.quantity_received > 0 AND pi.unit_cost > 0
               ORDER BY pi.purchased_at DESC, pi.id DESC LIMIT 1),
              p.cost, 0),
            TRUE
     FROM nextore_products p WHERE p.product_id = $2
     RETURNING id`,
    [session.order_id, String(productId), session.supplier_id]
  );
  return { id: rows[0].id, existed: false };
}

async function abandonSession(sessionId, warehouseId) {
  const session = await getSessionForShop(sessionId, warehouseId);
  assertCounting(session);
  await pool.query("UPDATE boutique_reception_sessions SET status = 'abandoned' WHERE id = $1", [session.id]);
}

/**
 * Rattache (code inconnu) ou confirme (unité / carton) un code-barres, chez nous.
 */
async function saveBarcode({ barcode, productId, kind, packQty, userEmail }) {
  const code = String(barcode || '').trim();
  if (!code) throw httpError(400, 'Code-barres vide');
  if (!['unit', 'carton'].includes(kind)) throw httpError(400, 'Type de code invalide');
  const pack = kind === 'carton' ? Math.max(parseInt(packQty, 10) || 1, 1) : 1;
  await pool.query(
    `INSERT INTO nextore_reception_barcodes (barcode, product_id, kind, pack_qty, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (barcode, product_id) DO UPDATE SET kind = EXCLUDED.kind, pack_qty = EXCLUDED.pack_qty`,
    [code, String(productId), kind, pack, userEmail || null]
  );
  return { barcode: code, kind, pack_qty: pack };
}

/** Lignes de la session, avec le reste attendu et le compté. */
async function sessionLines(sessionId, orderId, db) {
  const { rows } = await db.query(
    `SELECT i.id, i.product_id, i.supplier_sku, i.unit_cost::float AS unit_cost,
            ${REMAINING_SQL}::int AS remaining, p.name,
            COALESCE(c.units_counted, 0) AS units_counted
     FROM boutique_order_items i
     JOIN nextore_products p ON p.product_id = i.product_id
     LEFT JOIN boutique_reception_counts c ON c.order_item_id = i.id AND c.session_id = $1
     WHERE i.order_id = $2
     ORDER BY i.id`,
    [sessionId, orderId]
  );
  return rows;
}

/** Lignes d'achat Nextore portant cette référence (datées d'aujourd'hui). */
async function findNextorePurchase(reference) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const items = await api.getReceivedPurchaseItems(today, today);
  const mine = (Array.isArray(items) ? items : []).filter((x) => x.purchase_reference === reference);
  return mine.length ? mine[0].purchase_id : null;
}

/**
 * Enregistre chez nous une réception que Nextore a acceptée : cumul reçu,
 * lignes soldées par motif, commande close s'il ne reste rien.
 */
async function finalizeSession(session, purchaseId, userEmail) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: counts } = await client.query(
      'SELECT order_item_id, units_counted, motif FROM boutique_reception_counts WHERE session_id = $1',
      [session.id]
    );
    for (const c of counts) {
      await client.query(
        `UPDATE boutique_order_items
         SET qty_received = qty_received + $2,
             closed_reason = CASE WHEN $3::text = ANY($4::text[]) THEN $3 ELSE closed_reason END
         WHERE id = $1`,
        [c.order_item_id, c.units_counted, c.motif, CLOSING_MOTIFS]
      );
    }
    await client.query(
      `UPDATE boutique_reception_sessions
       SET status = 'validated', validated_by = $2, validated_at = NOW(), nextore_purchase_id = $3, last_error = NULL
       WHERE id = $1`,
      [session.id, userEmail || session.validated_by || null, purchaseId]
    );
    const { rows: left } = await client.query(
      `SELECT COALESCE(SUM(${REMAINING_SQL}), 0)::int AS remaining FROM boutique_order_items i WHERE i.order_id = $1`,
      [session.order_id]
    );
    if (left[0].remaining === 0) {
      await client.query("UPDATE boutique_orders SET status = 'received', closed_at = NOW() WHERE id = $1", [session.order_id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Session restée en 'sending' (envoi interrompu) : si Nextore a l'achat, on
 * l'enregistre ; sinon on rend le comptage pour un nouvel essai.
 */
async function reconcileSending(session, warehouseId) {
  const purchaseId = session.nextore_reference ? await findNextorePurchase(session.nextore_reference) : null;
  if (purchaseId) {
    await finalizeSession({ ...session, warehouse_id: warehouseId }, purchaseId, session.validated_by);
    return true;
  }
  await pool.query("UPDATE boutique_reception_sessions SET status = 'counting' WHERE id = $1", [session.id]);
  return false;
}

/**
 * Valide la réception : contrôle des motifs, verrou 'sending', achat REÇU
 * dans Nextore (pièces comptées, surplus compris), puis enregistrement chez nous.
 * motifs = { [order_item_id]: 'reliquat'|'solde'|'manquant'|'erreur_saisie' }.
 * Rien de compté mais tout justifié = clôture sans envoi (reliquat jamais livré).
 */
async function validateSession(sessionId, warehouse, motifs, userEmail) {
  const client = await pool.connect();
  let session;
  let toSend;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT s.*, o.supplier_id, o.reference
       FROM boutique_reception_sessions s
       JOIN boutique_orders o ON o.id = s.order_id
       WHERE s.id = $1 AND o.warehouse_id = $2
       FOR UPDATE OF s`,
      [parseInt(sessionId, 10), warehouse.id]
    );
    session = rows[0];
    if (!session) throw httpError(404, 'Réception introuvable dans cette boutique');
    assertCounting(session);

    const lines = await sessionLines(session.id, session.order_id, client);
    const motifById = new Map();
    for (const [id, m] of Object.entries(motifs || {})) {
      if (!m) continue;
      if (!MOTIFS.includes(m)) throw httpError(400, `Motif inconnu : « ${m} »`);
      motifById.set(parseInt(id, 10), m);
    }
    const missing = lines.filter((l) => l.units_counted < l.remaining);
    const noMotif = missing.filter((l) => !motifById.has(l.id));
    if (noMotif.length) {
      throw httpError(400, 'Il manque un motif (reliquat, soldé, manquant ou erreur de saisie) pour : '
        + noMotif.map((l) => l.supplier_sku || l.name).join(', '));
    }
    toSend = lines.filter((l) => l.units_counted > 0);
    // Sans pièce comptée, seule une clôture (soldé, manquant, erreur) a un sens :
    // une réception vide « reliquat » ne changerait rien
    if (!toSend.length && !missing.some((l) => CLOSING_MOTIFS.includes(motifById.get(l.id)))) {
      throw httpError(400, 'Aucune pièce comptée : il n\'y a rien à réceptionner');
    }

    // Historique : reste attendu et motif, figés au moment de la validation
    for (const l of lines) {
      if (l.units_counted === 0 && !motifById.has(l.id)) continue;
      await client.query(
        `INSERT INTO boutique_reception_counts (session_id, order_item_id, units_counted, units_expected, motif)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (session_id, order_item_id)
         DO UPDATE SET units_expected = EXCLUDED.units_expected, motif = EXCLUDED.motif`,
        [session.id, l.id, l.units_counted, l.remaining, l.units_counted < l.remaining ? motifById.get(l.id) : null]
      );
    }

    if (toSend.length) {
      const { rows: done } = await client.query(
        "SELECT COUNT(*)::int AS n FROM boutique_reception_sessions WHERE order_id = $1 AND status = 'validated' AND nextore_reference IS NOT NULL",
        [session.order_id]
      );
      session.nextore_reference = done[0].n > 0 ? `${session.reference}-R${done[0].n + 1}` : session.reference;
      // Verrou AVANT l'appel : un second clic trouve 'sending' et s'arrête
      await client.query(
        "UPDATE boutique_reception_sessions SET status = 'sending', nextore_reference = $2, validated_by = $3 WHERE id = $1",
        [session.id, session.nextore_reference, userEmail || null]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  let purchaseId = null;
  if (toSend.length) {
    try {
      purchaseId = await api.createPurchase({
        referenceNo: session.nextore_reference,
        status: 'received',
        supplierId: session.supplier_id,
        warehouseId: warehouse.id,
        items: toSend.map((l) => ({
          product_id: l.product_id,
          net_unit_cost: Number(l.unit_cost).toFixed(4),
          quantity: String(l.units_counted),
        })),
      });
    } catch (err) {
      // On ne sait pas si Nextore l'a enregistré : on vérifie avant de rendre la main
      const found = await findNextorePurchase(session.nextore_reference).catch(() => null);
      if (!found) {
        await pool.query(
          "UPDATE boutique_reception_sessions SET status = 'counting', last_error = $2 WHERE id = $1",
          [session.id, err.message]
        );
        throw httpError(502, `Nextore a refusé la réception, rien n'a été mis en stock : ${err.message}`);
      }
      purchaseId = found;
    }
  }

  await finalizeSession(session, purchaseId ? String(purchaseId) : null, userEmail);
  const detail = await getOrder(session.order_id, warehouse.id);
  return {
    nextore_reference: toSend.length ? session.nextore_reference : null,
    nextore_purchase_id: purchaseId ? String(purchaseId) : null,
    pieces: toSend.reduce((a, l) => a + l.units_counted, 0),
    ...detail,
    received_session_id: session.id,
  };
}

module.exports = {
  MOTIFS,
  makeReference,
  createOrder,
  addItems,
  listOrders,
  getOrder,
  deleteOrder,
  updateOrder,
  openSession,
  setCount,
  addLine,
  abandonSession,
  saveBarcode,
  validateSession,
};
