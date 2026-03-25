/**
 * Parseur PDF pour LCA Distribution
 * Format : mail de confirmation de preparation imprime en PDF
 * Pas de prix dans ce document — uniquement refs, designations, quantites
 */

module.exports = {
  parse: (text) => {
    // Extraire le numero de commande : "N°321094" -> "321094"
    const orderMatch = text.match(/N°(\d+)/);
    const orderNumber = orderMatch ? orderMatch[1] : null;

    // Extraire la date : "passée le 03/03/2026" -> "2026-03-03"
    const dateMatch = text.match(/pass[ée]+e le (\d{2})\/(\d{2})\/(\d{4})/);
    const orderDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

    // Les refs sont coupees sur 2 lignes dans le texte extrait :
    // "#REF18884-\n65133 Shishasip 35K - JNR - Saveur : Lush Ice \t20 \t20 \t0"
    // Certaines designations aussi :
    // "#REF18884-\n65140\nShishasip 35K - JNR - Saveur : Mango\nPineapple 20 \t20 \t0"

    // Strategie : rejoindre les lignes cassees puis parser
    // 1. Trouver tous les blocs commencant par #REF jusqu'au prochain #REF ou "LCA DISTRIBUTION"
    const items = [];
    const blockRegex = /#REF[\s\S]*?(?=#REF|LCA DISTRIBUTION)/g;
    const blocks = text.match(blockRegex) || [];

    for (const block of blocks) {
      // Nettoyer le bloc : remplacer les retours a la ligne par des espaces
      const cleaned = block.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

      // Format attendu apres nettoyage :
      // "#REF18884- 65133 Shishasip 35K - JNR - Saveur : Lush Ice 20 20 0"
      // ou "#REF18884- 65140 Shishasip 35K - JNR - Saveur : Mango Pineapple 20 20 0"
      const itemMatch = cleaned.match(
        /^#(REF\d+-\s*\d+)\s+(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/
      );

      if (itemMatch) {
        // Reconstituer la ref sans espace : "REF18884- 65133" -> "#REF18884-65133"
        const rawRef = itemMatch[1].replace(/\s+/g, '');
        items.push({
          supplier_sku: `#${rawRef}`,
          designation: itemMatch[2].trim(),
          qty_ordered: parseInt(itemMatch[3]),
          qty_prepared: parseInt(itemMatch[4]),
          backorder: parseInt(itemMatch[5]),
        });
      }
    }

    return { orderNumber, orderDate, items, hasPrice: false };
  }
};
