/**
 * Parseur PDF pour Levest (Roykin / Petit Nuage / Vape of Legends)
 * Format : facture Odoo avec prix HT
 * Colonnes : Description | Quantite | Prix unitaire | Rem.% | Taxes | Montant
 * Les refs sont entre crochets : [PNREC10N06]
 * Les designations + chiffres sont sur la meme ligne, separees par tabs
 * Certaines designations debordent sur 2 lignes
 * [SHIPPING] est a ignorer
 */

module.exports = {
  parse: (text) => {
    // Ref commande : "Référence :\n202602866"
    const refMatch = text.match(/Référence\s*:\s*\n\s*(\S+)/);
    const orderNumber = refMatch ? refMatch[1] : null;

    // Date : "Date de la facture :\n17/03/2026"
    const dateMatch = text.match(/Date de la facture\s*:\s*\n\s*(\d{2})\/(\d{2})\/(\d{4})/);
    const orderDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

    const items = [];

    // Scan global : chaque bloc [REF] ... QTE PU TVA XX% MONTANT €
    // Insensible aux sauts de page, les headers/footers intercales sont ignores
    const pricePattern = /\[(\w+)\]([\s\S]*?)([\d.,]+)\s+([\d.,]+)\s+(?:([\d.,]+)\s+)?TVA\s+(\d+)%\s+([\d.,]+)\s*€/g;

    let m;
    while ((m = pricePattern.exec(text)) !== null) {
      const supplierSku = m[1];

      // Ignorer [SHIPPING]
      if (supplierSku === 'SHIPPING') continue;

      const parseNum = (str) => parseFloat(str.replace(',', '.'));

      const qty = Math.round(parseNum(m[3]));
      const prixUnit = parseNum(m[4]);
      const totalHt = parseNum(m[7]);

      // Designation : texte entre la ref et les chiffres, nettoyé
      const designation = m[2].replace(/\s+/g, ' ').trim();

      items.push({
        supplier_sku: supplierSku,
        designation: designation,
        qty_ordered: qty,
        unit_price_net: prixUnit,
        total_ht: totalHt,
      });
    }

    return { orderNumber, orderDate, items, hasPrice: true, skipPackQty: true };
  }
};
