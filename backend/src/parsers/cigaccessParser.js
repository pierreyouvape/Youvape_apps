/**
 * Parseur PDF pour CigAccess (SARL ALAV)
 * Format : facture TCPDF avec prix HT
 * Colonnes : Reference | Produit | Poids | Taux | Prix base HT | Prix unitaire HT | Quantite | Total HT
 * Les refs sont numeriques (ex: 008407) ou avec tirets (ex: 006674-0-SSW)
 * Les designations debordent sur 2-3 lignes
 * Les prix sont en format virgule avec € (ex: "4,50 €")
 * On extrait le Prix unitaire HT (prix apres remise)
 * Multi-pages : page 2+ n'a PAS de header de colonnes repete, les items continuent directement
 */

module.exports = {
  parse: (text) => {
    // Extraire la ref de commande : ligne "#FA125169 03/03/2026 DNOGOEJPX 03/03/2026 0000"
    const orderMatch = text.match(/#FA\d+\s+\d{2}\/\d{2}\/\d{4}\s+(\S+)\s+(\d{2})\/(\d{2})\/(\d{4})/);
    const orderNumber = orderMatch ? orderMatch[1] : null;
    const orderDate = orderMatch ? `${orderMatch[4]}-${orderMatch[3]}-${orderMatch[2]}` : null;

    const items = [];

    // Extraire la zone de lignes produit
    // Debut : apres "Quantité Total\n(HT)" (fin du header de colonnes page 1)
    // Fin : "Détail des taxes"
    const startMatch = text.match(/Quantité\s+Total\s*\n\s*\(HT\)/);
    const startIdx = startMatch ? startMatch.index + startMatch[0].length : -1;
    const endIdx = text.indexOf('Détail des taxes');

    if (startIdx < 0 || endIdx < 0) return { orderNumber, orderDate, items, hasPrice: true };

    const productZone = text.substring(startIdx, endIdx);

    // Nettoyer : retirer les footers et headers de pages intermediaires
    // Footer : "cig access pro - SARL ALAV..." jusqu'a la fin du bloc (page break)
    // Header page 2+ : "FACTURE\n03/03/2026\n#FA125169"
    // Page break : "-- N of M --"
    const cleaned = productZone
      .replace(/cig access pro[\s\S]*?(?=\n\d{6}|\nDétail|$)/g, '\n')
      .replace(/--\s*\d+\s*of\s*\d+\s*--/g, '\n')
      .replace(/FACTURE\n\d{2}\/\d{2}\/\d{4}\n#FA\d+/g, '\n')
      .replace(/SARL ALAV[^\n]*/g, '\n');

    const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Pattern de ligne de prix : "0.05 20 % 5,90 € 4,50 € 20 90,00 €"
    const priceLineRegex = /[\d.]+\s+\d+\s*%\s+[\d,]+\s*€\s+[\d,]+\s*€\s+\d+\s+[\d,]+\s*€\s*$/;

    // Trouver les indices des lignes de prix
    const priceLineIndices = [];
    for (let i = 0; i < lines.length; i++) {
      if (priceLineRegex.test(lines[i])) {
        priceLineIndices.push(i);
      }
    }

    // Construire les blocs : chaque bloc va de la fin du bloc precedent jusqu'a la ligne de prix incluse
    let blockStart = 0;
    for (const priceIdx of priceLineIndices) {
      const blockLines = lines.slice(blockStart, priceIdx + 1);
      blockStart = priceIdx + 1;

      // Joindre le bloc, en gerant les refs coupees sur 2 lignes
      // Ex: "006674-0-SS\nW\nDotmod - Résistances..." -> "006674-0-SSW Dotmod - Résistances..."
      // La ref peut etre coupee : si une ligne courte (< 10 chars) suit la premiere ligne
      // et ne contient que des lettres/chiffres, c'est la suite de la ref
      let blockText = '';
      for (let i = 0; i < blockLines.length; i++) {
        const line = blockLines[i];
        if (i > 0 && blockLines[i - 1].length < 15 && line.length < 10 && /^[\w-]+$/.test(line) && i < 3) {
          // Continuation de la ref ou ref courte : coller sans espace
          // Mais seulement si la ligne precedente ressemble a une ref incomplete (finit par tiret ou lettre)
          const prev = blockText.trimEnd();
          if (prev.match(/[-A-Z]$/) && !line.match(/^\d+\s*%/)) {
            blockText = prev + line + ' ';
            continue;
          }
        }
        blockText += line + ' ';
      }
      blockText = blockText.replace(/\s+/g, ' ').trim();

      // Extraire les chiffres de prix
      // POIDS TAUX% PRIX_BASE€ PRIX_UNIT€ QTE TOTAL€
      const numbersMatch = blockText.match(
        /([\d.]+)\s+(\d+)\s*%\s+([\d,]+)\s*€\s+([\d,]+)\s*€\s+(\d+)\s+([\d,]+)\s*€\s*$/
      );
      if (!numbersMatch) continue;

      const parseDecimal = (str) => parseFloat(str.replace(',', '.'));

      const prixBase = parseDecimal(numbersMatch[3]);
      const prixUnit = parseDecimal(numbersMatch[4]);
      const qty = parseInt(numbersMatch[5]);
      const totalHt = parseDecimal(numbersMatch[6]);

      // Texte avant les chiffres = ref + designation
      const textBefore = blockText.substring(0, blockText.indexOf(numbersMatch[0])).trim();
      if (!textBefore) continue;

      // La ref est au debut : chiffres (6 digits) ou chiffres-lettres-tirets (006674-0-SSW)
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
};
