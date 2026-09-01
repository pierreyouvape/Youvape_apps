/**
 * Parseur PDF pour Curieux e-liquides
 * Format : facture TCPDF avec prix HT (meme logiciel que CigAccess)
 * Colonnes : Reference | Produit | Taux taxe | [Prix de base HT] | Prix unitaire HT | Quantite | Total HT
 *
 * La colonne « Prix de base » (tarif barre) est apparue en cours de route et vaut
 * "--" quand l'article n'a aucune remise (facture FA072952, 01/09/2026). Elle est
 * donc OPTIONNELLE ici : les anciennes factures n'en ont pas, les nouvelles oui.
 * Exiger sa presence -- ou son absence -- fait echouer la detection des lignes de
 * prix, et le PDF ressort avec « Aucune ligne produit trouvee ».
 *
 * Les refs sont coupees sur plusieurs lignes quasi systematiquement, et depuis
 * l'ajout de la colonne la coupure ne tombe plus forcement sur un tiret :
 * "NAT-\nGRAN-10-3MG", mais aussi "AST-LICO-1\n0-10SDN" ou "PRE-\nSEL-10-20M\nG".
 * On recolle donc TOUS les fragments de tete du bloc (majuscules/chiffres/tirets,
 * sans espace) : une ligne de designation contient toujours des espaces ou des
 * minuscules, elle arrete naturellement le recollage.
 * Les designations peuvent deborder sur 2 lignes.
 * La derniere ref peut deborder sur la page suivante (ref coupee entre pages)
 */

// Fragment de reference : uniquement majuscules, chiffres, tirets et points.
// Une ligne de designation (« Le Precieux - 10ml (Taux de ») ne peut pas matcher :
// elle contient des espaces et des minuscules.
const REF_FRAGMENT = /^[A-Z0-9][A-Z0-9.-]*$/;

module.exports = {
  parse: (text) => {
    // Extraire la ref de commande et date : "#FA067222 17/03/2026 QBIQTGUGF 17/03/2026 FR..."
    const orderMatch = text.match(/#FA\d+\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\S+)\s+\d{2}\/\d{2}\/\d{4}/);
    const orderNumber = orderMatch ? orderMatch[4] : null;
    const orderDate = orderMatch ? `${orderMatch[3]}-${orderMatch[2]}-${orderMatch[1]}` : null;

    const items = [];

    // Total HT produits imprime sur la facture ("Total produits 962,71 €").
    // Source independante des lignes parsees : un ecart trahit une ligne perdue.
    let invoiceProductTotalHT = null;
    const totalMatch = text.match(/Total\s+produits\s+([0-9][0-9   ]*,\d{2})\s*€/i);
    if (totalMatch) {
      const n = parseFloat(totalMatch[1].replace(/[\s   ]/g, '').replace(',', '.'));
      if (Number.isFinite(n) && n > 0) invoiceProductTotalHT = n;
    }

    const result = () => ({
      orderNumber, orderDate, items, hasPrice: true, invertPackQty: true,
      invoiceProductTotalHT, invoiceProductTotalIsGross: true,
    });

    // Extraire la zone produit : apres le header de colonnes, avant "Détail des taxes"
    const startMatch = text.match(/Quantité\s+Total\s*\n\s*\(HT\)/);
    const startIdx = startMatch ? startMatch.index + startMatch[0].length : -1;
    const endIdx = text.indexOf('Détail des taxes');

    if (startIdx < 0 || endIdx < 0) return result();

    let productZone = text.substring(startIdx, endIdx);

    // Nettoyer : retirer pagination, page breaks, headers de page 2+
    productZone = productZone
      .replace(/\d+\s*\/\s*\d+\s*\n/g, '\n')       // "1 / 2"
      .replace(/--\s*\d+\s*of\s*\d+\s*--/g, '\n')   // "-- 1 of 2 --"
      .replace(/FACTURE\n[\s\S]*?#FA\d+/g, '\n');    // header page 2 (date peut etre tronquee)

    const lines = productZone.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Pattern de ligne de prix : "20 % 1,53 € 10 15,30 €" (sans tarif barre)
    // ou "20 % 5,90 € 3,84 € 5 19,18 €" / "20 % -- 1,36 € 20 27,20 €" (avec).
    // Taux% [PrixBase€|--] Prix_unit€ Qte Total€
    const priceLineRegex = /\d+\s*%\s+(?:(?:--|[\d,]+\s*€)\s+)?[\d,]+\s*€\s+\d+\s+[\d,]+\s*€\s*$/;

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
      let blockLines = lines.slice(blockStart, priceIdx + 1);
      blockStart = priceIdx + 1;

      // Ref coupée sur un saut de page : si l'item précédent a une ref tronquée ("NAT-")
      // et que ce bloc commence par un fragment orphelin ("VERT-50-0MG") qui est la suite,
      // rattacher le fragment à la ref précédente et l'enlever du bloc courant
      if (items.length > 0 && items[items.length - 1].supplier_sku.endsWith('-') && blockLines.length > 1) {
        if (REF_FRAGMENT.test(blockLines[0])) {
          items[items.length - 1].supplier_sku += blockLines[0];
          blockLines = blockLines.slice(1);
        }
      }

      // Recoller les fragments de reference en tete de bloc, SANS espace :
      // ["AST-LICO-1", "0-10SDN"] -> "AST-LICO-10-10SDN"
      // ["PRE-SEL-10-20M", "G"]   -> "PRE-SEL-10-20MG"
      // On s'arrete a la premiere ligne qui n'est pas un fragment de ref (= la
      // designation), et on laisse toujours au moins la ligne de prix + 1 ligne
      // derriere : jamais de designation avalee en entier.
      let cut = 0;
      let supplierSku = '';
      while (cut < blockLines.length - 1 && REF_FRAGMENT.test(blockLines[cut])) {
        supplierSku += blockLines[cut];
        cut++;
      }

      const blockText = blockLines.slice(cut).join(' ').replace(/\s+/g, ' ').trim();

      // Extraire les prix : TAUX% [PRIX_BASE€|--] PRIX_UNIT€ QTE TOTAL€
      const numbersMatch = blockText.match(
        /(\d+)\s*%\s+(?:(--|[\d,]+\s*€)\s+)?([\d,]+)\s*€\s+(\d+)\s+([\d,]+)\s*€\s*$/
      );
      if (!numbersMatch) continue;

      const parseDecimal = (str) => parseFloat(str.replace(',', '.'));

      // "--" = pas de tarif barre sur cet article ; absent = colonne inexistante.
      const prixBase = !numbersMatch[2] || numbersMatch[2] === '--'
        ? null
        : parseDecimal(numbersMatch[2].replace('€', '').trim());
      const prixUnit = parseDecimal(numbersMatch[3]);
      const qty = parseInt(numbersMatch[4]);
      const totalHt = parseDecimal(numbersMatch[5]);

      // Texte avant les prix
      const textBefore = blockText.substring(0, blockText.indexOf(numbersMatch[0])).trim();

      // La ref est au debut, format avec tirets : "190-FRAM-10-6MG", "PREC-50-0MG"
      // Ou parfois "AST-LICO-200-0MG". Cas des factures ou elle n'a PAS ete coupee :
      // elle est alors collee a la designation sur la meme ligne.
      let designation = textBefore;
      if (!supplierSku) {
        const refMatch = textBefore.match(/^([A-Z0-9][\w-]+)\s+(.+)$/);
        if (refMatch) {
          supplierSku = refMatch[1];
          designation = refMatch[2];
        }
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

    // Gerer la ref qui deborde sur la page suivante :
    // Le dernier item a une ref tronquee (ex: "PRE-") car la SUITE de la ref est sur page 2.
    // Le fragment orphelin (ex: "PREC-10-12MG") est la CONTINUATION, pas la ref complete :
    // on le CONCATENE au prefixe tronque, exactement comme la reconstitution intra-bloc
    // (cf. plus haut "items[...].supplier_sku += ..."). Ex: "PRE-" + "PREC-10-12MG"
    // = "PRE-PREC-10-12MG" (coherent avec les refs freres PRE-PREC-10-3MG/6MG/18MG).
    // Bug historique : un `= orphan` ici tronquait la ref en "PREC-10-12MG" -> mismatch
    // du pack_qty -> quantite non divisee par pack_qty (20 unites vues comme 20 packs).
    if (items.length > 0 && blockStart < lines.length) {
      const orphanLines = lines.slice(blockStart);
      const orphan = orphanLines.join('').trim();
      if (orphan && /^[A-Z0-9][\w-]+$/.test(orphan)) {
        const lastItem = items[items.length - 1];
        if (lastItem.supplier_sku.endsWith('-')) {
          lastItem.supplier_sku += orphan;
        }
      }
    }

    return result();
  }
};
