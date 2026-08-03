/**
 * Parseur PDF pour MG Vape Distribution (MG VAPE DISTRIBUTION, Marseille).
 * Format : FACTURE TCPDF (fichiers "MDxxxxxx.pdf"), prix HT.
 *
 * Colonnes : Référence | Produit | Taux de taxe | Prix de base (HT) |
 *            Prix unitaire (HT) | Quantité | Total (HT)
 *
 * Particularités du texte extrait (pdf-parse / pdfjs) :
 *  - La référence et la désignation arrivent AVANT la ligne de prix, chacune
 *    éventuellement éclatée sur plusieurs lignes par le retour à la ligne des
 *    colonnes :
 *      "MPV-ACC-18\n650-4000\nACCUS MPV - 4000 MAH INR\n18650 - 18A\n20 % 5,90 € 4,40 € 100 440,00 €"
 *    → réf = "MPV-ACC-18650-4000", désignation = "ACCUS MPV - 4000 MAH INR 18650 - 18A".
 *  - cleanPdfText recolle les réfs coupées sur un tiret ("MPV-CHA-\nFC1" → "MPV-CHA-FC1")
 *    mais pas celles coupées ailleurs ("MPV-ACC-18\n650-4000" reste éclaté) : le
 *    parseur reconstruit donc la réf en recollant les fragments SANS espace.
 *  - Une ligne d'en-tête de catégorie ("MPV") précède le 1er produit : elle n'a
 *    pas de tiret, on la saute (la réf commence au 1er fragment contenant un "-").
 *  - Deux colonnes de prix : "Prix de base" (tarif catalogue, parfois "--") puis
 *    "Prix unitaire" (prix réellement facturé). On retient le PRIX UNITAIRE
 *    (Total = Prix unitaire × Quantité).
 *
 * Prix unitaire HT, quantités exprimées en UNITÉS. Comme Levest, on importe
 * chaque ligne « à l'unité » (skipPackQty + trustPdfPrice) : pas de conversion
 * pack/unité via le pack_qty de la BDD (source d'incohérences), le montant
 * réellement facturé fait foi.
 */

const parseDecimal = (str) => parseFloat(String(str).replace(/\s/g, '').replace(',', '.'));

module.exports = {
  parse: (text) => {
    // En-tête : "5746 MD039634 03/08/2026 JTOHJEFYT 03/08/2026"
    //  = ID client | N° facture | Date facturation | Réf. commande | Date commande
    // On retient la Réf. de commande comme numéro de commande et la Date de commande.
    const headerMatch = text.match(
      /MD\w+\s+\d{2}\/\d{2}\/\d{4}\s+(\w+)\s+(\d{2})\/(\d{2})\/(\d{4})/
    );
    const orderNumber = headerMatch ? headerMatch[1] : null;
    const orderDate = headerMatch
      ? `${headerMatch[4]}-${headerMatch[3]}-${headerMatch[2]}`
      : null;

    // Restreindre le scan au tableau produits : après l'en-tête de colonnes
    // ("... Total (HT)") et avant le récapitulatif ("Détail des taxes").
    const startMatch = text.match(/Total\s*\n?\s*\(\s*HT\s*\)/i);
    const startIdx = startMatch ? startMatch.index + startMatch[0].length : 0;
    const footerIdx = text.search(/D[ée]tail des\s*\n?\s*taxes/i);
    const scanText = text.slice(startIdx, footerIdx >= 0 ? footerIdx : text.length);

    const items = [];

    // Chaque ligne produit se termine par :
    //   TAUX %  (Prix de base € | --)  Prix unitaire €  QTE  Total €
    // Le bloc qui précède (capture paresseuse) contient la réf + la désignation.
    const rowPattern =
      /([\s\S]*?)(\d+)\s*%\s+(?:--|[\d.,]+\s*€)\s+([\d.,]+)\s*€\s+(\d+)\s+([\d.,]+)\s*€/g;

    let m;
    while ((m = rowPattern.exec(scanText)) !== null) {
      const block = m[1];
      const unitPrice = parseDecimal(m[3]);
      const qty = parseInt(m[4], 10);
      const totalHt = parseDecimal(m[5]);

      // Cohérence qty × prix unitaire ≈ total (évite les faux positifs).
      if (Number.isNaN(qty) || Number.isNaN(unitPrice) || Math.abs(qty * unitPrice - totalHt) > 0.05) {
        continue;
      }

      // Séparer réf et désignation dans le bloc capturé.
      // - Les fragments de RÉFÉRENCE sont des lignes SANS espace (majuscules,
      //   chiffres, tirets) : "MPV-ACC-18", "650-4000", "SBVUSBCW", "HI".
      // - La DÉSIGNATION commence à la 1re ligne contenant un espace
      //   ("ACCUS MPV - 4000 MAH INR"), et tout ce qui suit lui appartient.
      // - On ignore les lignes de tête sans tiret ni espace (en-tête de
      //   catégorie "MPV") : la réf débute au 1er fragment contenant un "-".
      const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

      const refParts = [];
      const descParts = [];
      let refStarted = false;
      for (const line of lines) {
        const isNoSpaceToken = /^[A-Z0-9-]+$/.test(line);
        if (!refStarted) {
          // Sauter les fragments de tête sans tiret (en-tête de catégorie).
          if (isNoSpaceToken && line.includes('-')) {
            refStarted = true;
            refParts.push(line);
          }
          // sinon (catégorie "MPV" sans tiret) : ignoré
          continue;
        }
        // Réf en cours : on continue tant que la ligne n'a pas d'espace.
        if (isNoSpaceToken && descParts.length === 0) {
          refParts.push(line);
        } else {
          descParts.push(line);
        }
      }

      const supplierSku = refParts.join('');
      if (!supplierSku) continue;
      const designation = descParts.join(' ').replace(/\s+/g, ' ').trim();

      items.push({
        supplier_sku: supplierSku,
        designation: designation || supplierSku,
        qty_ordered: qty,
        unit_price_net: unitPrice,
        total_ht: totalHt,
      });
    }

    return {
      orderNumber,
      orderDate,
      items,
      hasPrice: true,
      skipPackQty: true,
      trustPdfPrice: true,
    };
  },
};
