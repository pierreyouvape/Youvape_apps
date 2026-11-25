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
 * - Colonne « REM.% » (factures depuis novembre 2026) entre le prix et la TVA :
 *   « 500,00 Unité(s) 1,50 0,00 TVA 20% 750,00 € ». Sans elle dans le motif,
 *   aucune ligne n'était lue (INV/2026/02834). Une remise de ligne partielle
 *   devient le discount_percent de l'article.
 * - Unités OFFERTES (« offert – Black Friday — 1 acheté = 1 offert », REM 100 %,
 *   0,00 €) : fusionnées dans la ligne payée de la même réf. — quantité payée +
 *   offerte, même prix brut, remise qui ramène le net au montant réellement
 *   payé. C'est le coût de revient réel de chaque flacon, et le contrôle de
 *   facture cumule déjà les lignes d'une même réf. Une réf. offerte sans ligne
 *   payée devient un article à 100 % de remise.
 * - Remise en pourcentage sur une PARTIE des articles (« Offre MOIS SANS TABAC
 *   -10% sur les 10ml… ») : reportée sur les seuls articles visés (contenance
 *   citée dans le libellé), si l'arithmétique retombe au centime.
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
    // Sur une facture : « Date de facturation », colonne étroite → libellé et
    // année coupés (« facturatio / n / 25/11/202 / 6 »).
    const dateMatch = text.match(/Date de la commande\s+(\d{2})\/(\d{2})\/(\d{4})/i);
    const invDateMatch = !dateMatch && text.match(/facturatio[\s\S]{0,40}?(\d{2})\/(\d{2})\/(\d{3})\s*(\d)\b/i);
    const orderDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
      : invDateMatch ? `${invDateMatch[3]}${invDateMatch[4]}-${invDateMatch[2]}-${invDateMatch[1]}` : null;

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
    const freeItems = [];

    // Chaque ligne : DESCRIPTION  QTE Unité(s) [(groupage)]  PRIX  [REM.%]  TVA NN%  MONTANT €
    // La désignation peut déborder sur plusieurs lignes (capture non gourmande).
    const rowPattern = /([\s\S]*?)([\d.,]+)\s*Unité\(s\)(?:\s*\([^)]*\))?\s+(-?[\d.,]+)(?:\s+([\d.,]+))?\s+TVA\s*\d+\s*%\s+(-?[\d\s.,]+)\s*€/g;

    let m;
    while ((m = rowPattern.exec(tableText)) !== null) {
      const description = m[1].replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
      const qty = Math.round(parseDecimal(m[2]));
      const unitPrice = parseDecimal(m[3]);
      const rem = m[4] != null ? parseDecimal(m[4]) : 0;
      const montant = parseDecimal(m[5]);

      // Cohérence qty × prix × (1 − rem) ≈ montant (évite les faux positifs : totaux, etc.)
      if (Number.isNaN(qty) || Number.isNaN(unitPrice) || Number.isNaN(rem) || rem < 0 || rem > 100
        || Math.abs(qty * unitPrice * (1 - rem / 100) - montant) > 0.05) {
        continue;
      }

      const skuMatch = description.match(/\[([^\]]+)\]/);

      // Unités offertes : article à prix normal remisé à 100 %.
      if (montant === 0 && rem === 100 && unitPrice > 0 && qty > 0 && skuMatch) {
        freeItems.push({ supplier_sku: skuMatch[1].trim(), qty, unitPrice, designation: description.slice(skuMatch.index + skuMatch[0].length).trim() });
        continue;
      }

      // Ligne à 0 € (livraison « [Delivery_007] … Chronopost ») : rien à commander.
      if (montant === 0) continue;

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
        const item = {
          supplier_sku: supplierSku,
          designation: designation || supplierSku,
          qty_ordered: qty,
          unit_price_net: unitPrice,
          total_ht: montant,
        };
        if (rem > 0) item.discount_percent = rem;
        items.push(item);
      }
      // sinon (ligne positive sans référence) : ignorée
    }

    const folded = foldGlobalDiscounts(items, discountItems);
    mergeFreeItems(items, freeItems);

    if (folded) {
      return { orderNumber, orderDate, items, discountItems: [], foldedDiscounts: discountItems, hasPrice: true, invertPackQty: true };
    }
    return { orderNumber, orderDate, items, discountItems, hasPrice: true, invertPackQty: true };
  },
  foldGlobalDiscounts,
  mergeFreeItems,
};

/**
 * Fusionne les unités offertes dans la ligne payée de même réf. : quantité
 * cumulée, prix brut inchangé, remise recalculée pour que le net de la ligne
 * reste ce qui a été payé. Sans ligne payée : article à 100 % de remise.
 */
function mergeFreeItems(items, freeItems) {
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  for (const f of freeItems) {
    const paid = items.find((i) => norm(i.supplier_sku) === norm(f.supplier_sku) && i.unit_price_net === f.unitPrice);
    if (!paid) {
      items.push({
        supplier_sku: f.supplier_sku,
        designation: f.designation || f.supplier_sku,
        qty_ordered: f.qty,
        unit_price_net: f.unitPrice,
        discount_percent: 100,
        document_discount: true,
        total_ht: 0,
        free_qty: f.qty,
      });
      continue;
    }
    const net = paid.total_ht * (1 - (paid.discount_percent || 0) / 100);
    const qty = paid.qty_ordered + f.qty;
    paid.qty_ordered = qty;
    paid.free_qty = (paid.free_qty || 0) + f.qty;
    paid.discount_percent = Math.round((1 - net / (qty * paid.unit_price_net)) * 10000) / 100;
    // Propre à CE document : un tarif validé ne doit pas l'écraser à l'import.
    paid.document_discount = true;
  }
}

/**
 * Reporte les remises de pied en pourcentage sur les articles, si et seulement
 * si l'arithmétique le prouve. Chaque remise doit valoir son taux appliqué à
 * l'une de ces assiettes, essayées dans l'ordre :
 *   - tous les articles, montant restant (remises précédentes déduites) :
 *     l'escompte CB de 1 % sur le net déjà remisé ;
 *   - tous les articles, montant imprimé ;
 *   - les articles de la contenance citée par le libellé (« -10% sur les 10ml »),
 *     montant imprimé puis restant.
 * L'ordre d'impression n'est pas l'ordre de calcul (INV/2026/02834 : l'escompte
 * est imprimé avant « Mois sans tabac » mais calculé après) : on retente les
 * remises restantes tant qu'une nouvelle tombe juste.
 * Le net obtenu ligne par ligne doit retomber sur le net imprimé.
 * Modifie `items` (discount_percent, document_discount) et renvoie true ;
 * renvoie false sans rien toucher sinon.
 */
function foldGlobalDiscounts(items, discountItems) {
  if (!items.length || !discountItems.length) return false;
  const round2 = (n) => Math.round(n * 100) / 100;
  const gross = items.map((i) => i.total_ht * (1 - (i.discount_percent || 0) / 100));
  const net = gross.slice();
  const all = items.map((_, k) => k);

  const sizeSubset = (label) => {
    const sizes = [...String(label || '').matchAll(/(\d+)\s*ml\b/gi)].map((m) => m[1]);
    if (!sizes.length) return null;
    const re = new RegExp(`(^|[^0-9])(${sizes.join('|')})\\s*ML\\b`, 'i');
    const idx = all.filter((k) => re.test(items[k].supplier_sku) || re.test(items[k].designation));
    return idx.length && idx.length < items.length ? idx : null;
  };

  const pending = discountItems.slice();
  while (pending.length) {
    let applied = false;
    for (let p = 0; p < pending.length && !applied; p++) {
      const d = pending[p];
      if (!(d.rate > 0 && d.rate < 1)) return false;
      const subset = sizeSubset(d.product_name);
      const candidates = [[all, 'net'], [all, 'gross']];
      if (subset) candidates.push([subset, 'gross'], [subset, 'net']);
      for (const [idx, mode] of candidates) {
        const src = mode === 'net' ? net : gross;
        const base = idx.reduce((s, k) => s + src[k], 0);
        // Un centime d'arrondi par remise, rien de plus.
        if (Math.abs(round2(base * d.rate) + d.unit_price) > 0.01) continue;
        for (const k of idx) net[k] -= src[k] * d.rate;
        pending.splice(p, 1);
        applied = true;
        break;
      }
    }
    if (!applied) return false;
  }

  // discount_percent est stocké à 2 décimales : la remise arrondie doit encore
  // retomber sur le net imprimé.
  const percents = items.map((it, k) => round2((1 - net[k] / it.total_ht) * 100));
  const printedNet = round2(items.reduce((s, it) => s + it.total_ht * (1 - (it.discount_percent || 0) / 100), 0)
    + discountItems.reduce((s, d) => s + d.unit_price, 0));
  const computedNet = items.reduce((s, it, k) => s + round2(it.total_ht * (1 - percents[k] / 100)), 0);
  if (Math.abs(round2(computedNet) - printedNet) > 0.02) return false;

  items.forEach((it, k) => {
    it.discount_percent = percents[k];
    // Remise propre à CE document (progressive : elle dépend du volume) : un
    // tarif validé d'une commande passée ne doit pas l'écraser à l'import.
    it.document_discount = true;
  });
  return true;
}
