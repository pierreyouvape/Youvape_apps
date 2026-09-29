/**
 * Factures et avoirs fournisseur : enregistrement, relecture, règlements.
 *
 * Deux choses s'écrivent ici et nulle part ailleurs :
 *
 * • L'ANALYSE GELÉE. Les quantités et prix ATTENDUS sont recopiés dans
 *   `supplier_document_lines` au moment du contrôle. La commande BMS bouge dès
 *   qu'on la corrige — sur S311485, la ligne litigieuse était déjà passée de 8
 *   à 7 avant qu'on la regarde — et une preuve qui s'efface quand on corrige ne
 *   prouve rien. Relire un document, c'est relire ce qui a été constaté, pas
 *   rejouer la comparaison.
 *
 * • LES RÈGLEMENTS, qui ne se déduisent jamais du document. Un relevé Amex
 *   solde plusieurs factures et un avoir d'un coup ; une facture se règle en
 *   deux fois. Le reste à payer se calcule (vue `supplier_document_balances`),
 *   il ne se stocke pas.
 */

const pool = require('../config/database');
const supplierRefModel = require('./supplierRefModel');

const VALID_STATUSES = ['to_check', 'checked', 'disputed', 'archived'];
const VALID_METHODS = ['cb', 'amex', 'virement', 'prelevement', 'avoir', 'especes', 'cheque', 'autre'];

/** Ce document est-il déjà enregistré pour ce fournisseur ? */
async function findExisting(supplierId, number, db = pool) {
  if (!supplierId || !number) return null;
  const { rows } = await db.query(
    `SELECT id, number, doc_type, doc_date, total_ttc, status, created_at
       FROM supplier_documents WHERE supplier_id = $1 AND number = $2`,
    [supplierId, number],
  );
  return rows[0] || null;
}

/**
 * Enregistre un document et son analyse, en une transaction.
 * Renvoie `{ duplicate: true, existing }` si ce numéro est déjà arrivé de ce
 * fournisseur : c'est le garde-fou contre le double dépôt, donc le double
 * paiement.
 */
async function createDocument({ supplier, invoice, order, comparison, filePath, originalName, matchedBy, userId }, db = pool) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT id, number, doc_date, total_ttc, status FROM supplier_documents WHERE supplier_id = $1 AND number = $2',
      [supplier.id, invoice.number],
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return { duplicate: true, existing: existing.rows[0] };
    }

    const docRes = await client.query(
      `INSERT INTO supplier_documents (
         supplier_id, doc_type, number, doc_date, due_date, currency,
         total_ht, total_tva, total_ttc, stated_payment_method, order_ref_on_doc,
         status, file_path, analysis, created_by
       ) VALUES ($1,$2,$3,$4,$5,'EUR',$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        supplier.id,
        invoice.docType || (invoice.isProforma ? 'proforma' : 'invoice'),
        invoice.number,
        invoice.date,
        invoice.dueDate,
        invoice.totalHt,
        invoice.totalTva,
        invoice.totalTtc,
        invoice.statedPaymentMethod,
        invoice.orderRefOnDoc,
        'to_check',
        filePath,
        comparison
          ? JSON.stringify({
              totals: comparison.totals,
              summary: comparison.summary,
              warnings: invoice.warnings || [],
              originalName,
              correctsInvoice: invoice.correctsInvoice || null,
              statedPayments: invoice.payments || [],
            })
          : JSON.stringify({ warnings: invoice.warnings || [], originalName }),
        userId || null,
      ],
    );
    const document = docRes.rows[0];

    // Les lignes, avec l'état de la commande FIGÉ à cet instant.
    const lines = comparison ? comparison.lines : (invoice.lines || []).map((l) => ({ ...l, verdict: null }));
    let lineNo = 0;
    for (const l of lines) {
      lineNo += 1;
      await client.query(
        `INSERT INTO supplier_document_lines (
           document_id, line_no, supplier_sku, label, kind, qty, line_total_ht,
           product_id, expected_qty, expected_unit_price, verdict, material,
           gap_qty, gap_price, gap, effective_unit_cost
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          document.id,
          lineNo,
          l.ref || null,
          l.label || null,
          ['product', 'shipping', 'discount', 'other'].includes(l.verdict) ? l.verdict : (l.kind || 'product'),
          l.qtyInvoiced != null ? l.qtyInvoiced : l.qty,
          l.invoicedTotal != null ? l.invoicedTotal : l.lineTotalHt,
          l.productId || null,
          l.qtyOrdered != null ? l.qtyOrdered : null,
          l.expectedUnitPrice != null ? l.expectedUnitPrice : null,
          l.verdict || null,
          l.material || false,
          l.gapQty || 0,
          l.gapPrice || 0,
          l.gap || 0,
          l.effectiveUnitCost != null ? l.effectiveUnitCost : null,
        ],
      );
    }

    if (order && order.id) {
      await client.query(
        `INSERT INTO supplier_document_orders (document_id, purchase_order_id, matched_by)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [document.id, order.id, matchedBy || 'reference'],
      );
    }

    await client.query('COMMIT');
    return { duplicate: false, document };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Liste filtrable : fournisseur, état du contrôle, état du paiement, période. */
async function listDocuments({ supplierId, status, paymentStatus, from, to, docType, search, limit = 100, offset = 0 } = {}, db = pool) {
  const where = [];
  const params = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };

  if (supplierId) add('d.supplier_id = ?', supplierId);
  if (status) add('d.status = ?', status);
  if (docType) add('d.doc_type = ?', docType);
  if (from) add('d.doc_date >= ?', from);
  if (to) add('d.doc_date <= ?', to);
  if (paymentStatus) add('b.payment_status = ?', paymentStatus);
  // Recherche libre : le numéro de document ou le nom du fournisseur, c'est
  // par l'un ou l'autre qu'on cherche une facture qu'on a en main.
  if (search) {
    params.push(`%${String(search).trim()}%`);
    where.push(`(d.number ILIKE $${params.length} OR s.name ILIKE $${params.length}
                 OR d.order_ref_on_doc ILIKE $${params.length})`);
  }

  params.push(limit, offset);
  const { rows } = await db.query(
    `SELECT d.*, s.name AS supplier_name,
            b.paid_amount, b.remaining_amount, b.payment_status, b.effective_due_date,
            (SELECT count(*) FROM supplier_document_lines l
              WHERE l.document_id = d.id AND l.verdict IS NOT NULL AND l.verdict <> 'ok') AS difference_count,
            -- Les trois dates que l'acheteur suit : quand il a commandé, quand
            -- le fournisseur a facturé, quand l'argent est parti.
            (SELECT min(po.order_date) FROM supplier_document_orders o
               JOIN purchase_orders po ON po.id = o.purchase_order_id
              WHERE o.document_id = d.id) AS order_date,
            (SELECT max(p.paid_at) FROM supplier_payment_allocations a
               JOIN supplier_payments p ON p.id = a.payment_id
              WHERE a.document_id = d.id) AS paid_at
       FROM supplier_documents d
       JOIN suppliers s ON s.id = d.supplier_id
       LEFT JOIN supplier_document_balances b ON b.document_id = d.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY d.doc_date DESC, d.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

/** Document complet : lignes gelées, commandes liées, règlements imputés. */
async function getDocument(id, db = pool) {
  const { rows } = await db.query(
    `SELECT d.*, s.name AS supplier_name, s.email AS supplier_email, s.contact_name,
            b.paid_amount, b.remaining_amount, b.payment_status, b.effective_due_date
       FROM supplier_documents d
       JOIN suppliers s ON s.id = d.supplier_id
       LEFT JOIN supplier_document_balances b ON b.document_id = d.id
      WHERE d.id = $1`,
    [id],
  );
  const document = rows[0];
  if (!document) return null;

  const [lines, orders, payments] = await Promise.all([
    db.query('SELECT * FROM supplier_document_lines WHERE document_id = $1 ORDER BY line_no', [id]),
    db.query(
      `SELECT po.id, po.bms_po_id, po.bms_reference, po.order_number, po.order_date, po.total_amount, o.matched_by
         FROM supplier_document_orders o
         JOIN purchase_orders po ON po.id = o.purchase_order_id
        WHERE o.document_id = $1`,
      [id],
    ),
    db.query(
      `SELECT p.id, p.method, p.paid_at, p.amount AS payment_amount, p.reference, a.amount AS allocated
         FROM supplier_payment_allocations a
         JOIN supplier_payments p ON p.id = a.payment_id
        WHERE a.document_id = $1
        ORDER BY p.paid_at`,
      [id],
    ),
  ]);

  return { ...document, lines: lines.rows, orders: orders.rows, payments: payments.rows };
}

async function updateStatus(id, status, db = pool) {
  if (!VALID_STATUSES.includes(status)) throw new Error(`Statut inconnu : ${status}`);
  const { rows } = await db.query(
    'UPDATE supplier_documents SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
    [id, status],
  );
  return rows[0] || null;
}

/**
 * Enregistre un règlement et ce qu'il solde, en une transaction.
 * `allocations` : [{ documentId, amount }] — montants SIGNÉS, négatifs pour un
 * avoir venant en déduction du règlement.
 */
async function createPayment({ supplierId, method, paidAt, amount, reference, notes, allocations = [], userId }, db = pool) {
  if (!VALID_METHODS.includes(method)) throw new Error(`Moyen de paiement inconnu : ${method}`);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO supplier_payments (supplier_id, method, paid_at, amount, reference, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [supplierId, method, paidAt, amount, reference || null, notes || null, userId || null],
    );
    const payment = rows[0];

    for (const a of allocations) {
      await client.query(
        `INSERT INTO supplier_payment_allocations (payment_id, document_id, amount)
         VALUES ($1,$2,$3)
         ON CONFLICT (payment_id, document_id) DO UPDATE SET amount = EXCLUDED.amount`,
        [payment.id, a.documentId, a.amount],
      );
    }

    await client.query('COMMIT');
    return payment;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Règlements d'un fournisseur, avec ce que chacun solde. */
async function listPayments({ supplierId, method, from, to, limit = 100 } = {}, db = pool) {
  const where = [];
  const params = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
  if (supplierId) add('p.supplier_id = ?', supplierId);
  if (method) add('p.method = ?', method);
  if (from) add('p.paid_at >= ?', from);
  if (to) add('p.paid_at <= ?', to);
  params.push(limit);

  const { rows } = await db.query(
    `SELECT p.*, s.name AS supplier_name,
            COALESCE(SUM(a.amount), 0) AS allocated_amount,
            p.amount - COALESCE(SUM(a.amount), 0) AS unallocated_amount,
            count(a.document_id) AS document_count,
            -- Les numéros eux-mêmes, pas seulement leur nombre : « 1 document »
            -- ne dit pas lequel, et c'est justement ce qu'on cherche en relisant
            -- un relevé Amex qui solde six factures.
            string_agg(d.number, ', ' ORDER BY d.doc_date) AS document_numbers,
            -- Un règlement qui ne solde que des avoirs n'est pas un paiement :
            -- c'est un avoir qu'on consomme. L'écran doit pouvoir le dire.
            count(*) FILTER (WHERE d.doc_type = 'credit_note') AS credit_note_count
       FROM supplier_payments p
       JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN supplier_payment_allocations a ON a.payment_id = p.id
       LEFT JOIN supplier_documents d ON d.id = a.document_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      GROUP BY p.id, s.name
      ORDER BY p.paid_at DESC, p.id DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

/** Documents restant à régler : ce qu'on doit, et depuis quand. */
async function listUnpaid({ supplierId } = {}, db = pool) {
  const params = [];
  let filter = '';
  if (supplierId) { params.push(supplierId); filter = ` AND d.supplier_id = $${params.length}`; }
  const { rows } = await db.query(
    `SELECT b.*, s.name AS supplier_name, d.doc_type, d.status,
            (CURRENT_DATE - b.effective_due_date) AS days_overdue
       FROM supplier_document_balances b
       JOIN supplier_documents d ON d.id = b.document_id
       JOIN suppliers s ON s.id = d.supplier_id
      WHERE b.payment_status IN ('unpaid', 'partial')${filter}
      ORDER BY b.effective_due_date NULLS LAST, b.document_id`,
    params,
  );
  return rows;
}

async function deleteDocument(id, db = pool) {
  const { rows } = await db.query(
    'DELETE FROM supplier_documents WHERE id = $1 RETURNING file_path',
    [id],
  );
  return rows[0] || null;
}

/**
 * Commandes candidates au rapprochement manuel d'un fournisseur.
 *
 * Nécessaire parce que la référence imprimée ne mène pas toujours à la commande :
 * la facture GFC F2601377295 porte « 548638 », le numéro interne du fournisseur,
 * quand la commande BMS 107811 est enregistrée chez nous sous « ZWMEFWKYY ».
 * Aucun rapprochement automatique n'est possible — il faut pouvoir la désigner.
 *
 * `q` accepte la référence, le numéro de commande, l'identifiant BMS, et jusqu'à
 * l'URL BMS collée telle quelle : c'est ce que l'acheteur a sous la main quand il
 * regarde la commande dans BMS.
 */
async function listCandidateOrders(supplierId, q, limit = 40) {
  const params = [supplierId];
  let filtre = '';

  const terme = (q || '').trim();
  if (terme) {
    // « …/po_id/107811/key/… » ou « 107811 » : on retient le nombre du lien.
    const lien = terme.match(/po_id\/(\d+)/);
    const bmsId = lien ? Number(lien[1]) : (/^\d+$/.test(terme) ? Number(terme) : null);

    params.push(`%${terme}%`);
    filtre = ` AND (po.bms_reference ILIKE $${params.length} OR po.order_number ILIKE $${params.length}`;
    if (bmsId) {
      params.push(bmsId);
      filtre += ` OR po.bms_po_id = $${params.length}`;
    }
    filtre += ')';
  }

  params.push(limit);
  const { rows } = await pool.query(
    `SELECT po.id, po.bms_po_id, po.bms_reference, po.order_number, po.order_date,
            po.total_amount, po.status
       FROM purchase_orders po
      WHERE po.supplier_id = $1${filtre}
      ORDER BY po.order_date DESC NULLS LAST
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

/**
 * Écrire les tarifs relevés sur une facture dans `supplier_refs.pack_price`.
 *
 * C'est la règle du meilleur prix payé : à l'import, `convertLine` retient le
 * moins cher entre le prix du document et celui de la base. Inscrire ici le prix
 * réellement payé — promotions comprises — fait que les commandes suivantes le
 * reprendront, et une facture ultérieure révélera tout changement de tarif.
 *
 * DEUX PRIX DIFFÉRENTS PORTENT LE MÊME NOM. Le prix relevé sur la facture est
 * celui d'un pack de `packQty` pièces au sens BMS ; `pack_price` est celui d'un
 * pack de `supplier_refs.pack_qty` pièces. Quand les deux conditionnements
 * diffèrent, on convertit — et si la conversion ne tombe pas juste, on N'ÉCRIT
 * PAS : confondre prix de pack et prix unitaire a déjà coûté deux bugs (LCA
 * Mozambique enregistré à 1,34 € au lieu de 13,40 €).
 */
async function alignTariffs(supplierId, tariffs, db = pool) {
  const applied = [];
  const skipped = [];

  for (const t of tariffs || []) {
    const ref = await supplierRefModel.findBySku(supplierId, t.ref, db);
    if (!ref) {
      skipped.push({ ref: t.ref, reason: 'référence inconnue de ce fournisseur' });
      continue;
    }

    const bmsPack = Number(t.packQty) || 1;
    const refPack = Number(ref.pack_qty) || 1;
    const prixPack = (Number(t.realPrice) || 0) * (refPack / bmsPack);

    if (!Number.isFinite(prixPack) || prixPack <= 0) {
      skipped.push({ ref: t.ref, reason: 'prix inexploitable' });
      continue;
    }
    // Deux décimales en base : au-delà, on inscrirait un prix qu'on ne saurait
    // pas relire.
    const arrondi = Math.round(prixPack * 100) / 100;
    if (Math.abs(arrondi - prixPack) > 0.005) {
      skipped.push({
        ref: t.ref,
        reason: `conditionnements incompatibles (facture par ${bmsPack}, réf. par ${refPack})`,
      });
      continue;
    }

    const { rows } = await db.query(
      `UPDATE supplier_refs
          SET pack_price = $3, updated_at = CURRENT_TIMESTAMP
        WHERE supplier_id = $1 AND id = $2
        RETURNING supplier_sku, pack_qty, pack_price`,
      [supplierId, ref.id, arrondi],
    );
    applied.push({
      ref: rows[0].supplier_sku,
      packQty: rows[0].pack_qty,
      packPrice: Number(rows[0].pack_price),
      previous: ref.pack_price == null ? null : Number(ref.pack_price),
    });
  }

  return { applied, skipped };
}

module.exports = {
  alignTariffs,
  listCandidateOrders,
  findExisting,
  createDocument,
  listDocuments,
  getDocument,
  updateStatus,
  createPayment,
  listPayments,
  listUnpaid,
  deleteDocument,
  VALID_STATUSES,
  VALID_METHODS,
};
