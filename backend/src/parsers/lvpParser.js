/**
 * Parseur PDF pour LVP Distribution
 * Format : facture OpenSi multi-pages avec prix HT
 * Colonnes : Reference | Designation | Quantite | PU HT | Montant HT
 * Les refs sont libres (avec espaces possibles), les designations debordent sur 2-3 lignes
 * Les chiffres (qte, pu ht, montant ht) sont toujours en fin de ligne du bloc
 * Multi-pages : chaque page repete le header + "Sous-total HT XXXX" (report sans deux-points)
 */

module.exports = {
  parse: (text) => {
    // Extraire le numero de commande : "Réf. Commande : 263387"
    const orderMatch = text.match(/Réf\.\s*Commande\s*:\s*(\S+)/);
    const orderNumber = orderMatch ? orderMatch[1] : null;

    // Extraire la date : "Date : 24/03/2026"
    const dateMatch = text.match(/Date\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/);
    const orderDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

    const items = [];

    // Split par header de colonnes (chaque page en a un)
    const sections = text.split(/Référence\s+Désignation\s+Quantité\s+PU HT\s+Montant HT/);

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
        if (/\d+\s+\d+\.\d{2}\s+\d+\.\d{2}\s*$/.test(filteredLines[i])) {
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
        const priceRegex = /(\d+)\s+(\d+\.\d{2})\s+(\d+\.\d{2})/g;
        let m;
        while ((m = priceRegex.exec(blockText)) !== null) {
          lastPriceMatch = m;
        }
        if (!lastPriceMatch) continue;

        const qty = parseInt(lastPriceMatch[1]);
        const puHt = parseFloat(lastPriceMatch[2]);
        const montantHt = parseFloat(lastPriceMatch[3]);

        // Verifier coherence qte * pu ~= montant
        if (Math.abs(qty * puHt - montantHt) > 0.02) continue;

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
            unit_price_net: puHt,
            total_ht: montantHt,
          });
        }
      }
    }

    return { orderNumber, orderDate, items, hasPrice: true };
  }
};

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
