/**
 * Contrôle d'une facture fournisseur : du PDF déposé au tableau d'écarts.
 *
 * Enchaîne les briques déjà en place — parseur du gabarit, résolution des
 * références en produits, récupération de la commande, moteur de comparaison —
 * et ne décide de rien : c'est l'écran qui aligne, réclame ou classe.
 *
 * DEUX PARTIS PRIS QUI ONT COÛTÉ CHER À TROUVER
 *
 * 1. LA COMMANDE EST LUE EN DIRECT DANS BMS, jamais dans la copie locale.
 *    Les prix sont corrigés dans BMS pendant le contrôle, et la synchro locale
 *    ne repasse qu'après : sur la commande 356948, la base disait 4 409,95 €
 *    quand BMS disait 4 149,55 €. Contrôler sur la copie locale, c'est
 *    réclamer des écarts qui n'existent plus.
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
const bmsApiModel = require('../models/bmsApiModel');
const { compareInvoiceToOrder, listDifferences, listTariffUpdates } = require('../utils/invoiceCompare');
const { attachMatchKeys } = require('../utils/invoiceMatching');
const { resolveCompleteRefs } = require('../utils/refResolution');

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

/** Lignes de la commande telles que BMS les donne À L'INSTANT (cf. parti pris 1). */
async function fetchOrderLines(bmsPoId) {
  const data = await bmsApiModel.apiCall(`/supplier/purchase-orders/${bmsPoId}`);
  const po = data.data || data;
  return {
    reference: po.reference,
    verified: po.verified == null ? null : !!Number(po.verified),
    // BMS compte en PACKS (`qty` = nombre de packs, `price` = prix du pack), les
    // factures parfois en pièces, parfois en packs — et pas les mêmes selon le
    // fournisseur : LCA et Highbuy facturent le pack comme BMS, Levest et Cloud
    // Vapor la pièce. On ne convertit donc RIEN ici.
    //
    // Convertir la commande en pièces a été essayé le 28/09/2026 : ça rend
    // lisible l'écran Levest, mais ça fait exploser le réclamable LCA de 40,60 €
    // à 94,33 € — la ligne #REF11324-36716, commandée ET facturée par packs de
    // 200, se retrouvait comparée « 200 × 0,27 € » contre « 1 × 60,00 € », et son
    // écart de tarif passait de 6,00 € à 59,73 €.
    //
    // Ce qui tranche vraiment, c'est l'ARGENT : qty × price est le même des deux
    // côtés du conditionnement, et le verdict « conditionnement » reconnaît
    // l'écart de quantité à montant égal. `packQty` est transmis pour que l'écran
    // puisse expliquer la quantité affichée.
    lines: (po.items || []).map((i) => ({
      ref: i.supplier_sku || i.sku || null,
      sku: i.sku || null,
      productName: i.name || null,
      qty: Number(i.qty) || 0,
      price: Number(i.price) || 0,
      packQty: Number(i.qty_pack) || 1,
    })),
  };
}

/**
 * Analyse complète d'une facture déposée.
 *
 * @param {Buffer} buffer      le fichier tel que déposé
 * @param {number} supplierId  fournisseur choisi à l'écran
 * @param {number} [orderId]   commande imposée à la main (rapprochement manuel)
 */
async function analyseInvoice({ buffer, supplierId, orderId = null, db = pool }) {
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
      needsManualOrder: true,
    };
  }

  const bmsOrder = await fetchOrderLines(order.bms_po_id);

  const refProducts = await findRefProducts(
    supplierId,
    [...invoice.lines.map((l) => l.ref), ...bmsOrder.lines.map((l) => l.ref)],
    db,
  );
  const skuProducts = await findSkuProducts(bmsOrder.lines.map((l) => l.sku), db);

  const keyed = attachMatchKeys({
    invoiceLines: invoice.lines,
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
    // Les écarts, MOINS ceux que le tableau des tarifs traite déjà.
    //
    // Une ligne dont le seul reproche est le tarif figurait deux fois de suite :
    // en haut avec son bouton « Retenir », en bas avec « Réclamer un avoir ». Le
    // tableau des tarifs dit la même chose et permet d'agir — l'autre n'ajoutait
    // rien.
    //
    // Les lignes « quantité ET tarif » restent dans les deux : le tableau des
    // écarts y montre la quantité commandée face à la quantité facturée, que
    // celui des tarifs n'affiche pas.
    differences: listDifferences(comparison).filter(
      (d) => !(d.verdict === 'price' && tarifs.some((t) => t.ref === d.ref)),
    ),
    // Ce qu'il faut corriger dans BMS : l'API ne sait pas l'écrire (aucune route
    // d'écriture sur /supplier/products), l'acheteur le reporte à la main.
    tariffs: tarifs,
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
