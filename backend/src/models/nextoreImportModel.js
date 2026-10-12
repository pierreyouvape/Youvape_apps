/**
 * Boutiques Nextore — import d'une commande fournisseur (PDF/CSV).
 *
 * Mêmes parseurs que le site (pdfImportModel.readDocument), choisis par le
 * fournisseur du site correspondant (nextore_suppliers.site_supplier_id).
 * Une ligne du document est rattachée à un produit Nextore, dans l'ordre :
 *   1. réf boutique déjà mappée (nextore_supplier_refs) ;
 *   2. proposition du site : réf du site → produit WC → code-barres → produit
 *      Nextore, avec le pack de la réf du site — seulement si elle désigne UN
 *      seul produit Nextore ;
 *   3. sinon mapping à la main (mapLine + saveRef), au fil des imports.
 * Tout est compté en PIÈCES, comme Nextore : la conversion est celle du site
 * (convertLine) avec un pack BMS de 1.
 */

const pool = require('../config/database');
const parserRegistry = require('../parsers');
const pdfImportModel = require('./pdfImportModel');
const { normalizeRef, normalizedSql } = require('./supplierRefModel');
const { convertLine } = require('../utils/importLineConversion');
const nextoreModel = require('./nextoreModel');

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
 * Réfs du site → Map(norm → { pack_qty, pack_price, nx_ids }). nx_ids = produits
 * Nextore qui partagent un code-barres avec le produit WC de la réf.
 */
async function findSiteRefs(siteSupplierId, norms) {
  if (!siteSupplierId || !norms.length) return new Map();
  const { rows } = await pool.query(
    `SELECT ${normalizedSql('r.supplier_sku')} AS norm, r.pack_qty, r.pack_price::float AS pack_price,
            array_remove(array_agg(DISTINCT nb.product_id), NULL) AS nx_ids
     FROM supplier_refs r
     LEFT JOIN product_barcodes pb ON pb.product_id = r.product_id
     LEFT JOIN nextore_product_barcodes nb ON nb.barcode = pb.barcode
     WHERE r.supplier_id = $1 AND ${normalizedSql('r.supplier_sku')} = ANY($2)
     GROUP BY r.id, r.pack_qty, r.pack_price`,
    [siteSupplierId, norms]
  );
  return new Map(rows.map((r) => [r.norm, r]));
}

/** Produits Nextore (nom, code, stock de la boutique) → Map(id → produit). */
async function findProducts(ids, warehouseId) {
  if (!ids.length) return new Map();
  const { rows } = await pool.query(
    `SELECT p.product_id AS id, p.name, p.code, st.stock::float AS stock
     FROM nextore_products p
     LEFT JOIN nextore_stock st ON st.product_id = p.product_id AND st.warehouse_id = $2
     WHERE p.product_id = ANY($1::text[])`,
    [ids, warehouseId]
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/** Dernier coût d'une pièce payé chez ce fournisseur (cette boutique d'abord). */
async function findLastCosts(nxSupplierId, ids, warehouseId) {
  if (!ids.length) return new Map();
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (product_id) product_id, unit_cost::float AS unit_cost
     FROM nextore_purchase_items
     WHERE supplier_id = $1 AND product_id = ANY($2::text[])
       AND status = 'received' AND quantity_received > 0 AND unit_cost > 0
     ORDER BY product_id, (warehouse_id = $3) DESC, purchased_at DESC, id DESC`,
    [String(nxSupplierId), ids, warehouseId]
  );
  return new Map(rows.map((r) => [r.product_id, r.unit_cost]));
}

/**
 * Quantité et prix d'une ligne en PIÈCES. Prix : celui du document, sinon le
 * dernier coût payé par la boutique, sinon le tarif de la réf du site.
 */
function convert({ docQty, docPrice, discountPercent, pack, conversion, lastCost, sitePrice }) {
  const line = convertLine({
    docQty: parseFloat(docQty) || 0,
    docPrice: docPrice != null && docPrice !== '' ? parseFloat(docPrice) : null,
    discountPercent: parseFloat(discountPercent) || 0,
    refPack: pack,
    refPrice: null,
    bmsPack: 1,
    conversion: { invertPackQty: !!conversion.invertPackQty, trustPdfPrice: !!conversion.trustPdfPrice },
  });
  let unitCost = line.pdfNet;
  let priceSource = unitCost != null ? 'document' : null;
  if (unitCost == null && lastCost != null) { unitCost = lastCost; priceSource = 'dernier achat'; }
  if (unitCost == null && sitePrice != null) { unitCost = sitePrice; priceSource = 'tarif site'; }
  return {
    quantity: Math.round(line.qtyOrdered),
    unit_cost: unitCost != null ? Math.round(unitCost * 10000) / 10000 : null,
    price_source: priceSource,
  };
}

const sitePiecePrice = (s) => (s && s.pack_price != null ? s.pack_price / (s.pack_qty || 1) : null);

/** Lit le document et rattache chaque ligne à un produit Nextore. */
async function parseDocument(fileBuffer, nxSupplierId, warehouse) {
  const sup = await getSupplier(nxSupplierId);
  const parser = parserRegistry.getParser(sup.code);

  const { rows: known } = await pool.query(
    `SELECT supplier_sku FROM supplier_refs WHERE supplier_id = $1
     UNION SELECT supplier_sku FROM nextore_supplier_refs WHERE supplier_id = $2`,
    [sup.site_supplier_id, String(nxSupplierId)]
  );
  const { parsed, parseWarnings, invoiceTotalHt, conversion } = await pdfImportModel.readDocument(
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
  const [products, lastCosts] = await Promise.all([
    findProducts([...ids], warehouse.id),
    findLastCosts(nxSupplierId, [...ids], warehouse.id),
  ]);

  const items = parsed.items.map((item) => {
    const norm = normalizeRef(item.supplier_sku);
    const b = boutiqueRefs.get(norm);
    const s = siteRefs.get(norm);
    let match = null;
    if (b) match = { productId: b.product_id, pack: b.pack_qty, source: 'boutique' };
    else if (s && s.nx_ids.length === 1) match = { productId: s.nx_ids[0], pack: s.pack_qty || 1, source: 'site' };

    const base = {
      supplier_sku: item.supplier_sku || null,
      designation: item.designation || null,
      doc_qty: item.qty_ordered,
      doc_price: item.unit_price_net != null ? item.unit_price_net : null,
      discount_percent: item.discount_percent || 0,
      site_pack: s ? s.pack_qty : null,
      // Plusieurs produits Nextore pour une réf du site : à choisir à la main
      candidates: !match && s && s.nx_ids.length > 1
        ? s.nx_ids.map((id) => products.get(id)).filter(Boolean)
        : [],
    };
    if (!match || !products.has(match.productId)) {
      return { ...base, match_source: null, product: null, pack: null, quantity: null, unit_cost: null, price_source: null };
    }
    return {
      ...base,
      match_source: match.source,
      product: products.get(match.productId),
      pack: match.pack,
      ...convert({
        docQty: base.doc_qty, docPrice: base.doc_price, discountPercent: base.discount_percent,
        pack: match.pack, conversion,
        lastCost: lastCosts.get(match.productId), sitePrice: sitePiecePrice(s),
      }),
    };
  });

  let duplicateWarning = null;
  if (parsed.orderNumber) {
    const { rows } = await pool.query(
      'SELECT 1 FROM nextore_purchase_items WHERE purchase_reference = $1 LIMIT 1',
      [parsed.orderNumber]
    );
    if (rows.length) duplicateWarning = `Un achat ${parsed.orderNumber} existe déjà dans Nextore`;
  }

  return {
    supplier: { id: sup.id, company: sup.company },
    order_number: parsed.orderNumber || null,
    order_date: parsed.orderDate || null,
    has_price: !!parsed.hasPrice,
    parse_warnings: parseWarnings,
    duplicate_warning: duplicateWarning,
    conversion,
    items,
    // Remises de pied (montant négatif) : réparties sur les lignes à l'envoi
    discounts: (parsed.discountItems || []).map((d) => ({ label: d.product_name, amount: d.unit_price })),
    invoice_total_ht: invoiceTotalHt,
  };
}

/**
 * Mapping manuel d'une ligne : conditionnement proposé (réf boutique, sinon réf
 * du site, sinon 1) si packQty absent, ligne convertie, et produit qui porte
 * déjà la réf s'il est différent (l'écran demande alors de la déplacer).
 */
async function mapLine({ nxSupplierId, warehouse, productId, supplierSku, packQty, docQty, docPrice, discountPercent, conversion }) {
  const sup = await getSupplier(nxSupplierId);
  const products = await findProducts([String(productId)], warehouse.id);
  const product = products.get(String(productId));
  if (!product) throw httpError(404, `Produit Nextore introuvable (${productId})`);

  const norm = normalizeRef(supplierSku);
  const [boutiqueRefs, siteRefs, lastCosts] = await Promise.all([
    findBoutiqueRefs(nxSupplierId, norm ? [norm] : []),
    findSiteRefs(sup.site_supplier_id, norm ? [norm] : []),
    findLastCosts(nxSupplierId, [product.id], warehouse.id),
  ]);
  const existing = boutiqueRefs.get(norm);
  const s = siteRefs.get(norm);
  const pack = parseInt(packQty, 10) >= 1
    ? parseInt(packQty, 10)
    : (existing ? existing.pack_qty : (s ? s.pack_qty || 1 : 1));

  let conflict = null;
  if (existing && existing.product_id !== product.id) {
    const owner = (await findProducts([existing.product_id], warehouse.id)).get(existing.product_id);
    conflict = { name: owner ? owner.name : existing.product_id, code: owner ? owner.code : null };
  }

  return {
    product,
    pack,
    conflict,
    ...convert({
      docQty, docPrice, discountPercent, pack, conversion: conversion || {},
      lastCost: lastCosts.get(product.id), sitePrice: sitePiecePrice(s),
    }),
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
 * Crée l'achat EN ATTENTE dans Nextore. lines = [{ product_id, quantity, unit_cost,
 * supplier_sku, pack, match_source }] en pièces, coût HT d'une pièce, remises
 * déjà réparties. Une fois l'achat parti, les propositions du site retenues
 * deviennent des réfs boutique.
 */
async function createPurchase({ nxSupplierId, warehouse, referenceNo, lines, userEmail }) {
  const sup = await getSupplier(nxSupplierId);
  const ref = (referenceNo || '').trim();
  if (!ref) throw httpError(400, 'Référence de l\'achat requise');
  if (!Array.isArray(lines) || !lines.length) throw httpError(400, 'Aucune ligne à envoyer');
  for (const l of lines) {
    const qty = Number(l.quantity);
    const cost = Number(l.unit_cost);
    if (!l.product_id || !Number.isInteger(qty) || qty <= 0 || !Number.isFinite(cost) || cost < 0) {
      throw httpError(400, `Ligne invalide (${l.supplier_sku || l.product_id || '?'}) : quantité entière > 0 et prix requis`);
    }
  }
  const ids = [...new Set(lines.map((l) => String(l.product_id)))];
  const known = await findProducts(ids, warehouse.id);
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) throw httpError(400, `Produits Nextore inconnus : ${unknown.join(', ')}`);

  const result = await nextoreModel.sendPurchase(warehouse, sup.id, ref, lines);

  for (const l of lines.filter((x) => x.match_source === 'site' && x.supplier_sku)) {
    await saveRef({
      nxSupplierId: sup.id, supplierSku: l.supplier_sku, productId: l.product_id,
      packQty: l.pack, source: 'site', userEmail,
    }).catch((err) => console.error(`Nextore import : réf ${l.supplier_sku} non enregistrée :`, err.message));
  }
  return result;
}

module.exports = { listSuppliers, parseDocument, mapLine, saveRef, createPurchase };
