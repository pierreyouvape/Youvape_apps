/**
 * Parseur PDF pour CigAccess (SARL ALAV)
 * Gere deux formats :
 *
 * Format 1 — FACTURE (FA)
 *   Colonnes : Reference | Produit | Poids | Taux | Prix base HT | Prix unitaire HT | Quantite | Total HT
 *   Header fin : "Quantité Total\n(HT)"
 *   Fin zone : "Détail des taxes"
 *   Ref commande : ligne "#FA125169 03/03/2026 DNOGOEJPX 03/03/2026"
 *   Prix : POIDS TAUX% PRIX_BASE€ PRIX_UNIT€ QTE TOTAL€
 *
 * Format 2 — PROFORMA
 *   Colonnes : Reference | Produit | Taux de taxe | Prix unitaire (HT) | Quantite | Total (HT)
 *   Header fin : "Prix unitaire (HT) Quantité Total (HT)"
 *   Fin zone : "Total Produits (HT)"
 *   Ref commande : colonne "Référence commande" → ex: "KDXEYDYYE"
 *   Date : colonne "Date de la commande" → ex: "2026-03-30 10:14:17"
 *   Prix : TAUX% PRIX_UNIT€ QTE TOTAL€
 */

module.exports = {
  parse: (text) => {
    // Detecter le format : PROFORMA ou FACTURE
    const isProforma = text.includes('#PROFORMA');

    if (isProforma) {
      return parseProforma(text);
    } else {
      return parseFacture(text);
    }
  }
};

/**
 * Format FACTURE (#FA...)
 */
function parseFacture(text) {
  // Ref de commande : ligne "#FA125169 03/03/2026 DNOGOEJPX 03/03/2026 0000"
  const orderMatch = text.match(/#FA\d+\s+\d{2}\/\d{2}\/\d{4}\s+(\S+)\s+(\d{2})\/(\d{2})\/(\d{4})/);
  const orderNumber = orderMatch ? orderMatch[1] : null;
  const orderDate = orderMatch ? `${orderMatch[4]}-${orderMatch[3]}-${orderMatch[2]}` : null;

  const items = [];

  // Zone produits : apres "Quantité Total\n(HT)", avant "Détail des taxes"
  const startMatch = text.match(/Quantité\s+Total\s*\n\s*\(HT\)/);
  const startIdx = startMatch ? startMatch.index + startMatch[0].length : -1;
  const endIdx = text.indexOf('Détail des taxes');

  if (startIdx < 0 || endIdx < 0) return { orderNumber, orderDate, items, hasPrice: true };

  const productZone = text.substring(startIdx, endIdx);

  const cleaned = productZone
    .replace(/cig access pro[\s\S]*?(?=\n\d{6}|\nDétail|$)/g, '\n')
    .replace(/--\s*\d+\s*of\s*\d+\s*--/g, '\n')
    .replace(/FACTURE\n\d{2}\/\d{2}\/\d{4}\n#FA\d+/g, '\n')
    .replace(/SARL ALAV[^\n]*/g, '\n');

  const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Ligne de prix : POIDS TAUX% PRIX_BASE€ PRIX_UNIT€ QTE TOTAL€
  const priceLineRegex = /[\d.]+\s+\d+\s*%\s+[\d,]+\s*€\s+[\d,]+\s*€\s+\d+\s+[\d,]+\s*€\s*$/;

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

    let blockText = '';
    for (let i = 0; i < blockLines.length; i++) {
      const line = blockLines[i];
      if (i > 0 && blockLines[i - 1].length < 15 && line.length < 10 && /^[\w-]+$/.test(line) && i < 3) {
        const prev = blockText.trimEnd();
        if (prev.match(/[-A-Z]$/) && !line.match(/^\d+\s*%/)) {
          blockText = prev + line + ' ';
          continue;
        }
      }
      blockText += line + ' ';
    }
    blockText = blockText.replace(/\s+/g, ' ').trim();

    const numbersMatch = blockText.match(
      /([\d.]+)\s+(\d+)\s*%\s+([\d,]+)\s*€\s+([\d,]+)\s*€\s+(\d+)\s+([\d,]+)\s*€\s*$/
    );
    if (!numbersMatch) continue;

    const parseDecimal = (str) => parseFloat(str.replace(',', '.'));

    const prixBase = parseDecimal(numbersMatch[3]);
    const prixUnit = parseDecimal(numbersMatch[4]);
    const qty = parseInt(numbersMatch[5]);
    const totalHt = parseDecimal(numbersMatch[6]);

    const textBefore = blockText.substring(0, blockText.indexOf(numbersMatch[0])).trim();
    if (!textBefore) continue;

    const refMatch = textBefore.match(/^([\d][\d\w-]+)\s+(.+)$/);
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
        unit_price_base: prixBase,
        unit_price_net: prixUnit,
        total_ht: totalHt,
      });
    }
  }

  return { orderNumber, orderDate, items, hasPrice: true };
}

/**
 * Format PROFORMA
 * Colonnes : Reference | Produit | Taux de taxe | Prix unitaire (HT) | Quantite | Total (HT)
 * Prix par ligne : TAUX% PRIX_UNIT€ QTE TOTAL€
 */
function parseProforma(text) {
  // Ref commande depuis le tableau recap :
  // "Proforma Date Référence commande Date de la commande\n30/03/2026 KDXEYDYYE 2026-03-30 10:14:17"
  const orderMatch = text.match(/Référence commande\s+Date de la commande\s+\S+\s+(\S+)\s+([\d]{4}-[\d]{2}-[\d]{2})/);
  const orderNumber = orderMatch ? orderMatch[1] : null;
  const orderDate = orderMatch ? orderMatch[2] : null;

  const items = [];

  // Zone produits : apres header "Référence Produit Taux de taxe Prix unitaire (HT) Quantité Total (HT)"
  // Fin : "Total Produits (HT)"
  const startMatch = text.match(/Référence\s+Produit\s+Taux de taxe\s+Prix unitaire \(HT\)\s+Quantité\s+Total \(HT\)/);
  const startIdx = startMatch ? startMatch.index + startMatch[0].length : -1;
  const endIdx = text.indexOf('Total Produits (HT)');

  if (startIdx < 0 || endIdx < 0) return { orderNumber, orderDate, items, hasPrice: true };

  const productZone = text.substring(startIdx, endIdx);

  // Nettoyer les footers/headers de pages intermediaires
  const cleaned = productZone
    .replace(/cig access pro[\s\S]*?(?=\n\d{6}|\nTotal Produits|$)/g, '\n')
    .replace(/#PROFORMA/g, '\n')
    .replace(/\d{2}\/\d{2}\/\d{4}\n#PROFORMA/g, '\n')
    .replace(/SARL ALAV[^\n]*/g, '\n')
    .replace(/30\/03\/2026/g, '\n');

  const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Ligne de prix : TAUX% PRIX_UNIT€ QTE TOTAL€
  // Ex: "20,00% 4,50 € 6 27,00 €"
  const priceLineRegex = /\d+,\d+%\s+[\d,]+\s*€\s+\d+\s+[\d,]+\s*€\s*$/;

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

    // Extraire les valeurs numeriques en fin de bloc
    // TAUX% PRIX_UNIT€ QTE TOTAL€
    const numbersMatch = blockText.match(
      /(\d+,\d+)%\s+([\d,]+)\s*€\s+(\d+)\s+([\d,]+)\s*€\s*$/
    );
    if (!numbersMatch) continue;

    const parseDecimal = (str) => parseFloat(str.replace(',', '.'));

    const prixUnit = parseDecimal(numbersMatch[2]);
    const qty = parseInt(numbersMatch[3]);
    const totalHt = parseDecimal(numbersMatch[4]);

    // Texte avant les chiffres = ref + designation
    const textBefore = blockText.substring(0, blockText.indexOf(numbersMatch[0])).trim();
    if (!textBefore) continue;

    // La ref est au debut : chiffres (6 digits) ou chiffres-lettres-tirets (012884-0-Blac)
    const refMatch = textBefore.match(/^(\d[\d\w-]+)\s+(.+)$/);
    if (!refMatch) continue;

    const supplierSku = refMatch[1];
    const designation = refMatch[2];

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
