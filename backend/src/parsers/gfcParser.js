/**
 * Parseur PDF pour GFC Provap
 * Format : facture avec prix HT
 * Colonnes : Reference | Designation | Code barre | Quantite | PU HT | Montant HT
 * Refs au format GFCxxxxx ou GFCxxxxx-xxxxx
 */

module.exports = {
  parse: (text) => {
    // Extraire le numero de commande : "Réf. Commande : 560189"
    const orderMatch = text.match(/Réf\.\s*Commande\s*:\s*(\S+)/);
    const orderNumber = orderMatch ? orderMatch[1] : null;

    // Extraire la date : "Date : 18/03/2026"
    const dateMatch = text.match(/Date\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/);
    const orderDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

    // Extraire les lignes produit
    // Les lignes commencent par GFCxxxxx et se terminent par les chiffres prix
    // Certaines designations debordent sur 2 lignes :
    // "GFC34676-63077 Silver Nic Salt 10ml - Eminence by Xo Havana - Nicotine :\n20mg 3760366394003 10 2.20 22.00"
    const items = [];

    // Trouver les blocs GFC... jusqu'au prochain GFC... ou "Base HT"
    const blockRegex = /GFC\d[\s\S]*?(?=GFC\d|\bBase HT\b)/g;
    const blocks = text.match(blockRegex) || [];

    for (const block of blocks) {
      // Nettoyer : joindre les lignes
      const cleaned = block.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

      // Format apres nettoyage :
      // "GFC29787 Pochette de Vapoteur 8100000026 5 1.84 9.20"
      // "GFC34676-63077 Silver Nic Salt 10ml - Eminence by Xo Havana - Nicotine : 20mg 3760366394003 10 2.20 22.00"
      //
      // Pattern : REF DESIGNATION CODEBARRE QTE PU_HT MONTANT_HT
      // Le code barre est une suite de chiffres (10-13 digits), suivi de qte (1-4 digits) puis prix
      const itemMatch = cleaned.match(
        /^(GFC[\w-]+)\s+(.+?)\s+(\d{4,13})\s+(\d+)\s+(\d+\.\d{2})\s+(\d+\.\d{2})\s*$/
      );

      if (itemMatch) {
        items.push({
          supplier_sku: itemMatch[1],
          designation: itemMatch[2].trim(),
          barcode: itemMatch[3],
          qty_ordered: parseInt(itemMatch[4]),
          unit_price_net: parseFloat(itemMatch[5]),
          total_ht: parseFloat(itemMatch[6]),
        });
      }
    }

    return { orderNumber, orderDate, items, hasPrice: true };
  }
};
