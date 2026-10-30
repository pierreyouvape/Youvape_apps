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
const { saveAttachments } = require('../utils/savAttachments');
const orderModel = require('./orderModel');
const { BMS_WAREHOUSE_ID, findBmsProductId, findMovementId, readBmsStock } = require('./pdaProductModel');
const { wcRequest, fetchWcOrder, importOrder, metaOf, relayPointOf } = require('../services/wcOrderImportService');
const loyaltyService = require('../services/loyaltyService');
const shipmentController = require('../controllers/shipmentController');
const shippingMethodMapModel = require('./shippingMethodMapModel');
const shipmentLabelModel = require('./shipmentLabelModel');
const { getAdapter } = require('../services/carriers');
const { getAccount } = require('../services/carriers/accounts');
const mondialRelayAdapter = require('../services/carriers/mondialRelayAdapter');
const { WAREHOUSE_BY_ID } = require('../config/nextore');
const { BMS_SANS_DOUBLON } = require('../services/bmsShipmentSyncService');
const { createTicket } = require('./pickingPackingModel');
const {
  REASONS, LOST_REASON, ORDER_TICKET_REASONS, OUTCOMES, unitPaid, bundleParents, expandSelection, checkDestination, returnStatus, suggestSupplier,
  lotRemaining, checkLot, suggestLot,
  suggestPoints, replacementShipping, relayNetwork, pickRefund, pointsBreakdown, breakdownText,
} = require('../services/returnRules');

const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status });

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Note interne dans le ticket du retour : l'agent voit où en est le retour sans quitter le ticket. */
const noteTicket = async (ticketId, user, lines, files = []) => {
  if (!ticketId) return;
  try {
    await savModel.addMessage(ticketId, {
      from: user.name || user.email,
      body: lines.map(l => `<p>${l}</p>`).join(''),
      is_agent: true,
      is_private: true,
      // Même rangement que les pièces jointes d'un message (utils/savAttachments).
      attachments: saveAttachments(ticketId, files),
    });
  } catch (error) {
    console.error(`[Retours] Note du ticket #${ticketId} non écrite :`, error.message);
  }
};

// ── Commande ────────────────────────────────────────────────────────────────

const ORDER_SQL = `
  SELECT o.wp_order_id, o.post_date, o.paid_date, o.post_status, o.order_total, o.shipping_method,
         o.billing_first_name, o.billing_last_name, o.billing_email, o.billing_phone
    FROM orders o WHERE o.wp_order_id = $1`;

/**
 * Lignes de la commande, avec ce qui reste retournable (retours annulés exclus).
 * `excludeReturnId` : le retour qu'on modifie ne compte pas contre lui-même.
 */
const orderLines = async (wpOrderId, excludeReturnId = null) => {
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
            AND ($2::int IS NULL OR r.id <> $2::int)
          GROUP BY l.order_item_id
       ) ret ON ret.order_item_id = oi.order_item_id
      WHERE oi.wp_order_id = $1 AND oi.order_item_type = 'line_item'
      ORDER BY oi.order_item_id`,
    [wpOrderId, excludeReturnId]
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
         (r.label_data IS NOT NULL) AS has_label, r.label_tracking, r.label_format,
         o.billing_first_name, o.billing_last_name, o.billing_email,
         uc.name AS created_by_name,
         (SELECT COALESCE(SUM(l.qty), 0)::int FROM customer_return_lines l
           WHERE l.return_id = r.id AND NOT l.is_bundle) AS pieces
    FROM customer_returns r
    LEFT JOIN orders o ON o.wp_order_id = r.wp_order_id
    LEFT JOIN users uc ON uc.id = r.created_by`;

/** De quoi ouvrir la pop-up de création : la commande, ses lignes, ses retours. */
const orderContext = async (wpOrderId, excludeReturnId = null) => {
  const { rows: [order] } = await pool.query(ORDER_SQL, [wpOrderId]);
  if (!order) throw httpError(404, `Commande ${wpOrderId} absente de notre base.`);
  const lines = await orderLines(wpOrderId, excludeReturnId);
  const { rows: returns } = await pool.query(`${LIST_SQL} WHERE r.wp_order_id = $1 ORDER BY r.created_at DESC`, [wpOrderId]);
  // Cette commande est-elle le renvoi d'un retour (colis perdu…) ?
  const { rows: replacementFor } = await pool.query(
    `SELECT id, wp_order_id, reason FROM customer_returns
      WHERE replacement_order_id = $1 AND cancelled_at IS NULL ORDER BY id`,
    [wpOrderId]
  );
  const parents = bundleParents(lines);
  return {
    order,
    replacementFor,
    shipments: await orderShipments(wpOrderId),
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

/**
 * Lignes d'un retour. Le pack passe avant ses composants (expandSelection les
 * range ainsi). `partials` : consignes de retour partiel à garder, par
 * order_item_id (modification d'un retour).
 */
const insertLines = async (client, returnId, picks, partials = new Map()) => {
  const lineIds = new Map();
  for (const { line, qty, bundleOf } of picks) {
    const partial = partials.get(String(line.order_item_id));
    const { rows: [l] } = await client.query(
      `INSERT INTO customer_return_lines
         (return_id, order_item_id, product_id, sku, name, qty, unit_paid, is_bundle, bundle_line_id, partial, partial_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [returnId, line.order_item_id, line.catalog_id, line.sku, line.name, qty, line.unit_paid,
        line.product_type === 'woosb', bundleOf ? lineIds.get(bundleOf) : null,
        !!partial, partial || null]
    );
    lineIds.set(line.order_item_id, l.id);
  }
};

const create = async ({ wpOrderId, ticketId, reason, returnRequired, outcome, note, selection }, user, { attachTicket = true } = {}) => {
  if (!REASONS[reason]) throw httpError(400, 'Motif inconnu.');
  if (reason === LOST_REASON) throw httpError(400, 'Un colis perdu se déclare par « Déclarer colis perdu ».');
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
    await insertLines(client, returnId, picks);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const lines = [
    `<strong>Retour n°${returnId} créé</strong> — ${escapeHtml(REASONS[reason])}${returnRequired === false ? ' (sans retour du produit)' : ''}`,
    ...picks.filter(p => !p.bundleOf).map(p => `${p.qty} × ${escapeHtml(p.line.name)}`),
  ];
  // Colis revenu seul (transporteur, non réclamé) : créé depuis la commande, sans
  // ticket. Il en trouve un — ou en ouvre un — pour que ses notes (création,
  // renvoi, points) y soient écrites (Pierre, 20/10 et 30/10/2026).
  if (!ticketId && attachTicket && ORDER_TICKET_REASONS.includes(reason)) {
    const { warnings } = await attachOrderTicket(returnId, order, lines, user);
    return { ...(await get(returnId)), warnings };
  }
  await noteTicket(ticketId, user, lines);
  return get(returnId);
};

/**
 * Rattache un retour créé sans ticket au ticket de sa commande — le plus
 * récent, non terminé d'abord, repassé « Ouvert » quel que soit son statut —
 * et y écrit `note` en note interne. Sans ticket, en crée un « Nouveau »
 * (note privée, aucun mail au client).
 */
const attachOrderTicket = async (returnId, order, note, user) => {
  const { rows: [existing] } = await pool.query(
    `SELECT id FROM sav_tickets
      WHERE order_id = $1 AND merged_into_id IS NULL AND NOT is_spam
      ORDER BY (sav_status <> 'terminé') DESC, created_at DESC
      LIMIT 1`,
    [String(order.wp_order_id)]
  );
  const warnings = [];
  let ticketId = existing?.id || null;
  try {
    if (ticketId) {
      await noteTicket(ticketId, user, note);
      await savModel.updateStatus(ticketId, 'ouvert');
    } else {
      // Sujet lu par le client dans l'objet de nos réponses (Pierre, 19/10/2026).
      ticketId = (await createTicket(order, `Votre commande YouVape N°${order.wp_order_id}`,
        note.map(l => `<p>${l}</p>`).join(''), user.name || user.email)).id;
    }
    await pool.query('UPDATE customer_returns SET ticket_id = $2 WHERE id = $1', [returnId, ticketId]);
  } catch (error) {
    console.error(`[Retours] Ticket du retour n°${returnId} (commande ${order.wp_order_id}) :`, error.message);
    warnings.push(`Retour créé, mais le ticket n’a pas pu être ${ticketId ? 'mis à jour' : 'créé'} (${error.message}).`);
  }
  return { ticketCreated: !existing, warnings };
};

// ── Colis perdu (16/10/2026) ────────────────────────────────────────────────

/** Colis d'une commande : étiquettes de l'app encore actives et colis emballés dans BMS. */
const orderShipments = async (wpOrderId) => {
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT l.carrier_code, l.account_code, l.tracking_number, l.created_at
         FROM shipment_labels l WHERE l.order_number = $1 AND l.status = 'active'
       UNION ALL
       SELECT b.carrier_code, b.account_code, b.tracking_number, b.created_at
         FROM bms_shipments b WHERE b.order_number = $1 AND ${BMS_SANS_DOUBLON}
     ) s ORDER BY created_at DESC`,
    [String(wpOrderId)]
  );
  return rows;
};

const shipmentText = (s) => [s.carrier_code === 'chronopost' && s.account_code === '2shop' ? '2Shop' : s.carrier_code, s.tracking_number && `n°${s.tracking_number}`]
  .filter(Boolean).join(' ');

/**
 * Déclare perdu par le transporteur tout ou partie d'une commande. Rien ne
 * revient : le constat est validé d'office, toutes les pièces « non remises en
 * stock ». L'issue prévue est le renvoi (méthode d'origine, bloqué si le
 * stock BMS manque). Colis retrouvé : on annule la déclaration.
 */
const declareLost = async ({ wpOrderId, ticketId, note, selection }, user) => {
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
      `INSERT INTO customer_returns
         (wp_order_id, ticket_id, reason, return_required, outcome, note, created_by, received_at, received_by, status)
       VALUES ($1, $2, $3, false, 'renvoi', $4, $5, NOW(), $5, 'recu') RETURNING id`,
      [wpOrderId, ticketId || null, LOST_REASON, String(note || '').trim() || null, user.id]
    );
    returnId = r.id;
    await insertLines(client, returnId, picks);
    await client.query(
      'UPDATE customer_return_lines SET qty_no_restock = qty WHERE return_id = $1 AND NOT is_bundle',
      [returnId]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const shipments = await orderShipments(wpOrderId);
  await noteTicket(ticketId, user, [
    `<strong>Colis perdu déclaré — retour n°${returnId}</strong>${shipments.length ? ` (${escapeHtml(shipments.map(shipmentText).join(', '))})` : ''}`,
    ...picks.filter(p => !p.bundleOf).map(p => `${p.qty} × ${escapeHtml(p.line.name)}`),
  ]);
  return get(returnId);
};

// ── Colis non réclamé revenu (16/10/2026) ───────────────────────────────────

/**
 * Le colis revient seul, sans ticket ni retour : c'est la réception qui
 * déclenche. Crée le retour « Commande non récupérée » sur tout ce qui n'est
 * pas déjà dans un retour (réception à valider à la main), et le dit dans le
 * ticket de la commande — repassé « Ouvert » quel que soit son statut — ou dans
 * un ticket « Nouveau » créé pour l'occasion, note interne seulement (Pierre).
 */
const declareUnclaimed = async (wpOrderId, user) => {
  const { rows: [order] } = await pool.query(ORDER_SQL, [wpOrderId]);
  if (!order) throw httpError(404, `Commande ${wpOrderId} absente de notre base.`);
  const lines = await orderLines(wpOrderId);
  const parents = bundleParents(lines);
  const selection = lines
    .filter(l => !parents.has(l.order_item_id) && l.returnable > 0)
    .map(l => ({ orderItemId: l.order_item_id, qty: l.returnable }));
  if (!selection.length) throw httpError(400, 'Tous les articles de la commande sont déjà dans un retour.');

  // Le retour d'abord, sans ticket : la note doit en donner le numéro.
  const ret = await create({
    wpOrderId, ticketId: null, reason: 'non_recupere', returnRequired: true, outcome: 'points', selection,
  }, user, { attachTicket: false });

  const note = [
    '<strong>Colis revenu chez nous, non réclamé par le client.</strong>',
    `Retour n°${ret.id} créé, réception à valider.`,
    ...ret.lines.filter(l => !l.bundle_line_id).map(l => `${l.qty} × ${escapeHtml(l.name)}`),
  ];
  const { ticketCreated, warnings } = await attachOrderTicket(ret.id, order, note, user);
  return { ...(await get(ret.id)), ticketCreated, warnings };
};

// ── Modification (avant validation) ─────────────────────────────────────────

/**
 * Corrige un retour pas encore validé : motif, articles, retour exigé, issue
 * prévue, note. Une fois validé, la remise en stock et le SAV fournisseur sont
 * faits : il ne se modifie plus. Une issue déjà faite n'est pas touchée.
 */
const update = async (id, { reason, returnRequired, outcome, note, selection }, user) => {
  const { rows: [r] } = await pool.query('SELECT * FROM customer_returns WHERE id = $1', [id]);
  if (!r) throw httpError(404, 'Retour introuvable.');
  if (r.cancelled_at) throw httpError(400, 'Retour annulé.');
  if (r.received_at) throw httpError(400, 'Retour déjà validé : il ne se modifie plus.');
  if (!REASONS[reason]) throw httpError(400, 'Motif inconnu.');
  if (reason === LOST_REASON) throw httpError(400, 'Un colis perdu se déclare par « Déclarer colis perdu ».');
  if (outcome && !OUTCOMES[outcome]) throw httpError(400, 'Issue inconnue.');

  const picks = expandSelection(await orderLines(r.wp_order_id, id), selection);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: kept } = await client.query(
      'SELECT order_item_id, partial_note FROM customer_return_lines WHERE return_id = $1 AND partial',
      [id]
    );
    await client.query('DELETE FROM customer_return_lines WHERE return_id = $1', [id]);
    await insertLines(client, id, picks, new Map(kept.map(k => [String(k.order_item_id), k.partial_note])));
    await client.query(
      `UPDATE customer_returns
          SET reason = $2, return_required = $3, note = $4,
              outcome = CASE WHEN treated_at IS NULL THEN $5 ELSE outcome END
        WHERE id = $1`,
      [id, reason, returnRequired !== false, String(note || '').trim() || null, outcome || null]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await noteTicket(r.ticket_id, user, [
    `<strong>Retour n°${id} modifié</strong> — ${escapeHtml(REASONS[reason])}${returnRequired === false ? ' (sans retour du produit)' : ''}`,
    ...picks.filter(p => !p.bundleOf).map(p => `${p.qty} × ${escapeHtml(p.line.name)}`),
  ]);
  return get(id);
};

// ── Lecture ─────────────────────────────────────────────────────────────────

const list = async ({ status, reason, q } = {}) => {
  const where = [];
  const params = [];
  if (status) {
    params.push(status);
    where.push(`r.status = $${params.length}`);
  }
  if (reason) {
    params.push(reason);
    where.push(`r.reason = $${params.length}`);
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
  const { rows: [lost] } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM customer_returns WHERE reason = $1 AND cancelled_at IS NULL', [LOST_REASON]
  );
  return { returns: rows, counts: Object.fromEntries(counts.map(c => [c.status, c.n])), lost: lost.n };
};

// ── Commandes fournisseur d'une pièce SAV (Pierre, 15/10/2026) ─────────────

/**
 * Commandes fournisseur qui ont apporté ces produits : une ligne par commande
 * et par produit, avec les pièces REÇUES, celles déjà en SAV sur elle (tous
 * statuts, site et boutique) et le prix payé d'une pièce (même formule que le
 * FIFO, computedCostModel).
 *
 * @param {number[]} productIds
 * @param {{exclude?: number[], db?}} opts  `exclude` : pièces SAV à ne pas
 *   décompter (celle dont on change la commande).
 */
const LOTS_SQL = `
  SELECT poi.product_id, po.id AS purchase_order_id, po.order_number, po.supplier_id, s.name AS supplier_name,
         COALESCE(po.received_date, po.order_date) AS received_at,
         SUM(poi.units_received)::int AS received,
         ROUND(SUM(poi.units_received * poi.unit_price / COALESCE(NULLIF(poi.units_per_qty, 0), 1)
                   * (1 - COALESCE(poi.discount_percent, 0) / 100.0))
               / NULLIF(SUM(poi.units_received) FILTER (WHERE poi.unit_price IS NOT NULL), 0), 4) AS unit_cost,
         COALESCE((SELECT SUM(i.qty) FROM supplier_return_items i
                    WHERE i.purchase_order_id = po.id AND i.product_id = poi.product_id
                      AND NOT (i.id = ANY($2::int[]))), 0)::int AS returned
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.purchase_order_id
    JOIN suppliers s ON s.id = po.supplier_id
   WHERE poi.product_id = ANY($1::int[]) AND poi.units_received > 0
     AND po.status NOT IN ('draft', 'cancelled')
   GROUP BY poi.product_id, po.id, s.name
   ORDER BY received_at DESC NULLS LAST, po.id DESC`;

const purchaseLots = async (productIds, { exclude = [], db = pool } = {}) => {
  if (!productIds.length) return [];
  const { rows } = await db.query(LOTS_SQL, [productIds, exclude]);
  return rows.map(l => ({ ...l, unit_cost: l.unit_cost == null ? null : Number(l.unit_cost), remaining: lotRemaining(l) }));
};

/**
 * Contrôle, sous verrou des commandes, que chaque commande couvre les pièces
 * qu'on lui impute (plusieurs pièces sur la même commande s'additionnent).
 * À appeler DANS la transaction qui écrit les pièces.
 *
 * @param {Array<{purchaseOrderId, productId, supplierId, qty, name, excludeItemId?}>} picks
 * @returns {Array} la commande de chaque pick, dans l'ordre
 */
const reserveLots = async (client, picks) => {
  if (!picks.length) return [];
  for (const p of picks) {
    if (!Number(p.purchaseOrderId)) throw httpError(400, `« ${p.name} » : choisir la commande fournisseur.`);
  }
  const poIds = [...new Set(picks.map(p => Number(p.purchaseOrderId)))];
  // Deux saisies simultanées sur la même commande passent l'une après l'autre.
  await client.query('SELECT id FROM purchase_orders WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [poIds]);
  const lots = await purchaseLots([...new Set(picks.map(p => Number(p.productId)))], {
    exclude: picks.map(p => Number(p.excludeItemId)).filter(Boolean),
    db: client,
  });
  const taken = new Map();
  return picks.map(p => {
    const key = `${p.purchaseOrderId}:${p.productId}`;
    const lot = lots.find(l => l.purchase_order_id === Number(p.purchaseOrderId) && l.product_id === Number(p.productId));
    if (lot && lot.supplier_id !== Number(p.supplierId)) {
      throw httpError(400, `« ${p.name} » : la commande ${lot.order_number} est chez ${lot.supplier_name}.`);
    }
    const already = taken.get(key) || 0;
    checkLot(lot && { ...lot, returned: lot.returned + already }, p.qty, p.name);
    taken.set(key, already + Number(p.qty));
    return lot;
  });
};

/**
 * Fournisseurs et commandes d'une ligne de retour : les fournisseurs chez qui
 * la pièce a été achetée (le plus probable en tête) et, pour chacun, la
 * commande proposée pour toute la ligne.
 */
const lineCandidates = (lots, line, paidAt) => {
  const mine = lots.filter(l => l.product_id === line.product_id);
  const suppliers = [];
  for (const lot of mine) {
    if (!suppliers.some(s => s.id === lot.supplier_id)) {
      suppliers.push({ id: lot.supplier_id, name: lot.supplier_name, lastReceived: lot.received_at });
    }
  }
  const suggested = suggestSupplier(mine.map(l => ({ supplier_id: l.supplier_id, last_received: l.received_at })), paidAt);
  const suggestedLots = Object.fromEntries(suppliers.map(s => [s.id, suggestLot(mine, s.id, line.qty, paidAt)]));
  return { suppliers, suggested, suggestedLots, lots: mine };
};

/**
 * Port payé TTC. `order_shipping_tax` est toujours NULL en base : la TVA du
 * port est sur la ligne `tax` de la commande (CLAUDE.md, formule Metorik).
 * Commande 1264475 : 3,25 € HT + 0,65 € = 3,90 €, et non 3,25 €.
 */
const SHIPPING_PAID_SQL = `COALESCE(o.order_shipping, 0) + COALESCE((
    SELECT SUM(t.line_tax) FROM order_items t WHERE t.wp_order_id = o.wp_order_id AND t.order_item_type = 'tax'
  ), 0)`;

const get = async (id) => {
  const { rows: [r] } = await pool.query(
    `SELECT r.*, o.post_date, o.paid_date, o.post_status, o.order_total, o.shipping_method,
            ${SHIPPING_PAID_SQL} AS shipping_paid,
            o.billing_first_name, o.billing_last_name, o.billing_email,
            COALESCE(o.relay_point_manual, o.relay_point) AS relay_point,
            uc.name AS created_by_name, ur.name AS received_by_name, ut.name AS treated_by_name,
            ux.name AS cancelled_by_name, ul.name AS label_created_by_name, t.subject AS ticket_subject
       FROM customer_returns r
       LEFT JOIN orders o ON o.wp_order_id = r.wp_order_id
       LEFT JOIN users uc ON uc.id = r.created_by
       LEFT JOIN users ur ON ur.id = r.received_by
       LEFT JOIN users ut ON ut.id = r.treated_by
       LEFT JOIN users ux ON ux.id = r.cancelled_by
       LEFT JOIN users ul ON ul.id = r.label_created_by
       LEFT JOIN sav_tickets t ON t.id = r.ticket_id
      WHERE r.id = $1`,
    [id]
  );
  if (!r) throw httpError(404, 'Retour introuvable.');

  const { rows: lines } = await pool.query(
    `SELECT l.*, s.name AS supplier_name, COALESCE(p.image_url, pp.image_url) AS image_url,
            i.status AS supplier_status, spo.order_number AS supplier_order_number
       FROM customer_return_lines l
       LEFT JOIN suppliers s ON s.id = l.supplier_id
       LEFT JOIN products p ON p.id = l.product_id
       LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id
       LEFT JOIN supplier_return_items i ON i.return_line_id = l.id
       LEFT JOIN purchase_orders spo ON spo.id = i.purchase_order_id
      WHERE l.return_id = $1
      ORDER BY l.id`,
    [id]
  );
  const productIds = [...new Set(lines.filter(l => !l.is_bundle && l.product_id).map(l => l.product_id))];
  const lots = await purchaseLots(productIds);
  const paidAt = r.paid_date || r.post_date;
  const { rows: suppliers } = await pool.query('SELECT id, name FROM suppliers WHERE is_active ORDER BY name');
  const { rows: refunds } = await pool.query(
    `SELECT f.wp_refund_id, f.refund_amount, f.refund_date, f.refund_reason, cr.id AS linked_return_id
       FROM refunds f
       LEFT JOIN customer_returns cr ON cr.refund_wp_id = f.wp_refund_id
      WHERE f.wp_order_id = $1
      ORDER BY f.refund_date`,
    [r.wp_order_id]
  );

  // L'étiquette ne voyage qu'à la demande (GET /:id/label).
  const { label_data: labelData, ...ret } = r;
  const shippingPaid = Number(r.shipping_paid || 0);
  return {
    ...ret,
    has_label: !!labelData,
    lines: lines.map(l => ({ ...l, supplierCandidates: lineCandidates(lots, l, paidAt) })),
    suppliers,
    refunds,
    shipping_paid: shippingPaid,
    suggested_points: {
      lines: suggestPoints(lines),
      withShipping: suggestPoints(lines, { shippingPaid, withShipping: true }),
    },
    replacement_plan: r.shipping_method ? replacementShipping(r.shipping_method, r.reason) : null,
    shipments: r.reason === LOST_REASON ? await orderShipments(r.wp_order_id) : [],
  };
};

// ── Validation (colis reçu) et remise en stock ──────────────────────────────

/**
 * Remet en stock dans BMS ce qui ne l'est pas encore. La ligne est RÉSERVÉE
 * avant l'appel (restocked_qty), pour qu'un double clic ne la fasse pas
 * entrer deux fois ; un échec BMS la libère et peut se relancer.
 * Rend les erreurs et le nombre de pièces RÉELLEMENT entrées : seul ce
 * nombre-là peut figurer dans une note du ticket.
 */
const restock = async (id, user) => {
  const { rows: lines } = await pool.query(
    `SELECT l.*, r.wp_order_id FROM customer_return_lines l JOIN customer_returns r ON r.id = l.return_id
      WHERE l.return_id = $1 AND r.received_at IS NOT NULL AND l.restocked_qty < l.qty_restock
      ORDER BY l.id`,
    [id]
  );
  const errors = [];
  let restocked = 0;
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
      restocked += qty;
    } catch (error) {
      await pool.query(
        'UPDATE customer_return_lines SET restocked_qty = $2, restocked_at = NULL WHERE id = $1',
        [line.id, line.restocked_qty]
      );
      console.error(`[Retours] Remise en stock BMS refusée (retour ${id}, ${line.sku}) :`, error.message);
      errors.push(`${line.name} : ${error.message}`);
    }
  }
  return { errors, restocked };
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
    const toSupplier = plan.filter(p => p.supplier);
    const lotsTaken = await reserveLots(client, toSupplier.map(p => ({
      purchaseOrderId: p.d.purchaseOrderId, productId: p.line.product_id, supplierId: p.d.supplierId,
      qty: p.supplier, name: p.line.name || p.line.sku,
    })));
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
        const lot = lotsTaken[toSupplier.indexOf(p)];
        await client.query(
          `INSERT INTO supplier_return_items
             (supplier_id, product_id, return_line_id, qty, reason, problem, unit_cost, created_by, purchase_order_id)
           SELECT $1, $2, $3, $4, $5, $6, COALESCE($8::numeric, p.computed_cost, p.wc_cog_cost), $7, $9
             FROM products p WHERE p.id = $2`,
          [Number(p.d.supplierId), p.line.product_id, p.line.id, p.supplier, r.reason,
            String(p.d.problem).trim(), user.id, lot.unit_cost, lot.purchase_order_id]
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

  const { errors: restockErrors, restocked } = await restock(id, user);

  // Ce que BMS a refusé n'est pas « remis en stock » : la note le dira à la relance réussie.
  const sum = (k) => plan.reduce((n, p) => n + p[k], 0);
  const parts = [];
  if (restocked) parts.push(`${restocked} remis en stock`);
  if (sum('supplier')) parts.push(`${sum('supplier')} en SAV fournisseur`);
  if (sum('noRestock')) parts.push(`${sum('noRestock')} non remis en stock`);
  await noteTicket(r.ticket_id, user, [
    `<strong>Retour n°${id} ${r.return_required ? 'reçu' : 'validé'}</strong>${parts.length ? ` — ${parts.join(', ')}` : ''}`,
    ...plan.filter(p => p.supplier).map(p => `SAV : ${p.supplier} × ${escapeHtml(p.line.name)} — ${escapeHtml(p.d.problem)}`),
  ]);

  return { ...(await get(id)), restockErrors };
};

const retryRestock = async (id, user) => {
  const { errors: restockErrors, restocked } = await restock(id, user);
  if (restocked) {
    const { rows: [r] } = await pool.query('SELECT ticket_id FROM customer_returns WHERE id = $1', [id]);
    await noteTicket(r?.ticket_id, user, [`<strong>Retour n°${id}</strong> — ${restocked} remis en stock`]);
  }
  return { ...(await get(id)), restockErrors };
};

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

/**
 * Un colis perdu, validé d'office, s'annule tant qu'aucune issue n'est faite
 * (colis retrouvé) : rien n'est entré en stock ni parti en SAV fournisseur.
 */
const cancel = async (id, user) => {
  const { rows: [r] } = await pool.query(
    `UPDATE customer_returns SET cancelled_at = NOW(), cancelled_by = $2, status = 'annule'
      WHERE id = $1 AND cancelled_at IS NULL
        AND (received_at IS NULL
             OR (reason = $3 AND treated_at IS NULL AND replacement_order_id IS NULL
                 AND loyalty_credited_at IS NULL AND refund_wp_id IS NULL AND reship_label_id IS NULL))
      RETURNING ticket_id, reason`,
    [id, user.id, LOST_REASON]
  );
  if (!r) throw httpError(400, 'Seul un retour pas encore validé (ou un colis perdu sans issue faite) peut être annulé.');
  await noteTicket(r.ticket_id, user, [r.reason === LOST_REASON
    ? `<strong>Déclaration de colis perdu annulée</strong> (retour n°${id})`
    : `<strong>Retour n°${id} annulé</strong>`]);
  return get(id);
};

// ── Lot 2 : commande de renvoi ──────────────────────────────────────────────

const loadForAction = async (id) => {
  const { rows: [r] } = await pool.query(
    `SELECT r.*, o.shipping_method, o.billing_email, o.billing_first_name, o.billing_last_name,
            o.billing_address_1, o.billing_address_2, o.billing_postcode, o.billing_city,
            o.billing_country, o.billing_phone,
            COALESCE(o.relay_point_manual, o.relay_point) AS relay_point
       FROM customer_returns r LEFT JOIN orders o ON o.wp_order_id = r.wp_order_id
      WHERE r.id = $1`,
    [id]
  );
  if (!r) throw httpError(404, 'Retour introuvable.');
  if (r.cancelled_at) throw httpError(400, 'Retour annulé.');
  return r;
};

const markTreated = (id, userId, outcome, outcomeRef, extraSql = '', extraParams = []) =>
  pool.query(
    `UPDATE customer_returns
        SET outcome = $2, outcome_ref = $3, treated_at = COALESCE(treated_at, NOW()), treated_by = $4,
            status = CASE WHEN cancelled_at IS NOT NULL THEN 'annule'
                          WHEN received_at IS NOT NULL THEN 'traite' ELSE 'attente' END
            ${extraSql}
      WHERE id = $1`,
    [id, outcome, outcomeRef, userId, ...extraParams]
  );

// Autres déclinaisons publiées du même produit : une rupture se remplace par
// une autre couleur (Pierre, 14/10/2026). Stock de notre base, rafraîchi par la
// synchro ; le stock BMS de la déclinaison choisie est relu avant de commander.
const SIBLINGS_SQL = `
  SELECT s.id, s.sku, s.post_title AS name, s.stock
    FROM products s
   WHERE s.wp_parent_id = $1 AND s.id <> $2 AND s.product_type = 'variation'
     AND s.post_status = 'publish' AND s.wc_deleted_at IS NULL AND COALESCE(s.sku, '') <> ''
   ORDER BY s.post_title`;

/** Articles proposés au renvoi : les pièces retournées (pas les packs), stock BMS lu à l'instant. */
const replacementPreview = async (id) => {
  const r = await loadForAction(id);
  const { rows: lines } = await pool.query(
    `SELECT l.id, l.name, l.sku, l.qty, l.product_id, p.product_type, p.wp_parent_id
       FROM customer_return_lines l JOIN products p ON p.id = l.product_id
      WHERE l.return_id = $1 AND NOT l.is_bundle
      ORDER BY l.id`,
    [id]
  );
  const items = [];
  for (const l of lines) {
    let available = null;
    let stockError = null;
    try {
      available = (await readBmsStock(l.sku)).available;
    } catch (error) {
      stockError = error.message;
    }
    const alternatives = l.product_type === 'variation'
      ? (await pool.query(SIBLINGS_SQL, [l.wp_parent_id, l.product_id])).rows
      : [];
    items.push({ lineId: l.id, productId: l.product_id, name: l.name, sku: l.sku, qty: l.qty, available, stockError, alternatives });
  }
  return {
    items,
    lost: r.reason === LOST_REASON,
    shippingMethod: r.shipping_method,
    plan: r.shipping_method ? replacementShipping(r.shipping_method, r.reason) : null,
    relayPoint: r.relay_point,
    methods: await replacementMethods(),
  };
};

/** Méthodes qu'on peut choisir à la main pour un renvoi : les dénominations actives. */
const replacementMethods = async () => (await shippingMethodMapModel.listActive())
  .map(m => ({ method: m.denomination, network: relayNetwork(m) }))
  .sort((a, b) => a.method.localeCompare(b.method, 'fr'));

/** Stock BMS d'une déclinaison choisie à la place, lu à l'instant. */
const productStock = async (productId) => {
  const { rows: [p] } = await pool.query('SELECT sku FROM products WHERE id = $1', [productId]);
  if (!p?.sku) throw httpError(404, 'Produit introuvable.');
  return { available: (await readBmsStock(p.sku)).available };
};

// Métas WooCommerce du point relais (plugins WMS Mondial Relay / Chronopost,
// plugin Colissimo). C'est là que BMS lit le point à l'import de la commande
// (`shipping.pickup_point`), et notre synchro aussi (relayPointOf).
const PICKUP_META_KEYS = [
  '_wms_mondial_relay_pickup_info', '_wms_chronopost_pickup_info',
  '_lpc_meta_pickUpLocationId', '_lpc_meta_pickUpLocationLabel',
  '_lpc_meta_pickUpProductCode', '_lpc_meta_pickUpLocationData',
];

/**
 * Point relais d'une commande WC, recopiable sur une autre. `shipping_method`
 * des métas WMS suit la méthode de la nouvelle commande (Chronopost Relais →
 * 2Shop : même point, autre service).
 */
const pickupMetaFor = (wcOrder, methodId) => (wcOrder.meta_data || [])
  .filter(m => PICKUP_META_KEYS.includes(m.key))
  .map(m => (m.key.startsWith('_wms_') && m.value && typeof m.value === 'object'
    ? { key: m.key, value: { ...m.value, shipping_method: methodId } }
    : { key: m.key, value: m.value }));

/**
 * Le point relais d'origine part-il avec le renvoi ? Toujours avec la méthode
 * prévue par la règle (comme avant le choix manuel) ; avec une méthode choisie
 * à la main, seulement si elle est sur le même réseau de points.
 */
const keepRelay = (plan, planned, network, originNetwork) =>
  plan.method === planned.method || (!!network && network === originNetwork);

/**
 * Ligne d'expédition WooCommerce d'une méthode, reprise d'une commande récente qui la porte.
 * Une commande saisie à la main dans l'admin n'a que le libellé (`method_id` vide) :
 * WooCommerce refuse d'en créer une copie (1253066, 21/10/2026), on passe à la suivante.
 */
const shippingLineFor = async (denomination) => {
  const { rows } = await pool.query(
    `SELECT wp_order_id FROM orders WHERE shipping_method = $1 ORDER BY post_date DESC LIMIT 5`,
    [denomination]
  );
  if (!rows.length) throw httpError(400, `Aucune commande récente en « ${denomination} » pour en reprendre la méthode.`);
  for (const o of rows) {
    const line = (await fetchWcOrder(o.wp_order_id)).shipping_lines?.[0];
    if (line?.method_id) return line;
  }
  throw httpError(400, `Aucune commande récente en « ${denomination} » ne porte la méthode WooCommerce à reprendre.`);
};

/**
 * Crée la commande de renvoi dans WooCommerce : même client, mêmes adresses,
 * articles à 0 €, « SAV commande N°… » en note interne, statut En cours
 * pour qu'elle suive le parcours habituel (BMS, picking, packing).
 */
const createReplacement = async (id, items, user, method = null) => {
  const r = await loadForAction(id);
  if (r.replacement_order_id) throw httpError(400, `Commande de renvoi déjà créée (#${r.replacement_order_id || '…'}).`);
  if (!r.shipping_method) throw httpError(400, 'Méthode d’expédition de la commande inconnue.');

  const lost = r.reason === LOST_REASON;
  const chosen = (items || []).filter(i => Number(i.qty) > 0);
  const wanted = new Map(chosen.map(i => [Number(i.lineId), Number(i.qty)]));
  const swaps = new Map(chosen.filter(i => i.productId).map(i => [Number(i.lineId), Number(i.productId)]));
  if (!wanted.size) throw httpError(400, 'Aucun article à renvoyer.');
  const { rows: returned } = await pool.query(
    `SELECT l.id, l.name, l.sku, l.product_id, p.wp_product_id, p.wp_parent_id, p.product_type
       FROM customer_return_lines l JOIN products p ON p.id = l.product_id
      WHERE l.return_id = $1 AND NOT l.is_bundle AND l.id = ANY($2::int[])`,
    [id, [...wanted.keys()]]
  );
  if (returned.length !== wanted.size) throw httpError(400, 'Article inconnu dans ce retour.');
  for (const [, q] of wanted) if (!Number.isInteger(q) || q < 1) throw httpError(400, 'Quantité invalide.');

  // Ce qui part réellement : l'article retourné, ou n'importe quel autre
  // produit publié (Pierre, 20/10/2026 — avant : une autre déclinaison seulement).
  const lines = [];
  for (const l of returned) {
    const swapId = swaps.get(l.id);
    if (!swapId || swapId === l.product_id) {
      lines.push({ ...l, returnedName: null });
      continue;
    }
    const { rows: [alt] } = await pool.query(
      `SELECT id, sku, post_title AS name, wp_product_id, wp_parent_id, product_type
         FROM products WHERE id = $1 AND product_type IN ('simple', 'variation') AND post_status = 'publish'
          AND wc_deleted_at IS NULL AND COALESCE(sku, '') <> ''`,
      [swapId]
    );
    if (!alt) throw httpError(400, `« ${l.name} » : le produit choisi à la place n’est pas publié (ou n’a pas de SKU).`);
    lines.push({ ...alt, id: l.id, returnedName: l.name });
  }

  const short = [];
  for (const l of lines) {
    const { available } = await readBmsStock(l.sku);
    if (available < wanted.get(l.id)) short.push(`${l.name} : ${available} dispo`);
  }
  if (short.length) {
    throw httpError(400, lost
      ? `Stock BMS insuffisant, on ne peut pas renvoyer — ${short.join(' ; ')}.`
      : `Stock insuffisant — ${short.join(' ; ')}.`);
  }

  // Méthode choisie à la main (Pierre, 20/10/2026), sinon celle prévue par la règle.
  const planned = replacementShipping(r.shipping_method, r.reason);
  const methods = await shippingMethodMapModel.listActive();
  const chosenMethod = method ? methods.find(m => m.denomination === method) : null;
  if (method && !chosenMethod) throw httpError(400, `Méthode d’expédition inconnue : « ${method} ».`);
  const plan = chosenMethod ? { method: chosenMethod.denomination } : planned;
  // Le point relais d'origine ne suit que sur le même réseau ; la méthode prévue
  // par la règle le garde toujours (Chronopost Relais → 2Shop : même réseau).
  const network = relayNetwork(methods.find(m => m.denomination === plan.method));
  const originNetwork = r.relay_point?.network || null;

  // Verrou contre le double clic : 0 = création en cours.
  const { rowCount } = await pool.query(
    `UPDATE customer_returns SET replacement_order_id = 0
      WHERE id = $1 AND replacement_order_id IS NULL AND cancelled_at IS NULL`,
    [id]
  );
  if (!rowCount) throw httpError(409, 'Commande de renvoi déjà en cours de création.');

  let created;
  let origin;
  try {
    origin = await fetchWcOrder(r.wp_order_id);
    // La méthode affichée fait foi ; la ligne d'origine n'est reprise que si elle
    // la porte vraiment (une commande créée dans l'admin n'a que le libellé).
    const originLine = origin.shipping_lines?.[0];
    const shippingLine = plan.method === r.shipping_method && originLine?.method_id
      ? originLine
      : await shippingLineFor(plan.method);

    created = await wcRequest('post', '/orders', {
      status: 'processing',
      customer_id: origin.customer_id || 0,
      billing: origin.billing,
      shipping: origin.shipping,
      line_items: lines.map(l => (l.product_type === 'variation'
        ? { product_id: Number(l.wp_parent_id), variation_id: Number(l.wp_product_id) }
        : { product_id: Number(l.wp_product_id) })
      ).map((li, i) => ({ ...li, quantity: wanted.get(lines[i].id), subtotal: '0.00', total: '0.00' })),
      shipping_lines: [{
        method_id: shippingLine.method_id,
        instance_id: shippingLine.instance_id,
        method_title: plan.method,
        total: '0.00',
      }],
      // Sans elles, BMS n'a pas de point relais (commande 1269103, 14/10/2026).
      meta_data: keepRelay(plan, planned, network, originNetwork || relayPointOf(metaOf(origin.meta_data))?.network)
        ? pickupMetaFor(origin, shippingLine.method_id)
        : [],
    });
  } catch (error) {
    await pool.query('UPDATE customer_returns SET replacement_order_id = NULL WHERE id = $1', [id]);
    if (error.statusCode) throw error;
    const detail = error.response?.data?.message || error.message;
    // 422 et non 502 : Cloudflare remplace le corps d'un 502, le message n'arrivait jamais à l'écran.
    throw httpError(422, `WooCommerce a refusé la commande : ${detail}`);
  }

  const newId = Number(created.id);
  await pool.query('UPDATE customer_returns SET replacement_order_id = $2 WHERE id = $1', [id, newId]);
  await markTreated(id, user.id, 'renvoi', `#${created.number || newId}`);

  // Dans notre base tout de suite (sans attendre yousync), puis le point relais
  // d'origine (Chronopost Relais → 2Shop : même réseau de points).
  const warnings = [];
  // « SAV commande N°… » en note INTERNE seulement : le client ne doit pas la
  // voir (pas de note de commande) — Pierre, 14/10/2026.
  try {
    const note = lost ? `SAV colis perdu commande N°${r.wp_order_id}` : `SAV commande N°${r.wp_order_id}`;
    await wcRequest('post', `/orders/${newId}/notes`, { note, customer_note: false });
  } catch (error) {
    warnings.push(`Note interne WooCommerce non ajoutée (${error.message}) : à mettre à la main.`);
  }
  try {
    await importOrder(newId);
    // Notre base n'a le point que depuis le 07/09/2026 : sinon, celui de WooCommerce.
    const relay = r.relay_point || relayPointOf(metaOf(origin.meta_data));
    if (relay && keepRelay(plan, planned, network, relay.network)) await orderModel.setManualRelayPoint(newId, relay);
    else if (network) warnings.push(`Aucun point relais ${plan.method} repris : à saisir dans le détail de la commande #${newId}.`);
  } catch (error) {
    warnings.push(`Commande créée, mais pas encore dans notre base (${error.message}) : le point relais sera à saisir.`);
  }

  await noteTicket(r.ticket_id, user, [
    `<strong>Retour n°${id} — ${lost ? 'renvoi du colis perdu' : 'commande de renvoi'} #${created.number || newId}</strong> (${escapeHtml(plan.method)})`,
    ...lines.filter(l => l.returnedName).map(l => `${escapeHtml(l.returnedName)} remplacé par ${escapeHtml(l.name)}`),
  ]);
  return { ...(await get(id)), warnings };
};

// ── Réparé / même produit renvoyé (14/10/2026) ──────────────────────────────

/**
 * Étiquette d'expédition au n° de la commande d'origine, pour renvoyer au
 * client le produit réparé (ou le même). Même chemin que l'expédition manuelle
 * du Packing : AUCUNE confirmation BMS (rien ne sort du stock), plusieurs
 * étiquettes admises sur une commande. Elle s'imprime depuis l'historique
 * d'expédition. Transporteur : règle du renvoi (Chronopost → 2Shop / Colissimo).
 */
const reship = async (id, user) => {
  const r = await loadForAction(id);
  if (r.reason === LOST_REASON) throw httpError(400, 'Colis perdu : rien à réexpédier, créer la commande de renvoi.');
  if (r.reship_label_id != null) throw httpError(409, 'L’étiquette de réexpédition existe déjà (historique d’expédition).');

  const order = await shipmentController.loadOrderForLabel(r.wp_order_id);
  if (!order) throw httpError(404, `Commande ${r.wp_order_id} introuvable.`);
  // Commande d'avant le 07/09/2026 : point relais absent de notre base, lu dans WooCommerce.
  if (!order.relay_point) {
    try {
      order.relay_point = relayPointOf(metaOf((await fetchWcOrder(r.wp_order_id)).meta_data));
    } catch (error) {
      console.error(`[Retours] Point relais WooCommerce illisible (commande ${r.wp_order_id}) :`, error.message);
    }
  }
  const { method } = replacementShipping(order.shipping_method);
  const mapping = await shippingMethodMapModel.resolve(method);
  if (mapping.status !== 'mapped') throw httpError(400, `« ${method || '(vide)'} » ne génère pas d’étiquette.`);
  const adapter = getAdapter(mapping.carrierCode);

  const { rowCount } = await pool.query(
    `UPDATE customer_returns SET reship_label_id = 0
      WHERE id = $1 AND reship_label_id IS NULL AND cancelled_at IS NULL`,
    [id]
  );
  if (!rowCount) throw httpError(409, 'Étiquette de réexpédition déjà en cours de création.');

  let label;
  try {
    label = await shipmentController.createShipmentLabel({
      adapter,
      orderNumber: String(r.wp_order_id),
      accountCode: mapping.accountCode,
      receiver: shipmentController.receiverFromOrder(order),
      packedBy: user.id,
      weightGrams: adapter.fixedWeight === true ? null : await returnedWeightGrams(id),
      options: {
        deliveryMode: mapping.deliveryMode,
        relayPoint: order.relay_point || null,
        shippingMethod: method,
      },
    });
  } catch (error) {
    await pool.query('UPDATE customer_returns SET reship_label_id = NULL WHERE id = $1', [id]);
    throw httpError(error.statusCode && error.statusCode < 500 ? error.statusCode : 422,
      error.userMessage || `${adapter.label} : ${error.message}`);
  }

  await pool.query('UPDATE customer_returns SET reship_label_id = $2 WHERE id = $1', [id, label.labelId]);
  await markTreated(id, user.id, 'reexpedition', `${adapter.label} n°${label.trackingNumber}`);
  await noteTicket(r.ticket_id, user, [
    `<strong>Retour n°${id} — produit réexpédié</strong> : étiquette ${escapeHtml(adapter.label)} n°${escapeHtml(label.trackingNumber)} (${escapeHtml(method)}), à imprimer depuis l'historique d'expédition`,
  ]);
  return get(id);
};

// ── Retour partiel (14/10/2026) ─────────────────────────────────────────────

/**
 * Une ligne n'est revenue qu'en partie (la batterie seule d'une cigarette…).
 * La consigne suit la commande de renvoi jusqu'au Packing ; le Picking ne la
 * met jamais dans une vague générée par règle (services/returnPartialService).
 */
const setPartial = async (id, lineId, { partial, note }, user) => {
  const r = await loadForAction(id);
  const text = String(note || '').trim();
  if (partial && !text) throw httpError(400, 'Préciser la partie reçue et ce qu’il faut renvoyer.');
  const { rows: [line] } = await pool.query(
    `UPDATE customer_return_lines SET partial = $3, partial_note = $4
      WHERE id = $2 AND return_id = $1 AND NOT is_bundle
      RETURNING name`,
    [id, lineId, !!partial, partial ? text : null]
  );
  if (!line) throw httpError(404, 'Article introuvable dans ce retour.');
  await noteTicket(r.ticket_id, user, [partial
    ? `<strong>Retour n°${id} — retour partiel</strong> : ${escapeHtml(line.name)} — ${escapeHtml(text)}`
    : `<strong>Retour n°${id}</strong> : ${escapeHtml(line.name)} n'est plus en retour partiel`]);
  return get(id);
};

// ── Annuler l'issue (14/10/2026) ────────────────────────────────────────────

/**
 * Vide l'issue client pour en choisir une autre. Ce que l'app a fait elle-même
 * est défait quand elle le peut : l'étiquette de réexpédition est annulée chez
 * le transporteur si son API le permet, sinon marquée annulée dans
 * l'historique (Mondial Relay ne facture pas une étiquette non utilisée). Ce
 * qui vit ailleurs — commande de renvoi WooCommerce, points WPLoyalty — n'est
 * pas touché : on le dit, à faire à la main.
 */
const cancelOutcome = async (id, user) => {
  const r = await loadForAction(id);
  if (!r.treated_at && !r.outcome) throw httpError(400, 'Aucune issue à annuler.');
  if (Number(r.replacement_order_id) === 0 && r.replacement_order_id != null) throw httpError(409, 'Commande de renvoi en cours de création.');
  if (r.reship_label_id === 0) throw httpError(409, 'Étiquette de réexpédition en cours de création.');

  const done = [];
  const todo = [];
  if (r.reship_label_id > 0) {
    const label = await shipmentLabelModel.findById(r.reship_label_id);
    if (label && label.status === 'active') {
      const adapter = getAdapter(label.carrier_code);
      if (adapter.cancelWindow(label).cancellable) {
        try {
          await adapter.cancelLabel({ label, account: await getAccount(adapter.code, label.account_code) });
        } catch (error) {
          throw httpError(422, `${adapter.label} refuse d'annuler l'étiquette n°${label.tracking_number} : ${error.message}`);
        }
        done.push(`étiquette ${adapter.label} n°${label.tracking_number} annulée chez le transporteur`);
      } else {
        done.push(`étiquette ${adapter.label} n°${label.tracking_number} marquée annulée dans l'historique (non annulable chez le transporteur)`);
      }
      await shipmentLabelModel.markCancelled(label.id);
    }
  }
  if (Number(r.replacement_order_id) > 0) todo.push(`annuler la commande de renvoi #${r.replacement_order_id} dans WooCommerce`);
  if (r.loyalty_credited_at) {
    // WPLoyalty sait retirer des points : on défait le crédit nous-mêmes.
    try {
      const removed = await loyaltyService.reducePoints(r.billing_email, r.loyalty_points, {
        type: 'avoir', note: `Annulation avoir commande N°${r.wp_order_id}`, orderId: r.wp_order_id,
      });
      done.push(removed.points < r.loyalty_points
        ? `${removed.points} points retirés sur ${r.loyalty_points} dans WPLoyalty (${r.billing_email}) : le client a déjà dépensé le reste`
        : `${r.loyalty_points} points retirés dans WPLoyalty (${r.billing_email})`);
    } catch (error) {
      todo.push(`retirer les ${r.loyalty_points} points dans WPLoyalty (refus : ${error.response?.data?.message || error.message})`);
    }
  } else if (r.outcome === 'points' && r.treated_at) {
    // Points crédités à la main : l'app ne sait pas ce qui a été fait.
    todo.push(`retirer à la main dans WPLoyalty les points notés « ${r.outcome_ref || '—'} »`);
  }
  if (r.refund_wp_id) done.push(`remboursement WooCommerce n°${r.refund_wp_id} détaché`);

  await pool.query(
    `UPDATE customer_returns
        SET outcome = NULL, outcome_ref = NULL, treated_at = NULL, treated_by = NULL,
            replacement_order_id = NULL, loyalty_points = NULL, loyalty_credited_at = NULL,
            refund_wp_id = NULL, refund_amount = NULL, reship_label_id = NULL,
            status = CASE WHEN received_at IS NOT NULL THEN 'recu' ELSE 'attente' END
      WHERE id = $1`,
    [id]
  );
  await noteTicket(r.ticket_id, user, [
    `<strong>Retour n°${id} — issue « ${escapeHtml(OUTCOMES[r.outcome] || r.outcome || '—')} » annulée</strong>`,
    ...done.map(escapeHtml),
    ...todo.map(t => `À faire : ${escapeHtml(t)}`),
  ]);
  return { ...(await get(id)), done, todo };
};

// ── Lot 2 : points fidélité ─────────────────────────────────────────────────

/**
 * Avoir en points WPLoyalty. Le SERVEUR calcule : prix payé des pièces
 * retournées, + port en option, − un montant à déduire (étiquette retour
 * fournie…), × 100 (Pierre, 14/10/2026).
 *
 * `manual` : points crédités à la main dans WPLoyalty (plugin pas encore
 * branché, Pierre 19/10/2026). Même calcul, l'issue est enregistrée sans
 * appel ; `loyalty_credited_at` reste vide, l'app ne les retirera donc pas
 * d'elle-même si l'issue est annulée.
 */
const creditPoints = async (id, { withShipping, deductEuros, manual }, user) => {
  const r = await loadForAction(id);
  if (!manual && !r.billing_email) throw httpError(400, 'Commande sans email client.');
  if (r.loyalty_credited_at) throw httpError(409, 'Points déjà crédités pour ce retour.');
  const deduct = Number(String(deductEuros ?? 0).replace(',', '.'));
  if (!Number.isFinite(deduct) || deduct < 0 || deduct > 10000) throw httpError(400, 'Montant à déduire invalide.');

  const { rows: lines } = await pool.query('SELECT qty, unit_paid FROM customer_return_lines WHERE return_id = $1', [id]);
  const { rows: [o] } = await pool.query(
    `SELECT ${SHIPPING_PAID_SQL} AS shipping_paid FROM orders o WHERE o.wp_order_id = $1`, [r.wp_order_id]
  );
  const b = pointsBreakdown(lines, {
    shippingPaid: Number(o?.shipping_paid || 0),
    withShipping: !!withShipping,
    deductEuros: deduct,
  });
  if (b.points < 1) throw httpError(400, `Rien à créditer : ${breakdownText(b)} = ${b.euros.toFixed(2).replace('.', ',')} €.`);

  if (manual) {
    const detail = `${b.points} points (${breakdownText(b)}) crédités à la main`;
    await markTreated(id, user.id, 'points', detail.slice(0, 255));
    await noteTicket(r.ticket_id, user, [
      `<strong>Retour n°${id} — avoir commande N°${r.wp_order_id} : ${escapeHtml(detail)}</strong> dans WPLoyalty${r.billing_email ? ` (${escapeHtml(r.billing_email)})` : ''}`,
    ]);
    return get(id);
  }

  // Verrou avant l'appel : un double clic ne crédite pas deux fois.
  const { rowCount } = await pool.query(
    `UPDATE customer_returns SET loyalty_points = $2, loyalty_credited_at = NOW()
      WHERE id = $1 AND loyalty_credited_at IS NULL AND cancelled_at IS NULL`,
    [id, b.points]
  );
  if (!rowCount) throw httpError(409, 'Points déjà crédités pour ce retour.');
  try {
    await loyaltyService.addPoints(r.billing_email, b.points, {
      type: 'avoir', note: `Avoir commande N°${r.wp_order_id}`, orderId: r.wp_order_id,
    });
  } catch (error) {
    await pool.query('UPDATE customer_returns SET loyalty_points = NULL, loyalty_credited_at = NULL WHERE id = $1', [id]);
    const detail = error.response?.data?.message || error.message;
    throw httpError(422, `WPLoyalty a refusé le crédit : ${detail}`);
  }
  const detail = `${b.points} points (${breakdownText(b)})`;
  await markTreated(id, user.id, 'points', detail.slice(0, 255));
  await noteTicket(r.ticket_id, user, [
    `<strong>Retour n°${id} — avoir commande N°${r.wp_order_id} : ${escapeHtml(detail)}</strong> crédités à ${escapeHtml(r.billing_email)}`,
  ]);
  return get(id);
};

// ── Lot 2 : remboursement rapproché ─────────────────────────────────────────

const applyRefund = async (r, refund, userId) => {
  const amount = Number(refund.refund_amount);
  const { rowCount } = await pool.query(
    `UPDATE customer_returns
        SET refund_wp_id = $2, refund_amount = $3, outcome = 'remboursement',
            outcome_ref = $4, treated_at = COALESCE(treated_at, NOW()), treated_by = $5,
            status = CASE WHEN received_at IS NOT NULL THEN 'traite' ELSE 'attente' END
      WHERE id = $1 AND refund_wp_id IS NULL AND cancelled_at IS NULL`,
    [r.id, refund.wp_refund_id, amount, `${amount.toFixed(2).replace('.', ',')} € (remboursement WC n°${refund.wp_refund_id})`, userId]
  );
  return rowCount > 0;
};

/** Rattache à la main un remboursement de la commande. */
const linkRefund = async (id, wpRefundId, user) => {
  const r = await loadForAction(id);
  const { rows: [refund] } = await pool.query(
    'SELECT wp_refund_id, refund_amount FROM refunds WHERE wp_refund_id = $1 AND wp_order_id = $2',
    [wpRefundId, r.wp_order_id]
  );
  if (!refund) throw httpError(404, 'Remboursement introuvable sur cette commande.');
  const { rowCount } = await pool.query('SELECT 1 FROM customer_returns WHERE refund_wp_id = $1', [wpRefundId]);
  if (rowCount) throw httpError(409, 'Ce remboursement est déjà rattaché à un retour.');
  if (!(await applyRefund(r, refund, user.id))) throw httpError(409, 'Un remboursement est déjà rattaché à ce retour.');
  await noteTicket(r.ticket_id, user, [`<strong>Retour n°${id} — remboursement de ${euroText(refund.refund_amount)} rattaché</strong>`]);
  return get(id);
};

const euroText = (n) => `${Number(n).toFixed(2).replace('.', ',')} €`;

/**
 * Cron : chaque retour « remboursement » pas encore traité prend le premier
 * remboursement WooCommerce de sa commande fait après lui. Les dates WC sont
 * en heure de Paris : la création du retour y est convertie.
 */
const matchRefunds = async () => {
  const { rows: pending } = await pool.query(
    `SELECT id, wp_order_id, ticket_id,
            (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris') AS created_paris
       FROM customer_returns
      WHERE outcome = 'remboursement' AND treated_at IS NULL AND cancelled_at IS NULL AND refund_wp_id IS NULL
      ORDER BY created_at`
  );
  let matched = 0;
  for (const r of pending) {
    const { rows: refunds } = await pool.query(
      'SELECT wp_refund_id, refund_amount, refund_date FROM refunds WHERE wp_order_id = $1', [r.wp_order_id]
    );
    if (!refunds.length) continue;
    const { rows: taken } = await pool.query('SELECT refund_wp_id FROM customer_returns WHERE refund_wp_id IS NOT NULL');
    const refund = pickRefund(refunds, new Set(taken.map(t => Number(t.refund_wp_id))), r.created_paris);
    if (refund && await applyRefund(r, refund, null)) {
      matched++;
      await noteTicket(r.ticket_id, { name: 'Retours' }, [
        `<strong>Retour n°${r.id} — remboursement de ${euroText(refund.refund_amount)} rapproché</strong> (WooCommerce n°${refund.wp_refund_id})`,
      ]);
    }
  }
  return matched;
};

// ── Lot 3 : étiquette retour Mondial Relay ──────────────────────────────────

/** Poids des pièces retournées (products.weight en kg) : 100 g au moins, 500 g faute de poids. */
const returnedWeightGrams = async (id) => {
  const { rows: [w] } = await pool.query(
    `SELECT COALESCE(SUM(l.qty * COALESCE(p.weight, 0)), 0) AS kg
       FROM customer_return_lines l LEFT JOIN products p ON p.id = l.product_id
      WHERE l.return_id = $1 AND NOT l.is_bundle`,
    [id]
  );
  const grams = Math.round(Number(w.kg) * 1000);
  return grams > 0 ? Math.max(100, grams) : 500;
};

const createLabel = async (id, { format, force }, user) => {
  if (!['pdf', 'qr'].includes(format)) throw httpError(400, 'Format inconnu.');
  const r = await loadForAction(id);
  if (!r.return_required) throw httpError(400, 'Retour sans renvoi du produit : pas d’étiquette.');
  if (r.label_data && !force) throw httpError(409, `Une étiquette existe déjà (n°${r.label_tracking}).`);

  const { rows: [map] } = await pool.query(
    `SELECT account_code FROM shipping_method_carrier_map
      WHERE carrier_code = 'mondial_relay' AND active ORDER BY account_code LIMIT 1`
  );
  if (!map) throw httpError(400, 'Aucun contrat Mondial Relay en service.');
  const account = await getAccount('mondial_relay', map.account_code);

  const weightGrams = await returnedWeightGrams(id);

  const label = await mondialRelayAdapter.createReturnLabel({
    reference: `R${id}-${r.wp_order_id}`,
    customer: {
      first_name: r.billing_first_name,
      last_name: r.billing_last_name,
      address: [r.billing_address_1, r.billing_address_2].filter(Boolean).join(' '),
      postcode: r.billing_postcode,
      city: r.billing_city,
      country: r.billing_country || 'FR',
      phone: r.billing_phone,
      email: r.billing_email,
    },
    account,
    weightGrams,
    format,
  });

  await pool.query(
    `UPDATE customer_returns
        SET label_tracking = $2, label_format = $3, label_mime = $4, label_data = $5,
            label_created_at = NOW(), label_created_by = $6
      WHERE id = $1`,
    [id, label.trackingNumber, format, label.mime, label.dataBase64, user.id]
  );
  const buffer = Buffer.from(label.dataBase64, 'base64');
  await noteTicket(r.ticket_id, user, [
    `<strong>Retour n°${id} — étiquette retour Mondial Relay n°${escapeHtml(label.trackingNumber)}</strong> (${format === 'qr' ? 'QR code' : 'PDF'})`,
  ], [{
    fieldname: 'file',
    originalname: `retour_${id}_mondialrelay_${label.trackingNumber}.${LABEL_EXT[label.mime] || 'bin'}`,
    mimetype: label.mime,
    size: buffer.length,
    buffer,
  }]);
  return get(id);
};

const LABEL_EXT = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'text/plain': 'txt' };

const getLabel = async (id) => {
  const { rows: [r] } = await pool.query(
    'SELECT label_data, label_mime, label_tracking FROM customer_returns WHERE id = $1', [id]
  );
  if (!r?.label_data) throw httpError(404, 'Pas d’étiquette pour ce retour.');
  return {
    buffer: Buffer.from(r.label_data, 'base64'),
    mime: r.label_mime || 'application/pdf',
    filename: `retour_${id}_mondialrelay_${r.label_tracking}.${LABEL_EXT[r.label_mime] || 'bin'}`,
  };
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
         i.source, i.shop, i.note, i.purchase_order_id, po.order_number AS supplier_order_number,
         p.sku, COALESCE(NULLIF(p.post_title, ''), l.name) AS name, ref.supplier_sku,
         l.return_id, l.partial, l.partial_note, r.wp_order_id, r.ticket_id, uc.name AS created_by_name
    FROM supplier_return_items i
    JOIN products p ON p.id = i.product_id
    -- Un SAV boutique n'a pas de retour client.
    LEFT JOIN customer_return_lines l ON l.id = i.return_line_id
    LEFT JOIN customer_returns r ON r.id = l.return_id
    LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
    LEFT JOIN users uc ON uc.id = i.created_by
    LEFT JOIN LATERAL (
      SELECT sr.supplier_sku FROM supplier_refs sr
       WHERE sr.supplier_id = i.supplier_id AND sr.product_id = i.product_id
       ORDER BY sr.pack_qty, sr.id LIMIT 1
    ) ref ON true`;

const shopName = (shop) => WAREHOUSE_BY_ID[shop]?.name || (shop ? `Boutique ${shop}` : null);
const withShop = (i) => ({ ...i, shop_name: shopName(i.shop) });

/** « #1267852 » ou « Boutique Montpellier » */
const itemOrigin = (i) => (i.source === 'boutique' ? `Boutique ${shopName(i.shop)}` : `#${i.wp_order_id}`);

const supplierItems = async (supplierId) => {
  const { rows: [supplier] } = await pool.query('SELECT id, name FROM suppliers WHERE id = $1', [supplierId]);
  if (!supplier) throw httpError(404, 'Fournisseur introuvable.');
  const { rows: rawItems } = await pool.query(
    `${ITEMS_SQL} WHERE i.supplier_id = $1 AND i.status = 'a_retourner' ORDER BY i.created_at`, [supplierId]
  );
  const items = rawItems.map(withShop);
  // Commandes de ce fournisseur pour changer celle d'une pièce encore à retourner.
  const lots = (await purchaseLots([...new Set(items.map(i => i.product_id))]))
    .filter(l => l.supplier_id === Number(supplierId));
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
  const { rows: credits } = await pool.query(
    `SELECT c.batch_id, d.id, d.number, d.doc_date, d.total_ht
       FROM supplier_return_batch_credits c
       JOIN supplier_documents d ON d.id = c.document_id
       JOIN supplier_return_batches b ON b.id = c.batch_id
      WHERE b.supplier_id = $1
      ORDER BY d.doc_date`,
    [supplierId]
  );
  // Avoirs saisis dans l'app Factures et pas encore liés à un renvoi.
  const { rows: availableCredits } = await pool.query(
    `SELECT d.id, d.number, d.doc_date, d.total_ht
       FROM supplier_documents d
      WHERE d.supplier_id = $1 AND d.doc_type = 'credit_note'
        AND NOT EXISTS (SELECT 1 FROM supplier_return_batch_credits c WHERE c.document_id = d.id)
      ORDER BY d.doc_date DESC`,
    [supplierId]
  );
  return {
    supplier,
    items,
    lots,
    batches: batches.map(b => {
      const linked = credits.filter(c => c.batch_id === b.id);
      // L'app Factures enregistre un avoir en négatif (RV3/2026/02918 : −4,95 € HT).
      const credited = linked.reduce((n, c) => n + Math.abs(Number(c.total_ht || 0)), 0);
      return { ...b, credits: linked, credited: Math.round(credited * 100) / 100 };
    }),
    availableCredits,
  };
};

// ── Lot 4 : avoirs fournisseurs ─────────────────────────────────────────────

/** Un avoir règle le renvoi : le renvoi et ses lignes passent en Soldé. */
const linkCredit = async (batchId, documentId, user) => {
  const { rows: [b] } = await pool.query('SELECT id, supplier_id FROM supplier_return_batches WHERE id = $1', [batchId]);
  if (!b) throw httpError(404, 'Renvoi introuvable.');
  const { rows: [d] } = await pool.query(
    `SELECT id FROM supplier_documents WHERE id = $1 AND supplier_id = $2 AND doc_type = 'credit_note'`,
    [documentId, b.supplier_id]
  );
  if (!d) throw httpError(400, 'Cet avoir n’est pas un avoir de ce fournisseur.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO supplier_return_batch_credits (batch_id, document_id, linked_by) VALUES ($1, $2, $3)',
      [batchId, documentId, user.id]
    );
    await client.query(`UPDATE supplier_return_batches SET status = 'solde' WHERE id = $1`, [batchId]);
    await client.query(`UPDATE supplier_return_items SET status = 'solde' WHERE batch_id = $1`, [batchId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') throw httpError(409, 'Cet avoir est déjà lié à un renvoi.');
    throw error;
  } finally {
    client.release();
  }
  return supplierItems(b.supplier_id);
};

const unlinkCredit = async (batchId, documentId) => {
  const { rows: [b] } = await pool.query('SELECT id, supplier_id FROM supplier_return_batches WHERE id = $1', [batchId]);
  if (!b) throw httpError(404, 'Renvoi introuvable.');
  await pool.query('DELETE FROM supplier_return_batch_credits WHERE batch_id = $1 AND document_id = $2', [batchId, documentId]);
  const { rowCount } = await pool.query('SELECT 1 FROM supplier_return_batch_credits WHERE batch_id = $1', [batchId]);
  if (!rowCount) {
    await pool.query(`UPDATE supplier_return_batches SET status = 'envoye' WHERE id = $1`, [batchId]);
    await pool.query(`UPDATE supplier_return_items SET status = 'envoye' WHERE batch_id = $1`, [batchId]);
  }
  return supplierItems(b.supplier_id);
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
    { header: 'Commande fournisseur', key: 'po', width: 20 },
    { header: 'SKU', key: 'sku', width: 16 },
    { header: 'Produit', key: 'name', width: 50 },
    { header: 'Quantité', key: 'qty', width: 10 },
    { header: 'Motif', key: 'reason', width: 22 },
    { header: 'Problème', key: 'problem', width: 50 },
    { header: 'Retour partiel', key: 'partial', width: 40 },
    { header: 'Origine', key: 'origin', width: 22 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Coût unitaire HT', key: 'cost', width: 16 },
    { header: 'Total HT', key: 'total', width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const i of items) {
    const cost = i.unit_cost == null ? null : Number(i.unit_cost);
    ws.addRow({
      ref: i.supplier_sku || '',
      po: i.supplier_order_number || '',
      sku: i.sku || '',
      name: i.name,
      qty: i.qty,
      reason: REASONS[i.reason] || i.reason,
      problem: [i.problem, i.note].filter(Boolean).join(' — '),
      partial: i.partial ? i.partial_note || 'oui' : '',
      origin: itemOrigin(i),
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

// ── SAV boutique (Pierre, 15/10/2026) ──────────────────────────────────────
// L'échange est fait en caisse ; la pièce défectueuse part au fournisseur avec
// celles du site. Le stock Nextore n'est pas touché.

/** Produits du catalogue du site : nom, SKU ou code-barres exact. Les produits achetés d'abord. */
const searchProducts = async (q) => {
  const text = String(q || '').trim();
  if (text.length < 2) return [];
  const terms = text.split(/\s+/).slice(0, 6);
  const params = [text];
  const where = terms.map(t => {
    params.push(`%${t}%`);
    return `(p.sku ILIKE $${params.length} OR p.post_title ILIKE $${params.length})`;
  });
  const { rows } = await pool.query(
    `SELECT p.id, p.sku, p.post_title AS name, p.post_status, COALESCE(p.image_url, pp.image_url) AS image_url,
            EXISTS (SELECT 1 FROM purchase_order_items poi WHERE poi.product_id = p.id AND poi.units_received > 0) AS bought
       FROM products p
       LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id
      WHERE p.product_type IN ('simple', 'variation')
        AND ((${where.join(' AND ')})
             OR EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id = p.id AND b.barcode = $1))
      ORDER BY bought DESC, (p.post_status = 'publish') DESC, p.post_title
      LIMIT 30`,
    params
  );
  return rows;
};

const productLots = async (productId) => purchaseLots([Number(productId)]);

const createBoutiqueItem = async ({ shop, productId, supplierId, purchaseOrderId, qty, problem, note }, user) => {
  if (!WAREHOUSE_BY_ID[Number(shop)]) throw httpError(400, 'Choisir la boutique.');
  const { rows: [product] } = await pool.query(
    `SELECT id, sku, post_title FROM products WHERE id = $1 AND product_type IN ('simple', 'variation')`, [Number(productId)]
  );
  if (!product) throw httpError(400, 'Produit introuvable.');
  if (!Number(supplierId)) throw httpError(400, 'Choisir le fournisseur.');
  if (!String(problem || '').trim()) throw httpError(400, 'Décrire le problème.');
  const name = product.post_title || product.sku;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const [lot] = await reserveLots(client, [{ purchaseOrderId, productId: product.id, supplierId, qty, name }]);
    await client.query(
      `INSERT INTO supplier_return_items
         (supplier_id, product_id, return_line_id, qty, reason, problem, unit_cost, created_by,
          purchase_order_id, source, shop, note)
       SELECT $1, $2, NULL, $3, 'defaut', $4, COALESCE($5::numeric, p.computed_cost, p.wc_cog_cost), $6,
              $7, 'boutique', $8, $9
         FROM products p WHERE p.id = $2`,
      [Number(supplierId), product.id, Number(qty), String(problem).trim(), lot.unit_cost, user.id,
        lot.purchase_order_id, Number(shop), String(note || '').trim() || null]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { supplierId: Number(supplierId) };
};

/** Change la commande fournisseur d'une pièce encore à retourner. */
const setItemLot = async (itemId, purchaseOrderId) => {
  const client = await pool.connect();
  let supplierId;
  try {
    await client.query('BEGIN');
    const { rows: [i] } = await client.query(
      `SELECT i.*, p.post_title FROM supplier_return_items i JOIN products p ON p.id = i.product_id
        WHERE i.id = $1 FOR UPDATE OF i`,
      [itemId]
    );
    if (!i) throw httpError(404, 'Pièce introuvable.');
    if (i.status !== 'a_retourner') throw httpError(400, 'Pièce déjà envoyée au fournisseur.');
    supplierId = i.supplier_id;
    const [lot] = await reserveLots(client, [{
      purchaseOrderId, productId: i.product_id, supplierId: i.supplier_id, qty: i.qty,
      name: i.post_title, excludeItemId: i.id,
    }]);
    await client.query(
      'UPDATE supplier_return_items SET purchase_order_id = $2, unit_cost = COALESCE($3::numeric, unit_cost) WHERE id = $1',
      [itemId, lot.purchase_order_id, lot.unit_cost]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return supplierItems(supplierId);
};

/** Une pièce boutique saisie par erreur (celles du site suivent leur retour). */
const deleteBoutiqueItem = async (itemId) => {
  const { rows: [i] } = await pool.query(
    `DELETE FROM supplier_return_items WHERE id = $1 AND source = 'boutique' AND status = 'a_retourner'
     RETURNING supplier_id`,
    [itemId]
  );
  if (!i) throw httpError(400, 'Seule une pièce boutique encore à retourner se supprime.');
  return supplierItems(i.supplier_id);
};

module.exports = {
  searchProducts,
  productLots,
  createBoutiqueItem,
  setItemLot,
  deleteBoutiqueItem,
  orderContext,
  create,
  declareLost,
  declareUnclaimed,
  update,
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
  replacementPreview,
  productStock,
  createReplacement,
  reship,
  cancelOutcome,
  setPartial,
  creditPoints,
  linkRefund,
  matchRefunds,
  createLabel,
  getLabel,
  linkCredit,
  unlinkCredit,
};
