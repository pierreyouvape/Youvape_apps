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

    // Zone produit : apres "Quantité Total HT" (header colonnes), avant "Détail des taxes"
    const startMatch = text.match(/Quantité\s+Total HT/);
    const startIdx = startMatch ? startMatch.index + startMatch[0].length : -1;
    const endIdx = text.indexOf('Détail des taxes');

    if (startIdx < 0 || endIdx < 0) return { orderNumber, orderDate, items, hasPrice: true };

    const productZone = text.substring(startIdx, endIdx);
    const lines = productZone.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Pattern de ligne de prix : "20 % 4,40 € 10 44,00 €"
    const priceLineRegex = /\d+\s*%\s+[\d,]+\s*€\s+\d+\s+[\d,]+\s*€\s*$/;

    // Trouver les indices des lignes de prix
    const priceLineIndices = [];
    for (let i = 0; i < lines.length; i++) {
      if (priceLineRegex.test(lines[i])) {
        priceLineIndices.push(i);
      }
    }

    // Construire les blocs
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

      // Texte avant les prix = ref + designation
      const textBefore = blockText.substring(0, blockText.indexOf(numbersMatch[0])).trim();
      if (!textBefore) continue;

      // La ref est au debut : lettres majuscules + chiffres (ex: SWDCO03000, BASIK05000)
      const refMatch = textBefore.match(/^([A-Z0-9][\w]+)\s+(.+)$/);
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
