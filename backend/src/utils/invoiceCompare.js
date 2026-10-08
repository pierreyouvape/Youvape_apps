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
  // Renseigné quand c'est la déduction arithmétique qui a tranché : chaque
  // ligne reçoit alors son propre surcoût, pas une part au prorata.
  linesTargetedBy.parEcart = false;
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
  if (volumes) {
    const motifs = [...new Set(volumes.map((v) => v.replace(/\s+/g, '').toUpperCase()))]
      .map((v) => new RegExp(`\\b${v.replace('ML', '')}\\s*ML\\b`, 'i'));

    const cibles = productLines.filter((r) => motifs.some((re) => re.test(r.label || '')));
    if (cibles.length > 0) return cibles;
  }

  // 3. Enfin, la déduction arithmétique : les lignes dont la remise rembourse
  //    exactement la hausse de tarif.
  const compensees = linesCompensatedBy(discountLine, productLines);
  if (compensees) {
    linesTargetedBy.parEcart = true;
    return compensees;
  }
  return null;
}

/**
 * Les lignes surfacturées dont la remise compense, à elle seule, le surcoût.
 *
 * e.tasty FA083648/2026 : Opali et Serpentron (10 ml, 60 pièces) commandés
 * 1,00 €, facturés 1,35 € — 21,00 € de trop — et une remise « chevallier » de
 * 20,83 € (25 € TTC) au pied, sans taux ni conditionnement dans son libellé.
 * Étalée au prorata des sept lignes, elle donnait 1,236 € la pièce sur les
 * 10 ml et faisait passer sous leur prix des 100 ml facturés au tarif exact :
 * deux coûts de revient faux, et un tarif de 1,236 € proposé à l'application.
 *
 * Le document ne nomme pas l'assiette, mais l'arithmétique la désigne : UN SEUL
 * sous-ensemble des lignes surfacturées a un surcoût qui retombe sur la remise.
 * Si plusieurs y retombent, le document ne tranche pas et nous non plus — la
 * remise reste générale. Même chose quand aucune ligne n'est surfacturée
 * (Cosmer, GFC : lignes au prix commandé, remise vraiment globale).
 */
const MAX_COMPENSATION_CANDIDATES = 14;

function linesCompensatedBy(discountLine, productLines) {
  const montant = Math.abs(Number(discountLine.invoicedTotal) || 0);
  if (!(montant > 0)) return null;

  const candidats = productLines.filter((r) => r.gapPrice > UNIT_ROUNDING_TOLERANCE
    && (r.verdict === 'price' || r.verdict === 'qty_price'));
  if (candidats.length === 0 || candidats.length > MAX_COMPENSATION_CANDIDATES) return null;

  // Même tolérance que la vérification d'une règle nommée : une remise TTC
  // ramenée au HT ne tombe pas au centime (25 € TTC = 20,83 € HT).
  const tolerance = Math.max(0.10, montant * 0.01);
  const trouves = [];
  for (let masque = 1; masque < (1 << candidats.length); masque++) {
    let somme = 0;
    for (let i = 0; i < candidats.length; i++) {
      if (masque & (1 << i)) somme += candidats[i].gapPrice;
    }
    if (Math.abs(somme - montant) <= tolerance) {
      trouves.push(masque);
      if (trouves.length > 1) return null;
    }
  }
  if (trouves.length !== 1) return null;
  return candidats.filter((_, i) => trouves[0] & (1 << i));
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
  // Un avoir ne refacture pas la marchandise : chaque ligne est une CORRECTION,
  // en déduction. La confronter au montant commandé additionnait les deux —
  // l'avoir JoshNoa RV3/2026/02877 (−3,46 €, extourne d'un écart de tarif sur
  // 5 concentrés commandés à 4,50 €) affichait « écart −25,96 € », soit
  // −3,46 € − 22,50 €. L'écart d'une ligne d'avoir est son montant, rien d'autre.
  const creditNote = options.creditNote === true || invoice?.docType === 'credit_note';

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

    if (creditNote) {
      results.push({
        ref: (ord && ord.ref) || inv.ref,
        label: inv.label || (ord && ord.productName) || null,
        verdict: 'credit',
        // Rien à faire : l'avoir est déjà le geste du fournisseur.
        material: false,
        qtyOrdered: ord ? Number(ord.qty) || 0 : null,
        qtyInvoiced: inv.qty,
        expectedUnitPrice: ord ? Number(ord.price) || 0 : null,
        invoicedUnitPrice,
        expectedTotal: 0,
        invoicedTotal,
        gapQty: 0,
        gapPrice: 0,
        gap: invoicedTotal,
      });
      continue;
    }

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

    // CONDITIONNEMENT AVEC UN ÉCART DE TARIF PAR-DESSUS. Le rapport des quantités
    // est entier, mais le montant ne retombe pas : les deux côtés comptent LA MÊME
    // MARCHANDISE dans des unités différentes, et il y a une hausse de prix en plus.
    //
    // Facture JoshNoa V3/2026/37644 (02/10/2026), ligne josh00012308 : 5 pièces
    // commandées à 4,50 €, facturées « 1 × 25,96 € (5 pièces) ». L'écart réel vaut
    // 3,46 €. Comparé pièce à pack, l'écran annonçait 21,46 € réclamables et 18,00 €
    // de manquants — deux chiffres inventés par la comparaison de deux unités, et le
    // message au commercial aurait demandé un avoir de 21,46 €.
    //
    // Il n'y a donc RIEN de manquant ici, et tout l'écart est un écart de tarif, qui
    // ne se lit qu'À LA PIÈCE : c'est la seule unité que les deux côtés partagent.
    const unitMismatch = !isPackaging && packFactor !== null;
    const pieces = unitMismatch ? Math.max(inv.qty, qtyOrdered) : inv.qty;
    const expectedPerPiece = unitMismatch && pieces > 0 ? expectedTotal / pieces : expectedUnitPrice;
    const invoicedPerPiece = unitMismatch && pieces > 0 ? invoicedTotal / pieces : invoicedUnitPrice;

    // Tarif réellement différent, ou simple arrondi du fournisseur ? Ça se lit sur
    // l'unité (cf. règle 4), jamais sur le montant de la ligne.
    const unitGap = invoicedPerPiece === null ? 0 : invoicedPerPiece - expectedPerPiece;
    const isRounding = Math.abs(unitGap) < UNIT_ROUNDING_TOLERANCE;
    const priceDiffers = !isRounding && Math.abs(unitMismatch ? gap : gapPrice) >= 0.005;

    let verdict;
    if (isPackaging) verdict = 'packaging';
    // Pas « Quantité et tarif » : la quantité est juste, c'est l'unité qui diffère.
    else if (unitMismatch) verdict = priceDiffers ? 'price' : 'rounding';
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
      // Les deux côtés ne comptent pas dans la même unité, et il reste un écart de
      // tarif par-dessus : tout ce qui se dit de cette ligne — l'écart, le message
      // au commercial, le tableau — doit se dire À LA PIÈCE.
      unitMismatch,
      pieces: unitMismatch ? pieces : null,
      piecePriceExpected: unitMismatch ? Math.round(expectedPerPiece * 10000) / 10000 : null,
      piecePriceInvoiced: unitMismatch ? Math.round(invoicedPerPiece * 10000) / 10000 : null,
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
      // n'a pas de sens : les deux se compensent par construction. Quand il reste
      // une hausse de tarif par-dessus, c'est elle qui porte tout l'écart — la
      // quantité, elle, est la bonne, à l'unité de compte près.
      gapQty: isPackaging || unitMismatch ? 0 : gapQty,
      gapPrice: isPackaging || unitMismatch ? gap : gapPrice,
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
    const parEcart = linesTargetedBy.parEcart;

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

    // RÉPARTITION AU CENTIME. Les parts arrondies séparément ne somment pas
    // toujours la remise imprimée : sur LVP F2610287890, les six lignes
    // Vaporesso reçoivent 56,54 € d'une remise de 56,56 €. Deux centimes, et
    // l'écart de chaque ligne ne retombe plus sur l'écart global affiché en haut
    // de l'écran — or c'est précisément ce qu'on promet à l'acheteur : la somme
    // de la colonne vaut le total. Le reliquat va donc à la plus grosse ligne,
    // celle où il pèse le moins.
    const montant = Math.abs(d.invoicedTotal);

    // Remise déduite de l'arithmétique : chaque ligne reçoit EXACTEMENT son
    // surcoût et retombe sur le prix commandé (1,00 € pour les 10 ml de
    // FA083648, pas 1,0028 €). La poussière entre la remise et la somme des
    // surcoûts (0,17 € : 25 € TTC contre 21,00 € HT) reste au pied, sur la ligne
    // de remise, au lieu de fabriquer un tarif à quatre décimales qui
    // reviendrait à chaque facture.
    if (parEcart) {
      let impute = 0;
      for (const r of cibles) {
        remisePar.set(r, round2((remisePar.get(r) || 0) + r.gapPrice));
        remiseCibleePar.set(r, round2((remiseCibleePar.get(r) || 0) + r.gapPrice));
        impute += r.gapPrice;
      }
      d.allocated = round2(impute);
      const pieces = cibles.reduce((acc, r) => acc + (Number(r.qtyInvoiced) || 0), 0);
      d.scope = {
        targeted: true,
        deduced: true,
        lines: cibles.length,
        units: pieces,
        perUnit: null,
        unitCost: null,
        ruleName: null,
        ruleNote: `le surcoût de ${cibles.map((r) => r.ref || r.label).join(', ')}, ramenés au prix commandé`,
        ruleRate: null,
      };
      continue;
    }

    const ordre = [...cibles].sort((a, b) => a.invoicedTotal - b.invoicedTotal);
    let reste = round2(montant);
    ordre.forEach((r, i) => {
      const part = i === ordre.length - 1
        ? round2(reste)
        : round2(montant * (r.invoicedTotal / assiette));
      remisePar.set(r, round2((remisePar.get(r) || 0) + part));
      if (visees) remiseCibleePar.set(r, round2((remiseCibleePar.get(r) || 0) + part));
      reste = round2(reste - part);
    });
    // Ce qu'on a su imputer : le reste d'une remise reste au pied du document.
    d.allocated = round2(montant);

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
    // L'ÉCART RÉEL DE LA LIGNE : ce qu'elle a coûté, remise de pied comprise,
    // moins ce que la commande prévoyait. C'est le seul chiffre qu'un acheteur
    // puisse lire ligne à ligne sans se tromper, et le seul qui s'additionne.
    //
    // `gap` compare le montant BRUT de la facture au montant de la commande.
    // Chez LVP, qui facture au brut et ne retire ses −20 % qu'au pied, ça
    // donnait « +12,30 € » sur une ligne dont l'écart unitaire valait
    // −0,0044 € : deux chiffres justes, contradictoires à l'œil, et une
    // question à chaque facture (F2610287890, 01/10/2026).
    r.netGap = round2(r.gap - r.discountShare);
  }

  // Une remise entièrement imputée n'est plus un écart : elle vit désormais dans
  // le `netGap` des lignes qu'elle a payées. Ce qui n'a pas pu être imputé
  // (périmètre inconnu, cf. LIPS) reste porté par la ligne de remise elle-même,
  // pour que la somme des écarts affichés vaille toujours l'écart global.
  for (const d of remises) {
    d.netGap = round2(d.gap + (d.allocated || 0));
  }

  // ─── Ce que la remise de pied explique déjà ───────────────────────────────
  // Cas LVP F2609287196 (28/09/2026), le plus retors rencontré : la commande
  // porte le prix NET (4,50 €) et la facture le prix BRUT (5,62 €), la remise
  // « RSPV20 » n'apparaissant qu'au pied pour 93,55 €. Ligne à ligne, tout
  // paraît surfacturé — l'écran annonçait 75,42 € réclamables alors que le vrai
  // écart est de 0,43 €. Réclamer là-dessus, c'est écrire au commercial pour
  // une remise qu'il a déjà accordée.
  //
  // On impute donc la remise aux lignes dont le prix dépasse celui commandé,
  // PLAFONNÉE à ce dépassement. Ce qui reste après imputation est le seul écart
  // réellement dû. Le plafond compte : sans lui, une remise plus grosse que les
  // écarts créerait des avoirs imaginaires.
  //
  // DEUX RÉGIMES, ET NE JAMAIS LES MÉLANGER (corrigé le 01/10/2026) :
  //
  //   • Une remise CIBLÉE n'explique QUE ses propres lignes, à hauteur de ce
  //     qu'elle leur a versé. Une ligne qu'elle ne vise pas n'est pas expliquée
  //     du tout. L'étalement au prorata des dépassements prenait à Pierre et
  //     donnait à Paul : sur LVP F2610287890, il annonçait 3,48 € de résiduel
  //     sur chacune des trois lignes XROS payées AU PRIX COMMANDÉ (elles
  //     partaient telles quelles dans le message au commercial) et « expliquait
  //     par la remise » 1,43 € sur un Dojo, que RSPV20 exclut expressément.
  //
  //   • Une remise GÉNÉRALE, ou dont on n'a pas su lire le périmètre, reste
  //     volontairement concentrée sur les dépassements : c'est ce qui ramène
  //     Cosmer et GFC à 0 € réclamable, et la prudence même — on n'écrit pas au
  //     commercial pour une remise qu'il a peut-être déjà accordée.
  const overpriced = results.filter((r) => r.gapPrice > 0
    && (r.verdict === 'price' || r.verdict === 'qty_price'));
  let discountApplied = 0;
  for (const r of results) {
    r.explainedByDiscount = 0;
    r.residualGapPrice = r.gapPrice;
  }

  for (const r of overpriced) {
    const part = Math.min(round2(remiseCibleePar.get(r) || 0), r.gapPrice);
    if (part <= 0) continue;
    r.explainedByDiscount = round2(part);
    r.residualGapPrice = round2(r.gapPrice - part);
    discountApplied += part;
  }

  // Ce qui n'a pas de périmètre connu : les remises réparties au prorata du
  // montant (régime général) et celles qu'on n'a pas imputées du tout.
  const cibleeTotal = round2([...remiseCibleePar.values()].reduce((s, v) => s + v, 0));
  const sansPerimetre = round2(Math.abs(footerDiscount) - cibleeTotal);
  const residuels = overpriced.filter((r) => r.residualGapPrice > 0);
  const residuelTotal = round2(residuels.reduce((s, r) => s + r.residualGapPrice, 0));
  if (sansPerimetre > 0 && residuelTotal > 0) {
    const pool = Math.min(sansPerimetre, residuelTotal);
    let left = pool;
    residuels.forEach((r, i) => {
      // La dernière ligne reçoit le solde : arrondir chaque part séparément
      // ferait « expliquer » 93,57 € par une remise de 93,55 €, et rien n'est
      // plus douteux qu'un total qui dépasse ce qu'il répartit.
      const brut = i === residuels.length - 1
        ? round2(left)
        : Math.min(round2(pool * (r.residualGapPrice / residuelTotal)), round2(left));
      const part = Math.min(brut, r.residualGapPrice);
      r.explainedByDiscount = round2(r.explainedByDiscount + part);
      r.residualGapPrice = round2(r.residualGapPrice - part);
      left = round2(left - part);
      discountApplied += part;
    });
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
    // À la pièce quand les deux côtés ne comptent pas pareil : comparer un prix de
    // carton à un prix de pièce conclurait n'importe quoi, dans un sens comme dans
    // l'autre.
    const coutReel = r.unitMismatch
      ? (r.invoicedTotal - r.discountShare) / r.pieces
      : r.effectiveUnitCost;
    const prevu = r.unitMismatch ? r.piecePriceExpected : r.expectedUnitPrice;
    if (coutReel <= prevu + 0.005) {
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
  const EXTRA_VERDICTS = ['not_ordered', 'free', 'shipping', 'discount', 'other', 'credit'];

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
      // Un avoir EST l'écart : il ne se retranche pas d'un montant commandé.
      gap: creditNote ? invoiceParsed : round2(invoiceParsed - orderTotal),
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
  credit:             { rank: 8,  label: 'Avoir',                 action: 'Vient en déduction, rien à réclamer' },
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
 *
 * SAUF celle qu'on n'a pas su imputer. Une remise qui ne vit dans l'écart
 * d'aucune ligne doit vivre dans la sienne, sinon la colonne « Écart total » ne
 * somme plus l'écart global — et un tableau dont les lignes ne font pas le
 * total ne sert plus à rien.
 */
/** Un prix à la pièce, au millième quand le centime ne suffit pas (5,192 €). */
function prixPiece(n) {
  const v = Number(n);
  const auMillieme = Math.abs(v * 100 - Math.round(v * 100)) >= 0.05;
  return `${v.toFixed(auMillieme ? 3 : 2).replace('.', ',')} €`;
}

function listDifferences(comparison) {
  const lines = (comparison && comparison.lines) || [];
  return lines
    .filter((l) => l.verdict !== 'ok'
      && (l.verdict !== 'discount' || Math.abs(l.netGap || 0) >= 0.005))
    .map((l) => ({
      ...l,
      kindLabel: (DIFFERENCE_KINDS[l.verdict] || {}).label || l.verdict,
      action: l.verdict === 'discount' && l.scope && l.scope.unallocated
        ? "Périmètre inconnu : non imputée au coût des lignes"
        // Un carton contre des pièces, PLUS une hausse de tarif : dire à quelle
        // unité l'écart se lit, sinon « 4,50 € commandé » en face de
        // « 25,96 € facturé » reste illisible. Le bouton de tarif, lui, écrit le
        // prix de l'unité de commande (cf. `listTariffUpdates`).
        : (l.unitMismatch
          ? `Vendu par ${l.packFactor} : ${prixPiece(l.piecePriceInvoiced)} la pièce facturée `
            + `contre ${prixPiece(l.piecePriceExpected)} commandée — réclamer l'écart, ou aligner le tarif s'il a changé`
          : ((DIFFERENCE_KINDS[l.verdict] || {}).action || null)),
    }))
    .sort((a, b) => {
      const ra = (DIFFERENCE_KINDS[a.verdict] || {}).rank || 99;
      const rb = (DIFFERENCE_KINDS[b.verdict] || {}).rank || 99;
      return ra !== rb ? ra - rb : Math.abs(b.netGap) - Math.abs(a.netGap);
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
  // UN DEMI-DIX-MILLIÈME, depuis que la base tient quatre décimales
  // (widen_price_precision.sql). Le seuil valait 0,005 € quand `pack_price`
  // était un NUMERIC(10,2) : en dessous, il n'y avait rien à écrire, le prix
  // retombait sur le même centime. Ces écarts-là sont pourtant exactement ceux
  // qui reviennent à chaque facture — un 10 ml à 1,45 € remisé à 15 % coûte
  // 1,2325 € contre 1,23 € commandé, soit 0,0025 € : invisible au seuil de
  // 0,005, et « Arrondi de remise » sur la ligne à vie. Sept lignes de LIPS
  // FAC/2026/04474 étaient dans ce cas, sans aucun bouton pour en sortir.
  const seuil = Number.isFinite(options.threshold) ? options.threshold : 0.0005;
  // Un avoir n'est pas un prix d'achat : 3,46 € d'extourne n'est pas le tarif du produit.
  const hors = ['packaging', 'missing_in_invoice', 'free', 'not_ordered', 'shipping', 'discount', 'other', 'credit'];

  // Le coût réel EXPRIMÉ DANS L'UNITÉ DE LA COMMANDE BMS — c'est la seule que
  // `packQty`, `alignTariffs` et `applyTariffs` savent convertir.
  //
  // Quand la facture compte en cartons ce que la commande compte en pièces (ou
  // l'inverse), le prix unitaire FACTURÉ n'est pas dans cette unité : écrire
  // 24,50 € (un carton de 5) dans une case qui attend le prix d'une pièce, c'est
  // le bug Mozambique (1,34 € au lieu de 13,40 €) à l'envers. Le montant de la
  // ligne, lui, est le même des deux côtés : divisé par la quantité COMMANDÉE, il
  // donne le prix de l'unité de commande. JoshNoa V3/2026/38291, josh00045236 :
  // 6 cartons à 24,4967 € pour 30 pièces commandées à 3,92 € → 4,8993 € la pièce.
  // La ligne n'avait aucun bouton, alors que la hausse était un vrai changement
  // de tarif (fin d'une promotion), à retenir et non à réclamer.
  const coutCommande = (l) => (l.unitMismatch
    ? (l.qtyOrdered > 0 && l.invoicedTotal != null
      ? (l.invoicedTotal - (l.discountShare || 0)) / l.qtyOrdered
      : null)
    : l.effectiveUnitCost);

  return (comparison?.lines || [])
    .filter((l) => l.ref
      && !hors.includes(l.verdict)
      && l.qtyInvoiced > 0
      && l.expectedUnitPrice !== null
      && coutCommande(l) !== null
      && Math.abs(coutCommande(l) - l.expectedUnitPrice) > seuil)
    .map((l) => {
      const cout = coutCommande(l);
      return {
        ref: l.ref,
        label: l.label,
        // Une quantité dans l'unité du prix : celle de la commande quand les
        // deux côtés ne comptent pas pareil.
        qty: l.unitMismatch ? l.qtyOrdered : l.qtyInvoiced,
        // Le conditionnement auquel ce prix se rapporte : l'unité de la commande
        // BMS, c'est-à-dire un pack de `orderPackQty`.
        packQty: l.orderPackQty || 1,
        currentPrice: round2(l.expectedUnitPrice),
        // Deux décimales ne suffisent pas toujours : un prix fournisseur se
        // négocie au millième (cf. LCA 5,42633 €).
        realPrice: Math.round(cout * 10000) / 10000,
        discountShare: l.discountShare || 0,
        delta: Math.round((cout - l.expectedUnitPrice) * 10000) / 10000,
      };
    })
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
  const ligneParRef = new Map(((comparison && comparison.lines) || [])
    .filter((l) => l.ref).map((l) => [l.ref, l]));

  const rows = ecarts.map((d) => {
    const t = d.ref ? parRef.get(d.ref) : null;
    if (t) parRef.delete(d.ref);
    return { ...d, tariff: t || null };
  });

  // Les tarifs qu'aucun écart ne portait : prix payé différent, mais conforme.
  for (const t of parRef.values()) {
    const l = ligneParRef.get(t.ref) || {};
    // L'écart de la ligne vient de la ligne, jamais d'un recalcul : `delta × qty`
    // ignore l'effet quantité et ne retomberait pas sur le total de l'écran.
    const netGap = l.netGap != null ? l.netGap : round2(t.delta * t.qty);
    rows.push({
      ref: t.ref,
      label: t.label,
      verdict: 'price',
      kindLabel: DIFFERENCE_KINDS.price.label,
      action: netGap > 0
        ? DIFFERENCE_KINDS.price.action
        : 'Tarif à retenir : cette ligne a coûté moins que la commande',
      material: false,
      qtyOrdered: t.qty,
      qtyInvoiced: t.qty,
      expectedUnitPrice: t.currentPrice,
      invoicedUnitPrice: t.realPrice,
      effectiveUnitCost: t.realPrice,
      discountShare: l.discountShare || 0,
      invoicedTotal: l.invoicedTotal != null ? l.invoicedTotal : null,
      expectedTotal: l.expectedTotal != null ? l.expectedTotal : null,
      gap: l.gap != null ? l.gap : netGap,
      netGap,
      gapPrice: round2(t.delta * t.qty),
      gapQty: 0,
      tariff: t,
    });
  }

  return rows.sort((a, b) => {
    const ra = (DIFFERENCE_KINDS[a.verdict] || {}).rank || 99;
    const rb = (DIFFERENCE_KINDS[b.verdict] || {}).rank || 99;
    return ra !== rb ? ra - rb : Math.abs(b.netGap) - Math.abs(a.netGap);
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
