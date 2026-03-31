/**
 * Parseur PDF pour LCA Distribution
 * Gere 3 formats :
 * - "Confirmation" : mail "Confirmation de votre commande" (refs apres "Référence:", 1 qte + prix total)
 * - "Preparation" : mail "Votre commande est en cours de preparation" (refs en debut de ligne, 3 colonnes qte)
 * - "SiteWeb" : page commande site LCA (tableau Nom|Référence|Prix|Qté avec Commandé/Expédié)
 * Pas de prix exploite — uniquement refs, designations, quantites
 */

module.exports = {
  parse: (text) => {
    // Detecter le format SiteWeb : header de tableau "Nom du produit" + "Référence" + "Qté"
    if (text.includes('Nom du produit') && text.includes('Commandé')) {
      return parseSiteWeb(text);
    }
    // Detecter le format Confirmation (mail Gmail)
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

  return { orderNumber, orderDate, items, hasPrice: false };
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

  return { orderNumber, orderDate, items, hasPrice: false };
}

/**
 * Format "Site Web LCA" — page commande depuis le compte client LCA
 * Structure : tableau avec colonnes Nom du produit | Référence | Prix | Qté | Sous-total
 * Qté : "Commandé10\nExpédié10" — on prend uniquement Commandé
 * Une ligne = un article, tableau répété sur chaque page avec totaux en bas
 */
function parseSiteWeb(text) {
  // Numéro de commande : "Commande #325592"
  const orderMatch = text.match(/Commande\s+#(\d+)/);
  const orderNumber = orderMatch ? orderMatch[1] : null;

  // Date : "Date de commande : 30 mars 2026"
  const moisMap = {
    'janvier': '01', 'février': '02', 'mars': '03', 'avril': '04',
    'mai': '05', 'juin': '06', 'juillet': '07', 'août': '08',
    'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12'
  };
  const dateMatch = text.match(/Date de commande\s*:\s*(\d{1,2})\s+(\w+)\s+(\d{4})/i);
  let orderDate = null;
  if (dateMatch) {
    const day = dateMatch[1].padStart(2, '0');
    const month = moisMap[dateMatch[2].toLowerCase()] || '01';
    orderDate = `${dateMatch[3]}-${month}-${day}`;
  }

  const items = [];

  // Nettoyer : retirer les headers de tableau, les totaux répétés, les URLs et timestamps
  const cleaned = text
    .replace(/\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/g, '')
    .replace(/https?:\/\/[^\n]*/g, '')
    .replace(/\d+\/\d+\n/g, '')
    .replace(/Nom du produit\s+Référence\s+Prix\s+Qté\s+Sous-total/g, '')
    .replace(/Sous-total[\s\S]*?Montant global[^\n]*\n?/g, '')
    .replace(/Expédié\d+/g, '')           // retirer les lignes "Expédié10"
    .replace(/Pièces jointes[\s\S]*?(?=\n#REF|\nCommandé)/g, ''); // retirer les pièces jointes

  // Extraire toutes les refs avec leur position
  const refRegex = /#REF(\d+-\d+)/g;
  let match;
  const refs = [];
  while ((match = refRegex.exec(cleaned)) !== null) {
    refs.push({ ref: match[1], fullRef: `#REF${match[1]}`, index: match.index, endIndex: match.index + match[0].length });
  }

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    const nextStart = i + 1 < refs.length ? refs[i + 1].index : cleaned.length;
    const afterRef = cleaned.substring(ref.endIndex, nextStart);

    // Qté : "Commandé(\d+)" dans le bloc après la ref
    const qtyMatch = afterRef.match(/Commandé(\d+)/);
    const qty = qtyMatch ? parseInt(qtyMatch[1]) : null;
    if (!qty) continue;

    // Désignation : lignes avant la ref (depuis la fin du bloc précédent)
    const prevEnd = i > 0 ? refs[i - 1].endIndex : 0;
    const beforeRef = cleaned.substring(prevEnd, ref.index);
    const beforeLines = beforeRef.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.match(/^\d+,\d+\s*€/) && !l.match(/^Commandé/) && l !== 'Expédié');
    const designation = beforeLines.length > 0 ? beforeLines[beforeLines.length - 1] : '';

    items.push({
      supplier_sku: ref.fullRef,
      designation: designation.trim(),
      qty_ordered: qty,
    });
  }

  return { orderNumber, orderDate, items, hasPrice: false };
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
