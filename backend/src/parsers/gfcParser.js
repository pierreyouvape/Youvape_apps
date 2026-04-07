/**
 * Parseur PDF pour GFC PROVAP
 * Gere 2 formats :
 * - "Facture" : facture avec colonnes Reference | Designation | Code barre | Quantite | PU HT | Montant HT
 * - "Confirmation" : confirmation de commande site web gfc-provap.com
 *   Colonnes : Produit | Qté | Prix unitaire | Prix total
 *   Chaque item : désignation (1-2 lignes) + "Référence : GFCxxxxx" (espace avant les deux-points)
 *   Prix unitaires : HT
 *   Lignes remise : "Avoir concernant la commande n°..." et "Service après vente - Remboursement SAV..."
 */

module.exports = {
  parse: (text) => {
    // Format confirmation : "Commande KQSJBBEMX du 01-04-2026"
    if (text.match(/Commande\s+[A-Z0-9]+\s+du\s+\d{2}-\d{2}-\d{4}/) && text.includes('Référence :')) {
      return parseConfirmation(text);
    }
    return parseFacture(text);
  }
};

/**
 * Format "Confirmation de commande" (site web gfc-provap.com)
 */
function parseConfirmation(text) {
  // Numero de commande : "Commande KQSJBBEMX du 01-04-2026"
  const orderMatch = text.match(/Commande\s+([A-Z0-9]+)\s+du\s+(\d{2})-(\d{2})-(\d{4})/);
  const orderNumber = orderMatch ? orderMatch[1] : null;
  const orderDate = orderMatch ? `${orderMatch[4]}-${orderMatch[3]}-${orderMatch[2]}` : null;

  const items = [];
  const discountItems = [];

  // === Lignes remise : "Avoir concernant la commande n°XXXXXX 1 -7,80 €" ===
  const avoirRegex = /Avoir concernant la commande n°(\d+)\s+1\s+-?([\d,]+)\s*€/g;
  let avoirMatch;
  while ((avoirMatch = avoirRegex.exec(text)) !== null) {
    const montant = parseFloat(avoirMatch[2].replace(',', '.'));
    discountItems.push({
      item_type: 'discount',
      product_name: `Avoir commande n°${avoirMatch[1]}`,
      unit_price: -montant,
      qty_ordered: 1,
    });
  }

  // === Lignes remise : "Service après vente - Remboursement SAV 1-008518 1 -70,56 €" ===
  const savRegex = /Service après vente - Remboursement SAV\s+([\w-]+)\s+1\s+-?([\d,]+)\s*€/g;
  let savMatch;
  while ((savMatch = savRegex.exec(text)) !== null) {
    const montant = parseFloat(savMatch[2].replace(',', '.'));
    discountItems.push({
      item_type: 'discount',
      product_name: `Remboursement SAV ${savMatch[1]}`,
      unit_price: -montant,
      qty_ordered: 1,
    });
  }

  // Nettoyer les headers/footers de pages
  const cleaned = text
    .replace(/\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}[^\n]*/g, '')
    .replace(/https?:\/\/[^\n]*/g, '')
    .replace(/Historique des commandes - GFC PROVAP/g, '')
    .replace(/^\s*\d+\/\d+\s*$/gm, '')
    .replace(/Total produits HT[^\n]*/g, '')
    .replace(/Total produits TTC[^\n]*/g, '')
    .replace(/Total codes promo TTC[^\n]*/g, '')
    .replace(/Total livraison TTC[^\n]*/g, '')
    .replace(/^Total TTC[^\n]*/gm, '')
    .replace(/Avoir concernant[^\n]*/g, '')
    .replace(/Service après vente[^\n]*/g, '');

  // === Items produits : blocs "Référence : GFCxxxxxx QTE PRIX€ TOTAL€" ===
  const refRegex = /Référence\s*:\s*(GFC[\w-]+)\s+(\d+)\s+([\d,]+)\s*€/g;
  let match;
  const refMatches = [];
  while ((match = refRegex.exec(cleaned)) !== null) {
    refMatches.push({
      sku: match[1].trim(),
      qty: parseInt(match[2]),
      unitPrice: parseFloat(match[3].replace(',', '.')),
      index: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  for (let i = 0; i < refMatches.length; i++) {
    const ref = refMatches[i];
    const prevEnd = i > 0 ? refMatches[i - 1].endIndex : 0;

    // Désignation : lignes entre la fin du bloc précédent et la ref courante
    const beforeRef = cleaned.substring(prevEnd, ref.index);
    const headerWords = ['Produit', 'Qté', 'Prix', 'unitaire', 'total'];
    const beforeLines = beforeRef.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const desigLines = beforeLines.filter(l => !headerWords.some(w => l === w));
    const designation = desigLines.slice(-2).join(' ').trim();

    if (ref.qty > 0) {
      items.push({
        supplier_sku: ref.sku,
        designation,
        qty_ordered: ref.qty,
        unit_price_net: ref.unitPrice,
      });
    }
  }

  return { orderNumber, orderDate, items, discountItems, hasPrice: true, skipPackQty: true };
}

/**
 * Format "Facture"
 */
function parseFacture(text) {
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

  // Trouver les blocs GFC... jusqu'au prochain GFC... ou fin de section
  // "GFC Provap" = footer de page (ne commence pas par "GFC" + chiffre)
  // "Base HT" = debut des totaux
  // "Sous-total HT" = sous-total de page (multi-pages)
  const blockRegex = /GFC\d[\s\S]*?(?=GFC\d|\bBase HT\b|\bSous-total HT\b)/g;
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
