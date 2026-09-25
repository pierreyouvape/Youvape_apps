/**
 * Parseur PDF pour Pulp (Sunny Smoker — marques PULP / Le Pod / PULP PRO)
 *
 * Facture TCPDF « à l'unité » : la colonne Qté compte des PIÈCES et le prix
 * unitaire est le prix d'UNE pièce (→ invertPackQty, comme Curieux / e.tasty ;
 * la conversion unités ↔ packs reste à la charge de pdfImportModel).
 *
 * Colonnes : Référence | Produit | Taux de taxe | Prix unitaire (HT) | Qté | Total (HT)
 *
 * Particularité du gabarit : la cellule « Prix unitaire » tient sur PLUSIEURS
 * lignes et le couple Qté/Total bascule à la ligne suivante dès qu'elle en tient
 * deux. Quatre formes coexistent sur la même facture (FA165024) :
 *
 *   sans remise           « 0 % 1,55 € 20 31,00 € »        (tout sur une ligne)
 *   avec remise           « 0 % 1,03 € »
 *                         « -30% 1,47 € »                   ← tarif BARRÉ
 *                         « 80 82,40 € »
 *   avec écotaxe          « 0 % 7,70 € » / « écotaxe : 0,08 € » / « 20 154,00 € »
 *   écotaxe + remise      « 0 % 6,24 € » / « écotaxe : 0,08 € » / « -20% 7,70 € »
 *                         « 25 156,00 € »
 *
 * Le PREMIER montant est le prix NET (celui qui est facturé : 80 × 1,03 = 82,40) ;
 * le second, précédé du pourcentage, est le tarif barré → unit_price_base. La
 * remise est donc DÉJÀ déduite : ne jamais renvoyer discount_percent ici, sinon
 * pdfImportModel la déduirait une seconde fois (pdfNet = prix × (1 - remise)).
 * L'écotaxe est hors total de ligne (20 × 7,70 = 154,00 pile) : on l'ignore.
 *
 * La dernière ligne d'une page peut être coupée en deux : la référence, les prix
 * et le total restent sur la page courante, la fin de la désignation et le tarif
 * barré passent sur la suivante (FA165024, 2020101005009). On recolle ce reliquat
 * sur le dernier article — sans quoi sa désignation resterait tronquée.
 */

// Fin de ligne produit : « QTÉ TOTAL € ». Ni « 0 % 1,03 € » ni « -30% 1,47 € »
// ni « écotaxe : 0,08 € » ne peuvent matcher : il faut un entier nu, séparé du
// montant par une espace.
const ROW_END_REGEX = /(?:^|\s)\d{1,5}\s+\d[\d ]*(?:,\d{2})?\s*€\s*$/;

// Cellules prix + Qté/Total agglomérées : TAUX% NET€ [écotaxe : X€] [-REMISE% BARRÉ€] QTÉ TOTAL€
const PRICES_REGEX =
  /(\d+(?:,\d+)?)\s*%\s+([\d ]*\d(?:,\d{1,2})?)\s*€(?:\s+écotaxe\s*:\s*([\d,]+)\s*€)?(?:\s+-\s*(\d+(?:,\d+)?)\s*%\s+([\d ]*\d(?:,\d{1,2})?)\s*€)?\s+(\d{1,5})\s+([\d ]*\d(?:,\d{2})?)\s*€\s*$/;

// Tarif barré resté seul sur la page suivante : « -30% 6,60 € »
const ORPHAN_BASE_PRICE_REGEX = /^-\s*(\d+(?:,\d+)?)\s*%\s+([\d ]*\d(?:,\d{1,2})?)\s*€$/;

const parseDecimal = (str) => parseFloat(String(str).replace(/\s/g, '').replace(',', '.'));

module.exports = {
  parse: (text) => {
    // Tableau récapitulatif :
    // « Numéro de facture Date de facturation Réf. de commande Date de commande Numéro de TVA »
    // « #FA165024 25/09/2026 168213 25/09/2026 FR87789508439 »
    // Le n° retenu est la RÉF. DE COMMANDE (168213), pas le n° de facture : c'est
    // elle qui identifie la commande côté fournisseur.
    const orderMatch = text.match(/#FA\d+\s+\d{2}\/\d{2}\/\d{4}\s+(\S+)\s+(\d{2})\/(\d{2})\/(\d{4})/);
    const orderNumber = orderMatch ? orderMatch[1] : null;
    const orderDate = orderMatch ? `${orderMatch[4]}-${orderMatch[3]}-${orderMatch[2]}` : null;

    const items = [];

    // Total HT produits imprimé sur la facture (« Total produits HT 2 618,90 € »).
    // Source indépendante des lignes parsées : un écart trahit une ligne perdue.
    let invoiceProductTotalHT = null;
    const totalMatch = text.match(/Total\s+produits\s+HT\s+([0-9][0-9 ]*,\d{2})\s*€/i);
    if (totalMatch) {
      const n = parseDecimal(totalMatch[1]);
      if (Number.isFinite(n) && n > 0) invoiceProductTotalHT = n;
    }

    const result = () => ({
      orderNumber, orderDate, items, hasPrice: true, invertPackQty: true,
      invoiceProductTotalHT, invoiceProductTotalIsGross: true,
    });

    // Zone produits : après le header de colonnes « Qté Total\n(HT) »,
    // avant le bloc des taxes (« Détail des\ntaxes »).
    const startMatch = text.match(/Qté\s+Total\s*\n\s*\(HT\)/);
    const startIdx = startMatch ? startMatch.index + startMatch[0].length : -1;
    const endMatch = text.match(/Détail\s+des\s+taxes/);
    if (startIdx < 0 || !endMatch || endMatch.index < startIdx) return result();

    const productZone = text
      .substring(startIdx, endMatch.index)
      // Mobilier de page : pied de page légal, pagination, séparateur pdf-parse,
      // en-tête répété. Laissé en place, il se collerait devant le 1er article de
      // la page suivante, qui disparaîtrait en silence (cf. tests/parsers.test.js).
      .replace(/Sunny Smoker[\s\S]*?CMCIFRPP/g, '\n')
      .replace(/^\s*\d+\s*\/\s*\d+\s*$/gm, '')
      .replace(/--\s*\d+\s*of\s*\d+\s*--/g, '\n')
      .replace(/FACTURE\s*\n\s*\d{2}\/\d{2}\/\d{4}\s*\n\s*#FA\d+/g, '\n');

    const lines = productZone.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

    let blockStart = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!ROW_END_REGEX.test(lines[i])) continue;

      const blockText = lines.slice(blockStart, i + 1).join(' ').replace(/\s+/g, ' ').trim();
      blockStart = i + 1;

      const prices = blockText.match(PRICES_REGEX);
      if (!prices) continue;

      const prixUnit = parseDecimal(prices[2]);
      const prixBase = prices[5] ? parseDecimal(prices[5]) : null;
      const qty = parseInt(prices[6], 10);
      const totalHt = parseDecimal(prices[7]);

      const textBefore = blockText.substring(0, blockText.indexOf(prices[0])).trim();
      if (!textBefore) continue;

      // Réf. collée à la désignation, jamais coupée sur ce gabarit : EAN 13 chiffres
      // (3666528044512) ou code interne (2020101005245).
      const refMatch = textBefore.match(/^(\d[\d\w.-]*)\s+(.+)$/);
      if (!refMatch) continue;

      items.push({
        supplier_sku: refMatch[1],
        designation: refMatch[2].trim(),
        qty_ordered: qty,
        unit_price_base: prixBase,
        unit_price_net: prixUnit,
        total_ht: totalHt,
      });
    }

    // Reliquat de la dernière ligne, basculé sur la page suivante : fin de
    // désignation et/ou tarif barré, sans référence ni Qté/Total (ceux-là sont
    // restés avec l'article). On le rattache plutôt que de le perdre.
    if (items.length > 0 && blockStart < lines.length) {
      const lastItem = items[items.length - 1];
      const tail = [];
      for (const line of lines.slice(blockStart)) {
        const basePrice = line.match(ORPHAN_BASE_PRICE_REGEX);
        if (basePrice) {
          if (lastItem.unit_price_base == null) lastItem.unit_price_base = parseDecimal(basePrice[2]);
          continue;
        }
        tail.push(line);
      }
      if (tail.length > 0) {
        lastItem.designation = `${lastItem.designation} ${tail.join(' ')}`.replace(/\s+/g, ' ').trim();
      }
    }

    return result();
  },
};
