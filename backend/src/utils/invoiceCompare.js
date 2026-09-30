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
 *    Deux signes conjoints le prouvent : un rapport de quantités ENTIER (une boîte
 *    contient 2, 5 ou 10 pièces) et un montant qui retombe à 1 % près. GFC facture
 *    20 boîtes de 2 accus à 8,25 € ce qui a été commandé 40 à l'unité à 4,13 € : ni
 *    BMS ni la fiche de référence ne connaissent ce conditionnement, il se déduit.
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

// Les assiettes de remise connues par fournisseur. Module de données pur : le
// moteur reste sans base ni réseau.
const { scopesFor } = require('./discountScopes');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Réf. normalisée pour le rapprochement : casse, espaces, espaces multiples. */
function normalizeRef(ref) {
  return String(ref || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Sur quoi deux lignes se reconnaissent. Par défaut la référence, mais l'appelant
 * peut fournir un `matchKey` — en pratique l'identifiant du produit, quand la
 * référence de la facture et celle de la commande désignent le même article sans
 * se ressembler.
 *
 * Ça arrive pour de bon : 611 lignes de commande (3 % du total) portent le SKU
 * interne au lieu d'une référence fournisseur, parce que BMS n'en avait pas. Les
 * rapprocher sur la chaîne de caractères fabriquerait une fausse paire
 * « commandé non facturé » + « facturé non commandé » qui se compensent.
 *
 * La référence affichée, elle, reste celle du document : `matchKey` ne sert qu'à
 * apparier.
 */
function matchKeyOf(line) {
  return normalizeRef(line && line.matchKey ? line.matchKey : line && line.ref);
}

/**
 * Regroupe les lignes par réf. normalisée : un même article peut apparaître sur
 * plusieurs lignes (deux lots, deux prix), et c'est le cumul qui se compare à la
 * commande. Les lignes hors produit (port, remise de pied) ne sont jamais groupées.
 */
function groupByRef(lines) {
  const map = new Map();
  for (const line of lines) {
    const key = matchKeyOf(line);
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
/**
 * Les lignes qu'une remise vise réellement, ou null si elle est générale.
 *
 * Une promotion nomme souvent son périmètre dans son libellé : « PACK IMP 1€
 * 10ML » ne concerne que les 10 ml. On ne retient ce ciblage que s'il nomme un
 * conditionnement ET qu'il trouve des lignes — sinon on retombe sur une remise
 * générale, qui reste le cas le plus fréquent (Cosmer, GFC, Cloud Vapor, LVP).
 */
function linesTargetedBy(discountLine, productLines, supplierCode) {
  // Renseigné quand c'est une règle nommée qui a tranché : l'écran doit pouvoir
  // dire « −20 % sur les Vaporesso » plutôt qu'une moyenne par pièce, qui n'a
  // aucun sens quand les lignes visées n'ont pas le même prix.
  linesTargetedBy.derniereRegle = null;
  // 1. Une règle connue pour ce fournisseur, VÉRIFIÉE par la somme qu'elle
  //    produit. Si elle ne retombe pas sur la remise imprimée, on ne s'en sert
  //    pas : la promotion a changé, et une règle périmée vaut moins qu'une
  //    répartition générale.
  for (const regle of scopesFor(supplierCode)) {
    const vises = productLines.filter((r) => regle.covers(r.label || ''));
    if (vises.length === 0) continue;

    const brut = vises.reduce((acc, r) => acc + r.invoicedTotal, 0);
    const attendu = brut * regle.rate;
    const imprime = Math.abs(discountLine.invoicedTotal);
    const tolerance = Math.max(0.10, imprime * 0.01);
    if (Math.abs(attendu - imprime) <= tolerance) {
      linesTargetedBy.derniereRegle = regle;
      return vises;
    }
  }

  // 2. À défaut, le conditionnement nommé dans le libellé (« PACK IMP 1€ 10ML »).
  const volumes = String(discountLine.label || '').match(/\d+\s*ML\b/gi);
  if (!volumes) return null;

  const motifs = [...new Set(volumes.map((v) => v.replace(/\s+/g, '').toUpperCase()))]
    .map((v) => new RegExp(`\\b${v.replace('ML', '')}\\s*ML\\b`, 'i'));

  const cibles = productLines.filter((r) => motifs.some((re) => re.test(r.label || '')));
  return cibles.length > 0 ? cibles : null;
}

/**
 * L'assiette qu'une remise ANNONCE, quand son libellé porte un taux.
 *
 * « Remise 20% sur produits spécifiques » imprimée à 5,92 € ne peut porter que
 * sur 29,58 € de marchandise. Quand ce n'est pas le total des produits, le
 * document PROUVE que la remise ne vise qu'une partie de la facture — et ne dit
 * pas laquelle. C'est une information, pas une conjecture : on la lit.
 */
function impliedBaseOf(discountLine) {
  const m = String(discountLine.label || '').match(/(\d{1,2}(?:[.,]\d+)?)\s*%/);
  if (!m) return null;
  const rate = parseFloat(m[1].replace(',', '.')) / 100;
  if (!(rate > 0) || rate >= 1) return null;
  return { rate, base: round2(Math.abs(discountLine.invoicedTotal) / rate) };
}

function compareInvoiceToOrder({ invoice, order, options = {} }) {
  const threshold = Number.isFinite(options.lineThreshold)
    ? options.lineThreshold
    : DEFAULT_LINE_THRESHOLD;
  // Le document est-il censé reprendre toute la commande ? Une facture, oui ;
  // un avoir, non.
  const expectFullOrder = options.expectFullOrder !== false;

  const invoiceLines = invoice?.lines || [];
  const orderLines = order?.lines || [];

  const productLines = invoiceLines.filter((l) => (l.kind || 'product') === 'product');
  const otherLines = invoiceLines.filter((l) => (l.kind || 'product') !== 'product');

  const invoiceByRef = groupByRef(productLines);
  const orderByRef = new Map(orderLines.map((l) => [matchKeyOf(l), l]));

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
    // Un conditionnement se reconnaît à DEUX signes conjoints : un rapport de
    // quantités entier (une boîte contient 2, 5 ou 10 pièces, jamais 1,37), et
    // un montant de ligne qui retombe. Exiger que l'écart tienne sous 0,10 €
    // était trop rigide : chez GFC, 40 accus commandés à 4,13 € contre 20
    // boîtes de 2 facturées 8,25 € laissent 0,20 € d'arrondi sur 165 € — et la
    // ligne ressortait en « quantité ET tarif », avec 82,40 € annoncés
    // réclamables et 82,60 € de manquants. Deux chiffres inventés par la
    // comparaison de deux unités différentes.
    //
    // La tolérance devient donc relative au montant (1 %), avec le seuil absolu
    // comme plancher. Le rapport entier reste indispensable : sans lui, une
    // vraie erreur de quantité dont le prix compenserait par hasard passerait
    // pour un conditionnement.
    const packFactor = (() => {
      if (!packRatio || !Number.isFinite(packRatio) || packRatio <= 0) return null;
      const f = packRatio > 1 ? packRatio : 1 / packRatio;
      const rounded = Math.round(f);
      return rounded >= 2 && Math.abs(f - rounded) < 0.01 ? rounded : null;
    })();
    const packTolerance = Math.max(threshold, Math.abs(expectedTotal) * 0.01);
    const isPackaging = qtyDiffers
      && (Math.abs(gap) < threshold || (packFactor !== null && Math.abs(gap) <= packTolerance));

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
      // Rapport de conditionnement quand les deux ne comptent pas dans la même
      // unité, et le facteur entier qui s'en déduit (« boîte de 2 »).
      packRatio,
      packFactor,
      // Conditionnement BMS de la ligne de commande. Indispensable pour écrire un
      // tarif : `supplier_refs.pack_price` est le prix d'un pack de `pack_qty`
      // pièces, et confondre prix de pack et prix unitaire a déjà coûté deux
      // bugs (Mozambique à 1,34 € au lieu de 13,40 €).
      orderPackQty: Number(ord.packQty) || 1,
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
  //
  //    Sauf quand le document ne PRÉTEND PAS couvrir la commande. Un avoir
  //    corrige une facture, il ne la remplace pas : confronté aux 25 lignes de
  //    la commande, l'avoir JoshNoa RV3/2026/02731 en produisait 25 fausses
  //    « commandé non facturé » et un écart de −1 671,94 € pour un document de
  //    13,80 €.
  for (const ord of expectFullOrder ? orderLines : []) {
    if (invoiceByRef.has(matchKeyOf(ord))) continue;
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
  const remises = results.filter((r) => r.verdict === 'discount');
  const produits = results.filter((r) => !['discount', 'shipping', 'other'].includes(r.verdict));

  const footerDiscount = round2(remises.reduce((acc, r) => acc + r.invoicedTotal, 0));
  const productTotal = round2(produits.reduce((acc, r) => acc + r.invoicedTotal, 0));
  const discountRate = footerDiscount < 0 && productTotal > 0
    ? Math.abs(footerDiscount) / productTotal
    : 0;

  // Chaque remise a son ASSIETTE. Sur la facture e.tasty FA082519/2026, les deux
  // promotions ne visent pas les mêmes articles :
  //
  //     PACK IMP 1€ 10ML       255,50 €  sur 730 pièces de 10 ml  → 0,35 €/pièce
  //     PACK IMP 80 PRDS 50ML  288,00 €  sur 160 pièces de 50 ml  → 1,80 €/pièce
  //
  // Étalées ensemble au taux global de 29,9 %, elles donnaient 0,95 € pour un
  // 10 ml facturé 1,00 € et 3,65 € pour un 50 ml facturé 3,40 € : deux coûts de
  // revient faux, et des lignes présentées comme surfacturées alors qu'elles
  // sont payées SOUS le prix commandé.
  const remisePar = new Map();       // toutes remises confondues → coût réel
  const remiseCibleePar = new Map(); // remises CIBLÉES seulement → plafond
  for (const d of remises) {
    const visees = linesTargetedBy(d, produits, options.supplierCode);
    const regle = linesTargetedBy.derniereRegle;

    // UNE REMISE QU'ON NE SAIT PAS IMPUTER N'EST IMPUTÉE À PERSONNE.
    //
    // Sur LIPS FAC/2026/04474, « Remise 20% sur produits spécifiques » vaut
    // 5,92 € : à 20 %, elle porte sur 29,58 € de marchandise, pas sur les
    // 223,76 € de la facture. L'étaler au prorata donnait 1,1999 € la pièce sur
    // une ligne facturée 1,2325 € — un prix que personne n'a payé, sur une ligne
    // que la promotion ne visait peut-être même pas. Deux sous-ensembles de la
    // facture font exactement 29,58 € : le document ne tranche pas, nous non
    // plus. Le montant reste au pied, visible et non réparti.
    //
    // La répartition au prorata reste la règle quand RIEN ne prouve le
    // contraire — c'est le cas de Cosmer, GFC, Revolute et Cloud Vapor, dont les
    // remises de pied n'annoncent aucun taux et sont bel et bien globales.
    const annonce = impliedBaseOf(d);
    if (!visees && annonce
        && Math.abs(annonce.base - productTotal) > Math.max(0.10, productTotal * 0.01)) {
      d.scope = {
        targeted: false,
        unallocated: true,
        rate: annonce.rate,
        impliedBase: annonce.base,
        lines: 0,
        units: 0,
        perUnit: null,
        unitCost: null,
        ruleName: null,
        ruleNote: null,
        ruleRate: null,
      };
      continue;
    }

    const cibles = visees || produits;
    const assiette = round2(cibles.reduce((acc, r) => acc + r.invoicedTotal, 0));
    if (assiette <= 0) continue;
    for (const r of cibles) {
      const part = Math.abs(d.invoicedTotal) * (r.invoicedTotal / assiette);
      remisePar.set(r, (remisePar.get(r) || 0) + part);
      if (visees) remiseCibleePar.set(r, (remiseCibleePar.get(r) || 0) + part);
    }

    // De quoi expliquer la promotion à l'écran : sur combien de pièces elle
    // porte, et le prix réellement payé quand toutes ses cibles y arrivent au
    // même. C'est la réponse à « d'où sort ce prix ».
    //
    // Les lignes à 0 € sont écartées du décompte : une remise au prorata du
    // montant ne leur donne rien, mais les compter gonflait l'assiette affichée.
    // Sur la facture e.tasty, les 800 pièces de 10 ml OFFERTES portaient la
    // promotion « 1€ 10ML » à 1530 pièces et 0,17 € la pièce, au lieu de 730
    // pièces et 0,35 €.
    const payantes = cibles.filter((r) => r.invoicedTotal > 0);
    const pieces = payantes.reduce((acc, r) => acc + (Number(r.qtyInvoiced) || 0), 0);
    const couts = [...new Set(payantes
      .filter((r) => r.invoicedUnitPrice !== null)
      .map((r) => Math.round((r.invoicedUnitPrice - Math.abs(d.invoicedTotal) * (r.invoicedTotal / assiette) / (r.qtyInvoiced || 1)) * 100)))];
    d.scope = {
      targeted: Boolean(visees),
      lines: payantes.length,
      units: pieces,
      // Une remise « à la pièce » ne veut dire quelque chose que si toutes les
      // lignes visées reçoivent le MÊME montant par pièce. Chez LVP, RSPV20 est
      // un pourcentage sur des articles de prix très différents : annoncer
      // « −1,20 € la pièce » sur 74 pièces n'apprenait rien et induisait en
      // erreur. On ne le donne donc que lorsque c'est vrai.
      perUnit: couts.length === 1 && pieces > 0 ? round2(Math.abs(d.invoicedTotal) / pieces) : null,
      unitCost: couts.length === 1 ? couts[0] / 100 : null,
      // La règle qui a tranché, quand c'en est une : de quoi l'écrire en clair.
      ruleName: regle ? regle.name : null,
      ruleNote: regle ? regle.note : null,
      ruleRate: regle ? regle.rate : null,
    };
  }

  for (const r of results) {
    const remise = remisePar.get(r) || 0;
    r.discountShare = round2(remise);
    r.effectiveUnitCost = r.invoicedUnitPrice === null
      ? null
      : r.invoicedUnitPrice - (r.qtyInvoiced ? remise / r.qtyInvoiced : 0);
  }

  // ─── Ce que la remise de pied explique déjà ───────────────────────────────
  // Cas LVP F2609287196 (28/09/2026), le plus retors rencontré : la commande
  // porte le prix NET (4,50 €) et la facture le prix BRUT (5,62 €), la remise
  // « RSPV20 » n'apparaissant qu'au pied pour 93,55 €. Ligne à ligne, tout
  // paraît surfacturé — l'écran annonçait 75,42 € réclamables alors que le vrai
  // écart est de 0,43 €. Réclamer là-dessus, c'est écrire au commercial pour
  // une remise qu'il a déjà accordée.
  //
  // On impute donc la remise aux lignes dont le prix dépasse celui commandé, au
  // prorata de leur dépassement et PLAFONNÉE à ce dépassement. Ce qui reste
  // après imputation est le seul écart réellement dû. Le plafond compte : sans
  // lui, une remise plus grosse que les écarts créerait des avoirs imaginaires.
  const overpriced = results.filter((r) => r.gapPrice > 0
    && (r.verdict === 'price' || r.verdict === 'qty_price'));
  const overpricedTotal = round2(overpriced.reduce((s, r) => s + r.gapPrice, 0));
  let discountApplied = 0;
  if (footerDiscount < 0 && overpricedTotal > 0) {
    const pool = Math.min(Math.abs(footerDiscount), overpricedTotal);
    let left = pool;
    overpriced.forEach((r, i) => {
      // La dernière ligne reçoit le solde : arrondir chaque part séparément
      // ferait « expliquer » 93,57 € par une remise de 93,55 €, et rien n'est
      // plus douteux qu'un total qui dépasse ce qu'il répartit.
      //
      // Une promotion CIBLÉE ne peut pas expliquer plus que ce qu'elle a donné à
      // cette ligne : celle qui ne vise que les 10 ml n'explique rien sur un
      // 50 ml. Une remise GÉNÉRALE, elle, reste volontairement concentrée sur
      // les lignes en dépassement — c'est ce qui ramène LVP à 0 € réclamable.
      const plafond = remiseCibleePar.has(r) ? round2(remiseCibleePar.get(r)) : Infinity;
      const brut = i === overpriced.length - 1
        ? round2(left)
        : Math.min(round2(pool * (r.gapPrice / overpricedTotal)), round2(left));
      const part = Math.min(brut, plafond, r.gapPrice);
      r.explainedByDiscount = part;
      r.residualGapPrice = round2(r.gapPrice - part);
      left = round2(left - part);
      discountApplied += part;
    });
  }
  for (const r of results) {
    if (r.explainedByDiscount === undefined) {
      r.explainedByDiscount = 0;
      r.residualGapPrice = r.gapPrice;
    }
  }

  // ─── Une ligne payée SOUS le prix commandé n'est pas une anomalie ─────────
  // Sur la facture e.tasty FA082519/2026, les 10 ml sont commandés à 1,29 €,
  // facturés 1,35 € au brut, et ramenés à 1,00 € par la promotion « PACK IMP 1€
  // 10ML ». L'écran les affichait en rouge, « Tarif +3,00 € », avec pour
  // consigne « Réclamer un avoir » — sur des articles payés 29 centimes MOINS
  // cher que commandé. Réclamer là-dessus, c'est se ridiculiser.
  for (const r of results) {
    if (r.verdict !== 'price') continue;
    // Uniquement une ligne FACTURÉE PLUS CHER qu'une remise a ensuite ramenée
    // sous le prix commandé. Une ligne simplement moins chère (JoshNoa
    // josh00009356 : 6,95 € contre 7,00 €) reste un écart de tarif à voir.
    if (!(r.gapPrice > 0) || !(r.discountShare > 0)) continue;
    if (Math.abs(r.residualGapPrice) > threshold) continue;
    if (r.effectiveUnitCost === null || r.expectedUnitPrice === null) continue;
    if (r.effectiveUnitCost <= r.expectedUnitPrice + 0.005) {
      r.verdict = 'ok';
      r.material = false;
    }
  }

  // ─── Totaux ───────────────────────────────────────────────────────────────
  const invoiceParsed = round2(invoiceLines.reduce((s, l) => s + (Number(l.lineTotalHt) || 0), 0));
  // Quand le document ne couvre pas toute la commande (un avoir), la confronter
  // au total de la commande n'a aucun sens : l'avoir JoshNoa de 13,80 € affichait
  // « écart −1 671,94 € » en face des 1 658,14 € de la commande S309145. On ne
  // retient alors que les lignes de commande que le document reprend.
  const comptees = expectFullOrder
    ? orderLines
    : orderLines.filter((l) => invoiceByRef.has(matchKeyOf(l)));
  const orderTotal = round2(comptees.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0));
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
    // On ne réclame que le RÉSIDU : ce qu'une remise de pied explique déjà a
    // été accordé, le réclamer serait demander deux fois la même chose.
    if (isPrice && r.material && Math.abs(r.residualGapPrice) >= threshold) {
      if (r.residualGapPrice > 0) claimable += r.residualGapPrice;
      else inOurFavour += r.residualGapPrice;
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
      // Orphelins de part et d'autre dont les montants se répondent : très
      // probablement les mêmes articles, avec une référence que le PDF a rendue
      // illisible. Affirmer « facturé non commandé » serait faux.
      ...orphanBalance(results, threshold),
      // Part des écarts de tarif déjà couverte par la remise de pied.
      explainedByDiscount: round2(discountApplied),
      hasFooterDiscount: footerDiscount < 0,
      counts: results.reduce((acc, r) => {
        acc[r.verdict] = (acc[r.verdict] || 0) + 1;
        return acc;
      }, {}),
    },
  };
}

/**
 * Les orphelins des deux côtés se répondent-ils ?
 *
 * Quand une référence est illisible — le saut de page d'une facture Curieux
 * coupe « SPE-MACA-50-00MG » en deux et place la seconde moitié après la
 * désignation — la ligne ne retrouve pas sa commande. Elle ressort alors en
 * « facturé non commandé », face à son jumeau « commandé non facturé » : deux
 * fausses anomalies pour un article conforme.
 *
 * On ne peut pas toujours les rapprocher (deux articles de même quantité et de
 * même montant sont indiscernables). Mais si les deux groupes s'équilibrent au
 * centime, on peut le DIRE, au lieu d'annoncer un manquant et un article ajouté
 * qui n'existent ni l'un ni l'autre.
 */
function orphanBalance(results, threshold) {
  const factures = results.filter((r) => r.verdict === 'not_ordered');
  const commandes = results.filter((r) => r.verdict === 'missing_in_invoice');
  if (factures.length === 0 || commandes.length === 0) return { orphansLikelySame: false };

  const plus = factures.reduce((s, r) => s + r.gap, 0);
  const moins = commandes.reduce((s, r) => s + r.gap, 0);
  const ecart = round2(plus + moins);
  return {
    orphansLikelySame: Math.abs(ecart) <= Math.max(threshold, Math.abs(plus) * 0.01),
    orphanCount: factures.length + commandes.length,
    orphanAmount: round2(plus),
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

/**
 * Les écarts à porter à l'écran.
 *
 * La REMISE DE PIED n'en fait pas partie (décision du 28/09/2026). Ce n'est pas
 * une anomalie : le fournisseur facture au tarif brut convenu puis déduit la
 * remise négociée. Sur la facture Cosmer #FA018728, les douze lignes tombaient
 * au centime près sur la commande et la seule « différence » affichée était la
 * remise de 343,64 € — un gain, présenté comme un problème.
 *
 * Le montant reste disponible dans `totals.footerDiscount`, et il est réparti au
 * prorata sur chaque ligne pour que le réclamable soit calculé sur le coût réel.
 */
function listDifferences(comparison) {
  const lines = (comparison && comparison.lines) || [];
  return lines
    .filter((l) => l.verdict !== 'ok' && l.verdict !== 'discount')
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

/**
 * Les tarifs à corriger, déduits de ce que la facture a RÉELLEMENT coûté.
 *
 * C'est la réponse à « quels prix dois-je mettre dans BMS ». Le tarif de
 * référence d'une commande est ce qu'on croyait payer ; le coût réel est ce
 * qu'on a payé, promotions de pied comprises. Sur la facture e.tasty
 * FA082519/2026, BMS annonce 1,29 € le 10 ml et 5,20 € le 50 ml quand la
 * facture, une fois ses deux promotions imputées, donne 1,00 € et 3,40 €.
 *
 * Les lignes de conditionnement sont écartées : leur prix unitaire n'est pas
 * comparable (un carton de dix contre dix pièces), et l'aligner écrirait un
 * prix de pack dans une case de prix unitaire.
 */
function listTariffUpdates(comparison, options = {}) {
  const seuil = Number.isFinite(options.threshold) ? options.threshold : 0.005;
  const hors = ['packaging', 'missing_in_invoice', 'free', 'not_ordered', 'shipping', 'discount', 'other'];

  return (comparison?.lines || [])
    .filter((l) => l.ref
      && !hors.includes(l.verdict)
      && l.qtyInvoiced > 0
      && l.expectedUnitPrice !== null
      && l.effectiveUnitCost !== null
      && Math.abs(l.effectiveUnitCost - l.expectedUnitPrice) > seuil)
    .map((l) => ({
      ref: l.ref,
      label: l.label,
      qty: l.qtyInvoiced,
      // Le conditionnement auquel ce prix se rapporte : les quantités concordent
      // (les lignes de conditionnement sont écartées), donc l'unité facturée est
      // l'unité de la commande BMS, c'est-à-dire un pack de `orderPackQty`.
      packQty: l.orderPackQty || 1,
      currentPrice: round2(l.expectedUnitPrice),
      // Deux décimales ne suffisent pas toujours : un prix fournisseur se
      // négocie au millième (cf. LCA 5,42633 €).
      realPrice: Math.round(l.effectiveUnitCost * 10000) / 10000,
      discountShare: l.discountShare || 0,
      delta: Math.round((l.effectiveUnitCost - l.expectedUnitPrice) * 10000) / 10000,
    }))
    .sort((a, b) => Math.abs(b.delta * b.qty) - Math.abs(a.delta * a.qty));
}

/**
 * Le tableau UNIQUE de l'écran de contrôle : une ligne par sujet, avec son motif.
 *
 * Il y avait deux tableaux, et une ligne dont le seul reproche était le tarif
 * figurait dans les deux — en haut avec son bouton de tarif, en bas avec
 * « Réclamer un avoir ». On réunit donc les écarts et les tarifs relevés, et
 * chaque ligne porte ce qui l'amène là : un prix qui a bougé, une quantité qui
 * ne correspond pas, ou les deux.
 *
 * Une ligne peut n'être QUE dans les tarifs : le prix payé diffère de celui de
 * BMS sans que ce soit une anomalie — une promotion l'a fait baisser. Elle
 * mérite le tableau, puisqu'il y a un tarif à retenir.
 */
function listControlRows(comparison) {
  const ecarts = listDifferences(comparison);
  const tarifs = listTariffUpdates(comparison);
  const parRef = new Map(tarifs.map((t) => [t.ref, t]));

  const rows = ecarts.map((d) => {
    const t = d.ref ? parRef.get(d.ref) : null;
    if (t) parRef.delete(d.ref);
    return { ...d, tariff: t || null };
  });

  // Les tarifs qu'aucun écart ne portait : prix payé différent, mais conforme.
  for (const t of parRef.values()) {
    rows.push({
      ref: t.ref,
      label: t.label,
      verdict: 'price',
      kindLabel: DIFFERENCE_KINDS.price.label,
      action: DIFFERENCE_KINDS.price.action,
      material: false,
      qtyOrdered: t.qty,
      qtyInvoiced: t.qty,
      expectedUnitPrice: t.currentPrice,
      invoicedUnitPrice: t.realPrice,
      effectiveUnitCost: t.realPrice,
      gap: round2(t.delta * t.qty),
      gapPrice: round2(t.delta * t.qty),
      gapQty: 0,
      tariff: t,
    });
  }

  return rows.sort((a, b) => {
    const ra = (DIFFERENCE_KINDS[a.verdict] || {}).rank || 99;
    const rb = (DIFFERENCE_KINDS[b.verdict] || {}).rank || 99;
    return ra !== rb ? ra - rb : Math.abs(b.gap) - Math.abs(a.gap);
  });
}

module.exports = {
  listControlRows,
  listTariffUpdates,
  compareInvoiceToOrder,
  matchKeyOf,
  listDifferences,
  DIFFERENCE_KINDS,
  normalizeRef,
  DEFAULT_LINE_THRESHOLD,
};
