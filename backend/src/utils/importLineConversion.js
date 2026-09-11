/**
 * Convertit une ligne du document fournisseur (quantité et prix tels qu'imprimés,
 * comptés en packs de la RÉF) dans l'unité de compte de la ligne de commande.
 *
 * k = nombre d'unités de ligne dans un pack de la réf :
 *  - cas général : la ligne compte en UNITÉS → k = refPack ;
 *  - skipPackQty (LCA, Highbuy, Levest, MG Vape) : la ligne compte en packs de
 *    l'association BMS (units_per_qty = pack BMS, cf. purchaseOrderModel.create)
 *    → k = refPack / bmsPack. Les réfs reprises ont refPack = bmsPack → k = 1,
 *    comme avant ; une réf « pack de 50 » chez un fournisseur que BMS compte par
 *    10 donne 5 packs BMS par pack de la réf.
 * invertPackQty : le document est déjà en unités → quantité et prix tels quels.
 *
 * Le montant de la ligne est conservé (qty × prix inchangé) ; seul le prix de la
 * réf en base (refPrice, prix DU PACK) est ramené à l'unité de ligne.
 */
function convertLine({ docQty, docPrice, discountPercent = 0, refPack, refPrice, bmsPack, conversion = {} }) {
  const r = refPack >= 1 ? refPack : 1;
  const b = bmsPack >= 1 ? bmsPack : 1;
  let k = conversion.skipPackQty ? r / b : r;
  let packWarning = null;

  if (conversion.skipPackQty && r !== b && !Number.isInteger(docQty * k)) {
    packWarning =
      `Réf. en pack de ${r}, BMS compte ce produit par pack de ${b} : ` +
      `${docQty} × ${r} = ${docQty * r} unités ne font pas un nombre entier de packs BMS. ` +
      `Quantité reprise telle quelle, à vérifier.`;
    k = 1;
  }

  const pdfGross = docPrice != null && k !== 1 && !conversion.invertPackQty ? docPrice / k : docPrice;
  const pdfNet = pdfGross != null ? pdfGross * (1 - discountPercent / 100) : null;
  const dbPrice = refPrice != null ? (k !== 1 ? refPrice / k : refPrice) : null;
  const qtyOrdered = conversion.invertPackQty ? docQty : docQty * k;

  // Prix retenu.
  // invertPackQty / trustPdfPrice : on fait confiance au prix du document (= prix
  //   réellement facturé), le prix en base étant parfois incohérent.
  // autres modes : document si meilleur (ou si pas de prix en base), sinon base.
  const unitPrice = (conversion.invertPackQty || conversion.trustPdfPrice)
    ? (pdfNet != null ? pdfNet : dbPrice)
    : ((pdfNet != null && (dbPrice == null || pdfNet < dbPrice)) ? pdfNet : dbPrice);

  return { packQty: k, qtyOrdered, pdfGross, pdfNet, dbPrice, unitPrice, packWarning };
}

module.exports = { convertLine };
