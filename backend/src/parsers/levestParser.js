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

    // Zone produit : entre le header de colonnes et "Communication de paiement"
    const startMatch = text.match(/Description\s+Quantité\s+Prix/);
    const startIdx = startMatch ? startMatch.index + startMatch[0].length : -1;
    const endIdx = text.indexOf('Communication de paiement');

    if (startIdx < 0 || endIdx < 0) return { orderNumber, orderDate, items, hasPrice: true };

    // Avancer apres le header complet (qui est sur plusieurs lignes)
    const headerEnd = text.indexOf('Montant', startIdx);
    const productZone = text.substring(headerEnd > 0 ? headerEnd + 7 : startIdx, endIdx);

    const lines = productZone.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Pattern de ligne de prix avec tab :
    // "60,00 \t1,35 \t0,00 TVA 20% 81,00 €" ou sur la meme ligne que la ref
    // Format complet : "[REF] Designation \tQTE \tPU \tREM TVA XX% MONTANT €"
    // Ou split : "[REF] Designation -" + "SUITE" + "QTE \tPU \tREM TVA XX% MONTANT €"

    // Strategie : chaque item commence par "[" et se termine par une ligne contenant "TVA" + "€"
    const priceLineRegex = /TVA\s+\d+%\s+[\d.,]+\s*€\s*$/;

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

      // Extraire la ref entre crochets
      const refMatch = blockText.match(/^\[(\w+)\]\s*/);
      if (!refMatch) continue;

      const supplierSku = refMatch[1];

      // Ignorer [SHIPPING]
      if (supplierSku === 'SHIPPING') continue;

      // Extraire les chiffres : QTE PU REM TVA XX% MONTANT €
      // "60,00 1,35 0,00 TVA 20% 81,00 €" ou "5,00 4,50 0,00 TVA 20% 22,50 €"
      // Attention : les nombres peuvent utiliser virgule ou point
      const numbersMatch = blockText.match(
        /([\d.,]+)\s+([\d.,]+)\s+(?:([\d.,]+)\s+)?TVA\s+\d+%\s+([\d.,]+)\s*€\s*$/
      );
      if (!numbersMatch) continue;

      const parseNum = (str) => parseFloat(str.replace(',', '.'));

      const qty = Math.round(parseNum(numbersMatch[1]));
      const prixUnit = parseNum(numbersMatch[2]);
      const totalHt = parseNum(numbersMatch[4]);

      // Designation : entre la ref et les chiffres
      const afterRef = blockText.substring(refMatch[0].length);
      const numbersStart = afterRef.indexOf(numbersMatch[0]);
      const designation = afterRef.substring(0, numbersStart).trim();

      if (supplierSku) {
        items.push({
          supplier_sku: supplierSku,
          designation: designation,
          qty_ordered: qty,
          unit_price_net: prixUnit,
          total_ht: totalHt,
        });
      }
    }

    return { orderNumber, orderDate, items, hasPrice: true };
  }
};
