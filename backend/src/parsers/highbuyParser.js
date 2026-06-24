/**
 * Parseur PDF pour Highbuy.fr
 * Format : facture TCPDF
 * Colonnes : Référence | Produit | Taux de taxe | Prix de base (HT) | Prix unitaire (HT) | Quantité | Total (HT)
 * Référence format : HBxxxx
 * Numéro de facture : "#FAxxxxxx"
 * Réductions/avoirs listés après le tableau dans la section "Réductions"
 */

module.exports = {
  parse: (text) => {
    // L'en-tête existe en deux mises en page selon le PDF :
    //   A) libellé suivi de la valeur : "Réf. de commande MUKVTATQG"
    //   B) ligne de libellés puis ligne de valeurs :
    //      "Numéro de facture Date de facturation Réf. de commande Date de commande"
    //      "#FA020724 24/06/2026 QFNAVMCMQ 24/06/2026"
    // En B, "Réf. de commande" est immédiatement suivi du libellé "Date de commande" :
    // la regex naïve capturait alors "Date" au lieu du vrai numéro.

    // Ligne de valeurs : #FA<num> <date facturation> <réf commande> <date commande>
    const valueRowMatch = text.match(
      /#FA\d+\s+\d{2}\/\d{2}\/\d{4}\s+(\S+)\s+(\d{2})\/(\d{2})\/(\d{4})/
    );

    // Numéro de commande
    let orderNumber = null;
    const refLabelMatch = text.match(/Réf\.\s*de commande\s+(\S+)/);
    if (refLabelMatch && !/^Date$/i.test(refLabelMatch[1]) && !/^\d{2}\/\d{2}\/\d{4}$/.test(refLabelMatch[1])) {
      orderNumber = refLabelMatch[1];                 // format A
    } else if (valueRowMatch) {
      orderNumber = valueRowMatch[1];                 // format B
    }

    // Date de commande
    let orderDate = null;
    const dateMatch = text.match(/Date de commande\s+(\d{2})\/(\d{2})\/(\d{4})/);
    if (dateMatch) {
      orderDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;   // format A
    } else if (valueRowMatch) {
      orderDate = `${valueRowMatch[4]}-${valueRowMatch[3]}-${valueRowMatch[2]}`;   // format B
    }

    const items = [];

    // Isoler la zone produits : du premier HBxxxx jusqu'aux totaux
    const tableStart = text.search(/\bHB\d+\b/);
    const tableEnd = text.search(/Réductions|Total produits|Détail des taxes|Powered by TCPDF/);

    const tableText = text.substring(
      tableStart >= 0 ? tableStart : 0,
      tableEnd > tableStart ? tableEnd : text.length
    );

    // Trouver toutes les occurrences de HBxxxx dans la zone produits
    const refs = [];
    const refRegex = /\b(HB\d+)\b/g;
    let m;
    while ((m = refRegex.exec(tableText)) !== null) {
      refs.push({ sku: m[1], index: m.index, endIndex: m.index + m[0].length });
    }

    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      const nextStart = i + 1 < refs.length ? refs[i + 1].index : tableText.length;
      const block = tableText.substring(ref.index, nextStart);

      // "20 %" délimite la fin de la désignation et le début des données chiffrées
      // Les noms produits peuvent contenir "95 %" → on cherche spécifiquement "20 %"
      const taxIdx = block.search(/\b20\s*%/);
      if (taxIdx < 0) continue;

      const designation = block.substring(ref.sku.length, taxIdx)
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const afterTax = block.substring(taxIdx);
      let unitPrice = null, qty = null;

      // Cas 1 : prix de base présent → "20 % 12,90 € 11,90 € 5 59,50 €"
      const withBase = afterTax.match(
        /20\s*%\s+([\d,]+)\s*€\s+([\d,]+)\s*€\s+(\d+)\s+([\d,]+)\s*€/
      );
      if (withBase) {
        unitPrice = parseFloat(withBase[2].replace(',', '.'));
        qty = parseInt(withBase[3]);
      } else {
        // Cas 2 : sans prix de base → "20 % -- 10,35 € 10 103,50 €"
        const noDash = afterTax.match(
          /20\s*%\s*-{1,2}\s*([\d,]+)\s*€\s+(\d+)\s+([\d,]+)\s*€/
        );
        if (noDash) {
          unitPrice = parseFloat(noDash[1].replace(',', '.'));
          qty = parseInt(noDash[2]);
        }
      }

      if (!unitPrice || !qty) continue;

      items.push({
        supplier_sku: ref.sku,
        designation,
        qty_ordered: qty,
        unit_price_net: unitPrice,
      });
    }

    // Réductions/avoirs : section "Réductions" entre le tableau et les totaux
    // Ex : "Avoir Maxime C (erreur derniere commande) - 62,70 €"
    const discountItems = [];
    const reductionsIdx = text.search(/Réductions/);
    if (reductionsIdx >= 0) {
      const endIdx = text.search(/Total produits|Détail des taxes/);
      const reductionsBlock = text.substring(
        reductionsIdx + 'Réductions'.length,
        endIdx > reductionsIdx ? endIdx : reductionsIdx + 500
      );
      const discountRegex = /(.+?)\s*-\s*([\d,]+)\s*€/g;
      let dm;
      while ((dm = discountRegex.exec(reductionsBlock)) !== null) {
        const label = dm[1].trim();
        if (!label || label.length < 3) continue;
        const amount = parseFloat(dm[2].replace(',', '.'));
        if (amount > 0) {
          discountItems.push({
            item_type: 'discount',
            product_name: label,
            unit_price: -amount,
            qty_ordered: 1,
          });
        }
      }
    }

    return { orderNumber, orderDate, items, discountItems, hasPrice: true, skipPackQty: true };
  }
};
