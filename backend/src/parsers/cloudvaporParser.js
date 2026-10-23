/**
 * Parseur PDF pour Cloud Vapor (b2b.cloudvapor.com)
 * Format : bon de commande "Commande # Sxxxxx"
 * Colonnes : DESCRIPTION | QUANTITÉ | PRIX UNITAIRE | TAXES | MONTANT
 *
 * - Référence entre crochets en tête de désignation :
 *   "[BLUE VELVET-50ML-00MG] BLUE VELVET-50ML"
 * - Quantité en UNITÉS : "138,00 Unité(s) (23 Boîte de regroupement)"
 *   Le groupage entre parenthèses (Boîte / Colisage Carton) est ignoré : le
 *   pack_qty vient de la BDD (product_suppliers).
 * - Prix unitaire HT + montant HT par ligne.
 * - Lignes de remise / escompte (montant négatif) → remise de pied. Depuis
 *   octobre 2026 elles portent elles aussi des crochets (« [Remise] Remise /
 *   Remise progressive (-15%) ») : sans traitement, elles passaient pour des
 *   articles de réf. « Remise », jamais rapprochés, et disparaissaient de la
 *   commande (INV/2026/02555 : -375,26 € et -21,26 € perdus).
 *   Les lignes à 0 € (ex: "Chronopost") sont ignorées.
 * - Une remise de pied EN POURCENTAGE qui retombe au centime sur l'assiette de
 *   TOUS les articles est reportée sur chaque ligne (discount_percent) au lieu
 *   de rester une ligne à part : c'est le coût de revient de chaque produit
 *   qu'elle baisse. Les remises s'enchaînent (l'escompte CB de 1 % porte sur le
 *   montant déjà remisé de 15 % : 1 − 0,85 × 0,99 = 15,85 %). Une remise qui ne
 *   retombe pas juste reste une ligne à part, comme avant.
 *
 * PDF = prix unitaire + quantité en unités → invertPackQty (comme e.tasty) :
 * le modèle convertit en packs via le pack_qty de la BDD.
 */

module.exports = {
  parse: (text) => {
    const parseDecimal = (str) => parseFloat(String(str).replace(/\s/g, '').replace(',', '.'));

    // Numéro de commande : "Commande # S07639"
    // Sur une facture (« Facture INV/… »), c'est la « Source » qui porte le n° de
    // commande, étiquette parfois imprimée deux fois : « Source Source S08644 ».
    const orderMatch = text.match(/Commande\s*#\s*(\S+)/i)
      || text.match(/\bSource\s+(?:Source\s+)?(S\d{4,})\b/);
    const orderNumber = orderMatch ? orderMatch[1] : null;

    // Date de commande : "Date de la commande 26/06/2026" (libellé puis valeur)
    const dateMatch = text.match(/Date de la commande\s+(\d{2})\/(\d{2})\/(\d{4})/i);
    const orderDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

    // Zone tableau : du premier "[" (1ère référence) jusqu'à la fin du texte.
    // Pas de borne de fin : sur un document de 2 pages, pdf-parse sort le bloc
    // « Montant hors taxes » AVANT les dernières lignes de la page 2. Couper au
    // premier total perdait en silence ces lignes et la remise de pied
    // (INV/2025/04126 : PRISM, LE CHAMAN, SCOUT + remise de -927,81 €). Les
    // totaux et pieds de page ne passent pas le motif de ligne (« Unité(s) »,
    // « TVA NN % », qté × prix = montant).
    const tableStart = text.indexOf('[');
    const tableText = text.substring(tableStart >= 0 ? tableStart : 0);

    const items = [];
    const discountItems = [];

    // Chaque ligne : DESCRIPTION  QTE Unité(s) [(groupage)]  PRIX  TVA NN%  MONTANT €
    // La désignation peut déborder sur plusieurs lignes (capture non gourmande).
    const rowPattern = /([\s\S]*?)([\d.,]+)\s*Unité\(s\)(?:\s*\([^)]*\))?\s+(-?[\d.,]+)\s+TVA\s*\d+\s*%\s+(-?[\d\s.,]+)\s*€/g;

    let m;
    while ((m = rowPattern.exec(tableText)) !== null) {
      const description = m[1].replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
      const qty = Math.round(parseDecimal(m[2]));
      const unitPrice = parseDecimal(m[3]);
      const montant = parseDecimal(m[4]);

      // Cohérence qty × prix ≈ montant (évite les faux positifs : totaux, etc.)
      if (Number.isNaN(qty) || Number.isNaN(unitPrice) || Math.abs(qty * unitPrice - montant) > 0.05) {
        continue;
      }

      // Ligne à 0 € (livraison « [Delivery_007] … Chronopost ») : rien à commander.
      if (montant === 0) continue;

      const skuMatch = description.match(/\[([^\]]+)\]/);
      const isDiscount = montant < 0
        || (skuMatch && /^(remise|discount|escompte)\b/i.test(skuMatch[1].trim()));
      if (isDiscount) {
        // Ligne remise / escompte, avec ou sans crochets. Le libellé utile est
        // la 2e ligne (« Remise progressive (-15%) »), pas « [Remise] Remise ».
        const label = description.replace(/^\[[^\]]*\]\s*(?:remise\s+)?/i, '').trim() || description;
        const rate = description.match(/(\d+(?:[.,]\d+)?)\s*%/);
        discountItems.push({
          item_type: 'discount',
          product_name: label,
          unit_price: -Math.abs(montant),
          qty_ordered: 1,
          rate: rate ? parseDecimal(rate[1]) / 100 : null,
        });
      } else if (skuMatch) {
        // Ligne produit
        const supplierSku = skuMatch[1].trim();
        const designation = description.slice(skuMatch.index + skuMatch[0].length).trim();
        items.push({
          supplier_sku: supplierSku,
          designation: designation || supplierSku,
          qty_ordered: qty,
          unit_price_net: unitPrice,
          total_ht: montant,
        });
      }
      // sinon (ligne positive sans référence) : ignorée
    }

    if (foldGlobalDiscounts(items, discountItems)) {
      return { orderNumber, orderDate, items, discountItems: [], foldedDiscounts: discountItems, hasPrice: true, invertPackQty: true };
    }
    return { orderNumber, orderDate, items, discountItems, hasPrice: true, invertPackQty: true };
  },
  foldGlobalDiscounts,
};

/**
 * Reporte les remises de pied en pourcentage sur chaque article, si et
 * seulement si l'arithmétique le prouve : chaque remise vaut son taux appliqué
 * à l'assiette restante (tous les articles, moins les remises précédentes), et
 * le net obtenu ligne par ligne retombe sur le net imprimé.
 * Modifie `items` (discount_percent, document_discount) et renvoie true ;
 * renvoie false sans rien toucher sinon.
 */
function foldGlobalDiscounts(items, discountItems) {
  if (!items.length || !discountItems.length) return false;
  const round2 = (n) => Math.round(n * 100) / 100;
  const gross = round2(items.reduce((s, i) => s + i.total_ht, 0));

  let base = gross;
  let factor = 1;
  for (const d of discountItems) {
    if (!(d.rate > 0 && d.rate < 1)) return false;
    // Un centime d'arrondi par remise, rien de plus.
    if (Math.abs(round2(base * d.rate) + d.unit_price) > 0.01) return false;
    base = round2(base + d.unit_price);
    factor *= 1 - d.rate;
  }

  // discount_percent est stocké à 2 décimales : la remise arrondie doit encore
  // retomber sur le net imprimé.
  const percent = round2((1 - factor) * 100);
  if (Math.abs(round2(gross * (1 - percent / 100)) - base) > 0.02) return false;

  for (const it of items) {
    it.discount_percent = percent;
    // Remise propre à CE document (progressive : elle dépend du volume) : un
    // tarif validé d'une commande passée ne doit pas l'écraser à l'import.
    it.document_discount = true;
  }
  return true;
}
