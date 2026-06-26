/**
 * Parseur PDF pour Cloud Vapor (b2b.cloudvapor.com)
 * Format : bon de commande "Commande # Sxxxxx"
 * Colonnes : DESCRIPTION | QUANTITÉ | PRIX UNITAIRE | TAXES | MONTANT
 *
 * - Référence entre crochets en tête de désignation :
 *   "[BLUE VELVET-50ML-00MG] BLUE VELVET-50ML"
 * - Quantité en UNITÉS : "138,00 Unité(s) (23 Boîte de regroupement)"
 *   Le groupage entre parenthèses (Boîte / Colisage Carton) est ignoré : le
 *   pack_qty vient de la BDD (product_suppliers).
 * - Prix unitaire HT + montant HT par ligne.
 * - Lignes de remise / escompte (sans crochets, montant négatif) → discountItems.
 *   Les lignes à 0 € (ex: "Chronopost") sont ignorées.
 *
 * PDF = prix unitaire + quantité en unités → invertPackQty (comme e.tasty) :
 * le modèle convertit en packs via le pack_qty de la BDD.
 */

module.exports = {
  parse: (text) => {
    const parseDecimal = (str) => parseFloat(String(str).replace(/\s/g, '').replace(',', '.'));

    // Numéro de commande : "Commande # S07639"
    const orderMatch = text.match(/Commande\s*#\s*(\S+)/i);
    const orderNumber = orderMatch ? orderMatch[1] : null;

    // Date de commande : "Date de la commande 26/06/2026" (libellé puis valeur)
    const dateMatch = text.match(/Date de la commande\s+(\d{2})\/(\d{2})\/(\d{4})/i);
    const orderDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

    // Zone tableau : du premier "[" (1ère référence) jusqu'aux totaux / pied de page.
    const tableStart = text.indexOf('[');
    const tableEndIdx = text.search(/Montant hors taxes|Fabricant Nantais|Conditions de paiement/i);
    const tableText = text.substring(
      tableStart >= 0 ? tableStart : 0,
      tableEndIdx > tableStart ? tableEndIdx : text.length
    );

    const items = [];
    const discountItems = [];

    // Chaque ligne : DESCRIPTION  QTE Unité(s) [(groupage)]  PRIX  TVA NN%  MONTANT €
    // La désignation peut déborder sur plusieurs lignes (capture non gourmande).
    const rowPattern = /([\s\S]*?)([\d.,]+)\s*Unité\(s\)(?:\s*\([^)]*\))?\s+(-?[\d.,]+)\s+TVA\s*\d+\s*%\s+(-?[\d\s.,]+)\s*€/g;

    let m;
    while ((m = rowPattern.exec(tableText)) !== null) {
      const description = m[1].replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
      const qty = Math.round(parseDecimal(m[2]));
      const unitPrice = parseDecimal(m[3]);
      const montant = parseDecimal(m[4]);

      // Cohérence qty × prix ≈ montant (évite les faux positifs : totaux, etc.)
      if (Number.isNaN(qty) || Number.isNaN(unitPrice) || Math.abs(qty * unitPrice - montant) > 0.05) {
        continue;
      }

      const skuMatch = description.match(/\[([^\]]+)\]/);
      if (skuMatch) {
        // Ligne produit
        const supplierSku = skuMatch[1].trim();
        const designation = description.slice(skuMatch.index + skuMatch[0].length).trim();
        items.push({
          supplier_sku: supplierSku,
          designation: designation || supplierSku,
          qty_ordered: qty,
          unit_price_net: unitPrice,
          total_ht: montant,
        });
      } else if (montant < 0) {
        // Ligne remise / escompte (montant négatif, pas de référence)
        discountItems.push({
          item_type: 'discount',
          product_name: description,
          unit_price: montant, // déjà négatif
          qty_ordered: 1,
        });
      }
      // sinon (ex: "Chronopost" à 0,00 €) : ligne ignorée
    }

    return { orderNumber, orderDate, items, discountItems, hasPrice: true, invertPackQty: true };
  }
};
