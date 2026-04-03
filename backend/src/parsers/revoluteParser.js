/**
 * Parseur PDF pour Revolute (Laboratoire Cosmer)
 * Gere 2 formats :
 * - "Facture" : facture TCPDF avec colonnes Ref | Produit | Taux | Prix HT | Qte | Total HT
 * - "Confirmation" : mail Gmail "DÉTAILS DE LA COMMANDE" avec colonnes Ref | Produit | Prix unit | Qte | Prix total
 *   + remise fidelite globale 15% (fixe) sur le TTC
 */

module.exports = {
  parse: (text) => {
    if (text.includes('DÉTAILS DE LA COMMANDE')) {
      return parseConfirmation(text);
    }
    return parseFacture(text);
  }
};

/**
 * Format "Confirmation de commande" (Gmail)
 * Structure : tableau Référence | Produit | Prix unitaire | Quantité | Prix total
 * Remise fidélité globale 15% TTC → discount_percent = 15
 */
function parseConfirmation(text) {
  // Numero de commande : "Commande : FUFDRJNTN passée le ..."
  const orderMatch = text.match(/Commande\s*:\s*([A-Z0-9]+)\s+pass/);
  const orderNumber = orderMatch ? orderMatch[1] : null;

  // Date : "passée le 02/04/2026"
  const dateMatch = text.match(/pass[ée]+e le (\d{2})\/(\d{2})\/(\d{4})/);
  const orderDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

  // Nettoyer footers Gmail
  const cleaned = text
    .replace(/\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}[^\n]*\n/g, '')
    .replace(/https?:\/\/[^\n]*/g, '')
    .replace(/--\s*\d+\s*of\s*\d+\s*--/g, '');

  const items = [];

  // Extraire les refs avec leur position : REF suivi de lettres/chiffres
  const refRegex = /\b(REF[A-Z0-9]+)\b/g;
  let match;
  const refs = [];
  while ((match = refRegex.exec(cleaned)) !== null) {
    refs.push({ ref: match[1], index: match.index, endIndex: match.index + match[0].length });
  }

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    const nextStart = i + 1 < refs.length ? refs[i + 1].index : cleaned.length;
    const afterRef = cleaned.substring(ref.endIndex, nextStart);

    // Prix unitaire : premier "X,XX €" dans le bloc apres la ref
    const priceMatch = afterRef.match(/([\d,]+)\s*€/);
    const unitPrice = priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : null;

    // Quantite : nombre entier apres le premier prix
    const afterPrice = priceMatch ? afterRef.substring(afterRef.indexOf(priceMatch[0]) + priceMatch[0].length) : '';
    const qtyMatch = afterPrice.match(/(\d+)/);
    const qty = qtyMatch ? parseInt(qtyMatch[1]) : null;

    if (!qty) continue;

    // Designation : texte entre la fin de la ref et le premier prix
    const beforePrice = priceMatch ? afterRef.substring(0, afterRef.indexOf(priceMatch[0])) : afterRef;
    const designation = beforePrice.replace(/[-]+/g, '').replace(/\s+/g, ' ').trim();

    items.push({
      supplier_sku: ref.ref,
      designation,
      qty_ordered: qty,
      unit_price_net: unitPrice,
      discount_percent: 15,
    });
  }

  return { orderNumber, orderDate, items, hasPrice: true };
}

/**
 * Format "Facture" TCPDF
 */
function parseFacture(text) {
    // Extraire ref commande et date : "#FA019518 10/03/2026 DIYXUUZWF 10/03/2026"
    const orderMatch = text.match(/#FA\d+\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\S+)\s+\d{2}\/\d{2}\/\d{4}/);
    const orderNumber = orderMatch ? orderMatch[4] : null;
    const orderDate = orderMatch ? `${orderMatch[3]}-${orderMatch[2]}-${orderMatch[1]}` : null;

    const items = [];

    // Zone produit : apres header de colonnes, avant "Réductions" ou "Détail des taxes"
    // Le header finit par "Qté Total\n(HT)" ou "Quantité Total\n(HT)"
    const startMatch = text.match(/(?:Qté|Quantité)\s+Total\s*\n\s*\(HT\)/);
    const startIdx = startMatch ? startMatch.index + startMatch[0].length : -1;

    // Fin : "Réductions" en priorite, sinon "Détail des taxes"
    let endIdx = text.indexOf('Réductions');
    if (endIdx < 0 || endIdx < startIdx) endIdx = text.indexOf('Détail des taxes');

    if (startIdx < 0 || endIdx < 0) return { orderNumber, orderDate, items, hasPrice: true };

    let productZone = text.substring(startIdx, endIdx);

    // Nettoyer pagination et headers de pages intermediaires
    productZone = productZone
      .replace(/\d+\s*\/\s*\d+\s*\n/g, '\n')
      .replace(/--\s*\d+\s*of\s*\d+\s*--/g, '\n')
      .replace(/FACTURE\n[\s\S]*?#FA\d+/g, '\n')
      .replace(/Laboratoire cosmer[^\n]*/g, '\n');

    const lines = productZone.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Pattern de ligne de prix : "20 % 1,83 € 10 18,30 €"
    const priceLineRegex = /\d+\s*%\s+[\d,]+\s*€\s+\d+\s+[\d,]+\s*€\s*$/;

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

      // Extraire les prix : TAUX% PRIX_UNIT€ QTE TOTAL€
      const numbersMatch = blockText.match(
        /(\d+)\s*%\s+([\d,]+)\s*€\s+(\d+)\s+([\d,]+)\s*€\s*$/
      );
      if (!numbersMatch) continue;

      const parseDecimal = (str) => parseFloat(str.replace(',', '.'));

      const prixUnit = parseDecimal(numbersMatch[2]);
      const qty = parseInt(numbersMatch[3]);
      const totalHt = parseDecimal(numbersMatch[4]);

      const textBefore = blockText.substring(0, blockText.indexOf(numbersMatch[0])).trim();
      if (!textBefore) continue;

      // La ref commence par REF : "REF0029 -- Base 50/50..."
      const refMatch = textBefore.match(/^(REF[\w]+)\s+(.+)$/);
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
