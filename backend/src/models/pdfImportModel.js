const { PDFParse } = require('pdf-parse');
const pool = require('../config/database');
const parserRegistry = require('../parsers');

/**
 * Nettoie le texte brut extrait d'un PDF avant parsing :
 * - Normalise les caractères spéciaux (espaces insécables, tirets typographiques)
 * - Supprime les caractères de contrôle parasites
 * - Recollage des mots coupés en fin de ligne par un tiret
 * En cas d'échec, retourne le texte original sans modification.
 */
function cleanPdfText(text) {
  try {
    let cleaned = text;

    // Espaces insécables et autres variantes → espace normal
    cleaned = cleaned.replace(/[           ﻿]/g, ' ');

    // Tirets typographiques → tiret standard
    cleaned = cleaned.replace(/[‐‑‒–—―]/g, '-');

    // Caractères de contrôle parasites (hors \n et \t)
    cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // Recollage des mots coupés en fin de ligne par un tiret
    // Ex : "GOLD-\nSUCKER" → "GOLD-SUCKER"
    // Seulement si les deux côtés sont alphanumériques (évite de coller des tirets de liste)
    cleaned = cleaned.replace(/([A-Za-z0-9])-\n([A-Za-z0-9])/g, '$1-$2');

    // Espaces multiples → espace simple (hors sauts de ligne)
    cleaned = cleaned.replace(/[^\S\n]+/g, ' ');

    return cleaned;
  } catch {
    return text;
  }
}

/** Normalise un texte pour comparaison : minuscules, espaces collapsés, trim. */
function normalizeSku(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Réaffecte à chaque ligne sa référence fournisseur COMPLÈTE.
 *
 * Les PDF aplatissent les colonnes "Référence" et "Désignation" : une référence
 * contenant un espace ou un tiret (ex: "MJ AMNESIA 300MG", "VP RES GTX 0.2 V2")
 * se retrouve collée à la désignation, et aucun parseur ne peut deviner de façon
 * fiable où elle s'arrête. On lève l'ambiguïté en cherchant, parmi les SKU connus
 * en BDD pour ce fournisseur, le plus long qui préfixe le texte "réf + désignation"
 * à la frontière d'un mot. Ce traitement est commun à TOUS les fournisseurs.
 *
 * Modifie `items` en place. Ne change une ligne que si un SKU connu plus complet
 * est trouvé : aucune régression pour les références déjà correctes ou absentes
 * du catalogue.
 */
function resolveCompleteSkus(items, dbSkus) {
  if (!items || items.length === 0 || !dbSkus || dbSkus.length === 0) return;

  // Plus long SKU d'abord → on retient la référence la plus complète.
  const entries = dbSkus
    .map((original) => ({ original, normalized: normalizeSku(original) }))
    .filter((e) => e.normalized.length > 0)
    .sort((a, b) => b.normalized.length - a.normalized.length);

  for (const item of items) {
    if (!item.supplier_sku) continue;

    const combined = `${item.supplier_sku} ${item.designation || ''}`.trim();
    const nc = normalizeSku(combined);

    // Cherche le plus long SKU connu qui préfixe le texte combiné.
    const match = entries.find(
      (e) => nc === e.normalized || nc.startsWith(e.normalized + ' ')
    );
    if (!match || match.normalized === normalizeSku(item.supplier_sku)) continue;

    // Retire les mots de la référence en tête → reste = nouvelle désignation.
    const skuPattern = match.original.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
    const re = new RegExp('^' + skuPattern + '\\s*', 'i');
    item.designation = combined.replace(re, '').trim();
    item.supplier_sku = match.original;
  }
}

const pdfImportModel = {
  /**
   * Parse un fichier fournisseur (PDF ou CSV) et matche les lignes avec les produits en BDD
   * @param {Buffer} fileBuffer - Le buffer du fichier (PDF ou CSV)
   * @param {number} supplierId - L'ID du fournisseur local
   * @returns {Object} Donnees parsees et enrichies
   */
  parsePdf: async (fileBuffer, supplierId) => {
    // 1. Recuperer le fournisseur
    const supplierResult = await pool.query(
      'SELECT id, name, code FROM suppliers WHERE id = $1',
      [supplierId]
    );
    const supplier = supplierResult.rows[0];
    if (!supplier) throw new Error('Fournisseur non trouvé');

    // 2. Verifier qu'un parseur existe pour ce fournisseur
    const parser = parserRegistry.getParser(supplier.code);
    if (!parser) {
      throw new Error(
        `Pas de parseur pour le fournisseur ${supplier.name} (code: ${supplier.code || 'non défini'}). ` +
        `Parseurs disponibles : ${parserRegistry.availableParsers().join(', ') || 'aucun'}`
      );
    }

    // 3. Extraire le texte du fichier (PDF ou CSV)
    const isPdf = fileBuffer.length >= 4 && fileBuffer.toString('ascii', 0, 4) === '%PDF';

    let rawText, text;
    if (isPdf) {
      const uint8 = new Uint8Array(fileBuffer);
      const pdfParser = new PDFParse(uint8);
      await pdfParser.load();
      const pdfData = await pdfParser.getText();
      rawText = pdfData.text;
      text = cleanPdfText(rawText);
    } else {
      // CSV (ou autre fichier texte) : lecture directe, suppression du BOM eventuel
      // Fallback latin1 si le fichier n'est pas de l'UTF-8 valide (export Excel/Windows)
      let decoded = fileBuffer.toString('utf-8');
      if (decoded.includes('�')) {
        decoded = fileBuffer.toString('latin1');
      }
      rawText = decoded.replace(/^﻿/, '');
      text = rawText;
    }

    // 4. Parser avec le parseur du fournisseur (fallback sur rawText si aucun item trouvé)
    let parsed = parser.parse(text);
    let parseMode = 'clean';
    if (!parsed.items || parsed.items.length === 0) {
      console.warn(`[pdfImport] cleanPdfText a donné 0 items pour ${supplier.name}, fallback sur rawText`);
      parsed = parser.parse(rawText);
      parseMode = 'legacy';
    } else {
      console.log(`[pdfImport] ${supplier.name} : ${parsed.items.length} items trouvés (texte nettoyé)`);
    }

    if (!parsed.items || parsed.items.length === 0) {
      throw new Error('Aucune ligne produit trouvée dans le PDF');
    }

    // 4b. Reconstituer la référence complète à partir des SKU connus du fournisseur.
    //     Les PDF collent la colonne Référence à la Désignation : une référence avec
    //     espace/tiret (ex: "MJ AMNESIA 300MG") serait sinon tronquée par le parseur.
    const knownSkusResult = await pool.query(
      'SELECT supplier_sku FROM product_suppliers WHERE supplier_id = $1',
      [supplierId]
    );
    resolveCompleteSkus(parsed.items, knownSkusResult.rows.map(r => r.supplier_sku));

    // 5. Matcher les supplier_sku dans product_suppliers
    const supplierSkus = parsed.items.map(i => i.supplier_sku);

    const matchQuery = `
      SELECT
        ps.supplier_sku,
        ps.supplier_price,
        ps.pack_qty,
        p.id as internal_product_id,
        p.wp_product_id,
        p.post_title,
        p.sku as product_sku,
        p.stock,
        p.product_type,
        p.image_url
      FROM product_suppliers ps
      JOIN products p ON ps.product_id = p.id
      WHERE ps.supplier_id = $1
        AND ps.supplier_sku = ANY($2)
    `;
    const matchResult = await pool.query(matchQuery, [supplierId, supplierSkus]);

    const matchMap = new Map();
    for (const row of matchResult.rows) {
      matchMap.set(row.supplier_sku, row);
    }

    // 6. Enrichir chaque ligne avec les infos de matching
    const enrichedItems = parsed.items.map(item => {
      const match = matchMap.get(item.supplier_sku);
      const packQty = parsed.skipPackQty ? 1 : (match ? (parseInt(match.pack_qty) || 1) : 1);

      // Prix brut du PDF (avant remise éventuelle)
      // pdfIsPackBased (JoshNoa) : PDF = prix pack ET quantité en packs → aucune conversion
      // invertPackQty (Curieux)  : PDF = prix unitaire, quantité en unités → × pack_qty et ÷ pack_qty
      // normal (ancien)          : PDF = prix pack, quantité en packs → ÷ pack_qty et × pack_qty
      // skipPackQty              : packQty forcé à 1, pas de conversion
      const rawPdfGross = item.unit_price_net != null ? item.unit_price_net : null;
      let pdfGross;
      if (rawPdfGross != null && packQty > 1 && !parsed.pdfIsPackBased) {
        pdfGross = parsed.invertPackQty ? rawPdfGross * packQty : rawPdfGross / packQty;
      } else {
        pdfGross = rawPdfGross;
      }
      const discountPercent = item.discount_percent || 0;
      const pdfNet = pdfGross != null ? pdfGross * (1 - discountPercent / 100) : null;
      // dbPrice : supplier_price en BDD = prix pack pour tous les fournisseurs
      // pdfIsPackBased + invertPackQty : garder tel quel (prix pack, cohérent avec pdfGross)
      // skipPackQty : packQty forcé à 1, donc dbPackQty doit aussi être 1 pour rester cohérent
      // normal : diviser par pack_qty pour obtenir le prix unitaire
      const dbPackQty = packQty;  // déjà normalisé par skipPackQty ci-dessus
      const rawDbPrice = match ? parseFloat(match.supplier_price) || null : null;
      let dbPrice;
      if (rawDbPrice != null && dbPackQty > 1) {
        dbPrice = (parsed.invertPackQty || parsed.pdfIsPackBased) ? rawDbPrice : rawDbPrice / dbPackQty;
      } else {
        dbPrice = rawDbPrice;
      }

      // Quantité finale.
      // invertPackQty (e.tasty, Curieux) : PDF = nb d'UNITÉS → diviser par pack_qty
      //   pour obtenir les PACKS (le prix est, lui, converti en prix pack via
      //   pdfGross × pack_qty). Cohérent avec createInBMS qui renvoie qty × pack_qty.
      // normal/pdfIsPackBased=false : comportement historique inchangé.
      let qtyOrdered;
      if (parsed.invertPackQty) {
        qtyOrdered = packQty > 1 ? Math.round(item.qty_ordered / packQty) : item.qty_ordered;
      } else if (packQty > 1 && !parsed.pdfIsPackBased) {
        qtyOrdered = item.qty_ordered * packQty;
      } else {
        qtyOrdered = item.qty_ordered;
      }

      return {
        supplier_sku: item.supplier_sku,
        designation: item.designation,
        qty_from_pdf: item.qty_ordered,
        // Matching
        matched: !!match,
        product_id: match ? match.wp_product_id : null,
        internal_product_id: match ? match.internal_product_id : null,
        product_name: match ? match.post_title : null,
        product_sku: match ? match.product_sku : null,
        current_stock: match ? parseInt(match.stock) : null,
        image_url: match ? match.image_url : null,
        // Prix
        pdf_price: pdfGross,           // prix brut HT pack ou unité selon le mode
        pdf_price_net: pdfNet,         // prix net après remise
        discount_percent: discountPercent,
        supplier_price: dbPrice,
        // Prix retenu.
        // invertPackQty / trustPdfPrice : on fait confiance au prix du PDF (= prix
        //   réellement facturé), car le supplier_price en BDD est incohérent selon
        //   les produits (parfois prix unité/pack, parfois nul ou divergent).
        //   Le PDF/facture est la source de vérité du montant réellement payé.
        // autres modes : PDF si meilleur (ou si pas de prix BDD), sinon prix BDD.
        unit_price: (parsed.invertPackQty || parsed.trustPdfPrice)
          ? (pdfNet != null ? pdfNet : dbPrice)
          : ((pdfNet != null && (dbPrice == null || pdfNet < dbPrice)) ? pdfNet : dbPrice),
        // Pack
        pack_qty: packQty,
        qty_ordered: qtyOrdered,
      };
    });

    // 7. Verifier si le order_number existe deja
    let duplicateWarning = null;
    if (parsed.orderNumber) {
      const dupCheck = await pool.query(
        'SELECT id, order_number FROM purchase_orders WHERE order_number = $1',
        [parsed.orderNumber]
      );
      if (dupCheck.rows.length > 0) {
        duplicateWarning = `Une commande avec le numéro ${parsed.orderNumber} existe déjà`;
      }
    }

    // Lignes remise (item_type = 'discount') : pas de matching, pas de pack_qty
    const discountLines = (parsed.discountItems || []).map(d => ({
      item_type: 'discount',
      supplier_sku: null,
      designation: null,
      product_name: d.product_name,
      qty_from_pdf: 1,
      qty_ordered: 1,
      matched: true,
      unit_price: d.unit_price,  // déjà négatif
      pdf_price: d.unit_price,
      pack_qty: 1,
    }));

    const allItems = [...enrichedItems, ...discountLines];

    return {
      supplier_id: supplierId,
      supplier_name: supplier.name,
      order_number: parsed.orderNumber,
      order_date: parsed.orderDate,
      has_price: parsed.hasPrice || false,
      parse_mode: parseMode,
      duplicate_warning: duplicateWarning,
      items: allItems,
      total_items: enrichedItems.length,
      matched_count: enrichedItems.filter(i => i.matched).length,
      unmatched_count: enrichedItems.filter(i => !i.matched).length,
    };
  }
};

module.exports = pdfImportModel;
