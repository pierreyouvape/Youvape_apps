/**
 * Parseur PDF pour JoshNoa & Co
 * Format : facture pro forma Prestashop avec prix
 * Colonnes : DESCRIPTION | QTE | P.U HT | P.U TTC | PU REM. HT | TAXES | MONTANT
 * On extrait PU REM. HT comme prix unitaire net
 */

module.exports = {
  parse: (text) => {
    // Extraire le numero de facture : "Facture pro forma # S285348" -> "S285348"
    const orderMatch = text.match(/Facture\s+pro\s+forma\s+#\s*(\S+)/i);
    const orderNumber = orderMatch ? orderMatch[1] : null;

    // Extraire la date : "24/03/2026" apres "Date de la commande"
    const dateMatch = text.match(/Date de la commande\s*\n\s*(\d{2})\/(\d{2})\/(\d{4})/);
    const orderDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

    // Extraire les lignes produit
    // Format dans le texte brut :
    // [josh00043015] Puff Le Bar 40K\n1000mAh 22ml - Lost Vape (20\nmg/ml, Mr Blue)\n10,00 \t9,50 \t11,40 \t8,00 \t20% \t80,01 €
    const items = [];

    // Trouver tous les blocs commencant par [josh...] jusqu'au prochain [josh...] ou "Livraison" ou "Montant HT"
    const blockRegex = /\[josh[^\]]+\][\s\S]*?(?=\[josh|\bLivraison\b|\bMontant HT\b)/g;
    const blocks = text.match(blockRegex) || [];

    for (const block of blocks) {
      // Extraire la ref : [josh00043015]
      const refMatch = block.match(/\[(josh\d+)\]/);
      if (!refMatch) continue;

      const supplierSku = refMatch[1];

      // Extraire la designation : tout entre la ref et les chiffres
      // Les chiffres commencent par le pattern "10,00 \t9,50" (qte \t prix)
      const descAndNumbers = block.substring(block.indexOf(']') + 1).trim();

      // Separer designation des chiffres
      // Les chiffres sont sur la derniere "ligne logique" : "10,00 \t9,50 \t11,40 \t8,00 \t20% \t80,00 €"
      const numbersMatch = descAndNumbers.match(
        /(\d+[.,]\d+)\s+(\d+[.,]\d+)\s+(\d+[.,]\d+)\s+(\d+[.,]\d+)\s+(\d+%)\s+(\d+[.,]\d+)\s*€/
      );

      if (!numbersMatch) continue;

      // La designation est tout ce qui precede les chiffres
      const numbersStart = descAndNumbers.indexOf(numbersMatch[0]);
      const designation = descAndNumbers.substring(0, numbersStart)
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const parseDecimal = (str) => parseFloat(str.replace(',', '.'));

      const qty = parseDecimal(numbersMatch[1]);
      const puHt = parseDecimal(numbersMatch[2]);
      const puTtc = parseDecimal(numbersMatch[3]);
      const puRemHt = parseDecimal(numbersMatch[4]);
      const montant = parseDecimal(numbersMatch[6]);

      items.push({
        supplier_sku: supplierSku,
        designation,
        qty_ordered: Math.round(qty),
        unit_price_ht: puHt,
        unit_price_ttc: puTtc,
        unit_price_net: puRemHt,  // PU REM. HT = prix apres remise, c'est le vrai prix
        total_ht: montant,
      });
    }

    return { orderNumber, orderDate, items, hasPrice: true };
  }
};
