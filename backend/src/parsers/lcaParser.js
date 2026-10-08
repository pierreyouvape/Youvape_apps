/**
 * Parseur PDF pour LCA Distribution
 * Gere 4 formats :
 * - "Facture" : facture OpenSi avec colonnes Référence | Désignation | Quantité | PU HT | Montant HT
 * - "Confirmation" : mail "Confirmation de votre commande" (refs apres "Référence:", 1 qte + prix total)
 * - "Preparation" : mail "Votre commande est en cours de preparation" (refs en debut de ligne, 3 colonnes qte)
 * - "SiteWeb" : page commande site LCA (tableau Nom|Référence|Prix|Qté avec Commandé/Expédié)
 */

module.exports = {
  // Fournisseur « à l'unité » — voir highbuyParser / parsers/index.js skipsPackQty().
  skipPackQty: true,
  parse: (text) => {
    // Facture OpenSi LCA (ex: F2606391933)
    if (text.includes('LCA DISTRIBUTION') && text.includes('Facture N°')) {
      return parseFacture(text);
    }
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

  // Date : "Passée le 26 mars 2026" ou "Passée le 10 avr. 2026" -> "2026-03-26"
  const moisMap = {
    'janvier': '01', 'janv': '01',
    'février': '02', 'févr': '02',
    'mars': '03',
    'avril': '04', 'avr': '04',
    'mai': '05',
    'juin': '06',
    'juillet': '07', 'juil': '07',
    'août': '08',
    'septembre': '09', 'sept': '09',
    'octobre': '10', 'oct': '10',
    'novembre': '11', 'nov': '11',
    'décembre': '12', 'déc': '12',
  };
  const dateMatch = text.match(/Pass[ée]+e le (\d{1,2})\s+(\w+\.?)\s+(\d{4})/i);
  let orderDate = null;
  if (dateMatch) {
    const day = dateMatch[1].padStart(2, '0');
    const moisKey = dateMatch[2].toLowerCase().replace(/\.$/, '');
    const month = moisMap[moisKey] || '01';
    orderDate = `${dateMatch[3]}-${month}-${day}`;
  }

  // Nettoyer footers Gmail
  const cleanedText = cleanGmailFooters(text);

  // Extraire toutes les refs avec leur position dans le texte
  const items = [];
  const refRegex = /Référence\s*:\s*#(REF\d+(?:-\d+)?)/g;
  let match;
  const refs = [];
  while ((match = refRegex.exec(cleanedText)) !== null) {
    refs.push({ ref: match[1], index: match.index, endIndex: match.index + match[0].length });
  }

  // Fin de la dernière ligne "QTE PRIX €" déjà attribuée à un article
  let consumedUntil = 0;
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
    // Saut de page : la qté et le prix restent collés au nom ("Lemon Tart 10ML - Dinner Lady 2 3,24 €")
    const designation = (beforeLines.length > 0 ? beforeLines[beforeLines.length - 1] : '')
      .replace(/\s+\d+ [\d ,]+,\d{2} €$/, '');

    // Quantite : chercher "QTE PRIX€" avec prix obligatoirement décimal (ex: "5 44,50 €")
    // Le prix doit contenir une virgule ou un point pour éviter de capturer des chiffres dans les noms de saveurs
    // Quantité et prix doivent être sur la même ligne : "5 44,50 €"
    let qtyMatch = afterRef.match(/^(\d+) [\d ,]+,\d{2} €$/m);
    if (qtyMatch) {
      consumedUntil = ref.endIndex + qtyMatch.index + qtyMatch[0].length;
    } else {
      // Fallback : qty avant la ref (cas saut de page — qty+prix sur page N, Référence: sur page N+1).
      // Sur la page N, la ligne sans référence porte le nom, la qté et le prix sur une seule ligne :
      // "Lemon Tart 10ML - Dinner Lady 2 3,24 €". Le nom doit finir par un non-chiffre, sinon
      // "12 1 234,56 €" se lirait qté 1. On ne cherche qu'APRÈS la qté déjà prise par l'article
      // précédent : avant, on retombait sur elle (commande 360161 : 5 au lieu de 2).
      const zone = cleanedText.substring(Math.max(consumedUntil, i > 0 ? refs[i - 1].endIndex : 0), ref.index);
      const beforeTotals = zone.replace(/(^|\n)(Sous-total|Frais|Taxe|Montant|Articles)[^\n]*/g, '\n');
      const allQtyMatches = [...beforeTotals.matchAll(/^(?:.*[^\d\s,] )?(\d+) [\d ,]+,\d{2} €$/gm)];
      if (allQtyMatches.length > 0) {
        qtyMatch = allQtyMatches[allQtyMatches.length - 1];
        consumedUntil = ref.index;
      }
    }
    const qty = qtyMatch ? parseInt(qtyMatch[1]) : null;

    if (qty !== null) {
      items.push({
        supplier_sku: `#${ref.ref}`,
        designation: designation,
        qty_ordered: qty,
      });
    }
  }

  // LCA vend les produits "par 10" comme une unite atomique (le SKU = le pack) :
  // qty et prix catalogue ne doivent jamais etre multiplies/divises par pack_qty.
  return { orderNumber, orderDate, items, hasPrice: false, pdfIsPackBased: false, skipPackQty: true };
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

  // LCA vend les produits "par 10" comme une unite atomique (le SKU = le pack) :
  // qty et prix catalogue ne doivent jamais etre multiplies/divises par pack_qty.
  return { orderNumber, orderDate, items, hasPrice: false, pdfIsPackBased: false, skipPackQty: true };
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

  // LCA vend les produits "par 10" comme une unite atomique (le SKU = le pack) :
  // qty et prix catalogue ne doivent jamais etre multiplies/divises par pack_qty.
  return { orderNumber, orderDate, items, hasPrice: false, pdfIsPackBased: false, skipPackQty: true };
}

/**
 * Format "Facture OpenSi" LCA Distribution
 * Colonnes : Référence | Désignation | Quantité | PU HT | Rist. % | PU Net HT | Montant HT
 *
 * Délègue au lecteur des factures OpenSi (parsers/invoices/opensiInvoice), déjà
 * utilisé pour le contrôle des factures : l'ancienne regex exigeait
 * « qté PU montant » sur une seule ligne et ne lisait AUCUN article des factures
 * réelles (colonnes Rist. % / PU Net HT, désignations sur deux lignes) —
 * F2610415472 renvoyait « Aucune ligne produit trouvée ».
 */
function parseFacture(text) {
  const { parseInvoice } = require('./invoices/opensiInvoice');
  const invoice = parseInvoice(text);

  // « Réf. Commande » = n° de commande du site LCA, celui que portent les
  // commandes LCA chez nous (et les formats Confirmation / SiteWeb). Redéposer la
  // facture d'une commande déjà créée retombe ainsi sur elle au lieu d'en créer
  // une seconde. Repli sur le n° de facture.
  const orderNumber = invoice.orderRefOnDoc || invoice.number;

  const items = invoice.lines
    .filter((l) => l.kind === 'product')
    .map((l) => ({
      supplier_sku: l.ref,
      designation: l.label || '',
      qty_ordered: l.qty,
      // Prix NET exact, tiré du montant : LCA imprime le PU net arrondi (20,96)
      // mais facture le net exact (22,54 − 7 % = 20,9622 → 10 × = 209,62).
      unit_price_net: Math.round((l.lineTotalHt / l.qty) * 10000) / 10000,
      total_ht: l.lineTotalHt,
    }));

  const warnings = invoice.warnings.map((w) => ({
    type: w.type,
    message: w.message || `Ligne de facture illisible : ${w.text}`,
  }));

  // "Quantité" et "PU HT" de la facture OpenSi sont deja en unites reelles
  // (verifie : Quantite x PU Net HT = Montant HT sur chaque ligne) -> pas de
  // conversion pack a appliquer, meme pour les produits vendus en pack chez LCA.
  return {
    orderNumber,
    orderDate: invoice.date,
    items,
    warnings,
    hasPrice: true,
    pdfIsPackBased: false,
    skipPackQty: true,
  };
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
