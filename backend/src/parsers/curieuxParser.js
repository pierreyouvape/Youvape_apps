/**
 * Parseur PDF pour Curieux e-liquides
 * Format : facture TCPDF avec prix HT (meme logiciel que CigAccess)
 * Colonnes : Reference | Produit | Taux taxe | Prix unitaire HT | Quantite | Total HT
 * Les refs sont coupees sur 2 lignes quasi systematiquement : "NAT-\nGRAN-10-3MG"
 * Les designations peuvent deborder sur 2 lignes
 * La derniere ref peut deborder sur la page suivante (ref coupee entre pages)
 */

module.exports = {
  parse: (text) => {
    // Extraire la ref de commande et date : "#FA067222 17/03/2026 QBIQTGUGF 17/03/2026 FR..."
    const orderMatch = text.match(/#FA\d+\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\S+)\s+\d{2}\/\d{2}\/\d{4}/);
    const orderNumber = orderMatch ? orderMatch[4] : null;
    const orderDate = orderMatch ? `${orderMatch[3]}-${orderMatch[2]}-${orderMatch[1]}` : null;

    const items = [];

    // Extraire la zone produit : apres le header de colonnes, avant "Détail des taxes"
    const startMatch = text.match(/Quantité\s+Total\s*\n\s*\(HT\)/);
    const startIdx = startMatch ? startMatch.index + startMatch[0].length : -1;
    const endIdx = text.indexOf('Détail des taxes');

    if (startIdx < 0 || endIdx < 0) return { orderNumber, orderDate, items, hasPrice: true, skipPackQty: true };

    let productZone = text.substring(startIdx, endIdx);

    // Nettoyer : retirer pagination, page breaks, headers de page 2+
    productZone = productZone
      .replace(/\d+\s*\/\s*\d+\s*\n/g, '\n')       // "1 / 2"
      .replace(/--\s*\d+\s*of\s*\d+\s*--/g, '\n')   // "-- 1 of 2 --"
      .replace(/FACTURE\n[\s\S]*?#FA\d+/g, '\n');    // header page 2 (date peut etre tronquee)

    const lines = productZone.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Pattern de ligne de prix : "20 % 1,53 € 10 15,30 €"
    // Taux% Prix_unit€ Qte Total€
    const priceLineRegex = /\d+\s*%\s+[\d,]+\s*€\s+\d+\s+[\d,]+\s*€\s*$/;

    // Trouver les indices des lignes de prix
    const priceLineIndices = [];
    for (let i = 0; i < lines.length; i++) {
      if (priceLineRegex.test(lines[i])) {
        priceLineIndices.push(i);
      }
    }

    // Construire les blocs
    let blockStart = 0;
    for (let p = 0; p < priceLineIndices.length; p++) {
      const priceIdx = priceLineIndices[p];
      const blockLines = lines.slice(blockStart, priceIdx + 1);
      blockStart = priceIdx + 1;

      // Reconstituer les refs coupees sur 2 lignes :
      // "NAT-" + "GRAN-10-3MG" -> "NAT-GRAN-10-3MG"
      // "190-FRAM-10-6" + "MG" -> "190-FRAM-10-6MG"
      // Un fragment de ref : que des lettres maj, chiffres, tirets, < 15 chars
      let reconstituted = [];
      for (let i = 0; i < blockLines.length; i++) {
        const line = blockLines[i];
        if (reconstituted.length > 0 && i <= 2) {
          const prev = reconstituted[reconstituted.length - 1];
          // Fragment de ref : court, que alphanum + tirets
          if (/^[A-Z0-9][\w-]*$/.test(line) && line.length < 15) {
            // Coller au precedent si celui-ci finit par "-" ou si le fragment est court (< 5 chars)
            if (prev.endsWith('-') || line.length < 5) {
              reconstituted[reconstituted.length - 1] = prev + line;
              continue;
            }
          }
        }
        reconstituted.push(line);
      }

      const blockText = reconstituted.join(' ').replace(/\s+/g, ' ').trim();

      // Extraire les prix : TAUX% PRIX_UNIT€ QTE TOTAL€
      const numbersMatch = blockText.match(
        /(\d+)\s*%\s+([\d,]+)\s*€\s+(\d+)\s+([\d,]+)\s*€\s*$/
      );
      if (!numbersMatch) continue;

      const parseDecimal = (str) => parseFloat(str.replace(',', '.'));

      const prixUnit = parseDecimal(numbersMatch[2]);
      const qty = parseInt(numbersMatch[3]);
      const totalHt = parseDecimal(numbersMatch[4]);

      // Texte avant les prix
      const textBefore = blockText.substring(0, blockText.indexOf(numbersMatch[0])).trim();
      if (!textBefore) continue;

      // La ref est au debut, format avec tirets : "190-FRAM-10-6MG", "PREC-50-0MG"
      // Ou parfois "AST-LICO-200-0MG"
      const refMatch = textBefore.match(/^([A-Z0-9][\w-]+)\s+(.+)$/);
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

    // Gerer la ref qui deborde sur la page suivante :
    // Le dernier item peut avoir une ref tronquee (ex: "PRE-") car la ref complete est sur page 2
    // Le fragment orphelin (ex: "PREC-50-0MG") est la ref COMPLETE, pas juste la suite
    if (items.length > 0 && blockStart < lines.length) {
      const orphanLines = lines.slice(blockStart);
      const orphan = orphanLines.join('').trim();
      if (orphan && /^[A-Z0-9][\w-]+$/.test(orphan)) {
        const lastItem = items[items.length - 1];
        if (lastItem.supplier_sku.endsWith('-')) {
          // Le fragment orphelin est la ref complete (commence par le meme prefixe)
          lastItem.supplier_sku = orphan;
        }
      }
    }

    return { orderNumber, orderDate, items, hasPrice: true, skipPackQty: true };
  }
};
