/**
 * Parseur PDF pour LIPS - French Liquide (Laboratoire LIPS France)
 * Deux formats :
 * - "Devis" : Odoo, refs entre crochets [PACK-...], qty "4,000 Unité(s)", prix "9,5000 TVA 20% 38,00 €"
 * - "Facture Pro Forma" : ancien format SARL EMC, refs type E2S-MOON-GOLDSUCKER-60-03
 */

module.exports = {
  parse: (text) => {
    if (text.includes('Devis #')) return parseDevis(text);
    return parseProForma(text);
  }
};

/**
 * Format Devis Odoo
 */
function parseDevis(text) {
  // Numero : "Devis # S00220"
  const orderMatch = text.match(/Devis\s*#\s*(\S+)/);
  const orderNumber = orderMatch ? orderMatch[1] : null;

  // Date : "14/04/2026"
  const dateMatch = text.match(/Date du devis\s*\n\s*(\d{2})\/(\d{2})\/(\d{4})/);
  const orderDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

  const items = [];
  const parseNum = (s) => parseFloat(s.replace(',', '.'));

  // Les pages 1-2 sont un résumé sans prix — couper au header du tableau de prix
  // "Description Quantité Prix unitaire Taxes Montant" marque le début des vraies lignes
  const priceSectionStart = text.indexOf('Description Quantité Prix unitaire Taxes Montant');
  const priceText = priceSectionStart >= 0 ? text.substring(priceSectionStart) : text;

  // Scan global : [REF] designation ... QTE\nUnité(s) PU TVA XX% TOTAL €
  const pattern = /\[([A-Z0-9-]+)\](.*?)([\d,]+)\s*\nUnité\(s\)\s*([\d,]+)\s+TVA\s+\d+%\s+([\d,.]+)\s*€/gs;

  let m;
  while ((m = pattern.exec(priceText)) !== null) {
    const supplierSku = m[1];

    // Ignorer livraison/expédition
    if (/livraison|exp[eé]dition/i.test(m[2])) continue;
    // Ignorer items à 0
    const prixUnit = parseNum(m[4]);
    if (prixUnit === 0) continue;

    const designation = m[2].replace(/\s+/g, ' ').trim();
    const qty = Math.round(parseNum(m[3]));
    const totalHt = parseNum(m[5]);

    items.push({
      supplier_sku: supplierSku,
      designation,
      qty_ordered: qty,
      unit_price_net: prixUnit,
      total_ht: totalHt,
    });
  }

  return { orderNumber, orderDate, items, hasPrice: true, skipPackQty: true };
}

/**
 * Format Facture Pro Forma (ancien format SARL EMC)
 */
function parseProForma(text) {
    // Numero de commande : "Commande N°H2026-0005-2444"
    const orderMatch = text.match(/Commande\s+N°([\w-]+)/);
    const orderNumber = orderMatch ? orderMatch[1] : null;

    // Date : "07/04/2026"
    const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    const orderDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

    const items = [];

    // Nettoyer les headers/footers répétés sur chaque page
    let cleaned = text
      .replace(/FACTURE PRO FORMA[^\n]*/g, '')
      .replace(/Commande N°[^\n]*/g, '')
      .replace(/\d{2}\/\d{2}\/\d{4}\n/g, '')
      .replace(/SARL EMC[^\n]*/g, '')
      .replace(/Destinataire[^\n]*/g, '')
      .replace(/Contact[^\n]*/g, '')
      .replace(/Prise en charge[^\n]*/g, '')
      .replace(/Nombre de produits[^\n]*/g, '')
      .replace(/Devise[^\n]*/g, '')
      .replace(/Laboratoire LIPS France[^\n]*/g, '')
      .replace(/www\.lipsfrance[^\n]*/g, '')
      .replace(/4 rue des Savoir[^\n]*/g, '')
      .replace(/RCS Nantes[^\n]*/g, '')
      .replace(/IBAN[^\n]*/g, '')
      .replace(/\d+\/\d+\n/g, '')
      .replace(/\d+-\d{2}-\d{4}\n/g, '')
      .replace(/SOUS TOTAL PRODUITS[^\n]*/g, '')
      .replace(/Σ[^\n]*/g, '')
      .replace(/Sous-total HT[\s\S]*$/g, '')
      // Headers de colonnes
      .replace(/Référence\s+Nom\s+Quantité\s+Prix unitaire\s+Prix\s+TVA/g, '')
      // Headers de sections
      .replace(/E-liquides Premiums/g, '')
      .replace(/E-liquides Sels de nicotine/g, '')
      // Headers adresses (multi-lignes)
      .replace(/Livrer à[^\n]*/g, '')
      .replace(/Facturer à[^\n]*/g, '')
      .replace(/Castelnau[^\n]*/g, '')
      .replace(/580 avenue[^\n]*/g, '')
      .replace(/YouVape[^\n]*/g, '')
      .replace(/34170[^\n]*/g, '')
      .replace(/France\n/g, '')
      .replace(/8 Boulevard[^\n]*/g, '')
      .replace(/34000[^\n]*/g, '')
      .replace(/FRANCE\n/g, '');

    // Rejoindre les refs coupées sur 2 lignes par pdf-parse
    // Ex: "E2S-MOON-\nGOLDSUCKER-60-03" → "E2S-MOON-GOLDSUCKER-60-03"
    // Une ligne qui se termine par un tiret ET la ligne suivante commence par des majuscules+tirets+chiffres
    cleaned = cleaned.replace(/([A-Z][A-Z0-9-]*)-\n([A-Z0-9][A-Z0-9-]*)/g, '$1-$2');

    // Trouver tous les blocs de prix : QTE PU TOTAL TVA% TVA_MONTANT
    // Ex: "12 4.46 53.52 20.0% 10.70"
    const priceLineRegex = /(\d+)\s+(\d+\.\d{2})\s+\d+\.\d{2}\s+\d+\.\d+%\s+\d+\.\d{2}/g;

    const priceMatches = [];
    let m;
    while ((m = priceLineRegex.exec(cleaned)) !== null) {
      priceMatches.push({
        index: m.index,
        endIndex: m.index + m[0].length,
        qty: parseInt(m[1]),
        unitPrice: parseFloat(m[2]),
      });
    }

    for (let i = 0; i < priceMatches.length; i++) {
      const price = priceMatches[i];
      const prevEnd = i > 0 ? priceMatches[i - 1].endIndex : 0;

      // Texte entre le bloc précédent et ce bloc de prix
      const blockText = cleaned.substring(prevEnd, price.index).trim();
      const lines = blockText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      let supplierSku = null;
      let designationLines = [];

      for (let j = 0; j < lines.length; j++) {
        const line = lines[j];
        if (!supplierSku) {
          // La ref est un token sans espace contenant des tirets : XXXX-XXXX-XX-XX
          const firstToken = line.split(' ')[0];
          if (/^[A-Z][A-Z0-9]+-[A-Z0-9-]+-\d+$/.test(firstToken)) {
            supplierSku = firstToken;
            const rest = line.substring(firstToken.length).trim();
            if (rest) designationLines.push(rest);
          } else {
            // Ligne avant la ref (vide ou résidu de nettoyage) — ignorer
          }
        } else {
          designationLines.push(line);
        }
      }

      if (!supplierSku) continue;

      const designation = designationLines.join(' ').trim();

      items.push({
        supplier_sku: supplierSku,
        designation,
        qty_ordered: price.qty,
        unit_price_net: price.unitPrice,
      });
    }

  return { orderNumber, orderDate, items, hasPrice: true, skipPackQty: true };
}
