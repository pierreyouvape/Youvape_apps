/**
 * Parseur PDF pour e.tasty
 * Format : facture TCPDF avec prix HT
 * Colonnes : Reference | Produit | TVA | Prix unitaire HT | Quantite | Total HT
 * Les designations peuvent deborder sur 2 lignes ("Multilingue" sur la ligne suivante)
 * Les prix sont sur une ligne separee : "20 % 4,40 € 10 44,00 €"
 */

module.exports = {
  parse: (text) => {
    // Extraire ref commande et date : "#FA069087/2026 18/03/2026 ERWZBDFMZ 18/03/2026"
    const orderMatch = text.match(/#FA[\w/]+\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\S+)\s+\d{2}\/\d{2}\/\d{4}/);
    const orderNumber = orderMatch ? orderMatch[4] : null;
    const orderDate = orderMatch ? `${orderMatch[3]}-${orderMatch[2]}-${orderMatch[1]}` : null;

    const items = [];

    // Scan global : chaque bloc REF Designation TAUX% PRIX_UNIT€ QTE TOTAL€
    // Insensible aux sauts de page, les headers/footers intercales sont ignores
    // La ref est un token alphanum majuscules en debut de bloc (ex: SWDCO03000, BASIK05000)
    const pricePattern = /([A-Z0-9][\w]+)([\s\S]*?)(\d+)\s*%\s+([\d,]+)\s*€\s+(\d+)\s+([\d,]+)\s*€/g;

    let m;
    while ((m = pricePattern.exec(text)) !== null) {
      const parseDecimal = (str) => parseFloat(str.replace(',', '.'));

      const supplierSku = m[1];
      const designation = m[2].replace(/\s+/g, ' ').trim();
      const prixUnit = parseDecimal(m[4]);
      const qty = parseInt(m[5]);
      const totalHt = parseDecimal(m[6]);

      // Verification coherence : qty * prix ~= total (evite les faux positifs)
      if (Math.abs(qty * prixUnit - totalHt) > 0.05) continue;

      items.push({
        supplier_sku: supplierSku,
        designation: designation,
        qty_ordered: qty,
        unit_price_net: prixUnit,
        total_ht: totalHt,
      });
    }

    return { orderNumber, orderDate, items, hasPrice: true };
  }
};
