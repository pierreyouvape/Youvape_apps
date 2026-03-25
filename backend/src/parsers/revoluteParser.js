/**
 * Parseur PDF pour Revolute (Laboratoire Cosmer)
 * Format : facture TCPDF avec prix HT
 * Colonnes : Reference | Produit | Taux de taxe | Prix unitaire HT | Qte | Total HT
 * Les refs commencent par REF (ex: REF0029, REFVG10)
 * Les designations peuvent deborder sur 2 lignes
 * Fin de zone produit : "Réductions" ou "Détail des taxes"
 */

module.exports = {
  parse: (text) => {
    // Extraire ref commande et date : "#FA019518 10/03/2026 DIYXUUZWF 10/03/2026"
    const orderMatch = text.match(/#FA\d+\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\S+)\s+\d{2}\/\d{2}\/\d{4}/);
    const orderNumber = orderMatch ? orderMatch[4] : null;
    const orderDate = orderMatch ? `${orderMatch[3]}-${orderMatch[2]}-${orderMatch[1]}` : null;

    const items = [];

    // Zone produit : apres header de colonnes, avant "Réductions" ou "Détail des taxes"
    // Le header finit par "Qté Total\n(HT)" ou "Quantité Total\n(HT)"
    const startMatch = text.match(/(?:Qté|Quantité)\s+Total\s*\n\s*\(HT\)/);
    const startIdx = startMatch ? startMatch.index + startMatch[0].length : -1;

    // Fin : "Réductions" en priorite, sinon "Détail des taxes"
    let endIdx = text.indexOf('Réductions');
    if (endIdx < 0 || endIdx < startIdx) endIdx = text.indexOf('Détail des taxes');

    if (startIdx < 0 || endIdx < 0) return { orderNumber, orderDate, items, hasPrice: true };

    let productZone = text.substring(startIdx, endIdx);

    // Nettoyer pagination et headers de pages intermediaires
    productZone = productZone
      .replace(/\d+\s*\/\s*\d+\s*\n/g, '\n')
      .replace(/--\s*\d+\s*of\s*\d+\s*--/g, '\n')
      .replace(/FACTURE\n[\s\S]*?#FA\d+/g, '\n')
      .replace(/Laboratoire cosmer[^\n]*/g, '\n');

    const lines = productZone.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Pattern de ligne de prix : "20 % 1,83 € 10 18,30 €"
    const priceLineRegex = /\d+\s*%\s+[\d,]+\s*€\s+\d+\s+[\d,]+\s*€\s*$/;

    const priceLineIndices = [];
    for (let i = 0; i < lines.length; i++) {
      if (priceLineRegex.test(lines[i])) {
        priceLineIndices.push(i);
      }
    }

    let blockStart = 0;
    for (const priceIdx of priceLineIndices) {
      const blockLines = lines.slice(blockStart, priceIdx + 1);
      blockStart = priceIdx + 1;

      const blockText = blockLines.join(' ').replace(/\s+/g, ' ').trim();

      // Extraire les prix : TAUX% PRIX_UNIT€ QTE TOTAL€
      const numbersMatch = blockText.match(
        /(\d+)\s*%\s+([\d,]+)\s*€\s+(\d+)\s+([\d,]+)\s*€\s*$/
      );
      if (!numbersMatch) continue;

      const parseDecimal = (str) => parseFloat(str.replace(',', '.'));

      const prixUnit = parseDecimal(numbersMatch[2]);
      const qty = parseInt(numbersMatch[3]);
      const totalHt = parseDecimal(numbersMatch[4]);

      const textBefore = blockText.substring(0, blockText.indexOf(numbersMatch[0])).trim();
      if (!textBefore) continue;

      // La ref commence par REF : "REF0029 -- Base 50/50..."
      const refMatch = textBefore.match(/^(REF[\w]+)\s+(.+)$/);
      let supplierSku = '';
      let designation = textBefore;

      if (refMatch) {
        supplierSku = refMatch[1];
        designation = refMatch[2];
      }

      if (supplierSku) {
        items.push({
          supplier_sku: supplierSku,
          designation: designation.trim(),
          qty_ordered: qty,
          unit_price_net: prixUnit,
          total_ht: totalHt,
        });
      }
    }

    return { orderNumber, orderDate, items, hasPrice: true };
  }
};
