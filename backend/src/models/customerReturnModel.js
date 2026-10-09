/**
 * Retours client (lot 1) — cadrage validé avec Pierre le 09/10/2026.
 *
 * Un retour naît d'un ticket ou d'une commande, sur des lignes de commande.
 * À la validation (au PC, colis en main), l'opérateur SAV répartit chaque
 * pièce : remise en stock (mouvement BMS « retour produit » vers Entrepot),
 * SAV fournisseur (stock SAV chez nous, exporté au renvoi), ou rien.
 * L'issue client (renvoi, points, remboursement) se saisit à part : on peut
 * renvoyer avant d'avoir reçu le colis.
 *
 * ⚠️ Les RMA BMS ne doivent plus servir : un RMA clôturé remet lui aussi le
 * produit en stock, la pièce y entrerait deux fois.
 */

const ExcelJS = require('exceljs');
const pool = require('../config/database');
const bmsApiModel = require('./bmsApiModel');
const savModel = require('./savModel');
const { BMS_WAREHOUSE_ID, findBmsProductId, findMovementId } = require('./pdaProductModel');
const {
  REASONS, OUTCOMES, unitPaid, bundleParents, expandSelection, checkDestination, returnStatus, suggestSupplier,
} = require('../services/returnRules');

const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status });

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Note interne dans le ticket du retour : l'agent voit où en est le retour sans quitter le ticket. */
const noteTicket = async (ticketId, user, lines) => {
  if (!ticketId) return;
  try {
    await savModel.addMessage(ticketId, {
      from: user.name || user.email,
      body: lines.map(l => `<p>${l}</p>`).join(''),
      is_agent: true,
      is_private: true,
    });
  } catch (error) {
    console.error(`[Retours] Note du ticket #${ticketId} non écrite :`, error.message);
  }
};

// ── Commande ────────────────────────────────────────────────────────────────

const ORDER_SQL = `
  SELECT o.wp_order_id, o.post_date, o.paid_date, o.post_status, o.order_total, o.shipping_method,
         o.billing_first_name, o.billing_last_name, o.billing_email
    FROM orders o WHERE o.wp_order_id = $1`;

/** Lignes de la commande, avec ce qui reste retournable (retours annulés exclus). */
const orderLines = async (wpOrderId) => {
  const { rows } = await pool.query(
    `SELECT oi.order_item_id, oi.order_item_name AS name, oi.product_id, oi.variation_id, oi.qty,
            oi.line_total, oi.line_tax,
            p.id AS catalog_id, p.sku, p.product_type, p.woosb_ids,
            COALESCE(p.image_url, pp.image_url) AS image_url,
            COALESCE(ret.qty, 0)::int AS returned
       FROM order_items oi
       LEFT JOIN products p ON p.wp_product_id = COALESCE(NULLIF(oi.variation_id, 0), oi.product_id)
       LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id
       LEFT JOIN (
         SELECT l.order_item_id, SUM(l.qty) AS qty
           FROM customer_return_lines l
           JOIN customer_returns r ON r.id = l.return_id
          WHERE r.wp_order_id = $1 AND r.cancelled_at IS NULL
          GROUP BY l.order_item_id
       ) ret ON ret.order_item_id = oi.order_item_id
      WHERE oi.wp_order_id = $1 AND oi.order_item_type = 'line_item'
      ORDER BY oi.order_item_id`,
    [wpOrderId]
  );
  return rows.map(r => ({
    ...r,
    order_item_id: Number(r.order_item_id),
    qty: Number(r.qty) || 0,
    unit_paid: unitPaid(r),
    returnable: Math.max(0, (Number(r.qty) || 0) - r.returned),
  }));
};

const LIST_SQL = `
  SELECT r.id, r.wp_order_id, r.ticket_id, r.reason, r.return_required, r.status, r.outcome, r.outcome_ref,
         r.created_at, r.received_at, r.treated_at, r.cancelled_at,
         o.billing_first_name, o.billing_last_name, o.billing_email,
         uc.name AS created_by_name,
         (SELECT COALESCE(SUM(l.qty), 0)::int FROM customer_return_lines l
           WHERE l.return_id = r.id AND NOT l.is_bundle) AS pieces
    FROM customer_returns r
    LEFT JOIN orders o ON o.wp_order_id = r.wp_order_id
    LEFT JOIN users uc ON uc.id = r.created_by`;

/** De quoi ouvrir la pop-up de création : la commande, ses lignes, ses retours. */
const orderContext = async (wpOrderId) => {
  const { rows: [order] } = await pool.query(ORDER_SQL, [wpOrderId]);
  if (!order) throw httpError(404, `Commande ${wpOrderId} absente de notre base.`);
  const lines = await orderLines(wpOrderId);
  const { rows: returns } = await pool.query(`${LIST_SQL} WHERE r.wp_order_id = $1 ORDER BY r.created_at DESC`, [wpOrderId]);
  const parents = bundleParents(lines);
  return {
    order,
    lines: lines.map(l => ({
      orderItemId: l.order_item_id,
      name: l.name,
      sku: l.sku,
      imageUrl: l.image_url,
      productType: l.product_type,
      qty: l.qty,
      returnable: l.returnable,
      unitPaid: l.unit_paid,
      bundleOf: parents.get(l.order_item_id) || null,
    })),
    returns,
  };
};

// ── Création ────────────────────────────────────────────────────────────────

const create = async ({ wpOrderId, ticketId, reason, returnRequired, outcome, note, selection }, user) => {
  if (!REASONS[reason]) throw httpError(400, 'Motif inconnu.');
  if (outcome && !OUTCOMES[outcome]) throw httpError(400, 'Issue inconnue.');
  const { rows: [order] } = await pool.query(ORDER_SQL, [wpOrderId]);
  if (!order) throw httpError(404, `Commande ${wpOrderId} absente de notre base.`);
  if (ticketId) {
    const { rowCount } = await pool.query('SELECT 1 FROM sav_tickets WHERE id = $1', [ticketId]);
    if (!rowCount) throw httpError(404, `Ticket #${ticketId} introuvable.`);
  }

  const picks = expandSelection(await orderLines(wpOrderId), selection);

  const client = await pool.connect();
  let returnId;
  try {
    await client.query('BEGIN');
    const { rows: [r] } = await client.query(
      `INSERT INTO customer_returns (wp_order_id, ticket_id, reason, return_required, outcome, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [wpOrderId, ticketId || null, reason, returnRequired !== false, outcome || null, String(note || '').trim() || null, user.id]
    );
    returnId = r.id;
    // Le pack passe avant ses composants (expandSelection les range ainsi).
    const lineIds = new Map();
    for (const { line, qty, bundleOf } of picks) {
      const { rows: [l] } = await client.query(
        `INSERT INTO customer_return_lines
           (return_id, order_item_id, product_id, sku, name, qty, unit_paid, is_bundle, bundle_line_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [returnId, line.order_item_id, line.catalog_id, line.sku, line.name, qty, line.unit_paid,
          line.product_type === 'woosb', bundleOf ? lineIds.get(bundleOf) : null]
      );
      lineIds.set(line.order_item_id, l.id);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await noteTicket(ticketId, user, [
    `<strong>Retour n°${returnId} créé</strong> — ${escapeHtml(REASONS[reason])}${returnRequired === false ? ' (sans retour du produit)' : ''}`,
    ...picks.filter(p => !p.bundleOf).map(p => `${p.qty} × ${escapeHtml(p.line.name)}`),
  ]);
  return get(returnId);
};

// ── Lecture ─────────────────────────────────────────────────────────────────

const list = async ({ status, q } = {}) => {
  const where = [];
  const params = [];
  if (status) {
    params.push(status);
    where.push(`r.status = $${params.length}`);
  }
  const term = String(q || '').trim();
  if (term) {
    params.push(`%${term}%`, term);
    const p = `$${params.length - 1}`;
    where.push(`(r.wp_order_id::text LIKE ${p} OR r.id::text = $${params.length}
                 OR (o.billing_first_name || ' ' || o.billing_last_name) ILIKE ${p} OR o.billing_email ILIKE ${p})`);
  }
  const { rows } = await pool.query(
    `${LIST_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.created_at DESC LIMIT 500`,
    params
  );
  const { rows: counts } = await pool.query('SELECT status, COUNT(*)::int AS n FROM customer_returns GROUP BY status');
  return { returns: rows, counts: Object.fromEntries(counts.map(c => [c.status, c.n])) };
};

/** Fournisseurs chez qui la pièce a été achetée, le plus probable en tête. */
const supplierCandidates = async (productIds, paidAt) => {
  if (!productIds.length) return new Map();
  const { rows } = await pool.query(
    `SELECT DISTINCT poi.product_id, po.supplier_id, s.name,
            COALESCE(po.received_date, po.order_date) AS last_received
       FROM purchase_order_items poi
       JOIN purchase_orders po ON po.id = poi.purchase_order_id
       JOIN suppliers s ON s.id = po.supplier_id
      WHERE poi.product_id = ANY($1::int[])
        AND (poi.qty_received > 0 OR poi.units_received > 0)`,
    [productIds]
  );
  const byProduct = new Map();
  for (const id of productIds) {
    const lots = rows.filter(r => r.product_id === id);
    const suppliers = [];
    for (const lot of [...lots].sort((a, b) => new Date(b.last_received) - new Date(a.last_received))) {
      if (!suppliers.some(s => s.id === lot.supplier_id)) {
        suppliers.push({ id: lot.supplier_id, name: lot.name, lastReceived: lot.last_received });
      }
    }
    byProduct.set(id, { suppliers, suggested: suggestSupplier(lots, paidAt) });
  }
  return byProduct;
};

const get = async (id) => {
  const { rows: [r] } = await pool.query(
    `SELECT r.*, o.post_date, o.paid_date, o.post_status, o.order_total, o.shipping_method,
            o.billing_first_name, o.billing_last_name, o.billing_email,
            uc.name AS created_by_name, ur.name AS received_by_name, ut.name AS treated_by_name,
            ux.name AS cancelled_by_name, t.subject AS ticket_subject
       FROM customer_returns r
       LEFT JOIN orders o ON o.wp_order_id = r.wp_order_id
       LEFT JOIN users uc ON uc.id = r.created_by
       LEFT JOIN users ur ON ur.id = r.received_by
       LEFT JOIN users ut ON ut.id = r.treated_by
       LEFT JOIN users ux ON ux.id = r.cancelled_by
       LEFT JOIN sav_tickets t ON t.id = r.ticket_id
      WHERE r.id = $1`,
    [id]
  );
  if (!r) throw httpError(404, 'Retour introuvable.');

  const { rows: lines } = await pool.query(
    `SELECT l.*, s.name AS supplier_name, COALESCE(p.image_url, pp.image_url) AS image_url,
            i.status AS supplier_status
       FROM customer_return_lines l
       LEFT JOIN suppliers s ON s.id = l.supplier_id
       LEFT JOIN products p ON p.id = l.product_id
       LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id
       LEFT JOIN supplier_return_items i ON i.return_line_id = l.id
      WHERE l.return_id = $1
      ORDER BY l.id`,
    [id]
  );
  const productIds = [...new Set(lines.filter(l => !l.is_bundle && l.product_id).map(l => l.product_id))];
  const candidates = await supplierCandidates(productIds, r.paid_date || r.post_date);
  const { rows: suppliers } = await pool.query('SELECT id, name FROM suppliers WHERE is_active ORDER BY name');

  return {
    ...r,
    lines: lines.map(l => ({ ...l, supplierCandidates: candidates.get(l.product_id) || { suppliers: [], suggested: null } })),
    suppliers,
  };
};

// ── Validation (colis reçu) et remise en stock ──────────────────────────────

/**
 * Remet en stock dans BMS ce qui ne l'est pas encore. La ligne est RÉSERVÉE
 * avant l'appel (restocked_qty), pour qu'un double clic ne la fasse pas
 * entrer deux fois ; un échec BMS la libère et peut se relancer.
 */
const restock = async (id, user) => {
  const { rows: lines } = await pool.query(
    `SELECT l.*, r.wp_order_id FROM customer_return_lines l JOIN customer_returns r ON r.id = l.return_id
      WHERE l.return_id = $1 AND r.received_at IS NOT NULL AND l.restocked_qty < l.qty_restock
      ORDER BY l.id`,
    [id]
  );
  const errors = [];
  for (const line of lines) {
    const { rows: [claimed] } = await pool.query(
      `UPDATE customer_return_lines SET restocked_qty = qty_restock, restocked_at = NOW()
        WHERE id = $1 AND restocked_qty = $2 AND restocked_qty < qty_restock
        RETURNING qty_restock - $2::int AS qty`,
      [line.id, line.restocked_qty]
    );
    if (!claimed) continue;
    const qty = Number(claimed.qty);
    try {
      const comments = [`Retour n°${id}`, `cmd ${line.wp_order_id}`, user.name || user.email].join(' · ').slice(0, 100);
      const bmsProductId = await findBmsProductId(line.sku);
      const created = await bmsApiModel.apiCall('/v2/stock-movements', 'POST', {
        product_id: bmsProductId,
        to_warehouse_id: BMS_WAREHOUSE_ID,
        qty,
        category: 'product_return',
        comments,
      });
      const movementId = await findMovementId(created, bmsProductId, comments, qty);
      await pool.query('UPDATE customer_return_lines SET bms_movement_id = $2 WHERE id = $1', [line.id, movementId]);
    } catch (error) {
      await pool.query(
        'UPDATE customer_return_lines SET restocked_qty = $2, restocked_at = NULL WHERE id = $1',
        [line.id, line.restocked_qty]
      );
      console.error(`[Retours] Remise en stock BMS refusée (retour ${id}, ${line.sku}) :`, error.message);
      errors.push(`${line.name} : ${error.message}`);
    }
  }
  return errors;
};

/**
 * @param {Array<{lineId, restock, supplier, noRestock, supplierId, problem}>} destinations
 */
const validate = async (id, destinations, user) => {
  const { rows: [r] } = await pool.query('SELECT * FROM customer_returns WHERE id = $1', [id]);
  if (!r) throw httpError(404, 'Retour introuvable.');
  if (r.cancelled_at) throw httpError(400, 'Retour annulé.');
  if (r.received_at) throw httpError(400, 'Retour déjà validé.');

  const { rows: lines } = await pool.query(
    'SELECT * FROM customer_return_lines WHERE return_id = $1 AND NOT is_bundle ORDER BY id', [id]
  );
  const byLine = new Map((destinations || []).map(d => [Number(d.lineId), d]));
  const plan = lines.map(line => ({ line, d: byLine.get(line.id) || {}, ...checkDestination(line, byLine.get(line.id), r.return_required) }));

  const supplierIds = [...new Set(plan.filter(p => p.supplier).map(p => Number(p.d.supplierId)))];
  if (supplierIds.length) {
    const { rows } = await pool.query('SELECT id FROM suppliers WHERE id = ANY($1::int[])', [supplierIds]);
    if (rows.length !== supplierIds.length) throw httpError(400, 'Fournisseur inconnu.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `UPDATE customer_returns SET received_at = NOW(), received_by = $2
        WHERE id = $1 AND received_at IS NULL AND cancelled_at IS NULL`,
      [id, user.id]
    );
    if (!rowCount) throw httpError(409, 'Retour validé ou annulé entre-temps.');
    for (const p of plan) {
      await client.query(
        `UPDATE customer_return_lines
            SET qty_restock = $2, qty_supplier = $3, qty_no_restock = $4,
                supplier_id = $5, problem = $6
          WHERE id = $1`,
        [p.line.id, p.restock, p.supplier, p.noRestock,
          p.supplier ? Number(p.d.supplierId) : null, String(p.d.problem || '').trim() || null]
      );
      if (p.supplier) {
        await client.query(
          `INSERT INTO supplier_return_items
             (supplier_id, product_id, return_line_id, qty, reason, problem, unit_cost, created_by)
           SELECT $1, $2, $3, $4, $5, $6, COALESCE(p.computed_cost, p.wc_cog_cost), $7
             FROM products p WHERE p.id = $2`,
          [Number(p.d.supplierId), p.line.product_id, p.line.id, p.supplier, r.reason,
            String(p.d.problem).trim(), user.id]
        );
      }
    }
    await client.query(
      'UPDATE customer_returns SET status = $2 WHERE id = $1',
      [id, returnStatus({ ...r, received_at: new Date() })]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const restockErrors = await restock(id, user);

  const sum = (k) => plan.reduce((n, p) => n + p[k], 0);
  const parts = [];
  if (sum('restock')) parts.push(`${sum('restock')} remis en stock`);
  if (sum('supplier')) parts.push(`${sum('supplier')} en SAV fournisseur`);
  if (sum('noRestock')) parts.push(`${sum('noRestock')} non remis en stock`);
  await noteTicket(r.ticket_id, user, [
    `<strong>Retour n°${id} ${r.return_required ? 'reçu' : 'validé'}</strong> — ${parts.join(', ')}`,
    ...plan.filter(p => p.supplier).map(p => `SAV : ${p.supplier} × ${escapeHtml(p.line.name)} — ${escapeHtml(p.d.problem)}`),
  ]);

  return { ...(await get(id)), restockErrors };
};

const retryRestock = async (id, user) => ({ ...(await get(id)), restockErrors: await restock(id, user) });

// ── Issue client, annulation ────────────────────────────────────────────────

const treat = async (id, { outcome, outcomeRef }, user) => {
  if (!OUTCOMES[outcome]) throw httpError(400, 'Choisir l’issue.');
  const { rows: [r] } = await pool.query('SELECT * FROM customer_returns WHERE id = $1', [id]);
  if (!r) throw httpError(404, 'Retour introuvable.');
  if (r.cancelled_at) throw httpError(400, 'Retour annulé.');
  await pool.query(
    `UPDATE customer_returns
        SET outcome = $2, outcome_ref = $3, treated_at = COALESCE(treated_at, NOW()), treated_by = $4, status = $5
      WHERE id = $1`,
    [id, outcome, String(outcomeRef || '').trim() || null, user.id, returnStatus({ ...r, treated_at: new Date() })]
  );
  await noteTicket(r.ticket_id, user, [
    `<strong>Retour n°${id} — ${escapeHtml(OUTCOMES[outcome])}</strong>${outcomeRef ? ` : ${escapeHtml(outcomeRef)}` : ''}`,
  ]);
  return get(id);
};

const cancel = async (id, user) => {
  const { rows: [r] } = await pool.query(
    `UPDATE customer_returns SET cancelled_at = NOW(), cancelled_by = $2, status = 'annule'
      WHERE id = $1 AND received_at IS NULL AND cancelled_at IS NULL RETURNING ticket_id`,
    [id, user.id]
  );
  if (!r) throw httpError(400, 'Seul un retour pas encore validé peut être annulé.');
  await noteTicket(r.ticket_id, user, [`<strong>Retour n°${id} annulé</strong>`]);
  return get(id);
};

// ── Stock SAV fournisseur ───────────────────────────────────────────────────

const supplierSummary = async () => {
  const { rows } = await pool.query(
    `SELECT s.id, s.name,
            COUNT(*) FILTER (WHERE i.status = 'a_retourner')::int AS lines,
            COALESCE(SUM(i.qty) FILTER (WHERE i.status = 'a_retourner'), 0)::int AS pieces,
            COALESCE(SUM(i.qty * i.unit_cost) FILTER (WHERE i.status = 'a_retourner'), 0)::numeric(12,2) AS value,
            COUNT(*) FILTER (WHERE i.status = 'envoye')::int AS sent_lines
       FROM supplier_return_items i
       JOIN suppliers s ON s.id = i.supplier_id
      GROUP BY s.id, s.name
      ORDER BY lines DESC, s.name`
  );
  return rows;
};

const ITEMS_SQL = `
  SELECT i.id, i.supplier_id, i.product_id, i.qty, i.reason, i.problem, i.unit_cost, i.status, i.batch_id, i.created_at,
         p.sku, COALESCE(NULLIF(p.post_title, ''), l.name) AS name, ref.supplier_sku,
         l.return_id, r.wp_order_id, r.ticket_id
    FROM supplier_return_items i
    JOIN products p ON p.id = i.product_id
    JOIN customer_return_lines l ON l.id = i.return_line_id
    JOIN customer_returns r ON r.id = l.return_id
    LEFT JOIN LATERAL (
      SELECT sr.supplier_sku FROM supplier_refs sr
       WHERE sr.supplier_id = i.supplier_id AND sr.product_id = i.product_id
       ORDER BY sr.pack_qty, sr.id LIMIT 1
    ) ref ON true`;

const supplierItems = async (supplierId) => {
  const { rows: [supplier] } = await pool.query('SELECT id, name FROM suppliers WHERE id = $1', [supplierId]);
  if (!supplier) throw httpError(404, 'Fournisseur introuvable.');
  const { rows: items } = await pool.query(
    `${ITEMS_SQL} WHERE i.supplier_id = $1 AND i.status = 'a_retourner' ORDER BY i.created_at`, [supplierId]
  );
  const { rows: batches } = await pool.query(
    `SELECT b.id, b.status, b.created_at, u.name AS created_by_name,
            COUNT(i.id)::int AS lines, COALESCE(SUM(i.qty), 0)::int AS pieces,
            COALESCE(SUM(i.qty * i.unit_cost), 0)::numeric(12,2) AS value
       FROM supplier_return_batches b
       LEFT JOIN supplier_return_items i ON i.batch_id = b.id
       LEFT JOIN users u ON u.id = b.created_by
      WHERE b.supplier_id = $1
      GROUP BY b.id, u.name
      ORDER BY b.created_at DESC`,
    [supplierId]
  );
  return { supplier, items, batches };
};

/** Les lignes cochées partent au fournisseur : elles forment un renvoi. */
const createBatch = async (supplierId, itemIds, user) => {
  const ids = [...new Set((itemIds || []).map(Number).filter(Boolean))];
  if (!ids.length) throw httpError(400, 'Aucune ligne cochée.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id FROM supplier_return_items
        WHERE id = ANY($1::int[]) AND supplier_id = $2 AND status = 'a_retourner' FOR UPDATE`,
      [ids, supplierId]
    );
    if (rows.length !== ids.length) throw httpError(409, 'Des lignes ont changé entre-temps : recharger la page.');
    const { rows: [b] } = await client.query(
      'INSERT INTO supplier_return_batches (supplier_id, created_by) VALUES ($1, $2) RETURNING id',
      [supplierId, user.id]
    );
    await client.query(
      `UPDATE supplier_return_items SET status = 'envoye', batch_id = $2 WHERE id = ANY($1::int[])`,
      [ids, b.id]
    );
    await client.query('COMMIT');
    return { batchId: b.id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const exportBatch = async (batchId) => {
  const { rows: [b] } = await pool.query(
    `SELECT b.*, s.name AS supplier_name FROM supplier_return_batches b JOIN suppliers s ON s.id = b.supplier_id
      WHERE b.id = $1`,
    [batchId]
  );
  if (!b) throw httpError(404, 'Renvoi introuvable.');
  const { rows: items } = await pool.query(`${ITEMS_SQL} WHERE i.batch_id = $1 ORDER BY name`, [batchId]);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Retour fournisseur');
  ws.columns = [
    { header: 'Réf. fournisseur', key: 'ref', width: 18 },
    { header: 'SKU', key: 'sku', width: 16 },
    { header: 'Produit', key: 'name', width: 50 },
    { header: 'Quantité', key: 'qty', width: 10 },
    { header: 'Motif', key: 'reason', width: 22 },
    { header: 'Problème', key: 'problem', width: 50 },
    { header: 'Commande client', key: 'order', width: 16 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Coût unitaire HT', key: 'cost', width: 16 },
    { header: 'Total HT', key: 'total', width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const i of items) {
    const cost = i.unit_cost == null ? null : Number(i.unit_cost);
    ws.addRow({
      ref: i.supplier_sku || '',
      sku: i.sku || '',
      name: i.name,
      qty: i.qty,
      reason: REASONS[i.reason] || i.reason,
      problem: i.problem || '',
      order: Number(i.wp_order_id),
      date: new Date(i.created_at),
      cost,
      total: cost == null ? null : Math.round(cost * i.qty * 100) / 100,
    });
  }
  ws.getColumn('date').numFmt = 'dd/mm/yyyy';
  ws.getColumn('cost').numFmt = '#,##0.00 €';
  ws.getColumn('total').numFmt = '#,##0.00 €';

  const safe = b.supplier_name.replace(/[^\w-]+/g, '_');
  return { buffer: await wb.xlsx.writeBuffer(), filename: `retour_${safe}_n${b.id}.xlsx` };
};

module.exports = {
  orderContext,
  create,
  list,
  get,
  validate,
  retryRestock,
  treat,
  cancel,
  supplierSummary,
  supplierItems,
  createBatch,
  exportBatch,
};
