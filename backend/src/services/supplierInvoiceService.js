/**
 * Contrôle d'une facture fournisseur : du PDF déposé au tableau d'écarts.
 *
 * Enchaîne les briques déjà en place — parseur du gabarit, résolution des
 * références en produits, récupération de la commande, moteur de comparaison —
 * et ne décide de rien : c'est l'écran qui aligne, réclame ou classe.
 *
 * DEUX PARTIS PRIS QUI ONT COÛTÉ CHER À TROUVER
 *
 * 1. LA COMMANDE EST LUE SUR LE VPS, plus dans BMS (19/10/2026).
 *    Jusque-là, BMS faisait foi parce que les prix s'y corrigeaient : la base
 *    locale retardait d'une synchro (commande 356948 : 4 409,95 € chez nous,
 *    4 149,55 € chez BMS). Les tarifs se gèrent désormais ici, la synchro garde
 *    nos prix (cf. purchaseOrderModel.syncFromBMS), et c'est BMS qui retarde :
 *    commande LCA 361181, pods Argus à 8,22 € la pièce dans BMS contre 4,11 €
 *    réels, facture annoncée -387,19 € d'écart pour -17,29 €.
 *
 * 2. LE RAPPROCHEMENT PASSE PAR LE PRODUIT, pas par la chaîne de caractères.
 *    611 lignes de commande (3 %) portent le SKU interne faute de référence
 *    fournisseur dans BMS. Les apparier sur le texte fabriquerait une fausse
 *    paire « commandé non facturé » / « facturé non commandé » qui se
 *    compensent, et masquerait le vrai écart au milieu.
 *
 * L'analyse renvoyée est destinée à être GELÉE en base (supplier_document_lines) :
 * la commande BMS bouge dès qu'on la corrige, et une preuve qui s'efface au
 * moment où on la corrige ne prouve rien.
 */

const { PDFParse } = require('pdf-parse');
const pool = require('../config/database');
const { cleanPdfText, isPdf } = require('../utils/pdfText');
const invoiceParsers = require('../parsers/invoices');
const supplierRefModel = require('../models/supplierRefModel');
const { compareInvoiceToOrder, listDifferences, listTariffUpdates, listControlRows } = require('../utils/invoiceCompare');
const { attachMatchKeys } = require('../utils/invoiceMatching');
const { resolveCompleteRefs } = require('../utils/refResolution');
const { detachVouchers } = require('../utils/invoiceVouchers');
const supplierVoucherModel = require('../models/supplierVoucherModel');
const { piecesSoldeesSql } = require('../models/orderLifecycleModel');

/** Extrait le texte d'un PDF (ou lit un fichier texte), puis le nettoie. */
async function extractText(buffer) {
  if (!isPdf(buffer)) {
    let decoded = buffer.toString('utf-8');
    if (decoded.includes('�')) decoded = buffer.toString('latin1');
    return cleanPdfText(decoded.replace(/^﻿/, ''));
  }
  const parser = new PDFParse(new Uint8Array(buffer));
  await parser.load();
  const data = await parser.getText();
  return cleanPdfText(data.text);
}

/** Références fournisseur → produit, pour les réfs vues sur la facture. */
async function findRefProducts(supplierId, refs, db = pool) {
  const map = new Map();
  const wanted = [...new Set((refs || []).filter(Boolean).map((r) => String(r).toLowerCase().replace(/\s+/g, ' ').trim()))];
  if (wanted.length === 0) return map;
  const { rows } = await db.query(
    `SELECT ${supplierRefModel.normalizedSql('r.supplier_sku')} AS norm, r.product_id
       FROM supplier_refs r
      WHERE r.supplier_id = $1
        AND ${supplierRefModel.normalizedSql('r.supplier_sku')} = ANY($2)`,
    [supplierId, wanted],
  );
  for (const row of rows) map.set(row.norm, row.product_id);
  return map;
}

/** SKU internes → produit, pour les lignes de commande sans référence fournisseur. */
async function findSkuProducts(skus, db = pool) {
  const map = new Map();
  const wanted = [...new Set((skus || []).filter(Boolean).map(String))];
  if (wanted.length === 0) return map;
  const { rows } = await db.query(
    'SELECT lower(btrim(sku)) AS norm, id FROM products WHERE sku = ANY($1)',
    [wanted],
  );
  for (const row of rows) map.set(row.norm, row.id);
  return map;
}

/**
 * Retrouve la commande à partir de la référence imprimée sur la facture.
 * Chez GFC et MG Vape cette référence est le numéro interne du fournisseur et
 * ne correspond à rien chez nous : on renvoie null, l'écran demandera alors de
 * désigner la commande à la main.
 */
async function findOrderByRef(supplierId, orderRef, db = pool) {
  if (!orderRef) return null;
  const { rows } = await db.query(
    `SELECT id, bms_po_id, bms_reference, order_number, order_date, total_amount, verified
       FROM purchase_orders
      WHERE supplier_id = $1
        AND (bms_reference = $2 OR order_number = $2)
      ORDER BY order_date DESC NULLS LAST
      LIMIT 1`,
    [supplierId, String(orderRef).trim()],
  );
  return rows[0] || null;
}

/**
 * Lignes de la commande telles que le VPS les connaît (cf. parti pris 1).
 *
 * Même forme que la lecture BMS qu'elle remplace : `qty × price` est le montant
 * de la ligne, dans l'unité de la ligne (pièce, ou lot de `units_per_qty` chez
 * les fournisseurs « à l'unité »). Les remises de pied saisies sur la commande
 * ne sont pas des lignes de produit : la facture a les siennes.
 */
async function loadOrderLines(order, db = pool) {
  const { rows } = await db.query(
    `SELECT poi.supplier_sku, p.sku, poi.product_name, poi.qty_ordered, poi.unit_price,
            COALESCE(poi.units_per_qty, 1) AS units_per_qty,
            (${piecesSoldeesSql('poi', 'po')})::numeric
              / GREATEST(COALESCE(poi.units_per_qty, 1), 1) AS closed_qty
       FROM purchase_order_items poi
       JOIN purchase_orders po ON po.id = poi.purchase_order_id
       LEFT JOIN products p ON p.id = poi.product_id
      WHERE poi.purchase_order_id = $1
        AND poi.item_type IS DISTINCT FROM 'discount'
      ORDER BY poi.id`,
    [order.id],
  );
  return {
    reference: order.bms_reference || order.order_number,
    verified: order.verified == null ? null : !!order.verified,
    lines: rows.map((r) => ({
      ref: r.supplier_sku || r.sku || null,
      sku: r.sku || null,
      productName: r.product_name || null,
      qty: Number(r.qty_ordered) || 0,
      price: Number(r.unit_price) || 0,
      packQty: Number(r.units_per_qty) || 1,
      // Ce que la réception a SOLDÉ sur cette ligne (non livré, plus attendu),
      // dans l'unité de la ligne. Même règle que l'état de réception
      // (orderLifecycleModel.piecesSoldeesSql) : motif de clôture, ou commande
      // Terminée. Déduit de ce que la facture doit porter (cf. invoiceCompare).
      closedQty: Number(r.closed_qty) || 0,
    })),
  };
}

/**
 * Analyse complète d'une facture déposée.
 *
 * @param {Buffer} buffer      le fichier tel que déposé
 * @param {number} supplierId  fournisseur choisi à l'écran
 * @param {number} [orderId]   commande imposée à la main (rapprochement manuel)
 * @param {number} [documentId] document déjà enregistré qu'on re-contrôle : ses
 *                             bons déjà consommés restent les siens
 */
async function analyseInvoice({ buffer, supplierId, orderId = null, documentId = null, db = pool }) {
  const { rows: supRows } = await db.query(
    'SELECT id, name, code FROM suppliers WHERE id = $1',
    [supplierId],
  );
  const supplier = supRows[0];
  if (!supplier) throw new Error('Fournisseur introuvable');

  const parser = invoiceParsers.getInvoiceParser(supplier.code);
  if (!parser) {
    throw new Error(
      `Pas de parseur de facture pour ${supplier.name} (code : ${supplier.code || 'non défini'}). ` +
      `Gabarits connus : ${invoiceParsers.availableInvoiceParsers().join(', ')}`,
    );
  }

  const text = await extractText(buffer);
  const invoice = parser.parseInvoice(text);
  if (!invoice.lines || invoice.lines.length === 0) {
    throw new Error('Aucune ligne lue dans ce document');
  }

  // Les colonnes « Référence » et « Désignation » sont aplaties dans le PDF :
  // une référence contenant un espace est tronquée par le parseur, qui ne peut
  // pas deviner où elle s'arrête. On la reconstitue depuis les références
  // connues de CE fournisseur. Sans cette étape, « VP RES GTI 0.15 » et
  // « VP Box Arm S Cyber Gold » se réduisent tous deux à « VP » et fusionnent.
  const { rows: knownRefs } = await db.query(
    'SELECT supplier_sku FROM supplier_refs WHERE supplier_id = $1',
    [supplierId],
  );
  resolveCompleteRefs(invoice.lines, knownRefs.map((r) => r.supplier_sku));

  // Un bon émis sur une facture précédente et déduit ici n'est pas une remise
  // de cette commande : on le sort de la remise de pied avant toute analyse,
  // sans quoi il serait réparti sur le coût des lignes (cf. invoiceVouchers).
  let vouchersUsed = [];
  // Les bons encore à valoir que ce document n'a PAS consommés : si la facture
  // porte une remise, l'écran demande si c'en est un (code pas encore saisi).
  let vouchersOpen = [];
  if (invoice.docType !== 'credit_note') {
    const candidats = await supplierVoucherModel.candidatesFor(
      { supplierId, documentId, invoiceNumber: invoice.number || null },
      db,
    );
    const detache = detachVouchers({ lines: invoice.lines, text, vouchers: candidats });
    invoice.lines = detache.lines;
    vouchersUsed = detache.used.map((u) => {
      const v = candidats.find((c) => c.id === u.id) || {};
      return { ...u, code: v.code || null, sourceNumber: v.source_number || null, voucherAmount: Number(v.amount_ht) };
    });
    vouchersOpen = candidats
      .filter((c) => !detache.used.some((u) => u.id === c.id))
      .map((c) => ({ id: c.id, code: c.code || null, amount: Number(c.amount_ht), sourceNumber: c.source_number }));
  }

  // La commande : celle imposée, sinon celle que désigne la référence imprimée.
  let order = null;
  let matchedBy = null;
  if (orderId) {
    const { rows } = await db.query(
      'SELECT id, bms_po_id, bms_reference, order_number, order_date, total_amount, verified FROM purchase_orders WHERE id = $1',
      [orderId],
    );
    order = rows[0] || null;
    matchedBy = 'manual';
  } else {
    order = await findOrderByRef(supplierId, invoice.orderRefOnDoc, db);
    matchedBy = order ? 'reference' : null;
  }

  if (!order) {
    // Facture lue, commande introuvable : l'écran propose de la désigner.
    return {
      supplier,
      invoice,
      order: null,
      matchedBy: null,
      comparison: null,
      differences: [],
      vouchersUsed,
      vouchersOpen,
      needsManualOrder: true,
    };
  }

  const bmsOrder = await loadOrderLines(order, db);

  // PLUSIEURS FACTURES POUR UNE COMMANDE : c'est leur somme qui se compare à
  // la commande. LCA a facturé la 361704 en deux (F2610418141, 120,00 € et
  // F2610418130, 2 617,19 €) : contrôlée seule, chacune voyait l'autre comme un
  // manque, -2 617,19 € d'un côté et -120,00 € de l'autre, pour une commande
  // facturée au centime. Les lignes déjà enregistrées des AUTRES factures entrent
  // donc dans le rapprochement, marquées comme telles (jamais les avoirs, qui ont
  // leur propre lecture, ni un second dépôt du même numéro).
  let autresFactures = [];
  if (invoice.docType !== 'credit_note') {
    const { rows: autres } = await db.query(
      `SELECT d.number, l.supplier_sku, l.label, l.qty, l.line_total_ht
         FROM supplier_document_orders o
         JOIN supplier_documents d ON d.id = o.document_id
         JOIN supplier_document_lines l ON l.document_id = d.id
        WHERE o.purchase_order_id = $1
          AND d.doc_type = 'invoice'
          AND ($2::int IS NULL OR d.id <> $2::int)
          AND ($3::text IS NULL OR d.number <> $3::text)
          AND l.kind = 'product'
          -- Une ligne « soldée » peut porter un montant (16 facturés sur 17,
          -- le 17e soldé) : c'est le montant nul ci-dessous qui l'écarte.
          AND COALESCE(l.verdict, '') NOT IN ('missing_in_invoice', 'other_invoice')
          AND (COALESCE(l.qty, 0) <> 0 OR COALESCE(l.line_total_ht, 0) <> 0)
        ORDER BY d.id, l.line_no`,
      [order.id, documentId || null, invoice.number || null],
    );
    autresFactures = autres.map((a) => ({
        ref: a.supplier_sku,
        label: a.label,
        qty: Number(a.qty) || 0,
        lineTotalHt: Number(a.line_total_ht) || 0,
        kind: 'product',
        otherDocument: a.number,
      }));
    invoice.otherDocuments = [...new Set(autres.map((a) => a.number))];
  }

  const refProducts = await findRefProducts(
    supplierId,
    [...invoice.lines.map((l) => l.ref), ...autresFactures.map((l) => l.ref), ...bmsOrder.lines.map((l) => l.ref)],
    db,
  );
  const skuProducts = await findSkuProducts(bmsOrder.lines.map((l) => l.sku), db);

  const keyed = attachMatchKeys({
    invoiceLines: [...invoice.lines, ...autresFactures],
    orderLines: bmsOrder.lines,
    refProducts,
    skuProducts,
  });

  const comparison = compareInvoiceToOrder({
    invoice: { ...invoice, lines: keyed.invoiceLines },
    order: { reference: bmsOrder.reference, lines: keyed.orderLines },
    // Un avoir ne reprend que ce qu'il corrige : le reste de la commande n'est
    // pas « non facturé ».
    options: {
      expectFullOrder: invoice.docType !== 'credit_note',
      // Pour retrouver l'assiette d'une remise de pied ciblée (cf. discountScopes).
      supplierCode: supplier.code,
    },
  });

  const tarifs = listTariffUpdates(comparison);

  return {
    supplier,
    invoice,
    order: { ...order, bmsReference: bmsOrder.reference, verified: bmsOrder.verified },
    matchedBy,
    comparison,
    // Le tableau unique de l'écran : écarts et tarifs réunis, chaque ligne
    // portant son motif.
    rows: listControlRows(comparison),
    // Conservés pour l'enregistrement et les usages existants.
    differences: listDifferences(comparison),
    tariffs: tarifs,
    // Les bons à valoir que ce document consomme : à inscrire à l'enregistrement.
    vouchersUsed,
    vouchersOpen,
    needsManualOrder: false,
  };
}

module.exports = {
  analyseInvoice,
  findOrderByRef,
  findRefProducts,
  findSkuProducts,
  extractText,
};
