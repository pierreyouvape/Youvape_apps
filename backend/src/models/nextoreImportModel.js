/**
 * Boutiques Nextore — import d'une commande fournisseur (PDF/CSV).
 *
 * Même écran et mêmes champs que l'import du site (pdfImportModel.parsePdf) :
 * mêmes parseurs (readDocument), même conversion (convertLine), même forme de
 * ligne — l'écran boutique est une copie de ImportPdfPage. Le fournisseur du
 * site correspondant (nextore_suppliers.site_supplier_id) donne le parseur.
 *
 * Une ligne du document est rattachée à un produit Nextore, dans l'ordre :
 *   1. réf boutique déjà mappée (nextore_supplier_refs) ;
 *   2. proposition du site : réf du site → produit WC → code-barres → produit
 *      Nextore, avec le pack de la réf du site — seulement si elle désigne UN
 *      seul produit Nextore ;
 *   3. sinon mapping à la main (mapLine), enregistré à la création de la
 *      commande comme sur le site.
 * Le résultat est une commande gardée chez nous (boutiqueOrderModel), mise en
 * stock dans Nextore à la réception. Tout est compté en PIÈCES, comme Nextore :
 * convertLine avec un pack BMS de 1.
 */

const pool = require('../config/database');
const parserRegistry = require('../parsers');
const pdfImportModel = require('./pdfImportModel');
const { normalizeRef, normalizedSql } = require('./supplierRefModel');
const { convertLine } = require('../utils/importLineConversion');
const boutiqueOrderModel = require('./boutiqueOrderModel');

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

/** Fournisseurs Nextore importables : rattachés à un fournisseur du site qui a un parseur. */
async function listSuppliers() {
  const { rows } = await pool.query(
    `SELECT ns.id, ns.company, s.id AS site_supplier_id, s.code
     FROM nextore_suppliers ns
     JOIN suppliers s ON s.id = ns.site_supplier_id
     ORDER BY ns.company`
  );
  return rows.filter((r) => parserRegistry.hasParser(r.code)).map(({ id, company }) => ({ id, company }));
}

async function getSupplier(nxSupplierId) {
  const { rows } = await pool.query(
    `SELECT ns.id, ns.company, s.id AS site_supplier_id, s.code
     FROM nextore_suppliers ns
     LEFT JOIN suppliers s ON s.id = ns.site_supplier_id
     WHERE ns.id = $1`,
    [String(nxSupplierId)]
  );
  const sup = rows[0];
  if (!sup) throw httpError(400, `Fournisseur Nextore inconnu : ${nxSupplierId}`);
  if (!sup.code || !parserRegistry.hasParser(sup.code)) {
    throw httpError(400, `Pas de parseur pour ${sup.company}`);
  }
  return sup;
}

/** Réfs boutique d'un fournisseur parmi des réfs normalisées → Map(norm → réf). */
async function findBoutiqueRefs(nxSupplierId, norms) {
  if (!norms.length) return new Map();
  const { rows } = await pool.query(
    `SELECT ${normalizedSql('supplier_sku')} AS norm, product_id, pack_qty
     FROM nextore_supplier_refs
     WHERE supplier_id = $1 AND ${normalizedSql('supplier_sku')} = ANY($2)`,
    [String(nxSupplierId), norms]
  );
  return new Map(rows.map((r) => [r.norm, r]));
}

/**
 * Réfs du site → Map(norm → { pack_qty, image_url, nx_ids }). image_url = celle
 * du produit du site qui porte la réf ; nx_ids = produits Nextore qui partagent
 * un code-barres avec lui.
 */
async function findSiteRefs(siteSupplierId, norms) {
  if (!siteSupplierId || !norms.length) return new Map();
  const { rows } = await pool.query(
    `SELECT ${normalizedSql('r.supplier_sku')} AS norm, r.pack_qty, p.image_url,
            array_remove(array_agg(DISTINCT nb.product_id), NULL) AS nx_ids
     FROM supplier_refs r
     JOIN products p ON p.id = r.product_id
     LEFT JOIN product_barcodes pb ON pb.product_id = r.product_id
     LEFT JOIN nextore_product_barcodes nb ON nb.barcode = pb.barcode
     WHERE r.supplier_id = $1 AND ${normalizedSql('r.supplier_sku')} = ANY($2)
     GROUP BY r.id, r.pack_qty, p.image_url`,
    [siteSupplierId, norms]
  );
  return new Map(rows.map((r) => [r.norm, r]));
}

/**
 * Produits Nextore → Map(id → { id, name, code, brand, stock, fiche_price }).
 * fiche_price = « Prix BDD » d'une pièce : prix de ce fournisseur sur la fiche
 * Nextore, sinon coût de la fiche.
 */
async function findProducts(ids, warehouseId, nxSupplierId) {
  if (!ids.length) return new Map();
  const { rows } = await pool.query(
    `SELECT p.product_id AS id, p.name, p.code, p.brand, st.stock::float AS stock,
            COALESCE(NULLIF(p.supplier_refs -> $3 ->> 'price', '')::numeric, p.cost)::float AS fiche_price
     FROM nextore_products p
     LEFT JOIN nextore_stock st ON st.product_id = p.product_id AND st.warehouse_id = $2
     WHERE p.product_id = ANY($1::text[])`,
    [ids, warehouseId, String(nxSupplierId)]
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/** Image du produit du site rattaché par code-barres (quand la réf n'est pas au site). */
async function findImagesByBarcode(ids) {
  if (!ids.length) return new Map();
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (nb.product_id) nb.product_id, p.image_url
     FROM nextore_product_barcodes nb
     JOIN product_barcodes pb ON pb.barcode = nb.barcode
     JOIN products p ON p.id = pb.product_id
     WHERE nb.product_id = ANY($1::text[]) AND p.image_url IS NOT NULL
     ORDER BY nb.product_id, p.id`,
    [ids]
  );
  return new Map(rows.map((r) => [r.product_id, r.image_url]));
}

/**
 * « Dernier tarif » de la boutique : dernier prix d'une pièce réellement payé
 * chez ce fournisseur (cette boutique d'abord), avec l'achat Nextore d'où il vient.
 */
async function findLastPaid(nxSupplierId, ids, warehouseId) {
  if (!ids.length) return new Map();
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (product_id) product_id, unit_cost::float AS unit_price,
            purchased_at::date::text AS order_date, purchase_reference AS reference
     FROM nextore_purchase_items
     WHERE supplier_id = $1 AND product_id = ANY($2::text[])
       AND quantity_received > 0 AND unit_cost > 0
     ORDER BY product_id, (warehouse_id = $3) DESC, purchased_at DESC, id DESC`,
    [String(nxSupplierId), ids, warehouseId]
  );
  return new Map(rows.map((r) => [r.product_id, { unit_price: r.unit_price, order_date: r.order_date, reference: r.reference }]));
}

/** convertLine du site, pack BMS 1 : quantité et prix en pièces. */
function convertDoc({ docQty, docPrice, discountPercent, refPack, fichePrice, conversion }) {
  return convertLine({
    docQty: parseInt(docQty, 10) || 1,
    docPrice: docPrice != null && docPrice !== '' ? parseFloat(docPrice) : null,
    discountPercent: parseFloat(discountPercent) || 0,
    refPack,
    // Prix de la fiche = d'une pièce ; convertLine attend le prix DU PACK de la réf
    refPrice: fichePrice != null ? fichePrice * refPack : null,
    bmsPack: 1,
    conversion: { invertPackQty: !!conversion.invertPackQty, trustPdfPrice: !!conversion.trustPdfPrice },
  });
}

const productView = (p, imageUrl) => ({ id: p.id, name: p.name, code: p.code, brand: p.brand, stock: p.stock, image_url: imageUrl || null });

/** Lit le document et rattache chaque ligne à un produit Nextore (forme de parsePdf). */
async function parseDocument(fileBuffer, nxSupplierId, warehouse) {
  const sup = await getSupplier(nxSupplierId);
  const parser = parserRegistry.getParser(sup.code);

  const { rows: known } = await pool.query(
    `SELECT supplier_sku FROM supplier_refs WHERE supplier_id = $1
     UNION SELECT supplier_sku FROM nextore_supplier_refs WHERE supplier_id = $2`,
    [sup.site_supplier_id, String(nxSupplierId)]
  );
  const { parsed, parseMode, parseWarnings, invoiceTotalHt, conversion } = await pdfImportModel.readDocument(
    fileBuffer, parser, { name: sup.company, code: sup.code }, known.map((r) => r.supplier_sku)
  );

  const norms = [...new Set(parsed.items.map((i) => normalizeRef(i.supplier_sku)).filter(Boolean))];
  const [boutiqueRefs, siteRefs] = await Promise.all([
    findBoutiqueRefs(nxSupplierId, norms),
    findSiteRefs(sup.site_supplier_id, norms),
  ]);

  const ids = new Set();
  for (const r of boutiqueRefs.values()) ids.add(r.product_id);
  for (const r of siteRefs.values()) r.nx_ids.forEach((id) => ids.add(id));
  const [products, lastPaid, barcodeImages] = await Promise.all([
    findProducts([...ids], warehouse.id, nxSupplierId),
    findLastPaid(nxSupplierId, [...ids], warehouse.id),
    findImagesByBarcode([...ids]),
  ]);

  const items = parsed.items.map((item) => {
    const norm = normalizeRef(item.supplier_sku);
    const b = boutiqueRefs.get(norm);
    const s = siteRefs.get(norm);
    let match = null;
    if (b) match = { productId: b.product_id, pack: b.pack_qty, source: 'boutique' };
    else if (s && s.nx_ids.length === 1) match = { productId: s.nx_ids[0], pack: s.pack_qty || 1, source: 'site' };
    const product = match ? products.get(match.productId) : null;
    // Image : produit du site qui porte la réf, sinon celui du même code-barres
    const imageUrl = (s && s.image_url) || (product ? barcodeImages.get(product.id) : null) || null;

    const discountPercent = item.discount_percent || 0;
    const rawPdfGross = item.unit_price_net != null ? item.unit_price_net : null;
    const refPack = product ? parseInt(match.pack, 10) || 1 : 1;
    const line = convertDoc({
      docQty: item.qty_ordered, docPrice: rawPdfGross, discountPercent, refPack,
      fichePrice: product ? product.fiche_price : null, conversion,
    });

    return {
      supplier_sku: item.supplier_sku,
      designation: item.designation,
      qty_from_pdf: item.qty_ordered,
      matched: !!product,
      match_source: product ? match.source : null,
      product_id: product ? product.id : null,
      product_name: product ? product.name : null,
      product_sku: product ? product.code : null,
      current_stock: product ? product.stock : null,
      image_url: imageUrl,
      ref_pack_qty: product ? refPack : null,
      pack_warning: line.packWarning,
      pdf_price_raw: rawPdfGross,
      pdf_price: line.pdfGross,
      pdf_price_net: line.pdfNet,
      discount_percent: discountPercent,
      supplier_price: line.dbPrice,
      unit_price: line.unitPrice,
      pack_qty: line.packQty,
      qty_ordered: line.qtyOrdered,
      invoice_line_total_ht: Number.isFinite(Number(item.total_ht)) && Number(item.total_ht) > 0 ? Number(item.total_ht) : null,
      last_paid: product ? lastPaid.get(product.id) || null : null,
      // Plusieurs produits Nextore pour une réf du site : proposés à la main
      candidates: !product && s && s.nx_ids.length > 1
        ? s.nx_ids.map((id) => products.get(id)).filter(Boolean).map((p) => productView(p, barcodeImages.get(p.id)))
        : [],
    };
  });

  // Document déjà importé dans cette boutique : on COMPLÈTE la commande ouverte
  let existingOrder = null;
  let duplicateWarning = null;
  if (parsed.orderNumber) {
    const { rows: orders } = await pool.query(
      `SELECT o.id, o.reference, array_agg(i.product_id) AS product_ids, COUNT(i.id)::int AS total_items
       FROM boutique_orders o JOIN boutique_order_items i ON i.order_id = o.id
       WHERE o.warehouse_id = $1 AND o.supplier_id = $2 AND o.reference = $3 AND o.status = 'open'
       GROUP BY o.id ORDER BY o.id DESC LIMIT 1`,
      [warehouse.id, sup.id, parsed.orderNumber]
    );
    if (orders[0]) {
      existingOrder = { id: orders[0].id, order_number: orders[0].reference, total_items: orders[0].total_items, product_ids: orders[0].product_ids };
    } else {
      const { rows } = await pool.query(
        `SELECT 'app' AS src FROM boutique_orders WHERE warehouse_id = $1 AND reference = $2 AND status <> 'cancelled'
         UNION ALL
         SELECT 'nextore' FROM nextore_purchase_items WHERE warehouse_id = $1 AND purchase_reference = $2
         LIMIT 1`,
        [warehouse.id, parsed.orderNumber]
      );
      if (rows.length) {
        duplicateWarning = rows[0].src === 'app'
          ? `Une commande ${parsed.orderNumber} existe déjà (close) dans cette boutique`
          : `Un achat ${parsed.orderNumber} existe déjà dans Nextore pour cette boutique`;
      }
    }
  }

  const discountLines = (parsed.discountItems || []).map((d) => ({
    item_type: 'discount',
    supplier_sku: null,
    designation: null,
    product_name: d.product_name,
    qty_from_pdf: 1,
    qty_ordered: 1,
    matched: true,
    unit_price: d.unit_price, // déjà négatif
    pdf_price: d.unit_price,
    pack_qty: 1,
  }));

  return {
    supplier_id: sup.id,
    supplier_name: sup.company,
    order_number: parsed.orderNumber || null,
    order_date: parsed.orderDate || null,
    has_price: !!parsed.hasPrice,
    parse_mode: parseMode,
    duplicate_warning: duplicateWarning,
    existing_order: existingOrder,
    parse_warnings: parseWarnings,
    conversion,
    items: [...items, ...discountLines],
    total_items: items.length,
    matched_count: items.filter((i) => i.matched).length,
    unmatched_count: items.filter((i) => !i.matched).length,
    invoice_total_ht: invoiceTotalHt,
  };
}

/**
 * Mapping manuel d'une ligne (même contrat que pdfImportModel.mapLine) :
 * conditionnement proposé si packQty absent — réf boutique, sinon réf du site,
 * sinon 1 —, ligne convertie, dernier prix payé, et produit qui porte déjà la
 * réf s'il est différent (l'écran demande alors de la déplacer).
 */
async function mapLine({ nxSupplierId, warehouse, productId, supplierSku, packQty, docQty, docPrice, discountPercent, conversion }) {
  const sup = await getSupplier(nxSupplierId);
  const products = await findProducts([String(productId)], warehouse.id, nxSupplierId);
  const product = products.get(String(productId));
  if (!product) throw httpError(404, `Produit Nextore introuvable (${productId})`);

  const norm = normalizeRef(supplierSku);
  const [boutiqueRefs, siteRefs, lastPaid, barcodeImages] = await Promise.all([
    findBoutiqueRefs(nxSupplierId, norm ? [norm] : []),
    findSiteRefs(sup.site_supplier_id, norm ? [norm] : []),
    findLastPaid(nxSupplierId, [product.id], warehouse.id),
    findImagesByBarcode([product.id]),
  ]);
  const existing = boutiqueRefs.get(norm);
  const s = siteRefs.get(norm);
  const refPack = parseInt(packQty, 10) >= 1
    ? parseInt(packQty, 10)
    : (existing ? existing.pack_qty : (s ? s.pack_qty || 1 : 1));

  let conflict = null;
  if (existing && existing.product_id !== product.id) {
    const owner = (await findProducts([existing.product_id], warehouse.id, nxSupplierId)).get(existing.product_id);
    conflict = { post_title: owner ? owner.name : existing.product_id, sku: owner ? owner.code : null };
  }

  const line = convertDoc({ docQty, docPrice, discountPercent, refPack, fichePrice: product.fiche_price, conversion: conversion || {} });
  return {
    product: productView(product, (s && s.image_url) || barcodeImages.get(product.id)),
    line: { ...line, refPack },
    last_paid: lastPaid.get(product.id) || null,
    conflict,
  };
}

/**
 * Enregistre une réf boutique. Portée par un autre produit : REF_TAKEN (409),
 * sauf move = true, auquel cas elle est déplacée.
 */
async function saveRef({ nxSupplierId, supplierSku, productId, packQty, move = false, source = 'manuel', userEmail }) {
  const sku = (supplierSku || '').trim();
  if (!sku) throw httpError(400, 'Référence fournisseur vide');
  const pack = Math.max(parseInt(packQty, 10) || 1, 1);
  const { rows } = await pool.query(
    `SELECT id, product_id FROM nextore_supplier_refs
     WHERE supplier_id = $1 AND ${normalizedSql('supplier_sku')} = $2`,
    [String(nxSupplierId), normalizeRef(sku)]
  );
  const existing = rows[0];
  if (existing && existing.product_id !== String(productId) && !move) {
    throw httpError(409, `La réf. ${sku} est déjà associée à un autre produit`, { code: 'REF_TAKEN' });
  }
  if (existing) {
    await pool.query(
      `UPDATE nextore_supplier_refs
       SET product_id = $1, supplier_sku = $2, pack_qty = $3, source = $4, updated_at = NOW()
       WHERE id = $5`,
      [String(productId), sku, pack, source, existing.id]
    );
  } else {
    await pool.query(
      `INSERT INTO nextore_supplier_refs (supplier_id, supplier_sku, product_id, pack_qty, source, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [String(nxSupplierId), sku, String(productId), pack, source, userEmail || null]
    );
  }
}

/**
 * Crée la commande (ou complète la commande ouverte existingOrderId), puis
 * enregistre les réfs comme le site : mappings manuels (newSupplierSkus, avec
 * leur choix de déplacement) et propositions du site retenues.
 * lines = [{ product_id, quantity, unit_cost, supplier_sku, pack, match_source }]
 * en pièces, coût HT d'une pièce, remises de pied déjà réparties.
 */
async function createPurchase({ nxSupplierId, warehouse, referenceNo, lines, newSupplierSkus, existingOrderId, userEmail }) {
  const sup = await getSupplier(nxSupplierId);
  if (!Array.isArray(lines) || !lines.length) throw httpError(400, 'Aucune ligne matchée à créer');
  for (const l of lines) {
    const qty = Number(l.quantity);
    const cost = Number(l.unit_cost);
    if (!l.product_id || !Number.isInteger(qty) || qty <= 0 || !Number.isFinite(cost) || cost < 0) {
      throw httpError(400, `Ligne invalide (${l.supplier_sku || l.product_id || '?'}) : quantité entière > 0 et prix requis`);
    }
  }
  const ids = [...new Set(lines.map((l) => String(l.product_id)))];
  const known = await findProducts(ids, warehouse.id, nxSupplierId);
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) throw httpError(400, `Produits Nextore inconnus : ${unknown.join(', ')}`);

  const result = existingOrderId
    ? await boutiqueOrderModel.addItems(existingOrderId, warehouse.id, lines)
    : await boutiqueOrderModel.createOrder({
      warehouse, supplierId: sup.id, reference: (referenceNo || '').trim() || boutiqueOrderModel.makeReference(warehouse, sup.id),
      source: 'import', lines, userEmail,
    });

  const refs = [
    ...(newSupplierSkus || []).map((r) => ({ ...r, source: 'manuel' })),
    ...lines.filter((l) => l.match_source === 'site' && l.supplier_sku)
      .map((l) => ({ supplier_sku: l.supplier_sku, product_id: l.product_id, pack_qty: l.pack, move: false, source: 'site' })),
  ];
  for (const r of refs) {
    await saveRef({
      nxSupplierId: sup.id, supplierSku: r.supplier_sku, productId: r.product_id,
      packQty: r.pack_qty, move: r.move === true, source: r.source, userEmail,
    }).catch((err) => console.error(`Nextore import : réf ${r.supplier_sku} non enregistrée :`, err.message));
  }
  return result;
}

module.exports = { listSuppliers, parseDocument, mapLine, createPurchase };
