/**
 * Parseur PDF pour e.tasty — gère DEUX formats distincts.
 *
 * 1) FACTURE (TCPDF, prix HT)
 *    Colonnes : Reference | Produit | TVA | Prix unitaire HT | Quantite | Total HT
 *    Prix sur une ligne : "20 % 4,40 € 10 44,00 €", ref type "SWDCO03000".
 *
 * 2) CONFIRMATION DE COMMANDE (email Gmail exporté en PDF)
 *    Colonnes : Reference | Produit | Prix unitaire | Quantite | Prix total
 *    Chaque ligne produit est éclatée sur plusieurs lignes de texte :
 *      la référence est coupée ("INAZU01" puis "006"),
 *      la désignation sur 1-2 lignes,
 *      la dernière ligne se termine par "PRIX € QTE TOTAL €" (ex: "... Français 1,35 € 10 13,50 €").
 *    Réf = SKU fournisseur (ex: INAZU01003), n° de commande type "BIBAIERBM".
 *
 * Les deux formats : prix unitaire HT, quantités exprimées en UNITÉS
 * (→ invertPackQty : conversion unités↔packs déléguée à pdfImportModel).
 */

const parseDecimal = (str) => parseFloat(String(str).replace(/\s/g, '').replace(',', '.'));

/**
 * Format FACTURE TCPDF (comportement historique, inchangé).
 */
function parseInvoice(text) {
  // Extraire ref commande et date : "#FA069087/2026 18/03/2026 ERWZBDFMZ 18/03/2026"
  const orderMatch = text.match(/#FA[\w/]+\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\S+)\s+\d{2}\/\d{2}\/\d{4}/);
  const orderNumber = orderMatch ? orderMatch[4] : null;
  const orderDate = orderMatch ? `${orderMatch[3]}-${orderMatch[2]}-${orderMatch[1]}` : null;

  const items = [];

  // Restreindre le scan au tableau produits : on commence APRES l'en-tete de
  // colonnes et on s'arrete AVANT le recapitulatif ("Detail des taxes").
  //
  // L'en-tete de la derniere colonne peut s'ecrire "Total HT", "Total (HT)" ou
  // etre coupe sur deux lignes ("Total\n(HT)"). Une ancre trop stricte (/Total HT/)
  // echouait sur ces variantes : startIdx retombait a 0 et le scan capturait
  // "FACTURE" (1er mot du document) comme reference du 1er produit. La 1re
  // occurrence de "Total (HT)" est bien l'en-tete (le "Total (HT)" du pied de
  // page arrive plus loin).
  const headerMatch = text.match(/Total\s*\(?\s*HT\s*\)?/i);
  const startIdx = headerMatch ? headerMatch.index + headerMatch[0].length : 0;
  const footerIdx = text.search(/des taxes/i);
  const scanText = text.slice(startIdx, footerIdx >= 0 ? footerIdx : text.length);

  // Scan : chaque bloc REF Designation TAUX% PRIX_UNIT€ QTE TOTAL€
  const pricePattern = /([A-Z0-9][\w]+)([\s\S]*?)(\d+)\s*%\s+([\d,]+)\s*€\s+(\d+)\s+([\d,]+)\s*€/g;

  let m;
  while ((m = pricePattern.exec(scanText)) !== null) {
    const supplierSku = m[1];
    const designation = m[2].replace(/\s+/g, ' ').trim();
    const prixUnit = parseDecimal(m[4]);
    const qty = parseInt(m[5]);
    const totalHt = parseDecimal(m[6]);

    // Verification coherence : qty * prix ~= total (evite les faux positifs)
    if (Math.abs(qty * prixUnit - totalHt) > 0.05) continue;

    // Garde-fou : "FACTURE" (mot d'en-tete du document) n'est jamais une
    // reference produit. Si l'ancre d'en-tete a echoue malgre tout, on ignore
    // cette pseudo-ligne plutot que de creer un mauvais mapping fournisseur.
    if (/^FACTURE$/i.test(supplierSku)) continue;

    items.push({
      supplier_sku: supplierSku,
      designation: designation,
      qty_ordered: qty,
      unit_price_net: prixUnit,
      total_ht: totalHt,
    });
  }

  return { orderNumber, orderDate, items, hasPrice: true, invertPackQty: true };
}

/**
 * Format CONFIRMATION DE COMMANDE (email Gmail exporté en PDF).
 */
function parseOrderConfirmation(text) {
  // Ex : "Numéro de commande : BIBAIERBM"
  const numMatch = text.match(/Num[ée]ro de commande\s*:\s*([A-Z0-9]+)/i);
  const orderNumber = numMatch ? numMatch[1] : null;

  // Ex : "Date de la commande : 23/07/2026 14:33:58"
  const dateMatch = text.match(/Date de la commande\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/);
  const orderDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

  // Restreindre le scan au tableau produits : après l'en-tête "Prix total"
  // et avant le récapitulatif ("Livraison gratuite" / "Produits X €" / "Total payé").
  const headerMatch = text.match(/Prix total/i);
  const startIdx = headerMatch ? headerMatch.index + headerMatch[0].length : 0;
  const rest = text.slice(startIdx);
  const footerRel = rest.search(/Livraison gratuite|\bProduits\s+[\d,]+\s*€|Incluant un total|Total pay/i);
  const scanText = footerRel >= 0 ? rest.slice(0, footerRel) : rest;

  const items = [];

  // Chaque ligne produit se termine par "PRIX € QTE TOTAL €".
  // Le bloc qui précède contient la référence (éventuellement coupée sur
  // plusieurs lignes) puis la désignation.
  const rowPattern = /([\s\S]*?)([\d,]+)\s*€\s+(\d+)\s+([\d,]+)\s*€/g;

  let m;
  while ((m = rowPattern.exec(scanText)) !== null) {
    const prixUnit = parseDecimal(m[2]);
    const qty = parseInt(m[3]);
    const totalHt = parseDecimal(m[4]);

    // Verification coherence : qty * prix ~= total (evite les faux positifs)
    if (Math.abs(qty * prixUnit - totalHt) > 0.05) continue;

    // Séparer référence et désignation dans le bloc capturé.
    // La référence occupe les 1res lignes purement alphanumériques majuscules
    // (ex: "INAZU01" + "006" collées par la coupure de colonne), la désignation
    // commence dès qu'une ligne contient des minuscules/espaces.
    const lines = m[1].split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    let i = 0;
    const refParts = [];
    while (i < lines.length && /^[A-Z0-9]+$/.test(lines[i])) {
      refParts.push(lines[i]);
      i++;
    }
    // Fallback : aucune ligne "pure majuscule" → 1re ligne = référence.
    if (refParts.length === 0 && lines.length > 0) {
      refParts.push(lines[0].split(/\s+/)[0]);
      lines[0] = lines[0].replace(/^\S+\s*/, '');
      i = 0;
    }
    const supplierSku = refParts.join('');
    const designation = lines.slice(i).join(' ').replace(/\s+/g, ' ').trim();

    if (!supplierSku) continue;

    items.push({
      supplier_sku: supplierSku,
      designation: designation,
      qty_ordered: qty,
      unit_price_net: prixUnit,
      total_ht: totalHt,
    });
  }

  return { orderNumber, orderDate, items, hasPrice: true, invertPackQty: true };
}

module.exports = {
  parse: (text) => {
    // Le format "confirmation de commande" (email) est reconnaissable à ses
    // libellés uniques ; sinon on retombe sur le format facture TCPDF.
    if (/D[ée]tail de votre commande|Num[ée]ro de commande/i.test(text)) {
      return parseOrderConfirmation(text);
    }
    return parseInvoice(text);
  },
};
