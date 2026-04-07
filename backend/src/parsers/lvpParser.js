/**
 * Parseur PDF pour LVP Distribution
 * Gere 2 formats :
 * - "Facture" : facture OpenSi multi-pages avec colonnes Référence | Désignation | Quantité | PU HT | Montant HT
 * - "Confirmation" : confirmation de commande site web lvp-distribution.fr
 *   Colonnes : Produit | Quantité | Prix unitaire HT | Prix total HT | TVA | Prix total TTC
 *   Chaque item : désignation (1-2 lignes) + "Référence: REF" + QTE PRIX_HT€ TOTAL_HT€ TVA€ TTC€
 *   Remise globale : "Remise XX,XX €" en bas du tableau
 */

module.exports = {
  parse: (text) => {
    if (text.includes('Commande n°') && text.includes('Référence:')) {
      return parseConfirmation(text);
    }
    return parseFacture(text);
  }
};

/**
 * Format "Confirmation de commande" (site web lvp-distribution.fr)
 */
function parseConfirmation(text) {
  // Numero de commande : "Commande n°265057 du 06/04/2026"
  const orderMatch = text.match(/Commande n°(\d+)\s+du\s+(\d{2})\/(\d{2})\/(\d{4})/);
  const orderNumber = orderMatch ? orderMatch[1] : null;
  const orderDate = orderMatch ? `${orderMatch[4]}-${orderMatch[3]}-${orderMatch[2]}` : null;

  // Remise globale : "Remise 75,27 €"
  const discountMatch = text.match(/Remise\s+([\d,]+)\s*€/);
  const globalDiscount = discountMatch ? parseFloat(discountMatch[1].replace(',', '.')) : 0;

  const items = [];

  // Nettoyer footers/headers de pages
  const cleaned = text
    .replace(/\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}[^\n]*/g, '')
    .replace(/https?:\/\/[^\n]*/g, '')
    .replace(/Sous-total[\s\S]*?(?=\n\S)/g, '\n')
    .replace(/Remise[^\n]*/g, '')
    .replace(/Frais de livraison[^\n]*/g, '')
    .replace(/Taxes[^\n]*/g, '')
    .replace(/^Total\b[^\n]*/gm, '');

  // Trouver tous les blocs "Référence: XXX [chiffres sur la même ligne ou ligne suivante]"
  // La ref s'arrête avant le premier nombre suivi d'un tab ou espace+€
  // Ex: "Référence: FR10-SUBZ-EX00-01 36 \t2,49 €" → sku=FR10-SUBZ-EX00-01, qty=36, prix=2,49
  // Ex: "Référence: PP-CSWCEG-0\n5 \t2,95 €" → sku=PP-CSWCEG-0, chiffres sur la ligne suivante
  const refRegex = /Référence:\s*([^\n]+)/g;
  let match;
  const refMatches = [];
  while ((match = refRegex.exec(cleaned)) !== null) {
    const fullLine = match[1].trim();
    // Extraire la ref (tout avant le premier groupe "entier + prix €")
    const numInLine = fullLine.match(/^([\w\s.-]+?)\s+(\d+)\s+([\d,]+)\s*€/);
    if (numInLine) {
      const sku = numInLine[1].trim();
      const qty = parseInt(numInLine[2]);
      const unitPrice = parseFloat(numInLine[3].replace(',', '.'));
      refMatches.push({ sku, qty, unitPrice, index: match.index, endIndex: match.index + match[0].length, inlineData: true });
    } else {
      // Ref seule sur la ligne, chiffres sur la ligne suivante
      refMatches.push({ sku: fullLine, qty: null, unitPrice: null, index: match.index, endIndex: match.index + match[0].length, inlineData: false });
    }
  }

  for (let i = 0; i < refMatches.length; i++) {
    const ref = refMatches[i];
    const nextRefStart = i + 1 < refMatches.length ? refMatches[i + 1].index : cleaned.length;

    // Désignation : lignes entre la fin de la ref précédente et la ref courante
    const prevEnd = i > 0 ? refMatches[i - 1].endIndex : 0;
    const beforeRef = cleaned.substring(prevEnd, ref.index);
    const headerWords = ['Produit', 'Quantité', 'Prix', 'unitaire', 'total', 'HT', 'TVA', 'TTC'];
    const beforeLines = beforeRef.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const desigLines = beforeLines.filter(l => !headerWords.some(w => l === w));
    const designation = desigLines.slice(-2).join(' ').trim();

    let qty = ref.qty;
    let unitPrice = ref.unitPrice;

    if (!ref.inlineData) {
      // Chiffres sur la ligne suivante : QTE PRIX_HT€
      const afterRef = cleaned.substring(ref.endIndex, nextRefStart);
      const numMatch = afterRef.match(/(\d+)\s+([\d,]+)\s*€/);
      if (!numMatch) continue;
      qty = parseInt(numMatch[1]);
      unitPrice = parseFloat(numMatch[2].replace(',', '.'));
    }

    if (!qty) continue;

    items.push({
      supplier_sku: ref.sku,
      designation,
      qty_ordered: qty,
      unit_price_net: unitPrice,
    });
  }

  return { orderNumber, orderDate, items, hasPrice: true, skipPackQty: true, globalDiscount };
}

/**
 * Format "Facture" OpenSi
 */
function parseFacture(text) {
    // Extraire le numero de commande : "Réf. Commande : 263387"
    const orderMatch = text.match(/Réf\.\s*Commande\s*:\s*(\S+)/);
    const orderNumber = orderMatch ? orderMatch[1] : null;

    // Extraire la date : "Date : 24/03/2026"
    const dateMatch = text.match(/Date\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/);
    const orderDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

    const items = [];

    // Split par header de colonnes (chaque page en a un)
    // Deux variantes : avec ou sans colonne "Rist. %"
    const sections = text.split(/Référence\s+Désignation\s+Quantité\s+PU HT(?:\s+Rist\.\s*%)?\s+Montant HT/);

    for (let s = 1; s < sections.length; s++) {
      const section = sections[s];

      // Couper au vrai sous-total (avec deux-points) ou fin de page
      const endIdx = section.search(/Sous-total HT\s*:|Code\(s\) promo|Base HT\s+Taux|LVP DISTRIBUTION - S/);
      const content = endIdx > 0 ? section.substring(0, endIdx) : section;

      const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      // Filtrer les lignes de report : "Sous-total HT 1 339.26" (sans deux-points)
      const filteredLines = lines.filter(l => !/^Sous-total HT\s+[\d\s,.]+$/.test(l));

      // === Approche : trouver toutes les lignes qui contiennent des prix ===
      // Chaque ligne de prix marque la FIN d'un bloc item.
      // Tout ce qui est entre deux lignes de prix est : trailing du bloc precedent + debut du bloc suivant.

      // Etape 1 : identifier les indices des lignes de prix
      const priceLineIndices = [];
      for (let i = 0; i < filteredLines.length; i++) {
        // Avec ou sans colonne remise : "qty puHT montantHT" ou "qty puHT rist% montantHT"
        if (/\d+\s+\d+\.\d{2}(?:\s+\d+\.\d{2})?\s+\d+\.\d{2}\s*$/.test(filteredLines[i])) {
          priceLineIndices.push(i);
        }
      }

      // Etape 2 : pour chaque ligne de prix, determiner le debut du bloc
      // La cle : entre deux lignes de prix consecutives, il y a potentiellement :
      //   - des lignes trailing du bloc precedent (variante : "Gunmetal", "Silver", etc.)
      //   - des lignes du debut du bloc suivant (ref + designation)
      // On doit trouver le point de coupure.
      //
      // Strategie : on commence du debut. Le premier bloc va de la ligne 0 a la premiere ligne de prix.
      // Ensuite, les lignes entre deux lignes de prix successives sont attribuees :
      //   - trailing = lignes qui ne contiennent que des mots courts (variante/couleur)
      //   - debut du bloc suivant = premiere ligne qui ressemble a une ref
      //
      // Heuristique plus simple : les trailing lines sont celles qui ne contiennent pas
      // de mots-cles de debut de ref. On regarde si la ligne est "courte et sans ref pattern".

      for (let p = 0; p < priceLineIndices.length; p++) {
        const priceIdx = priceLineIndices[p];

        // Trouver le debut de ce bloc
        let startIdx;
        if (p === 0) {
          startIdx = 0;
        } else {
          // Le debut est juste apres les trailing lines du bloc precedent
          // On cherche depuis la ligne apres le prix precedent
          const prevPriceIdx = priceLineIndices[p - 1];
          startIdx = prevPriceIdx + 1;

          // Avancer startIdx pour sauter les trailing lines
          // Un trailing line est court et ne ressemble pas a une ref
          while (startIdx < priceIdx) {
            const line = filteredLines[startIdx];
            const isTrailing = isTrailingLine(line);
            if (!isTrailing) break;
            startIdx++;
          }
        }

        // Collecter les lignes du bloc : de startIdx a priceIdx inclus
        // Plus les trailing lines apres priceIdx
        const blockLines = filteredLines.slice(startIdx, priceIdx + 1);

        // Ajouter les trailing lines apres le prix (si c'est le dernier bloc, ou jusqu'au debut du bloc suivant)
        let trailEnd = priceIdx + 1;
        const nextPriceIdx = p + 1 < priceLineIndices.length ? priceLineIndices[p + 1] : filteredLines.length;
        while (trailEnd < nextPriceIdx && isTrailingLine(filteredLines[trailEnd])) {
          blockLines.push(filteredLines[trailEnd]);
          trailEnd++;
        }

        const blockText = blockLines.join(' ').replace(/\s+/g, ' ').trim();

        // Extraire les prix (dernier match dans le bloc texte)
        let lastPriceMatch = null;
        // Avec remise optionnelle : qty puHT [rist%] montantHT
        const priceRegex = /(\d+)\s+(\d+\.\d{2})(?:\s+(\d+\.\d{2}))?\s+(\d+\.\d{2})/g;
        let m;
        while ((m = priceRegex.exec(blockText)) !== null) {
          lastPriceMatch = m;
        }
        if (!lastPriceMatch) continue;

        const qty = parseInt(lastPriceMatch[1]);
        const puHt = parseFloat(lastPriceMatch[2]);
        // lastPriceMatch[3] = remise % (optionnel), lastPriceMatch[4] = montantHT
        const montantHt = parseFloat(lastPriceMatch[4]);

        // Verifier coherence qte * pu * (1 - rist/100) ~= montant
        const rist = lastPriceMatch[3] ? parseFloat(lastPriceMatch[3]) : 0;
        const expectedMontant = qty * puHt * (1 - rist / 100);
        if (Math.abs(expectedMontant - montantHt) > 0.02) continue;

        // Texte avant et apres les prix
        const priceStart = lastPriceMatch.index;
        const priceEnd = priceStart + lastPriceMatch[0].length;
        const textBeforePrices = blockText.substring(0, priceStart).trim();
        const textAfterPrices = blockText.substring(priceEnd).trim();
        const fullText = textAfterPrices ? textBeforePrices + ' ' + textAfterPrices : textBeforePrices;

        if (!fullText) continue;

        // Extraire ref et designation
        const { supplierSku, designation } = extractRefAndDesignation(fullText);

        if (qty > 0 && supplierSku) {
          items.push({
            supplier_sku: supplierSku,
            designation: designation.trim(),
            qty_ordered: qty,
            unit_price_net: puHt,       // prix brut HT (avant remise)
            discount_percent: rist,     // remise en % (0 si pas de remise)
            total_ht: montantHt,
          });
        }
      }
    }

    return { orderNumber, orderDate, items, hasPrice: true };
}

/**
 * Determine si une ligne est un "trailing" (fin de designation du bloc precedent)
 * Les trailing lines sont des variantes courtes : "Gunmetal", "Silver", "Apple Green",
 * "5ml", "Black DTL", "Mesh 0.3ohm V2", "Résistance 1.6ohm Europe", etc.
 *
 * Criteres : la ligne est courte ET ne contient pas de pattern de ref structuree
 */
function isTrailingLine(line) {
  // Si la ligne contient des prix, ce n'est pas un trailing
  if (/\d+\s+\d+\.\d{2}\s+\d+\.\d{2}\s*$/.test(line)) return false;

  // Si la ligne est courte (< 40 chars) et ne ressemble pas a une ref structuree, c'est un trailing
  if (line.length > 50) return false;

  // Les refs structurees contiennent des tirets significatifs : "PP-CSWPEM-0", "VP-XROS5M-CBB"
  // Mais les trailing peuvent aussi avoir des tirets : "0.6 ohm Flat"
  // Les refs avec espaces commencent par des lettres majuscules + chiffres : "VP cartouches xTANK"

  // Pattern de ref structuree (avec tirets)
  if (/^[\w][\w-]*(?:-[\w]+)+\s/.test(line)) return false;

  // Pattern de ref avec espaces qui commence par 2+ lettres maj puis un mot
  // Ex: "VP cartouches", "VO cart", "PP-CSWBAP-0", "ADDSWEETY10"
  if (/^[A-Z]{2,}[\w-]*\s+\w/.test(line) && line.length > 15) return false;

  // "5 resistances 1.6ohm" — ref speciale
  if (/^\d+\s+resistances/.test(line)) return false;

  // Sinon c'est probablement un trailing
  return true;
}

/**
 * Separe la reference fournisseur de la designation dans le texte combine
 */
function extractRefAndDesignation(fullText) {
  // Strategie 1 : refs structurees avec tirets (ex: "FR10-TRIB-PG06-01", "VP-XROS5M-CBB")
  const refWithDashes = fullText.match(/^([\w][\w-]*(?:-[\w]+)+)\s+(.+)$/);
  if (refWithDashes) {
    return { supplierSku: refWithDashes[1], designation: refWithDashes[2] };
  }

  // Strategie 2 : refs avec espaces — trouver ou commence la vraie designation
  // On cherche les mots-cles de debut de designation. Si le premier match coupe la ref
  // a moins de 4 chars, on essaie le match suivant (ex: "VP Box Arm S Green Box Armour...")
  const descKeywords = /\b(PG |Kit |Box |Cartouches |Résistances |Pyrex |Le Pod |Additif |Puff |Pochette |Red |Samourai |Jaune |Sunset |Gold |Silver |Crypt |Kraken |Spirit |Beginning )/g;
  let descMatch;
  let bestDescStart = -1;
  while ((descMatch = descKeywords.exec(fullText)) !== null) {
    const pos = descMatch.index;
    // La ref doit avoir au moins 4 chars
    if (pos >= 4) {
      bestDescStart = pos;
      break;
    }
  }
  if (bestDescStart > 0) {
    return {
      supplierSku: fullText.substring(0, bestDescStart).trim(),
      designation: fullText.substring(bestDescStart).trim(),
    };
  }

  // Fallback : le premier mot est la ref
  const parts = fullText.split(/\s+/);
  return {
    supplierSku: parts[0],
    designation: parts.slice(1).join(' '),
  };
}
