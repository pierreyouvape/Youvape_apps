/**
 * Parseur PDF pour LCA Distribution
 * Gere 2 formats :
 * - "Preparation" : mail "Votre commande est en cours de preparation" (refs en debut de ligne, 3 colonnes qte)
 * - "Confirmation" : mail "Confirmation de votre commande" (refs apres "Référence:", 1 qte + prix)
 * Pas de prix exploite — uniquement refs, designations, quantites
 */

module.exports = {
  parse: (text) => {
    // Detecter le format
    const isConfirmation = text.includes('Référence: #REF') || text.includes('Référence : #REF');
    return isConfirmation ? parseConfirmation(text) : parsePreparation(text);
  }
};

/**
 * Format "Confirmation de votre commande"
 * Structure par article :
 *   Designation
 *   Référence: #REFxxxxx-xxxxx
 *   [attributs multi-lignes]
 *   QTY \t PRIX €
 */
function parseConfirmation(text) {
  // Numero de commande : "commande #324993"
  const orderMatch = text.match(/commande\s+#(\d+)/i);
  const orderNumber = orderMatch ? orderMatch[1] : null;

  // Date : "Passée le 26 mars 2026" -> "2026-03-26"
  const moisMap = {
    'janvier': '01', 'février': '02', 'mars': '03', 'avril': '04',
    'mai': '05', 'juin': '06', 'juillet': '07', 'août': '08',
    'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12'
  };
  const dateMatch = text.match(/Pass[ée]+e le (\d{1,2})\s+(\w+)\s+(\d{4})/i);
  let orderDate = null;
  if (dateMatch) {
    const day = dateMatch[1].padStart(2, '0');
    const month = moisMap[dateMatch[2].toLowerCase()] || '01';
    orderDate = `${dateMatch[3]}-${month}-${day}`;
  }

  // Nettoyer footers Gmail
  const cleanedText = cleanGmailFooters(text);

  // Extraire toutes les refs avec leur position dans le texte
  const items = [];
  const refRegex = /Référence\s*:\s*#(REF\d+-\d+)/g;
  let match;
  const refs = [];
  while ((match = refRegex.exec(cleanedText)) !== null) {
    refs.push({ ref: match[1], index: match.index, endIndex: match.index + match[0].length });
  }

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    // Le texte entre la fin de cette ref et le debut de la prochaine ref (ou la designation suivante, ou fin)
    const nextRefStart = (i + 1 < refs.length)
      ? cleanedText.lastIndexOf('\n', refs[i + 1].index)
      : cleanedText.length;
    const afterRef = cleanedText.substring(ref.endIndex, nextRefStart);

    // La designation est AVANT "Référence:" — chercher en remontant
    const beforeRef = cleanedText.substring(
      i > 0 ? refs[i - 1].endIndex : 0,
      ref.index
    );
    // Derniere ligne non vide avant "Référence:" qui n'est pas un header/sous-total/footer
    const beforeLines = beforeRef.split('\n').map(l => l.trim()).filter(l =>
      l && !l.match(/^(Articles|Sous-total|Frais|Taxe|Montant|Qté|Prix)/) && !l.match(/^\d+[\s,.].*€/)
    );
    const designation = beforeLines.length > 0 ? beforeLines[beforeLines.length - 1] : '';

    // Quantite : chercher un nombre seul ou "nombre \t prix €" apres la ref
    // Format : "160 \t451,20 €" ou juste "50 \t141,00 €"
    const qtyMatch = afterRef.match(/(\d+)\s+\t?\s*[\d\s,]+€/);
    const qty = qtyMatch ? parseInt(qtyMatch[1]) : null;

    if (qty !== null) {
      items.push({
        supplier_sku: `#${ref.ref}`,
        designation: designation,
        qty_ordered: qty,
      });
    }
  }

  return { orderNumber, orderDate, items, hasPrice: false, skipPackQty: true };
}

/**
 * Format "Votre commande est en cours de preparation"
 * Structure par article :
 *   #REFxxxxx-xxxxx Designation QTE_CMD QTE_PREP RELIQUAT
 */
function parsePreparation(text) {
  // Numero de commande : "N°321094"
  const orderMatch = text.match(/N°(\d+)/);
  const orderNumber = orderMatch ? orderMatch[1] : null;

  // Date : "passée le 03/03/2026"
  const dateMatch = text.match(/pass[ée]+e le (\d{2})\/(\d{2})\/(\d{4})/);
  const orderDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

  // Nettoyer footers Gmail
  const cleanedText = cleanGmailFooters(text);

  // Trouver tous les blocs commencant par #REF
  const items = [];
  const blockRegex = /#REF[\s\S]*?(?=#REF|LCA DISTRIBUTION|$)/g;
  const blocks = cleanedText.match(blockRegex) || [];

  for (const block of blocks) {
    const cleaned = block.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    const itemMatch = cleaned.match(
      /^#(REF\d+-\s*\d+)\s+(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/
    );

    if (itemMatch) {
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

  return { orderNumber, orderDate, items, hasPrice: false, skipPackQty: true };
}

/**
 * Nettoyer les footers Gmail (impression PDF depuis Gmail)
 */
function cleanGmailFooters(text) {
  return text
    .replace(/\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\s+[^\n]*Gmail\n/g, '')
    .replace(/https:\/\/mail\.google\.com[^\n]*\n/g, '')
    .replace(/--\s*\d+\s+of\s+\d+\s*--/g, '')
    .replace(/\n\d+\/\d+\n/g, '\n');
}
