const { PDFParse } = require('pdf-parse');
const pool = require('../config/database');
const parserRegistry = require('../parsers');
const { findUnparsedRows } = require('./parseAudit');

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

    // 4a. Garde-fou anti-ligne perdue (voir findUnparsedRows). On relit le texte
    //     réellement parsé — celui qui a produit les items, nettoyé ou brut.
    const parseWarnings = [];
    const parsedText = parseMode === 'clean' ? text : rawText;
    const orphanRows = findUnparsedRows(parsedText, parsed.items, parsed.discountItems);
    if (orphanRows.length > 0) {
      const detail = orphanRows
        .map((o) => `${o.context ? o.context + ' — ' : ''}${o.qty} × ${o.unit_price.toFixed(2)} € = ${o.total.toFixed(2)} € HT`)
        .join(' | ');
      console.warn(`[pdfImport] ${supplier.name} : ${orphanRows.length} ligne(s) du document non parsée(s) → ${detail}`);
      parseWarnings.push({
        type: 'unparsed_rows',
        message:
          `${orphanRows.length} ligne${orphanRows.length > 1 ? 's' : ''} du document ${orphanRows.length > 1 ? 'ne sont pas reprises' : "n'est pas reprise"} ` +
          `ci-dessous (total ${orphanRows.reduce((a, o) => a + o.total, 0).toFixed(2)} € HT). ` +
          `Ajoutez-${orphanRows.length > 1 ? 'les' : 'la'} à la main, puis signalez le parseur ${supplier.code || supplier.name}.`,
        rows: orphanRows,
      });
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
    //    Une même référence fournisseur pointe parfois sur PLUSIEURS produits : le
    //    fournisseur recycle sa réf. sur le produit successeur (chez LCA, la réf. de
    //    la Batterie Elfa Pro sert aussi à l'Elfa Turbo) ou l'utilise pour plusieurs
    //    déclinaisons. Sans ORDER BY, la ligne retenue dépendait de l'ordre physique
    //    des lignes en base : l'import commandait — donc mettait en stock — le
    //    produit arrêté au lieu de l'actuel. On tranche explicitement : un produit
    //    en ligne (publish) l'emporte toujours sur un produit arrêté (draft/private).
    const supplierSkus = parsed.items.map(i => i.supplier_sku);

    const matchQuery = `
      SELECT DISTINCT ON (ps.supplier_sku)
        ps.supplier_sku,
        ps.supplier_price,
        ps.pack_qty,
        p.id as internal_product_id,
        p.wp_product_id,
        p.post_title,
        p.sku as product_sku,
        p.stock,
        p.product_type,
        p.image_url,
        COUNT(*) OVER (PARTITION BY ps.supplier_sku)::int AS nb_candidates,
        STRING_AGG(p.post_title || ' (' || COALESCE(p.sku, '?') || ')', ' • ')
          OVER (PARTITION BY ps.supplier_sku) AS candidates
      FROM product_suppliers ps
      JOIN products p ON ps.product_id = p.id
      WHERE ps.supplier_id = $1
        AND ps.supplier_sku = ANY($2)
      ORDER BY
        ps.supplier_sku,
        (p.post_status = 'publish') DESC,
        ps.is_primary DESC NULLS LAST,
        ps.updated_at DESC NULLS LAST,
        p.id DESC
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

      // Prix brut du PDF (avant remise éventuelle).
      // CONVENTION UNIQUE : on stocke tout À L'UNITÉ (qty_ordered en unités, unit_price par unité).
      // invertPackQty (e.tasty, Curieux…) : PDF déjà en prix unitaire → tel quel.
      // pdfIsPackBased (JoshNoa…) / normal : PDF en prix pack → ÷ pack_qty.
      // skipPackQty : packQty forcé à 1, pas de conversion.
      const rawPdfGross = item.unit_price_net != null ? item.unit_price_net : null;
      let pdfGross;
      if (rawPdfGross != null && packQty > 1) {
        pdfGross = parsed.invertPackQty ? rawPdfGross : rawPdfGross / packQty;
      } else {
        pdfGross = rawPdfGross;
      }
      const discountPercent = item.discount_percent || 0;
      const pdfNet = pdfGross != null ? pdfGross * (1 - discountPercent / 100) : null;
      // dbPrice : supplier_price en BDD = prix pack pour tous les fournisseurs.
      // Convention unités → prix unitaire = ÷ pack_qty pour TOUS les modes.
      const dbPackQty = packQty;  // déjà normalisé par skipPackQty ci-dessus
      const rawDbPrice = match ? parseFloat(match.supplier_price) || null : null;
      let dbPrice;
      if (rawDbPrice != null && dbPackQty > 1) {
        dbPrice = rawDbPrice / dbPackQty;
      } else {
        dbPrice = rawDbPrice;
      }

      // Quantité finale : convention unique = nombre d'UNITÉS individuelles.
      // invertPackQty (e.tasty, Curieux…) : PDF déjà en unités → tel quel.
      // pdfIsPackBased (JoshNoa…) / normal : PDF en packs → × pack_qty.
      // skipPackQty : packQty = 1, donc × 1 (no-op).
      const qtyOrdered = parsed.invertPackQty
        ? item.qty_ordered
        : item.qty_ordered * packQty;

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
        // Réf. fournisseur partagée par plusieurs produits : le choix ci-dessus reste
        // une heuristique, l'écran d'import le signale pour que l'opérateur tranche.
        ambiguous_match: match ? (match.nb_candidates || 1) > 1 : false,
        match_candidates: match && (match.nb_candidates || 1) > 1 ? match.candidates : null,
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
        // Montant HT de la ligne tel qu'imprimé sur la facture (colonne « montant »).
        // Lu indépendamment du prix retenu → permet à l'écran d'import de signaler
        // ligne par ligne un calcul qui diverge de la facture (prefill d'un ancien
        // tarif, quantité en packs mal convertie…), au lieu du seul écart global
        // renvoyé par le garde-fou d'envoi BMS. null si le parseur ne l'expose pas.
        invoice_line_total_ht: Number.isFinite(Number(item.total_ht)) && Number(item.total_ht) > 0
          ? Number(item.total_ht)
          : null,
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

    // Total HT produits de la facture, pour le garde-fou de réconciliation à l'envoi
    // BMS (cf. createInBMS, contrôle B). Deux sources, par priorité :
    //  1. total explicite extrait par le parseur (parsed.invoiceProductTotalHT) ;
    //  2. sinon somme des montants de ligne (item.total_ht = colonne « montant HT »
    //     du PDF, lue indépendamment du prix unitaire retenu → reste un contrôle
    //     pertinent même si le prefill modifie le prix). Universel : couvre tout
    //     parseur qui expose total_ht par ligne, sans code spécifique par fournisseur.
    // On n'utilise la somme QUE si TOUTES les lignes produit ont un total_ht valide
    // (sinon somme partielle → faux total → on préfère désactiver le contrôle B).
    let invoiceTotalHt = parsed.invoiceProductTotalHT ?? null;
    const lineTotals = (parsed.items || []).map(i => Number(i.total_ht));
    const lineTotalsSum = lineTotals.every(t => Number.isFinite(t) && t > 0) && lineTotals.length > 0
      ? Math.round(lineTotals.reduce((a, b) => a + b, 0) * 100) / 100
      : null;
    if (invoiceTotalHt == null) invoiceTotalHt = lineTotalsSum;

    // Réconciliation : quand le parseur sait lire le total produits IMPRIMÉ sur le
    // document, il devient une source indépendante des lignes parsées. Un écart =
    // une ligne perdue ou dénaturée, signalé ici plutôt qu'à l'envoi BMS (trop tard,
    // et confondu avec un envoi partiel légitime).
    //
    // Réservé aux parseurs qui déclarent invoiceProductTotalIsGross, c.-à-d. dont le
    // total lu est bien le BRUT produits (libellé « Total produits »), donc
    // comparable ligne à ligne. Ailleurs le libellé est ambigu (« Montant HT » peut
    // inclure port et remises) : comparer déclencherait une alerte à chaque import,
    // et une alerte qui crie au loup ne protège plus de rien. Ces documents restent
    // couverts par le garde-fou universel findUnparsedRows ci-dessus.
    if (parsed.invoiceProductTotalIsGross && parsed.invoiceProductTotalHT != null && lineTotalsSum != null) {
      const gap = Math.round((parsed.invoiceProductTotalHT - lineTotalsSum) * 100) / 100;
      if (Math.abs(gap) > 0.02) {
        console.warn(`[pdfImport] ${supplier.name} : total imprimé ${parsed.invoiceProductTotalHT} € ≠ somme des lignes ${lineTotalsSum} € (écart ${gap} €)`);
        parseWarnings.push({
          type: 'total_mismatch',
          message:
            `Le document totalise ${parsed.invoiceProductTotalHT.toFixed(2)} € HT de produits, ` +
            `mais les ${parsed.items.length} lignes lues totalisent ${lineTotalsSum.toFixed(2)} € HT ` +
            `(écart ${gap.toFixed(2)} €). Une ligne est probablement manquante ou mal lue.`,
        });
      }
    }

    return {
      supplier_id: supplierId,
      supplier_name: supplier.name,
      order_number: parsed.orderNumber,
      order_date: parsed.orderDate,
      has_price: parsed.hasPrice || false,
      parse_mode: parseMode,
      duplicate_warning: duplicateWarning,
      // Anomalies de lecture du document (lignes non reprises, total incohérent).
      // Affichées en rouge dans l'écran d'import : une ligne perdue doit se voir.
      parse_warnings: parseWarnings,
      items: allItems,
      total_items: enrichedItems.length,
      matched_count: enrichedItems.filter(i => i.matched).length,
      unmatched_count: enrichedItems.filter(i => !i.matched).length,
      // Total HT produits lu sur la facture (garde-fou de réconciliation à l'envoi BMS).
      // null si ni total explicite ni montants de ligne exploitables → contrôle B ignoré.
      invoice_total_ht: invoiceTotalHt,
    };
  }
};

module.exports = pdfImportModel;
