/**
 * Rapprochement d'une facture fournisseur avec sa commande.
 *
 * Moteur pur : aucune base, aucun réseau, aucun parseur — il reçoit d'un côté les
 * lignes lues sur la facture, de l'autre les lignes de la commande, et renvoie les
 * écarts classés. Il est donc identique pour les 14 fournisseurs : seul le parseur
 * change en amont.
 *
 * Trois règles tirées de factures réelles (LCA F2609412942, JoshNoa V3/2026/36621,
 * 25/09/2026) :
 *
 * 1. LE PRIX QUI FAIT FOI EST `montant de ligne ÷ quantité`, jamais le prix unitaire
 *    imprimé. LCA imprime 5,43 € sur les lignes remisées à 16 % mais facture
 *    5,42633 € (soit 0,11 € par ligne de 30) ; JoshNoa imprime un P.U **TTC** et une
 *    remise, dont le net HT arrondi ne redonne pas le montant. Le montant, lui, est
 *    ce que le fournisseur encaisse.
 *
 * 2. LA COMMANDE EST LA RÉFÉRENCE, prix ET quantités. Le prix attendu est celui de
 *    la ligne de commande (déjà négocié au meilleur tarif connu au moment de l'achat).
 *
 * 3. QUANTITÉ ET PRIX SONT DEUX PROBLÈMES DIFFÉRENTS, et l'écart d'une ligne se
 *    décompose : l'effet quantité (manquant, reliquat → ajuster la commande) n'est
 *    pas réclamable au commercial, l'effet prix l'est. Une ligne peut porter les deux.
 *
 * 5. FACTURER EN UNITÉS CE QUI A ÉTÉ COMMANDÉ EN PACKS N'EST PAS UN ÉCART. Pulp
 *    facture 20 cartouches à 1,24 € là où la commande dit 10 paires à 2,48 € : même
 *    montant, même marchandise. Sans cette règle, chaque facture Pulp sortirait avec
 *    une vingtaine de fausses alertes de quantité (vérifié sur #FA165024 : 20 lignes
 *    sur 33). Le juge, c'est le MONTANT de la ligne ; la quantité seule ne prouve rien.
 *
 * 6. UNE REMISE DE PIED N'EST PAS UNE BAISSE DE TARIF LIGNE À LIGNE. Cosmer facture
 *    ses lignes au prix commandé puis retire « Remise youvape −300,90 € » (15 % de
 *    2 006,00 €) ; GFC et Cloud Vapor font pareil. Les lignes sont donc conformes et
 *    l'écart est au pied du document. Mais le COÛT RÉEL, lui, est bien 15 % plus bas :
 *    `effectiveUnitCost` répartit la remise au prorata, et c'est LUI qui doit servir
 *    à aligner un tarif ou à valoriser un stock — jamais le prix de ligne brut.
 *
 * 4. UN ARRONDI N'EST PAS UNE ERREUR DE TARIF, et ça se tranche sur le prix UNITAIRE,
 *    pas sur le montant : quand le fournisseur applique sa remise sans arrondir,
 *    l'écart au centime près par unité devient visible en euros sur une ligne de 30.
 *    Trier au montant classerait ces 0,11 € parmi les erreurs de tarif et ferait
 *    écrire au commercial pour un centime — le tri se fait donc à l'unité, et la
 *    matérialité (seuil en euros) est un drapeau séparé.
 *
 * Les quantités des deux côtés sont exprimées dans la MÊME unité (l'article du
 * fournisseur, pack compris) : BMS compte en packs et facture le prix du pack, les
 * factures aussi. Aucune conversion ici — `units_per_qty` ne sert qu'au stock.
 */

/** Seuil par défaut, en euros, en dessous duquel un écart de ligne ne vaut pas qu'on en parle. */
const DEFAULT_LINE_THRESHOLD = 0.10;

/**
 * Écart de prix unitaire en dessous duquel il ne s'agit pas d'un tarif différent
 * mais du calcul non arrondi du fournisseur (un demi-centime par unité).
 */
const UNIT_ROUNDING_TOLERANCE = 0.005;

/** Tolérance de réconciliation entre la somme des lignes lues et le total imprimé. */
const TOTAL_TOLERANCE = 0.02;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Réf. normalisée pour le rapprochement : casse, espaces, espaces multiples. */
function normalizeRef(ref) {
  return String(ref || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Regroupe les lignes par réf. normalisée : un même article peut apparaître sur
 * plusieurs lignes (deux lots, deux prix), et c'est le cumul qui se compare à la
 * commande. Les lignes hors produit (port, remise de pied) ne sont jamais groupées.
 */
function groupByRef(lines) {
  const map = new Map();
  for (const line of lines) {
    const key = normalizeRef(line.ref);
    if (!map.has(key)) {
      map.set(key, { ref: line.ref, label: line.label || null, qty: 0, total: 0, parts: 0 });
    }
    const g = map.get(key);
    g.qty += Number(line.qty) || 0;
    g.total += Number(line.lineTotalHt) || 0;
    g.parts += 1;
    if (!g.label && line.label) g.label = line.label;
  }
  return map;
}

/**
 * @param {Object}   input
 * @param {Object}   input.invoice           facture lue
 * @param {Array}    input.invoice.lines     { ref, label, qty, lineTotalHt, kind }
 *                                           kind : 'product' (défaut) | 'shipping' | 'discount' | 'other'
 * @param {number}   [input.invoice.totalHt] total HT imprimé (contrôle de lecture)
 * @param {Object}   input.order             commande de référence (BMS, état gelé à l'analyse)
 * @param {Array}    input.order.lines       { ref, productName, qty, price }
 * @param {Object}   [input.options]
 * @param {number}   [input.options.lineThreshold] seuil prix/arrondi (défaut 0,10 €)
 */
function compareInvoiceToOrder({ invoice, order, options = {} }) {
  const threshold = Number.isFinite(options.lineThreshold)
    ? options.lineThreshold
    : DEFAULT_LINE_THRESHOLD;

  const invoiceLines = invoice?.lines || [];
  const orderLines = order?.lines || [];

  const productLines = invoiceLines.filter((l) => (l.kind || 'product') === 'product');
  const otherLines = invoiceLines.filter((l) => (l.kind || 'product') !== 'product');

  const invoiceByRef = groupByRef(productLines);
  const orderByRef = new Map(orderLines.map((l) => [normalizeRef(l.ref), l]));

  const results = [];

  // 1. Tout ce qui est facturé, confronté à la commande.
  for (const [key, inv] of invoiceByRef) {
    const ord = orderByRef.get(key);
    const invoicedTotal = round2(inv.total);
    const invoicedUnitPrice = inv.qty ? inv.total / inv.qty : null;

    if (!ord) {
      // Facturé sans avoir été commandé. À 0 €, c'est un geste commercial (PLV,
      // échantillon) : à tracer, pas à réclamer.
      results.push({
        ref: inv.ref,
        label: inv.label,
        verdict: invoicedTotal === 0 ? 'free' : 'not_ordered',
        material: Math.abs(invoicedTotal) >= threshold,
        qtyOrdered: null,
        qtyInvoiced: inv.qty,
        expectedUnitPrice: null,
        invoicedUnitPrice,
        expectedTotal: 0,
        invoicedTotal,
        gapQty: 0,
        gapPrice: 0,
        gap: invoicedTotal,
      });
      continue;
    }

    const expectedUnitPrice = Number(ord.price) || 0;
    const qtyOrdered = Number(ord.qty) || 0;
    const expectedTotal = round2(qtyOrdered * expectedUnitPrice);

    // Décomposition : ce que coûte l'écart de quantité au prix commandé, et ce que
    // coûte l'écart de prix sur la quantité réellement facturée. La somme des deux
    // vaut toujours l'écart total de la ligne.
    const gapQty = round2((inv.qty - qtyOrdered) * expectedUnitPrice);
    const gapPrice = round2(inv.total - inv.qty * expectedUnitPrice);
    const gap = round2(invoicedTotal - expectedTotal);

    const qtyDiffers = inv.qty !== qtyOrdered;

    // Conditionnement (cf. règle 5) : la quantité change mais le montant retombe —
    // le fournisseur compte en unités ce que la commande compte en packs. Rien à
    // réclamer, rien à corriger ; on expose le rapport pour que ça se voie.
    const packRatio = qtyDiffers && qtyOrdered > 0 && inv.qty > 0
      ? inv.qty / qtyOrdered
      : null;
    const isPackaging = qtyDiffers && Math.abs(gap) < threshold;

    // Tarif réellement différent, ou simple arrondi du fournisseur ? Ça se lit sur
    // l'unité (cf. règle 4), jamais sur le montant de la ligne.
    const unitGap = invoicedUnitPrice === null ? 0 : invoicedUnitPrice - expectedUnitPrice;
    const isRounding = Math.abs(unitGap) < UNIT_ROUNDING_TOLERANCE;
    const priceDiffers = !isRounding && Math.abs(gapPrice) >= 0.005;

    let verdict;
    if (isPackaging) verdict = 'packaging';
    else if (qtyDiffers && priceDiffers) verdict = 'qty_price';
    else if (qtyDiffers) verdict = 'qty';
    else if (priceDiffers) verdict = 'price';
    else if (Math.abs(gapPrice) >= 0.005) verdict = 'rounding';
    else verdict = 'ok';

    results.push({
      ref: ord.ref || inv.ref,
      label: inv.label || ord.productName || null,
      verdict,
      // Au-dessus du seuil : ça vaut un geste (réclamation, alignement, ajustement).
      // En dessous : visible dans le détail, absent des décomptes et de l'email.
      material: Math.abs(gap) >= threshold,
      qtyOrdered,
      qtyInvoiced: inv.qty,
      // Rapport de conditionnement quand les deux ne comptent pas dans la même unité
      packRatio,
      expectedUnitPrice,
      invoicedUnitPrice,
      expectedTotal,
      invoicedTotal,
      // Sur une ligne de conditionnement, décomposer en effet quantité / effet prix
      // n'a pas de sens : les deux se compensent par construction.
      gapQty: isPackaging ? 0 : gapQty,
      gapPrice: isPackaging ? gap : gapPrice,
      gap,
    });
  }

  // 2. Commandé et absent de la facture : reliquat, rupture, ou facture partielle.
  //    Jamais une erreur de tarif — on ne réclame pas, on ajuste la commande.
  for (const ord of orderLines) {
    if (invoiceByRef.has(normalizeRef(ord.ref))) continue;
    const expectedTotal = round2((Number(ord.qty) || 0) * (Number(ord.price) || 0));
    results.push({
      ref: ord.ref,
      label: ord.productName || null,
      verdict: 'missing_in_invoice',
      material: expectedTotal >= threshold,
      qtyOrdered: Number(ord.qty) || 0,
      qtyInvoiced: 0,
      expectedUnitPrice: Number(ord.price) || 0,
      invoicedUnitPrice: null,
      expectedTotal,
      invoicedTotal: 0,
      gapQty: round2(-expectedTotal),
      gapPrice: 0,
      gap: round2(-expectedTotal),
    });
  }

  // 3. Lignes hors produit : port, remise de pied, écotaxe. Elles pèsent sur le
  //    total de la facture mais ne se rapprochent d'aucune ligne de commande.
  for (const l of otherLines) {
    const total = round2(l.lineTotalHt);
    results.push({
      ref: l.ref || null,
      label: l.label || null,
      verdict: l.kind,
      material: Math.abs(total) >= threshold,
      qtyOrdered: null,
      qtyInvoiced: Number(l.qty) || null,
      expectedUnitPrice: null,
      invoicedUnitPrice: null,
      expectedTotal: 0,
      invoicedTotal: total,
      gapQty: 0,
      gapPrice: 0,
      gap: total,
    });
  }

  // ─── Remise de pied : le coût réel de chaque ligne (cf. règle 6) ──────────
  // Cosmer, GFC et Cloud Vapor facturent au prix commandé puis retranchent une
  // remise globale. Les lignes sont conformes, mais le prix payé ne l'est pas :
  // on répartit la remise au prorata du montant de chaque ligne produit pour
  // obtenir le coût unitaire réel — celui qui doit alimenter un tarif ou un PMP.
  const footerDiscount = round2(
    results
      .filter((r) => r.verdict === 'discount')
      .reduce((acc, r) => acc + r.invoicedTotal, 0),
  );
  const productTotal = round2(
    results
      .filter((r) => !['discount', 'shipping', 'other'].includes(r.verdict))
      .reduce((acc, r) => acc + r.invoicedTotal, 0),
  );
  const discountRate = footerDiscount < 0 && productTotal > 0
    ? Math.abs(footerDiscount) / productTotal
    : 0;
  for (const r of results) {
    r.effectiveUnitCost = r.invoicedUnitPrice === null
      ? null
      : r.invoicedUnitPrice * (1 - discountRate);
  }

  // ─── Totaux ───────────────────────────────────────────────────────────────
  const invoiceParsed = round2(invoiceLines.reduce((s, l) => s + (Number(l.lineTotalHt) || 0), 0));
  const orderTotal = round2(orderLines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0));
  const printed = Number.isFinite(Number(invoice?.totalHt)) ? round2(invoice.totalHt) : null;

  // Garde-fou de lecture : si le total imprimé ne retombe pas sur la somme des
  // lignes lues, une ligne a été perdue ou dénaturée — l'analyse ne vaut rien tant
  // que ce n'est pas réglé (même logique que findUnparsedRows à l'import).
  const readGap = printed === null ? null : round2(invoiceParsed - printed);
  const reconciles = readGap === null ? null : Math.abs(readGap) <= TOTAL_TOLERANCE;

  // Ventilation additive : la somme des six familles vaut exactement l'écart global,
  // pour qu'aucun euro ne se perde entre le tableau et le total affiché.
  let claimable = 0, inOurFavour = 0, minorGap = 0, roundingGap = 0, qtyGap = 0, extrasGap = 0, packagingGap = 0;
  const EXTRA_VERDICTS = ['not_ordered', 'free', 'shipping', 'discount', 'other'];

  for (const r of results) {
    if (EXTRA_VERDICTS.includes(r.verdict)) {
      extrasGap += r.gap;
      continue;
    }
    if (r.verdict === 'packaging') {
      packagingGap += r.gap;   // résidu d'arrondi d'un simple changement d'unité
      continue;
    }
    qtyGap += r.gapQty;
    const isPrice = r.verdict === 'price' || r.verdict === 'qty_price';
    if (isPrice && r.material) {
      if (r.gapPrice > 0) claimable += r.gapPrice;
      else inOurFavour += r.gapPrice;
    } else if (isPrice) {
      minorGap += r.gapPrice;        // tarif vraiment différent, mais pour des cacahuètes
    } else {
      roundingGap += r.gapPrice;     // arrondis du fournisseur, y compris sur les lignes en écart de quantité
    }
  }

  return {
    lines: results,
    totals: {
      invoiceParsed,
      invoicePrinted: printed,
      readGap,
      reconciles,
      order: orderTotal,
      gap: round2(invoiceParsed - orderTotal),
      // Remise globale du pied de facture (négative) et le taux qu'elle représente.
      footerDiscount,
      discountRate: Math.round(discountRate * 10000) / 10000,
    },
    summary: {
      // Ce qu'on réclame : le surcoût de tarif, hors effets de quantité et d'arrondi.
      claimable: round2(claimable),
      // Ce que le fournisseur facture MOINS cher que la commande : à aligner à la
      // baisse (le tarif de référence doit suivre), jamais à réclamer.
      inOurFavour: round2(inOurFavour),
      minorGap: round2(minorGap),
      roundingGap: round2(roundingGap),
      qtyGap: round2(qtyGap),
      extrasGap: round2(extrasGap),
      packagingGap: round2(packagingGap),
      counts: results.reduce((acc, r) => {
        acc[r.verdict] = (acc[r.verdict] || 0) + 1;
        return acc;
      }, {}),
    },
  };
}

/**
 * Toutes les différences entre la facture et la commande, sans exception.
 *
 * Règle posée par Pierre le 25/09/2026 : « toutes différences entre la commande
 * et la facture doivent m'être signalées ». Le seuil et la matérialité ne
 * filtrent donc JAMAIS ce tableau — ils ne servent qu'à décider ce qui part en
 * réclamation et ce qui pèse dans les décomptes. Un manquant, un arrondi de
 * onze centimes, une PLV offerte, un changement de conditionnement : tout
 * remonte, chacun sous son étiquette et avec ce qu'il y a à faire.
 *
 * Ordonné par ce qui coûte de l'argent d'abord, puis par montant décroissant.
 */
const DIFFERENCE_KINDS = {
  qty_price:          { rank: 1,  label: 'Quantité et tarif',     action: 'Ajuster la commande et réclamer le tarif' },
  missing_in_invoice: { rank: 2,  label: 'Commandé, non facturé', action: 'Reliquat ou manquant : vérifier la livraison' },
  qty:                { rank: 3,  label: 'Quantité',              action: 'Ajuster la quantité de la commande' },
  price:              { rank: 4,  label: 'Tarif',                 action: 'Réclamer un avoir, ou aligner le tarif si le prix a changé' },
  not_ordered:        { rank: 5,  label: 'Facturé, non commandé', action: 'Article ajouté : accepter ou contester' },
  shipping:           { rank: 6,  label: 'Frais de port',         action: 'Non prévus à la commande' },
  discount:           { rank: 7,  label: 'Remise de pied',        action: 'Répartie sur le coût réel de chaque ligne' },
  free:               { rank: 8,  label: 'Offert',                action: 'Geste commercial, rien à faire' },
  packaging:          { rank: 9,  label: 'Conditionnement',       action: 'Unités contre packs : même marchandise, même montant' },
  rounding:           { rank: 10, label: 'Arrondi de remise',     action: 'Calcul non arrondi du fournisseur, pas une erreur de tarif' },
  other:              { rank: 11, label: 'Ligne hors produit',    action: 'À qualifier' },
};

function listDifferences(comparison) {
  const lines = (comparison && comparison.lines) || [];
  return lines
    .filter((l) => l.verdict !== 'ok')
    .map((l) => ({
      ...l,
      kindLabel: (DIFFERENCE_KINDS[l.verdict] || {}).label || l.verdict,
      action: (DIFFERENCE_KINDS[l.verdict] || {}).action || null,
    }))
    .sort((a, b) => {
      const ra = (DIFFERENCE_KINDS[a.verdict] || {}).rank || 99;
      const rb = (DIFFERENCE_KINDS[b.verdict] || {}).rank || 99;
      return ra !== rb ? ra - rb : Math.abs(b.gap) - Math.abs(a.gap);
    });
}

module.exports = {
  compareInvoiceToOrder,
  listDifferences,
  DIFFERENCE_KINDS,
  normalizeRef,
  DEFAULT_LINE_THRESHOLD,
};
