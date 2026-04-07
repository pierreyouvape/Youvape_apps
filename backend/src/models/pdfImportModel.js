const { PDFParse } = require('pdf-parse');
const pool = require('../config/database');
const parserRegistry = require('../parsers');

const pdfImportModel = {
  /**
   * Parse un PDF fournisseur et matche les lignes avec les produits en BDD
   * @param {Buffer} pdfBuffer - Le buffer du fichier PDF
   * @param {number} supplierId - L'ID du fournisseur local
   * @returns {Object} Donnees parsees et enrichies
   */
  parsePdf: async (pdfBuffer, supplierId) => {
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
        `Pas de parseur PDF pour le fournisseur ${supplier.name} (code: ${supplier.code || 'non défini'}). ` +
        `Parseurs disponibles : ${parserRegistry.availableParsers().join(', ') || 'aucun'}`
      );
    }

    // 3. Extraire le texte du PDF
    const uint8 = new Uint8Array(pdfBuffer);
    const pdfParser = new PDFParse(uint8);
    await pdfParser.load();
    const pdfData = await pdfParser.getText();
    const text = pdfData.text;

    // 4. Parser avec le parseur du fournisseur
    const parsed = parser.parse(text);

    if (!parsed.items || parsed.items.length === 0) {
      throw new Error('Aucune ligne produit trouvée dans le PDF');
    }

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
        p.product_type
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
      // Pour Revolute/JoshNoa le prix PDF est un prix pack → diviser par pack_qty
      // Exception : skipPackQty (Curieux) → pack_qty forcé à 1, pas de division
      const rawPdfGross = item.unit_price_net != null ? item.unit_price_net : null;
      const pdfGross = (rawPdfGross != null && packQty > 1) ? rawPdfGross / packQty : rawPdfGross;
      const discountPercent = item.discount_percent || 0;
      // Prix net = brut * (1 - remise/100)
      const pdfNet = pdfGross != null ? pdfGross * (1 - discountPercent / 100) : null;
      // dbPrice : supplier_price BMS = prix pack → diviser par pack_qty réel pour avoir le prix unitaire
      const dbPackQty = match ? (parseInt(match.pack_qty) || 1) : 1;
      const rawDbPrice = match ? parseFloat(match.supplier_price) || null : null;
      const dbPrice = (rawDbPrice != null && dbPackQty > 1) ? rawDbPrice / dbPackQty : rawDbPrice;

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
        // Prix
        pdf_price: pdfGross,           // prix brut HT (affiché dans "Prix unit.")
        pdf_price_net: pdfNet,         // prix net après remise (pour calcul unit_price)
        discount_percent: discountPercent,
        supplier_price: dbPrice,
        // Prix retenu : PDF si meilleur (ou si pas de prix BDD), sinon prix BDD
        unit_price: (pdfNet != null && (dbPrice == null || pdfNet < dbPrice)) ? pdfNet : dbPrice,
        // Pack
        pack_qty: packQty,
        qty_ordered: item.qty_ordered * packQty,
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
      duplicate_warning: duplicateWarning,
      items: allItems,
      total_items: enrichedItems.length,
      matched_count: enrichedItems.filter(i => i.matched).length,
      unmatched_count: enrichedItems.filter(i => !i.matched).length,
    };
  }
};

module.exports = pdfImportModel;
