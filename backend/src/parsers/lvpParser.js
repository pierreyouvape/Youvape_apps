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

  // Nouveau format (2026) : colonnes remise% | prix_HT | prix_TTC | qté | total_HT | total_TTC
  // Ex: "20% 10,80 € 12,96 € 2 21,60 € 25,92 €"
  // La ref peut être sur la même ligne ou sur la ligne précédente
  //
  // Ancien format : Référence: REF QTE PRIX_HT€ TOTAL_HT€ TVA€ TTC€
  // On détecte le format selon la présence d'un pattern "remise%"

  const isNewFormat = /\d+%\s+[\d,]+\s*€\s+[\d,]+\s*€\s+\d+\s+[\d,]+\s*€/.test(cleaned);

  // Regex nouveau format : remise% prixHT prixTTC qté totalHT totalTTC
  const newFormatNumRegex = /(\d+)%\s+([\d,]+)\s*€\s+[\d,]+\s*€\s+(\d+)\s+([\d,]+)\s*€/;
  // Regex ancien format : qté prixHT€ (premier match)
  const oldFormatNumRegex = /(\d+)\s+([\d,]+)\s*€/;

  const refRegex = /Référence:\s*([^\n]+)/g;
  let match;
  const refMatches = [];
  while ((match = refRegex.exec(cleaned)) !== null) {
    const fullLine = match[1].trim();
    // Tenter d'extraire les chiffres inline (sur la même ligne que la ref)
    const numInLine = isNewFormat
      ? fullLine.match(/^([\w\s.-]+?)\s+\d+%\s+([\d,]+)\s*€\s+[\d,]+\s*€\s+(\d+)\s+([\d,]+)\s*€/)
      : fullLine.match(/^([\w\s.-]+?)\s+(\d+)\s+([\d,]+)\s*€/);

    if (numInLine) {
      const sku = numInLine[1].trim();
      const qty = isNewFormat ? parseInt(numInLine[3]) : parseInt(numInLine[2]);
      const unitPrice = isNewFormat ? parseFloat(numInLine[2].replace(',', '.')) : parseFloat(numInLine[3].replace(',', '.'));
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
      if (isNewFormat) {
        // Nouveau format : les données sont AVANT la ref (désignation + prix sur la même ligne, ref en dessous)
        // On cherche dans beforeRef
        const numMatch = beforeRef.match(newFormatNumRegex);
        if (!numMatch) continue;
        // groups: 1=remise%, 2=prixHT, 3=qté, 4=totalHT
        qty = parseInt(numMatch[3]);
        unitPrice = parseFloat(numMatch[2].replace(',', '.'));
      } else {
        // Ancien format : les données sont APRÈS la ref
        const afterRef = cleaned.substring(ref.endIndex, nextRefStart);
        const numMatch = afterRef.match(oldFormatNumRegex);
        if (!numMatch) continue;
        qty = parseInt(numMatch[1]);
        unitPrice = parseFloat(numMatch[2].replace(',', '.'));
      }
    }

    if (!qty) continue;

    items.push({
      supplier_sku: ref.sku,
      designation,
      qty_ordered: qty,
      unit_price_net: unitPrice,
    });
  }

  const discountItems = globalDiscount > 0
    ? [{ item_type: 'discount', product_name: 'Remise', unit_price: -globalDiscount, qty_ordered: 1 }]
    : [];

  return { orderNumber, orderDate, items, discountItems, hasPrice: true, skipPackQty: true };
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
    // Variantes : avec/sans "Code TVA", avec/sans "Rist. %"
    const sections = text.split(/Référence\s+Désignation\s+(?:Code\s+TVA\s+)?Quantité\s+PU HT(?:\s+Rist\.\s*%)?\s+Montant HT/);

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
        // Variantes : "qty puHT montantHT", "qty puHT rist% montantHT", "codeTVA qty puHT montantHT"
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
        // Variantes : "qty puHT montantHT", "qty puHT rist% montantHT", "codeTVA qty puHT montantHT"
        let qty = null, puHt = null, montantHt = null, rist = 0;
        let matched = false;

        // Chercher tous les groupes de nombres entier + XX.XX + XX.XX en fin de bloc
        // On teste les combinaisons possibles en prenant le dernier match valide
        const numRegex = /(?:(\d+)\s+)?(\d+)\s+(\d+\.\d{2})(?:\s+(\d+\.\d{2}))?\s+(\d+\.\d{2})/g;
        let m;
        while ((m = numRegex.exec(blockText)) !== null) {
          // m[1] = codeTVA optionnel, m[2] = qty, m[3] = puHT, m[4] = rist optionnel, m[5] = montantHT
          const q = parseInt(m[2]);
          const pu = parseFloat(m[3]);
          const r = m[4] ? parseFloat(m[4]) : 0;
          const mt = parseFloat(m[5]);
          if (Math.abs(q * pu * (1 - r / 100) - mt) <= 0.02 && q > 0) {
            qty = q; puHt = pu; rist = r; montantHt = mt;
            matched = true;
          }
        }
        if (!matched) continue;

        // Texte = bloc sans les nombres de fin (codeTVA? qty puHT rist? montantHT)
        const numSuffix = blockText.match(/(?:\d+\s+)?\d+\s+\d+\.\d{2}(?:\s+\d+\.\d{2})?\s+\d+\.\d{2}\s*$/);
        const fullText = numSuffix
          ? blockText.substring(0, blockText.lastIndexOf(numSuffix[0])).trim()
          : blockText;

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

    // Remise globale : "Remise : 122.86 €"
    const discountMatch = text.match(/Remise\s*:\s*([\d.,]+)\s*€/);
    const globalDiscount = discountMatch ? parseFloat(discountMatch[1].replace(',', '.')) : 0;
    const discountItems = globalDiscount > 0
      ? [{ item_type: 'discount', product_name: 'Remise', unit_price: -globalDiscount, qty_ordered: 1 }]
      : [];

    return { orderNumber, orderDate, items, discountItems, hasPrice: true };
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
