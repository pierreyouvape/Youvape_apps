/**
 * Rapprochement facture ↔ commande — rejoué sur deux factures réelles du 25/09/2026.
 *
 * Sans dépendance ni base : `node tests/invoiceCompare.test.js` (ou `npm test`).
 *
 * Les deux gabarits sont volontairement opposés, parce qu'ils cassent chacun une
 * hypothèse naïve différente :
 *
 *   • LCA F2609412942   — prix unitaires HT, remise en %. Le PU net imprimé (5,43 €)
 *                         est arrondi alors que le montant est calculé sur 5,42633 € :
 *                         un moteur qui ferait confiance au PU imprimé raterait 0,11 €
 *                         par ligne et en inventerait ailleurs.
 *   • JoshNoa V3/2026/36621 — prix unitaires **TTC**, remise en %, net HT arrondi. Le
 *                         PU imprimé n'est même pas dans la bonne base : seul
 *                         `montant ÷ quantité` est comparable à la commande.
 *
 * Les totaux attendus sont ceux vérifiés à la main sur les PDF et contre l'API BMS
 * (`GET /supplier/purchase-orders/{id}`) : LCA +40,37 € et JoshNoa −3,69 €.
 */

const assert = require('assert');
const {
  compareInvoiceToOrder, listDifferences, listTariffUpdates, listControlRows,
} = require('../src/utils/invoiceCompare');
const { buildClaimMessage } = require('../src/utils/invoiceClaimMessage');
const { attachMatchKeys } = require('../src/utils/invoiceMatching');
const { resolveCompleteRefs } = require('../src/utils/refResolution');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}
const close = (a, b, eps = 0.005) => Math.abs(a - b) < eps;
const byRef = (res, ref) => res.lines.find((l) => l.ref === ref);

/* ─────────────────────────────────────────────────────────────────────────────
 * LCA — facture F2609412942 du 25/09/2026, commande BMS 356948
 * Réf. Commande imprimée sur la facture : 356948 (= bms_reference)
 * ───────────────────────────────────────────────────────────────────────────── */

// [réf, quantité, montant HT de la ligne]
const LCA_INVOICE = [
  ['#REF8398-27584', 5, 7.50], ['#REF1921-5203', 20, 28.00], ['#REF8350-27512', 5, 23.50],
  ['#REF15320-49707', 240, 693.60], ['#REF15320-49715', 100, 289.00], ['#REF17363-57461', 20, 57.80],
  ['#REF17363-57459', 50, 144.50], ['#REF15051-48868', 80, 225.60], ['#REF11324-36716', 1, 60.00],
  ['#REF5140-13283', 10, 134.00], ['#REF5140-13284', 1, 13.40], ['#REF18588-62291', 30, 162.79],
  ['#REF18588-62289', 30, 162.79], ['#REF15320-49712', 10, 28.90], ['#REF16155-52579', 30, 119.70],
  ['#REF17362-57429', 30, 86.70], ['#REF15586-50738', 6, 45.00], ['#REF24017-24019', 20, 36.00],
  ['#REF16441-53794', 20, 56.00], ['#REF14906-48448', 30, 747.00], ['#REF5132-13242', 2, 26.80],
  ['#REF24367-24380', 10, 74.00], ['#REF17404-57561', 10, 60.00], ['#REF17631-58368', 10, 49.00],
  ['#REF14487-47006', 20, 26.00], ['#REF12565-41058', 1, 8.70], ['#REF12565-41060', 2, 17.40],
  ['#REF13005-42585', 20, 28.00], ['#REF16160-52599', 20, 57.80], ['#REF16160-52603', 20, 57.80],
  ['#REF16160-52601', 20, 57.80], ['#REF24914-24912', 10, 56.40], ['#REF18620-62608', 5, 15.00],
  ['#REF12689-41426', 12, 34.20], ['#REF12581-41131', 1, 8.70], ['#REF25190-25183', 5, 28.14],
  ['#REF18477-61459', 5, 32.50], ['#REF18347-60928', 10, 49.00], ['#REF16353-53406', 10, 28.00],
  ['#REF25850-25849', 1, 0.00], ['#REF7883-26197', 10, 43.00], ['#REF5131-13237', 1, 13.40],
  ['#REF15057-48877', 10, 45.00], ['#REF11071-35750', 10, 60.00], ['#REF14338-46607', 10, 12.00],
  ['#REF18846-64819', 5, 37.00], ['#REF18727-63795', 5, 24.50], ['#REF10117-32009', 5, 19.50],
  ['#REF25309-25308', 5, 39.50], ['#REF25309-25294', 5, 39.50], ['#REF6984-22760', 5, 19.50],
];

// [réf, quantité, prix unitaire] — état renvoyé par l'API BMS
const LCA_ORDER = [
  ['#REF8398-27584', 5, 1.5], ['#REF1921-5203', 20, 1.4], ['#REF8350-27512', 5, 4.7],
  ['#REF15320-49707', 240, 2.89], ['#REF15320-49715', 100, 2.89], ['#REF17363-57461', 20, 2.89],
  ['#REF17363-57459', 50, 2.89], ['#REF15051-48868', 80, 2.8], ['#REF11324-36716', 1, 54],
  ['#REF5140-13283', 10, 13.4], ['#REF5140-13284', 1, 13.4], ['#REF18588-62291', 30, 5.43],
  ['#REF18588-62289', 30, 5.43], ['#REF15320-49712', 10, 2.89], ['#REF16155-52579', 30, 2.89],
  ['#REF17362-57429', 30, 2.89], ['#REF15586-50738', 6, 7.5], ['#REF24017-24019', 20, 1.8],
  ['#REF16441-53794', 20, 2.8], ['#REF14906-48448', 30, 24.9], ['#REF5132-13242', 2, 13.4],
  ['#REF24367-24380', 10, 7.4], ['#REF17404-57561', 10, 6], ['#REF17631-58368', 10, 4.9],
  ['#REF14487-47006', 20, 1.3], ['#REF12565-41058', 1, 8.7], ['#REF12565-41060', 2, 8.7],
  ['#REF13005-42585', 20, 1.4], ['#REF16160-52599', 20, 2.89], ['#REF16160-52603', 20, 2.89],
  ['#REF16160-52601', 20, 2.89], ['#REF24914-24912', 10, 5.64], ['#REF18620-62608', 5, 3],
  ['#REF12689-41426', 12, 2.85], ['#REF12581-41131', 1, 8.7], ['#REF25190-25183', 5, 5.63],
  ['#REF18477-61459', 5, 6.5], ['#REF18347-60928', 10, 4.9], ['#REF16353-53406', 10, 2.8],
  ['#REF7883-26197', 10, 4.3], ['#REF5131-13237', 1, 13.4], ['#REF15057-48877', 10, 4.5],
  ['#REF11071-35750', 10, 6], ['#REF14338-46607', 10, 1.2], ['#REF18846-64819', 5, 7.4],
  ['#REF18727-63795', 5, 4.9], ['#REF10117-32009', 5, 3.9], ['#REF25309-25308', 5, 7.9],
  ['#REF25309-25294', 5, 7.9], ['#REF6984-22760', 5, 3.9],
];

const lca = compareInvoiceToOrder({
  invoice: {
    number: 'F2609412942',
    totalHt: 4189.92,
    lines: LCA_INVOICE.map(([ref, qty, lineTotalHt]) => ({ ref, qty, lineTotalHt })),
  },
  order: { reference: '356948', lines: LCA_ORDER.map(([ref, qty, price]) => ({ ref, qty, price })) },
});

console.log('\nLCA — facture F2609412942 vs commande 356948');

test('la somme des lignes lues retombe sur le total imprimé', () => {
  assert.strictEqual(lca.totals.invoiceParsed, 4189.92);
  assert.strictEqual(lca.totals.reconciles, true);
});

test('écart global : +40,37 € HT', () => {
  assert.strictEqual(lca.totals.order, 4149.55);
  assert.strictEqual(lca.totals.gap, 40.37);
});

test('trois hausses de tarif, et elles seules, sont réclamables (40,60 €)', () => {
  const prix = lca.lines.filter((l) => l.verdict === 'price').map((l) => [l.ref, l.gapPrice]);
  // Les 0,11 € des lignes remisées n'en font PAS partie : même tarif unitaire,
  // simple arrondi du fournisseur (cf. règle 4).
  assert.deepStrictEqual(prix, [
    ['#REF15051-48868', 1.60],
    ['#REF11324-36716', 6.00],
    ['#REF16155-52579', 33.00],
  ]);
  assert.strictEqual(lca.summary.claimable, 40.60);
});

test('le prix facturé est lu sur le montant, pas sur le PU imprimé', () => {
  // Ligne remisée à 16 % : PU imprimé 5,43 €, montant 162,79 € → 5,42633 € réels.
  const l = byRef(lca, '#REF18588-62291');
  assert.ok(close(l.invoicedUnitPrice, 5.42633, 1e-4));
  assert.strictEqual(l.gapPrice, -0.11);
});

test('les arrondis de remise sont isolés, pas mélangés aux erreurs de tarif', () => {
  const arrondis = lca.lines.filter((l) => l.verdict === 'rounding').map((l) => l.ref);
  assert.deepStrictEqual(arrondis, ['#REF18588-62291', '#REF18588-62289', '#REF25190-25183']);
  assert.strictEqual(lca.summary.roundingGap, -0.23);
});

test('la PLV offerte est tracée comme geste commercial, pas comme anomalie', () => {
  const l = byRef(lca, '#REF25850-25849');
  assert.strictEqual(l.verdict, 'free');
  assert.strictEqual(l.gap, 0);
});

test('aucune quantité en écart sur cette facture', () => {
  assert.strictEqual(lca.summary.qtyGap, 0);
  assert.strictEqual(lca.lines.filter((l) => l.verdict === 'qty').length, 0);
});

test('les 44 lignes conformes ne remontent pas', () => {
  assert.strictEqual(lca.summary.counts.ok, 44);
});

/* ─────────────────────────────────────────────────────────────────────────────
 * JoshNoa — facture V3/2026/36621 du 25/09/2026, commande BMS S311485
 * « Origine : S311485 » sur la facture (= bms_reference)
 * Commande prise dans son état d'origine (avant correction de la quantité).
 * ───────────────────────────────────────────────────────────────────────────── */

const JOSH_INVOICE = [
  ['josh00013448', 40, 156.01], ['josh00008069', 10, 60.72], ['josh00014009', 2, 7.57],
  ['josh00009370', 12, 68.40], ['josh00009358', 3, 14.52], ['josh00024231', 3, 36.00],
  ['josh00024232', 2, 24.00], ['josh00045197', 15, 93.00], ['josh00045196', 7, 43.40],
  ['josh00008058', 2, 49.00], ['josh00002973', 5, 54.50], ['josh00009668', 1, 19.50],
  ['josh00036732', 10, 49.00], ['josh00009356', 1, 6.95], ['josh00014494', 5, 24.50],
  ['josh00043017', 20, 160.00], ['josh00013559', 3, 11.70], ['josh00008054', 2, 49.00],
  ['josh00014137', 1, 24.50],
];

const JOSH_ORDER = [
  ['josh00013448', 40, 3.90], ['josh00008069', 10, 5.90], ['josh00014009', 2, 3.43],
  ['josh00009370', 12, 5.70], ['josh00009358', 3, 4.80], ['josh00024231', 3, 12.00],
  ['josh00024232', 2, 12.00], ['josh00045197', 15, 6.20], ['josh00045196', 8, 6.20],
  ['josh00008058', 2, 24.50], ['josh00002973', 5, 10.90], ['josh00009668', 1, 19.50],
  ['josh00036732', 10, 4.90], ['josh00009356', 1, 7.00], ['josh00014494', 5, 4.90],
  ['josh00043017', 20, 8.00], ['josh00013559', 3, 3.90], ['josh00008054', 2, 24.50],
  ['josh00014137', 1, 24.50],
];

const josh = compareInvoiceToOrder({
  invoice: {
    number: 'V3/2026/36621',
    totalHt: 952.27,
    lines: [
      ...JOSH_INVOICE.map(([ref, qty, lineTotalHt]) => ({ ref, qty, lineTotalHt })),
      { ref: null, label: 'Livraison', qty: 1, lineTotalHt: 0, kind: 'shipping' },
    ],
  },
  order: { reference: 'S311485', lines: JOSH_ORDER.map(([ref, qty, price]) => ({ ref, qty, price })) },
});

console.log('\nJoshNoa — facture V3/2026/36621 vs commande S311485');

test('la somme des lignes lues retombe sur le total imprimé', () => {
  assert.strictEqual(josh.totals.invoiceParsed, 952.27);
  assert.strictEqual(josh.totals.reconciles, true);
});

test('écart global : −3,69 € HT', () => {
  assert.strictEqual(josh.totals.order, 955.96);
  assert.strictEqual(josh.totals.gap, -3.69);
});

test('prix TTC + remise sur la facture : seul le montant est comparable', () => {
  // 8,28 € TTC − 12 % = 6,072 € HT réels, là où la commande dit 5,90 €.
  const l = byRef(josh, 'josh00008069');
  assert.ok(close(l.invoicedUnitPrice, 6.072, 1e-4));
  assert.strictEqual(l.gapPrice, 1.72);
});

test('les trois hausses de tarif sont réclamables (2,55 €)', () => {
  const prix = josh.lines
    .filter((l) => l.verdict === 'price' && l.material)
    .map((l) => [l.ref, l.gapPrice]);
  assert.deepStrictEqual(prix, [
    ['josh00008069', 1.72],
    ['josh00014009', 0.71],
    ['josh00009358', 0.12],
  ]);
  assert.strictEqual(josh.summary.claimable, 2.55);
});

test('un manquant est un écart de quantité, jamais une erreur de tarif', () => {
  const l = byRef(josh, 'josh00045196');
  assert.strictEqual(l.verdict, 'qty');
  assert.strictEqual(l.qtyOrdered, 8);
  assert.strictEqual(l.qtyInvoiced, 7);
  assert.strictEqual(l.gapQty, -6.20);
  assert.strictEqual(l.gapPrice, 0);       // le prix, lui, est bon
  assert.strictEqual(josh.summary.qtyGap, -6.20);
});

test('la ligne de port est portée au total sans chercher de produit', () => {
  const l = josh.lines.find((x) => x.verdict === 'shipping');
  assert.strictEqual(l.label, 'Livraison');
  assert.strictEqual(l.invoicedTotal, 0);
});

test('un vrai écart de tarif sous le seuil reste visible, hors décompte', () => {
  // 6,95 € facturés contre 7,00 € commandés : cinq centimes de tarif, bien réels,
  // mais on n'écrit pas au commercial pour ça.
  const l = byRef(josh, 'josh00009356');
  assert.strictEqual(l.verdict, 'price');
  assert.strictEqual(l.material, false);
  assert.strictEqual(josh.summary.minorGap, -0.05);
});

test('la ventilation des écarts redonne exactement l\'écart global', () => {
  const s = josh.summary;
  const total = s.claimable + s.inOurFavour + s.minorGap + s.roundingGap + s.qtyGap + s.extrasGap;
  assert.ok(close(total, josh.totals.gap));
  const l = lca.summary;
  const totalLca = l.claimable + l.inOurFavour + l.minorGap + l.roundingGap + l.qtyGap + l.extrasGap;
  assert.ok(close(totalLca, lca.totals.gap));
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Pulp — facture #FA165024 du 25/09/2026, commande BMS 168213
 * Le fournisseur facture en UNITÉS ce que la commande compte en PACKS.
 * ───────────────────────────────────────────────────────────────────────────── */

const pulp = compareInvoiceToOrder({
  invoice: {
    number: '#FA165024',
    lines: [
      // 20 cartouches à 1,24 € — la commande dit 10 paires à 2,48 €
      { ref: '3666528044512', qty: 20, lineTotalHt: 24.80 },
      { ref: '3666528044369', qty: 40, lineTotalHt: 49.60 },
      // conforme, même unité des deux côtés
      { ref: '2020101004996', qty: 100, lineTotalHt: 462.00 },
      // facturée sans avoir été commandée (cas réel de cette facture)
      { ref: '3666528035428', qty: 10, lineTotalHt: 15.00 },
    ],
  },
  order: {
    reference: '168213',
    lines: [
      { ref: '3666528044512', qty: 10, price: 2.48 },
      { ref: '3666528044369', qty: 20, price: 2.48 },
      { ref: '2020101004996', qty: 100, price: 4.62 },
    ],
  },
});

console.log('\nPulp — conditionnement unités/packs');

test('20 unités facturées contre 10 paires commandées : aucun écart', () => {
  const l = byRef(pulp, '3666528044512');
  assert.strictEqual(l.verdict, 'packaging');
  assert.strictEqual(l.packRatio, 2);
  assert.strictEqual(l.gap, 0);
  assert.strictEqual(l.gapQty, 0);        // décomposer n'aurait aucun sens
});

test('ces lignes ne comptent ni en quantité manquante ni en réclamation', () => {
  assert.strictEqual(pulp.summary.qtyGap, 0);
  assert.strictEqual(pulp.summary.claimable, 0);
  assert.strictEqual(pulp.summary.counts.packaging, 2);
});

test('la seule vraie anomalie de la facture ressort : 15 € non commandés', () => {
  const l = byRef(pulp, '3666528035428');
  assert.strictEqual(l.verdict, 'not_ordered');
  assert.strictEqual(l.gap, 15);
  assert.strictEqual(pulp.totals.gap, 15);
});

/* ─────────────────────────────────────────────────────────────────────────────
 * JoshNoa — facture V3/2026/37644 du 02/10/2026, commande BMS 1017
 * Le fournisseur facture AU CARTON ce que la commande compte en PIÈCES, et il y
 * a une hausse de tarif par-dessus : le cas que le conditionnement seul ne
 * couvre pas. Lu pièce contre carton, l'écran annonçait 21,46 € réclamables et
 * 18,00 € de manquants pour 3,46 € de trop, et le message au commercial aurait
 * demandé un avoir six fois trop gros.
 * ───────────────────────────────────────────────────────────────────────────── */

const carton = compareInvoiceToOrder({
  invoice: {
    number: 'V3/2026/37644',
    lines: [
      // 1 carton de 5 à 25,96 € — la commande dit 5 pièces à 4,50 € (22,50 €)
      { ref: 'josh00012308', label: 'Concentré Biscuit Roulé 30ml (5 pièces)', qty: 1, lineTotalHt: 25.96 },
      // conditionnement pur : le montant retombe au centime
      { ref: 'josh00022802', qty: 3, lineTotalHt: 36.00 },
      // même unité des deux côtés, au prix commandé
      { ref: 'josh00008029', qty: 24, lineTotalHt: 136.80 },
    ],
  },
  order: {
    reference: '1017',
    lines: [
      { ref: 'josh00012308', qty: 5, price: 4.50 },
      { ref: 'josh00022802', qty: 30, price: 1.20 },
      { ref: 'josh00008029', qty: 24, price: 5.70 },
    ],
  },
});

console.log('\nJoshNoa — un carton facturé plus cher que les pièces commandées');

test('rien ne manque : la quantité est bonne, c\'est l\'unité qui diffère', () => {
  const l = byRef(carton, 'josh00012308');
  assert.strictEqual(l.verdict, 'price');   // et non « Quantité et tarif »
  assert.strictEqual(l.packFactor, 5);
  assert.strictEqual(l.unitMismatch, true);
  assert.strictEqual(l.gapQty, 0);
  assert.strictEqual(carton.summary.qtyGap, 0);
});

test('l\'écart réclamé est celui de la ligne : 3,46 €, pas 21,46 €', () => {
  const l = byRef(carton, 'josh00012308');
  assert.strictEqual(l.gap, 3.46);
  assert.strictEqual(l.gapPrice, 3.46);
  assert.strictEqual(carton.summary.claimable, 3.46);
});

test('les tarifs se lisent à la pièce, la seule unité commune', () => {
  const l = byRef(carton, 'josh00012308');
  assert.strictEqual(l.pieces, 5);
  assert.ok(close(l.piecePriceExpected, 4.50));
  assert.ok(close(l.piecePriceInvoiced, 5.192));
});

test('la ventilation redonne l\'écart global de la facture', () => {
  const s = carton.summary;
  const total = s.claimable + s.inOurFavour + s.minorGap + s.roundingGap
    + s.qtyGap + s.extrasGap + s.packagingGap;
  assert.ok(close(total, carton.totals.gap));
  assert.ok(close(carton.totals.gap, 3.46));
});

test('le bouton de tarif écrit le prix de la PIÈCE, jamais celui du carton', () => {
  const t = listTariffUpdates(carton).find((x) => x.ref === 'josh00012308');
  assert.ok(t, 'un changement de tarif sur une ligne au carton doit pouvoir se retenir');
  assert.ok(close(t.realPrice, 5.192));   // 25,96 € ÷ 5 pièces, pas 25,96 €
  assert.strictEqual(t.currentPrice, 4.50);
  assert.strictEqual(t.qty, 5);
  assert.ok(close(t.delta * t.qty, 3.46));
});

test('le message réclame 3,46 € et dit à quelle unité il compte', () => {
  const m = buildClaimMessage({
    comparison: carton,
    invoice: { number: 'V3/2026/37644' },
    order: { reference: '1017' },
    supplier: { name: 'JoshNoa' },
    senderName: 'Maxime',
  });
  assert.strictEqual(m.claimable, 3.46);
  assert.strictEqual(m.lines.length, 1);
  assert.ok(m.subject.includes('3,46 €'));
  // Le tableau compte 5 pièces à 5,192 € contre 4,50 € commandés…
  assert.ok(m.body.includes('5,192 €'));
  assert.ok(m.body.includes('4,50 €'));
  assert.ok(!m.body.includes('21,46'));
  // …et la ligne du fournisseur reste reconnaissable sur sa propre facture.
  assert.ok(m.body.includes('facturée 1 × 25,96 € pour 5 pièces'));
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Cosmer — facture #FA018801, remise de pied « Remise youvape −300,90 € »
 * Les 11 lignes sont au prix commandé ; la remise (15 %) est au pied.
 * ───────────────────────────────────────────────────────────────────────────── */

const COSMER = [
  ['REF0661', 5, 6.80], ['REF0678', 30, 6.80], ['REF0654', 80, 6.80], ['REF0388', 10, 1.80],
  ['REF1361', 20, 1.00], ['REF2429', 10, 5.30], ['REF1088', 10, 5.30], ['REF2665', 20, 12.00],
  ['REF2641', 10, 12.00], ['REF2672', 20, 18.00], ['REF2658', 20, 18.00],
];

const cosmer = compareInvoiceToOrder({
  invoice: {
    number: '#FA018801',
    totalHt: 1705.10,
    lines: [
      ...COSMER.map(([ref, qty, pu]) => ({ ref, qty, lineTotalHt: Math.round(qty * pu * 100) / 100 })),
      { ref: null, label: 'Remise youvape', qty: 1, lineTotalHt: -300.90, kind: 'discount' },
    ],
  },
  order: { reference: 'YECQOOSHL', lines: COSMER.map(([ref, qty, price]) => ({ ref, qty, price })) },
});

console.log('\nCosmer — remise de pied');

test('toutes les lignes sont conformes : la remise est au pied, pas au tarif', () => {
  assert.strictEqual(cosmer.summary.counts.ok, 11);
  assert.strictEqual(cosmer.summary.claimable, 0);
});

test('l\'écart global est exactement la remise', () => {
  assert.strictEqual(cosmer.totals.order, 2006);
  assert.strictEqual(cosmer.totals.gap, -300.90);
  assert.strictEqual(cosmer.totals.footerDiscount, -300.90);
  assert.strictEqual(cosmer.totals.discountRate, 0.15);
});

test('le coût réel d\'une ligne est son prix remisé, pas le prix facturé', () => {
  // 6,80 € facturés, mais 15 % de remise au pied → 5,78 € réellement payés.
  const l = byRef(cosmer, 'REF0654');
  assert.ok(close(l.invoicedUnitPrice, 6.80));
  assert.ok(close(l.effectiveUnitCost, 5.78));
});

/* ─── Message de réclamation ──────────────────────────────────────────────── */

console.log('\nMessage de réclamation (copier-coller)');

test('le message ne reprend que les hausses de tarif matérielles', () => {
  const m = buildClaimMessage({
    comparison: lca,
    invoice: { number: 'F2609412942', date: '25/09/2026' },
    order: { reference: '356948' },
    supplier: { name: 'LCA', contactName: 'Romain' },
    senderName: 'Maxime',
  });
  assert.strictEqual(m.claimable, 40.60);
  assert.strictEqual(m.lines.length, 3);
  assert.ok(m.subject.includes('40,60 €'));
  assert.ok(m.body.includes('Bonjour Romain'));
  assert.ok(m.body.includes('commande 356948'));
  assert.ok(m.body.includes('#REF16155-52579'));
  // Les arrondis de remise n'y figurent pas : on n'écrit pas pour 11 centimes.
  assert.ok(!m.body.includes('#REF18588-62291'));
  // Ni la PLV offerte.
  assert.ok(!m.body.includes('#REF25850-25849'));
});

test('une facture sans hausse de tarif ne produit aucun message', () => {
  const m = buildClaimMessage({ comparison: cosmer, invoice: { number: '#FA018801' } });
  assert.strictEqual(m.claimable, 0);
  assert.strictEqual(m.body, '');
});

/* ─── Rien ne doit être tu ────────────────────────────────────────────────── */

console.log('\nToutes les différences remontent');

test('le tableau reprend chaque ligne non conforme, sans filtre de seuil', () => {
  const d = listDifferences(lca);
  assert.strictEqual(d.length, lca.lines.length - lca.summary.counts.ok);
  const refs = d.map((l) => l.ref);
  // Les trois écarts de tarif, mais AUSSI les trois arrondis et la PLV offerte,
  // qui ne partent pourtant dans aucune réclamation.
  assert.ok(refs.includes('#REF16155-52579'));
  assert.ok(refs.includes('#REF18588-62291'));
  assert.ok(refs.includes('#REF25850-25849'));
});

test('un manquant et un conditionnement sont signalés comme le reste', () => {
  const manquant = listDifferences(josh).find((l) => l.ref === 'josh00045196');
  assert.strictEqual(manquant.kindLabel, 'Quantité');
  assert.ok(manquant.action.includes('Ajuster'));

  const cond = listDifferences(pulp).find((l) => l.ref === '3666528044512');
  assert.strictEqual(cond.kindLabel, 'Conditionnement');
  assert.strictEqual(cond.packRatio, 2);
});

test('ce qui coûte de l\'argent arrive en tête', () => {
  const d = listDifferences(lca);
  assert.strictEqual(d[0].ref, '#REF16155-52579');   // +33,00 €
  assert.strictEqual(d[d.length - 1].verdict, 'rounding');
});

/* ─── Appariement par produit ─────────────────────────────────────────────── */

console.log('\nRapprochement quand les références ne se ressemblent pas');

test('une ligne de commande sans référence fournisseur retrouve sa facture', () => {
  // Cas réel : 611 lignes de commande portent le SKU interne faute de réf
  // fournisseur dans BMS. Sur la chaîne de caractères, « 1261822 » et
  // « josh00011822 » n'ont rien à voir — les deux désignent le même produit.
  const refProducts = new Map([['josh00011822', 1380790]]);
  const skuProducts = new Map([['1261822', 1380790]]);
  const keyed = attachMatchKeys({
    invoiceLines: [{ ref: 'josh00011822', qty: 15, lineTotalHt: 58.50 }],
    orderLines: [{ ref: '1261822', sku: '1261822', qty: 15, price: 3.90 }],
    refProducts,
    skuProducts,
  });
  const r = compareInvoiceToOrder({
    invoice: { lines: keyed.invoiceLines },
    order: { lines: keyed.orderLines },
  });
  assert.strictEqual(r.lines.length, 1);
  assert.strictEqual(r.lines[0].verdict, 'ok');
  assert.strictEqual(r.summary.qtyGap, 0);
});

test('une référence identique des deux côtés se rapproche toujours', () => {
  // Facture LCA F2609412956 : « #REF18941-24306 » figure des deux côtés, mais
  // seule la ligne de commande résolvait vers un produit (par son SKU interne).
  // L'appariement par produit prenait le pas sur la référence et fabriquait
  // deux clés différentes — trente lignes à la fois commandées non facturées et
  // facturées non commandées. La référence du document prime désormais.
  const keyed = attachMatchKeys({
    invoiceLines: [{ ref: '#REF18941-24306', qty: 15, lineTotalHt: 112.50 }],
    orderLines: [{ ref: '#REF18941-24306', sku: '1262640-1262705', qty: 15, price: 7.50 }],
    refProducts: new Map(),
    skuProducts: new Map([['1262640-1262705', 1405380]]),
  });
  const r = compareInvoiceToOrder({ invoice: { lines: keyed.invoiceLines }, order: { lines: keyed.orderLines } });
  assert.strictEqual(r.lines.length, 1);
  assert.strictEqual(r.lines[0].verdict, 'ok');
});

test('sans cet appariement, deux fausses anomalies se compensent', () => {
  // La même paire, rapprochée bêtement sur la référence.
  const r = compareInvoiceToOrder({
    invoice: { lines: [{ ref: 'josh00011822', qty: 15, lineTotalHt: 58.50 }] },
    order: { lines: [{ ref: '1261822', qty: 15, price: 3.90 }] },
  });
  assert.strictEqual(r.lines.length, 2);
  assert.deepStrictEqual(r.lines.map((l) => l.verdict).sort(),
    ['missing_in_invoice', 'not_ordered']);
});

test('la référence affichée reste celle du document', () => {
  const keyed = attachMatchKeys({
    invoiceLines: [{ ref: 'josh00011822', qty: 1, lineTotalHt: 3.90 }],
    orderLines: [{ ref: '1261822', sku: '1261822', qty: 1, price: 3.90 }],
    refProducts: new Map([['josh00011822', 42]]),
    skuProducts: new Map([['1261822', 42]]),
  });
  assert.strictEqual(keyed.invoiceLines[0].ref, 'josh00011822');
  assert.strictEqual(keyed.orderLines[0].ref, '1261822');
  assert.strictEqual(keyed.invoiceLines[0].matchKey, keyed.orderLines[0].matchKey);
});

test('une référence qu\'on ne sait pas résoudre garde la sienne', () => {
  const keyed = attachMatchKeys({
    invoiceLines: [{ ref: 'INCONNUE-1', qty: 1, lineTotalHt: 10 }],
    orderLines: [{ ref: 'INCONNUE-1', qty: 1, price: 10 }],
  });
  assert.strictEqual(keyed.invoiceLines[0].matchKey, undefined);
  const r = compareInvoiceToOrder({ invoice: { lines: keyed.invoiceLines }, order: { lines: keyed.orderLines } });
  assert.strictEqual(r.lines[0].verdict, 'ok');
});

/* ─── Cas de bord ─────────────────────────────────────────────────────────── */

console.log('\nCas de bord');

test('une réf commandée et absente de la facture ressort en reliquat', () => {
  const r = compareInvoiceToOrder({
    invoice: { lines: [{ ref: 'A', qty: 1, lineTotalHt: 10 }] },
    order: { lines: [{ ref: 'A', qty: 1, price: 10 }, { ref: 'B', qty: 3, price: 5 }] },
  });
  const b = byRef(r, 'B');
  assert.strictEqual(b.verdict, 'missing_in_invoice');
  assert.strictEqual(b.gap, -15);
});

test('une réf facturée en deux lignes est cumulée avant comparaison', () => {
  const r = compareInvoiceToOrder({
    invoice: { lines: [{ ref: 'A', qty: 6, lineTotalHt: 60 }, { ref: 'A', qty: 4, lineTotalHt: 40 }] },
    order: { lines: [{ ref: 'A', qty: 10, price: 10 }] },
  });
  assert.strictEqual(r.lines.length, 1);
  assert.strictEqual(r.lines[0].verdict, 'ok');
});

test('la casse et les espaces de la réf ne cassent pas le rapprochement', () => {
  const r = compareInvoiceToOrder({
    invoice: { lines: [{ ref: ' MJ amnesia  300MG ', qty: 2, lineTotalHt: 20 }] },
    order: { lines: [{ ref: 'MJ AMNESIA 300MG', qty: 2, price: 10 }] },
  });
  assert.strictEqual(r.lines[0].verdict, 'ok');
});

test('une ligne perdue par le parseur invalide l\'analyse (total qui ne retombe pas)', () => {
  const r = compareInvoiceToOrder({
    invoice: { totalHt: 100, lines: [{ ref: 'A', qty: 1, lineTotalHt: 60 }] },
    order: { lines: [{ ref: 'A', qty: 1, price: 60 }] },
  });
  assert.strictEqual(r.totals.reconciles, false);
  assert.strictEqual(r.totals.readGap, -40);
});

test('le seuil en euros décide de la matérialité, pas de la nature de l\'écart', () => {
  // 10,05 € facturés contre 10,00 € commandés : c'est un tarif différent, quel que
  // soit le seuil. Le seuil dit seulement s'il vaut la peine d'agir.
  const args = {
    invoice: { lines: [{ ref: 'A', qty: 10, lineTotalHt: 100.50 }] },
    order: { lines: [{ ref: 'A', qty: 10, price: 10 }] },
  };
  const serre = compareInvoiceToOrder(args).lines[0];
  assert.strictEqual(serre.verdict, 'price');
  assert.strictEqual(serre.material, true);

  const large = compareInvoiceToOrder({ ...args, options: { lineThreshold: 1 } }).lines[0];
  assert.strictEqual(large.verdict, 'price');
  assert.strictEqual(large.material, false);
  assert.strictEqual(compareInvoiceToOrder({ ...args, options: { lineThreshold: 1 } }).summary.claimable, 0);
});

test('un arrondi reste un arrondi même quand il pèse plusieurs euros', () => {
  // 0,002 € par unité sur 5 000 unités = 10 € : matériel, donc affiché, mais ce
  // n'est pas une erreur de tarif et ça ne part pas dans une réclamation.
  const r = compareInvoiceToOrder({
    invoice: { lines: [{ ref: 'A', qty: 5000, lineTotalHt: 10010 }] },
    order: { lines: [{ ref: 'A', qty: 5000, price: 2 }] },
  });
  assert.strictEqual(r.lines[0].verdict, 'rounding');
  assert.strictEqual(r.lines[0].material, true);
  assert.strictEqual(r.summary.claimable, 0);
  assert.strictEqual(r.summary.roundingGap, 10);
});

/* ─── Références tronquées (LVP F2609287196, 28/09/2026) ─────────────────── */

console.log('\nRéférences contenant des espaces');

test('deux références commençant pareil ne fusionnent plus', () => {
  // Le PDF aplatit réf et désignation. Le parseur ne garde que le premier mot :
  // « VP RES GTI 0.15 » et « VP Box Arm S Cyber Gold » devenaient tous deux
  // « VP », se regroupaient en une ligne de 11 pièces à 92,70 €, et laissaient
  // deux fausses anomalies « commandé non facturé » en face.
  const lignes = [
    { ref: 'VP', label: 'RES GTI 0.15 Résistances GTI (5pcs) - Vaporesso', qty: 10, lineTotalHt: 67.40 },
    { ref: 'VP', label: 'Box Arm S Cyber Gold Box Armour S 100W - Vaporesso', qty: 1, lineTotalHt: 25.30 },
  ];
  resolveCompleteRefs(lignes, ['VP RES GTI 0.15', 'VP Box Arm S Cyber Gold', 'VP-RGTXDUA-03']);
  assert.strictEqual(lignes[0].ref, 'VP RES GTI 0.15');
  assert.strictEqual(lignes[1].ref, 'VP Box Arm S Cyber Gold');
  assert.ok(lignes[0].label.startsWith('Résistances GTI'));

  const r = compareInvoiceToOrder({
    invoice: { lines: lignes },
    order: { lines: [
      { ref: 'VP RES GTI 0.15', qty: 10, price: 6.74 },
      { ref: 'VP Box Arm S Cyber Gold', qty: 1, price: 25.30 },
    ] },
  });
  assert.strictEqual(r.lines.length, 2);
  assert.ok(r.lines.every((l) => l.verdict === 'ok'));
});

test('une référence déjà complète n\'est pas touchée', () => {
  const lignes = [{ ref: 'VP-RGTXDUA-03', label: 'Résistances GTX Dual Mesh', qty: 20, lineTotalHt: 112.40 }];
  resolveCompleteRefs(lignes, ['VP RES GTI 0.15', 'VP-RGTXDUA-03']);
  assert.strictEqual(lignes[0].ref, 'VP-RGTXDUA-03');
  assert.strictEqual(lignes[0].label, 'Résistances GTX Dual Mesh');
});

/* ─── Remise de pied face à une commande au NET ──────────────────────────── */

console.log('\nRemise de pied : ne pas réclamer ce qui est déjà remisé');

const lvp = compareInvoiceToOrder({
  invoice: {
    totalHt: 888.53,
    lines: [
      // Facturées au BRUT, la remise « RSPV20 » n'apparaissant qu'au pied.
      { ref: 'A', qty: 20, lineTotalHt: 112.40 },   // commande : 20 × 4,50 = 90,00
      { ref: 'B', qty: 10, lineTotalHt: 67.30 },    // commande : 10 × 5,38 = 53,80
      { ref: 'C', qty: 30, lineTotalHt: 87.00 },    // commande : 30 × 2,88 = 86,40
      { ref: null, label: 'Remise', qty: 1, lineTotalHt: -37.50, kind: 'discount' },
    ],
  },
  order: { lines: [
    { ref: 'A', qty: 20, price: 4.50 },
    { ref: 'B', qty: 10, price: 5.38 },
    { ref: 'C', qty: 30, price: 2.88 },
  ] },
});

test('les écarts couverts par la remise ne sont pas réclamés', () => {
  // 22,40 + 13,50 + 0,60 = 36,50 € d'écarts bruts, pour 37,50 € de remise :
  // tout est couvert, il n'y a rien à demander.
  assert.strictEqual(lvp.summary.hasFooterDiscount, true);
  assert.strictEqual(lvp.summary.explainedByDiscount, 36.50);
  assert.strictEqual(lvp.summary.claimable, 0);
});

test('la remise ne peut pas expliquer plus que les écarts constatés', () => {
  // Plafonnée à l'écart : sans ce garde-fou, une grosse remise fabriquerait des
  // avoirs imaginaires sur des lignes parfaitement conformes.
  const total = lvp.lines.reduce((s, l) => s + (l.explainedByDiscount || 0), 0);
  assert.ok(total <= 37.50 + 0.001, `${total} > 37,50`);
  assert.ok(lvp.lines.every((l) => (l.explainedByDiscount || 0) <= l.gapPrice + 0.001));
});

test("la somme des écarts de ligne vaut l'écart global de la facture", () => {
  // L'invariant de l'écran : la colonne « Écart total » doit faire le total
  // affiché en haut. Avec `gap` (le montant BRUT contre la commande), elle ne le
  // faisait pas dès qu'une remise de pied s'en mêlait.
  const somme = lvp.lines.reduce((s, l) => s + (l.netGap || 0), 0);
  assert.ok(close(somme, lvp.totals.gap), `${somme} au lieu de ${lvp.totals.gap}`);
});

test('un vrai surcoût ressort malgré la remise', () => {
  const r = compareInvoiceToOrder({
    invoice: { lines: [
      { ref: 'A', qty: 10, lineTotalHt: 100 },      // commande : 10 × 5 = 50
      { ref: null, label: 'Remise', qty: 1, lineTotalHt: -10, kind: 'discount' },
    ] },
    order: { lines: [{ ref: 'A', qty: 10, price: 5 }] },
  });
  // 50 € d'écart pour 10 € de remise : 40 € restent dus.
  assert.strictEqual(r.summary.explainedByDiscount, 10);
  assert.strictEqual(r.summary.claimable, 40);
});

/* ─── Facture au BRUT contre commande au NET (LVP F2610287890, 01/10/2026) ── */

console.log("\nL'écart d'une ligne est son écart RÉEL, remise comprise");

// Extrait fidèle de la facture : deux Vaporesso remisés par RSPV20, un Dojo et
// un Innokin que la promotion exclut. La remise de pied vaut exactement 20 % des
// deux premiers (21,57 € sur 107,85 €), ce qui déclenche la règle fournisseur.
const brut = compareInvoiceToOrder({
  invoice: {
    totalHt: 185.98,
    lines: [
      { ref: 'VP-CXROC3-306', label: 'Cartouches XROS Series 3ml (4pcs) - Vaporesso', qty: 10, lineTotalHt: 61.70 },
      { ref: 'VP-KXR6M-BLAC', label: 'Kit Xros 6 Mini - Vaporesso (Couleur : Black)', qty: 5, lineTotalHt: 46.15 },
      { ref: 'DO15C-10MG-L6', label: 'Cartouche Dojo Blast 10ml 10mg - Dojo by Vaporesso', qty: 20, lineTotalHt: 58.00 },
      { ref: 'IN-CKLYV2-06', label: 'Cartouches Klypse V2 (3pcs) - Innokin', qty: 10, lineTotalHt: 41.70 },
      { ref: null, label: 'Remise', qty: 1, lineTotalHt: -21.57, kind: 'discount' },
    ],
  },
  order: { lines: [
    // La commande porte le prix NET : 6,17 × 0,8 = 4,936, arrondi au centime.
    { ref: 'VP-CXROC3-306', qty: 10, price: 4.94 },
    { ref: 'VP-KXR6M-BLAC', qty: 5, price: 7.38 },
    { ref: 'DO15C-10MG-L6', qty: 20, price: 2.80 },
    { ref: 'IN-CKLYV2-06', qty: 10, price: 4.05 },
  ] },
  options: { supplierCode: 'LVP Distribution' },
});

test("une ligne facturée au brut mais remisée au pied n'a pas d'écart", () => {
  // Le cas qui a lancé la correction : « Écart total +12,30 € » affiché à côté
  // d'un « Écart unitaire −0,0044 € » sur 10 pièces. Les deux chiffres étaient
  // justes — l'un brut, l'autre net — et aucun acheteur ne pouvait les lire.
  const l = byRef(brut, 'VP-CXROC3-306');
  assert.strictEqual(l.gap, 12.30);            // facturé 61,70 contre 49,40 commandés
  assert.strictEqual(l.discountShare, 12.34);  // part de RSPV20 sur cette ligne
  assert.strictEqual(l.netGap, -0.04);         // l'écart réel : rien à réclamer
  assert.ok(close(l.effectiveUnitCost, 4.936, 0.0001));
});

test('les lignes hors promotion gardent la totalité de leur écart', () => {
  // Le prorata sur les dépassements prenait à Pierre pour donner à Paul : il
  // « expliquait par la remise » une partie du Dojo, que RSPV20 exclut, et
  // laissait un résidu sur les Vaporesso payés au prix commandé.
  assert.strictEqual(byRef(brut, 'DO15C-10MG-L6').discountShare, 0);
  assert.strictEqual(byRef(brut, 'DO15C-10MG-L6').netGap, 2.00);
  assert.strictEqual(byRef(brut, 'IN-CKLYV2-06').discountShare, 0);
  assert.strictEqual(byRef(brut, 'IN-CKLYV2-06').netGap, 1.20);
  assert.strictEqual(brut.summary.claimable, 3.20);
});

test("la somme de la colonne vaut l'écart affiché en haut de l'écran", () => {
  // Au centime : les parts de remise arrondies séparément perdaient deux
  // centimes sur la vraie facture, et la colonne ne faisait plus le total.
  const somme = listControlRows(brut).reduce((s, r) => s + (r.netGap || 0), 0);
  assert.ok(close(somme, brut.totals.gap), `${somme} au lieu de ${brut.totals.gap}`);
  assert.strictEqual(brut.totals.gap, 3.18);
});

test('le message au commercial ne réclame que ce qui est dû', () => {
  const m = buildClaimMessage({ comparison: brut, invoice: { number: 'F2610287890' } });
  assert.strictEqual(m.claimable, 3.20);
  assert.strictEqual(m.lines.length, 2);
  // Les trois lignes XROS partaient en réclamation pour 3,48 € chacune, alors
  // qu'elles sont payées au prix commandé.
  assert.ok(!m.body.includes('VP-CXROC3-306'), 'une ligne conforme part en réclamation');
  assert.ok(!m.body.includes('VP-KXR6M-BLAC'), 'une ligne conforme part en réclamation');
});

/* ─── Conditionnement déduit (GFC F2609424691, 28/09/2026) ───────────────── */

console.log('\nConditionnement que personne ne connaît');

test('20 boîtes de 2 facturées contre 40 unités commandées : rien à réclamer', () => {
  // Ni BMS (qty_pack = 1) ni la fiche de référence (pack_qty = 1) ne savent que
  // GFC vend ces accus par deux. Le rapport entier et le montant qui retombe le
  // prouvent : 40 × 4,13 = 165,20 € contre 20 × 8,25 = 165,00 €.
  const r = compareInvoiceToOrder({
    invoice: { lines: [{ ref: 'GFC24676', label: 'Accus 18650 (2pcs)', qty: 20, lineTotalHt: 165.00 }] },
    order: { lines: [{ ref: 'GFC24676', qty: 40, price: 4.13 }] },
  });
  const l = r.lines[0];
  assert.strictEqual(l.verdict, 'packaging');
  assert.strictEqual(l.packFactor, 2);
  assert.strictEqual(r.summary.claimable, 0);
  assert.strictEqual(r.summary.qtyGap, 0);
  // Avant correction : 82,40 € réclamables et 82,60 € de manquants, deux
  // chiffres nés de la comparaison de deux unités différentes.
});

test('un rapport non entier reste une vraie anomalie', () => {
  // 8 commandés, 7 facturés : ce n'est pas un conditionnement, c'est un manquant.
  const r = compareInvoiceToOrder({
    invoice: { lines: [{ ref: 'A', qty: 7, lineTotalHt: 43.40 }] },
    order: { lines: [{ ref: 'A', qty: 8, price: 6.20 }] },
  });
  assert.strictEqual(r.lines[0].verdict, 'qty');
  assert.strictEqual(r.summary.qtyGap, -6.20);
});

test('un rapport entier ne suffit pas si le montant ne retombe pas', () => {
  // 20 boîtes de 2, mais facturées 12,00 € au lieu de 8,25 € : le rapport est
  // bien de 2, le montant non — c'est une erreur de tarif, pas un pack.
  const r = compareInvoiceToOrder({
    invoice: { lines: [{ ref: 'A', qty: 20, lineTotalHt: 240 }] },
    order: { lines: [{ ref: 'A', qty: 40, price: 4.13 }] },
  });
  assert.notStrictEqual(r.lines[0].verdict, 'packaging');
});

/* ─── Références rendues illisibles par le PDF ───────────────────────────── */

console.log('\nQuand la référence est illisible');

test('une référence coupée n\'importe où est reconstituée', () => {
  // Curieux rend « 190-FRAI-50-0M » puis, à la ligne, « G Fraise Grenade ». Le
  // « G » de la référence part dans la désignation — la coupure n'est pas sur
  // un tiret, le recollage habituel ne peut rien.
  const lignes = [{ ref: '190-FRAI-50-0M', label: 'G Fraise Grenade - 50ml (00mg)' }];
  resolveCompleteRefs(lignes, ['190-FRAI-50-0MG', 'NAT-NOIS-50-0MG']);
  assert.strictEqual(lignes[0].ref, '190-FRAI-50-0MG');
  assert.strictEqual(lignes[0].label, 'Fraise Grenade - 50ml (00mg)');
});

test('une référence trop courte ne sert pas à découper au hasard', () => {
  const lignes = [{ ref: 'XY', label: 'un produit quelconque' }];
  resolveCompleteRefs(lignes, ['XYZ']);   // 3 caractères : sous le seuil
  assert.strictEqual(lignes[0].ref, 'XY');
});

test('deux orphelins qui s\'équilibrent sont signalés comme tels', () => {
  // Le saut de page coupe la référence APRÈS la désignation : aucune
  // reconstitution possible, et deux candidats de même quantité et de même
  // montant sont indiscernables. On ne devine pas — mais on ne prétend pas
  // qu'il manque 74,52 € de marchandise.
  const keyed = attachMatchKeys({
    invoiceLines: [
      { ref: '50ml', qty: 6, lineTotalHt: 37.26 },
      { ref: 'MACA-50-00MG', qty: 6, lineTotalHt: 37.26 },
    ],
    orderLines: [
      { ref: 'SPE-MACA-50-00MG', qty: 6, price: 6.21 },
      { ref: 'SPE-SOUL-50-00MG', qty: 6, price: 6.21 },
    ],
  });
  const r = compareInvoiceToOrder({ invoice: { lines: keyed.invoiceLines }, order: { lines: keyed.orderLines } });
  assert.strictEqual(r.summary.orphansLikelySame, true);
  assert.strictEqual(r.summary.orphanCount, 4);
  assert.strictEqual(r.summary.orphanAmount, 74.52);
  assert.strictEqual(r.summary.claimable, 0);
});

test('un orphelin isolé reste une vraie anomalie', () => {
  const keyed = attachMatchKeys({
    invoiceLines: [{ ref: 'INCONNU', qty: 3, lineTotalHt: 58.80 }],
    orderLines: [],
  });
  const r = compareInvoiceToOrder({ invoice: { lines: keyed.invoiceLines }, order: { lines: keyed.orderLines } });
  assert.strictEqual(r.summary.orphansLikelySame, false);
  assert.strictEqual(r.lines[0].verdict, 'not_ordered');
});

test('un orphelin unique de même quantité et montant est apparié', () => {
  // Un seul candidat : là, on peut conclure.
  const keyed = attachMatchKeys({
    invoiceLines: [{ ref: 'ILLISIBLE', qty: 6, lineTotalHt: 37.26 }],
    orderLines: [{ ref: 'SPE-MACA-50-00MG', qty: 6, price: 6.21 }],
  });
  const r = compareInvoiceToOrder({ invoice: { lines: keyed.invoiceLines }, order: { lines: keyed.orderLines } });
  assert.strictEqual(r.lines.length, 1);
  assert.strictEqual(r.lines[0].verdict, 'ok');
});

/* ─── Séparateur de milliers (LCA F2511349312, 28/09/2026) ───────────────── */

console.log('\nUn montant à quatre chiffres');

test('le pied de TVA ne devient pas un article', () => {
  const { parseInvoice } = require('../src/parsers/invoices/opensiInvoice');
  // « 5 042.51 20.00 % 1 008.50 » : le découpage sur les espaces coupait
  // « 1 008.50 » en « 1 » et « 008.50 », lus comme un article de 1 × 8,50 €.
  // Un fantôme de 8,50 €, et un total qui ne retombait plus.
  const r = parseInvoice([
    'Référence Désignation Quantité PU HT Rist. % PU Net HT Montant HT',
    '#REF18068-59845 Tank Z Fli 2 - Geekvape 2 12.98 12.98 25.96',
    'Base HT Taux TVA Montant TVA',
    '5 042.51 20.00 % 1 008.50',
    'Total HT : 5 042.51 €',
  ].join('\n'));
  assert.strictEqual(r.lines.length, 1);
  assert.strictEqual(r.lines[0].ref, '#REF18068-59845');
});

test('une vraie ligne à plus de mille euros reste lue', () => {
  const { parseInvoice } = require('../src/parsers/invoices/opensiInvoice');
  const r = parseInvoice([
    'Référence Désignation Quantité PU HT Montant HT',
    '#REF99999-11111 Gros lot 10 1 008.50 10 085.00',
  ].join('\n'));
  assert.strictEqual(r.lines.length, 1);
  assert.strictEqual(r.lines[0].qty, 10);
  assert.ok(close(r.lines[0].unitPriceNet, 1008.50));
  assert.ok(close(r.lines[0].lineTotalHt, 10085));
});

test('les deux lectures possibles sont produites, et une seule quand il n\'y a pas d\'ambiguïté', () => {
  const { numberReadings } = require('../src/utils/invoiceNumbers');
  assert.strictEqual(numberReadings(['2', '12.98', '25.96']).length, 1);
  const deux = numberReadings(['1', '008.50']);
  assert.strictEqual(deux.length, 2);
  assert.deepStrictEqual(deux[0], [1, 8.5]);
  assert.deepStrictEqual(deux[1], [1008.5]);
});

test('commande et facture au pack : on ne convertit pas en pièces (cas LCA #REF11324-36716)', () => {
  // BMS et la facture LCA comptent tous deux par packs de 200. Une « normalisation »
  // de la commande en pièces — essayée le 28/09/2026 puis retirée — comparait
  // « 200 × 0,27 € » à « 1 × 60,00 € » et gonflait le réclamable de 6,00 € à 59,73 €.
  const r = compareInvoiceToOrder({
    invoice: { lines: [{ ref: '#REF11324-36716', qty: 1, lineTotalHt: 60 }] },
    order: { lines: [{ ref: '#REF11324-36716', qty: 1, price: 54, packQty: 200 }] },
  });
  assert.strictEqual(r.lines[0].verdict, 'price');
  assert.ok(close(r.summary.claimable, 6));
});

test('conditionnements différents mais même argent : aucune réclamation (cas Curieux)', () => {
  // Commande au carton de 10, facture à la pièce. Le montant est identique : c'est
  // une question de présentation, pas un écart de tarif.
  const r = compareInvoiceToOrder({
    invoice: { lines: [{ ref: 'AST-LICO-10-10SDN', qty: 10, lineTotalHt: 15.3 }] },
    order: { lines: [{ ref: 'AST-LICO-10-10SDN', qty: 1, price: 15.3, packQty: 10 }] },
  });
  assert.strictEqual(r.lines[0].verdict, 'packaging');
  assert.strictEqual(r.summary.claimable, 0);
});

test('un avoir ne réclame pas le reste de la commande (cas JoshNoa RV3/2026/02731)', () => {
  // L'avoir de 13,80 € confronté aux 1 658,14 € de la commande S309145 affichait
  // « écart −1 671,94 € » et 25 lignes « commandé, non facturé » imaginaires.
  const commande = {
    lines: [
      { ref: 'josh00004324', qty: 1, price: 13.8 },
      { ref: 'josh00009999', qty: 10, price: 100 },
    ],
  };
  const avoir = { lines: [{ ref: 'josh00004324', qty: 1, lineTotalHt: -13.8 }] };

  const sansGarde = compareInvoiceToOrder({ invoice: avoir, order: commande });
  assert.ok(sansGarde.lines.some((l) => l.verdict === 'missing_in_invoice'));

  const avecGarde = compareInvoiceToOrder({
    invoice: avoir, order: commande, options: { expectFullOrder: false },
  });
  assert.ok(!avecGarde.lines.some((l) => l.verdict === 'missing_in_invoice'));
  assert.ok(close(avecGarde.totals.order, 13.8));
});

test("l'écart d'un avoir est son montant, pas montant − commande (cas JoshNoa RV3/2026/02877)", () => {
  // Extourne de 3,46 € sur 5 concentrés commandés à 4,50 € : l'écran annonçait
  // « écart −25,96 € » (−3,46 − 22,50) et proposait 3,46 € comme nouveau tarif.
  const r = compareInvoiceToOrder({
    invoice: {
      docType: 'credit_note',
      totalHt: -3.46,
      lines: [{ ref: 'josh00012308', qty: 1, lineTotalHt: -3.46 }],
    },
    order: { lines: [
      { ref: 'josh00012308', qty: 5, price: 4.5 },
      { ref: 'josh00009999', qty: 10, price: 100 },
    ] },
    options: { expectFullOrder: false },
  });
  assert.strictEqual(r.lines.length, 1);
  assert.strictEqual(r.lines[0].verdict, 'credit');
  assert.ok(close(r.lines[0].gap, -3.46));
  assert.ok(close(r.lines[0].netGap, -3.46));
  assert.ok(close(r.totals.gap, -3.46));
  assert.strictEqual(r.summary.claimable, 0);
  assert.strictEqual(listTariffUpdates(r).length, 0);
});

test('remise ciblée par règle fournisseur : RSPV20 ne porte que sur les Vaporesso', () => {
  // Facture LVP F2609287455 : 89,11 € de remise, mais seuls les Vaporesso sont
  // remisés — Dojo et Armour G/GS exclus. Étalée sur tout, elle annonçait
  // +0,64 € sur des résistances GTX et −0,24 € sur une fiole graduée, pour un
  // écart réel de −0,71 €.
  const r = compareInvoiceToOrder({
    invoice: { lines: [
      { ref: 'VP RES GTI 0.2', label: 'Résistances GTI (5pcs) - Vaporesso', qty: 10, lineTotalHt: 67.40 },
      { ref: 'DO-CBLA', label: 'Cartouche Dojo Blast - Dojo by Vaporesso', qty: 5, lineTotalHt: 14.50 },
      { ref: 'GP-50', label: 'Cherry Ice 50ml - Goo Puff', qty: 6, lineTotalHt: 23.40 },
      { ref: null, label: 'Remise', qty: 1, lineTotalHt: -13.48, kind: 'discount' },
    ] },
    order: { lines: [
      { ref: 'VP RES GTI 0.2', qty: 10, price: 5.39 },
      { ref: 'DO-CBLA', qty: 5, price: 2.90 },
      { ref: 'GP-50', qty: 6, price: 3.90 },
    ] },
    options: { supplierCode: 'LVP Distribution' },
  });

  const par = (ref) => r.lines.find((l) => l.ref === ref);
  // Le Vaporesso retombe sur le prix commandé une fois ses 20 % imputés.
  assert.ok(close(par('VP RES GTI 0.2').effectiveUnitCost, 5.39, 0.01));
  // Le Dojo et le Goo Puff ne reçoivent rien : leur coût reste le prix facturé.
  assert.ok(close(par('DO-CBLA').effectiveUnitCost, 2.90, 0.001));
  assert.ok(close(par('GP-50').effectiveUnitCost, 3.90, 0.001));
  assert.strictEqual(r.summary.claimable, 0);
});

test('une règle qui ne retombe pas sur la remise imprimée est ignorée', () => {
  // Garde-fou : si la promotion change, la règle périmée ne doit pas s'appliquer
  // avec aplomb. 20 % de 67,40 € font 13,48 €, pas 40,00 € — on repasse donc à
  // une remise générale.
  const r = compareInvoiceToOrder({
    invoice: { lines: [
      { ref: 'A', label: 'Résistances GTI - Vaporesso', qty: 10, lineTotalHt: 67.40 },
      { ref: 'B', label: 'Cherry Ice 50ml - Goo Puff', qty: 6, lineTotalHt: 23.40 },
      { ref: null, label: 'Remise', qty: 1, lineTotalHt: -40, kind: 'discount' },
    ] },
    order: { lines: [{ ref: 'A', qty: 10, price: 5.39 }, { ref: 'B', qty: 6, price: 3.90 }] },
    options: { supplierCode: 'LVP Distribution' },
  });
  // Remise générale : le Goo Puff en reçoit sa part, ce qui ne serait pas le cas
  // si la règle s'était appliquée.
  assert.ok(r.lines.find((l) => l.ref === 'B').discountShare > 0);
});

/* ─── Une remise dont le taux prouve qu'elle ne vise pas toute la facture ── */

test("une remise à taux imprimé n'est pas étalée sur une assiette qu'elle ne couvre pas", () => {
  // LIPS FAC/2026/04474 : « Remise 20% sur produits spécifiques » à 5,92 €. À
  // 20 %, elle porte sur ~29,60 € — pas sur les 223,76 € de marchandise. Étalée
  // au prorata, elle donnait 1,1999 € la pièce sur une ligne facturée 1,2325 €.
  const r = compareInvoiceToOrder({
    invoice: {
      lines: [
        { ref: 'PECHE', label: 'Pêche 10mL', qty: 24, lineTotalHt: 29.58 },
        { ref: 'AUTRE', label: 'Autre 10mL', qty: 24, lineTotalHt: 40.60 },
        { ref: null, label: 'Remise 20% sur produits spécifiques', qty: 1, lineTotalHt: -5.92, kind: 'discount' },
      ],
    },
    order: {
      lines: [
        { ref: 'PECHE', productName: 'Pêche 10mL', qty: 24, price: 1.23 },
        { ref: 'AUTRE', productName: 'Autre 10mL', qty: 24, price: 1.69 },
      ],
    },
  });

  const peche = r.lines.find((l) => l.ref === 'PECHE');
  assert.strictEqual(peche.discountShare, 0, 'la remise a été imputée');
  assert.ok(close(peche.effectiveUnitCost, 1.2325, 0.0001),
    `coût réel ${peche.effectiveUnitCost} au lieu de 1,2325`);

  const remise = r.lines.find((l) => l.verdict === 'discount');
  assert.strictEqual(remise.scope.unallocated, true);
  assert.ok(close(remise.scope.impliedBase, 29.60, 0.01), `assiette ${remise.scope.impliedBase}`);
});

test('une remise de pied sans taux imprimé reste répartie au prorata', () => {
  // Cosmer, GFC, Revolute, Cloud Vapor : « Remise youvape », « Remise : ». Rien
  // ne prouve qu'elles visent une partie de la facture — elles sont globales, et
  // la répartition reste la seule façon d'avoir un coût de revient juste.
  const r = compareInvoiceToOrder({
    invoice: {
      lines: [
        { ref: 'A', label: 'A', qty: 10, lineTotalHt: 100 },
        { ref: null, label: 'Remise youvape', qty: 1, lineTotalHt: -10, kind: 'discount' },
      ],
    },
    order: { lines: [{ ref: 'A', productName: 'A', qty: 10, price: 10 }] },
  });
  const a = r.lines.find((l) => l.ref === 'A');
  assert.ok(a.discountShare > 0, 'remise globale non répartie');
  assert.ok(close(a.effectiveUnitCost, 9, 0.001), `coût réel ${a.effectiveUnitCost}`);
});

test('une remise à taux qui couvre bien toute la facture reste répartie', () => {
  // 10 % de 100 € = 10 € : l'assiette annoncée EST le total des produits, la
  // remise est donc bien globale malgré son taux imprimé.
  const r = compareInvoiceToOrder({
    invoice: {
      lines: [
        { ref: 'A', label: 'A', qty: 10, lineTotalHt: 100 },
        { ref: null, label: 'Remise 10% commerciale', qty: 1, lineTotalHt: -10, kind: 'discount' },
      ],
    },
    order: { lines: [{ ref: 'A', productName: 'A', qty: 10, price: 10 }] },
  });
  const a = r.lines.find((l) => l.ref === 'A');
  assert.ok(a.discountShare > 0, 'remise globale non répartie');
});

/* ─── Une remise sans libellé exploitable, désignée par l'arithmétique ──── */

// e.tasty #FA083648/2026 (29/09/2026), commande IJSBUKTLI / BMS 121404.
const ETASTY_083648 = {
  invoice: {
    totalHt: 226.17,
    lines: [
      { ref: 'GCDZE10000', label: 'DZEUS - 100ML', qty: 5, lineTotalHt: 29.50 },
      { ref: 'FRLIM03000', label: 'Limonata - 30ml', qty: 5, lineTotalHt: 22.00 },
      { ref: 'NUMQU10000', label: 'Numbers 04 - 100ml', qty: 5, lineTotalHt: 29.50 },
      { ref: 'NUMCI10000', label: 'Numbers 05 - 100ml', qty: 10, lineTotalHt: 59.00 },
      { ref: 'INOPA01003', label: 'OPALI 10ml - Taux de nicotine : 3', qty: 40, lineTotalHt: 54.00 },
      { ref: 'HOSER01012', label: 'Serpentron 10ml - Taux de nicotine : 12', qty: 20, lineTotalHt: 27.00 },
      { ref: 'GASOP05000', label: 'Sophie la casse-cou 50ml', qty: 5, lineTotalHt: 26.00 },
      { ref: null, label: 'chevallier', qty: 1, lineTotalHt: -20.83, kind: 'discount' },
    ],
  },
  order: { lines: [
    { ref: 'GCDZE10000', qty: 5, price: 5.20 },
    { ref: 'FRLIM03000', qty: 5, price: 4.40 },
    { ref: 'NUMQU10000', qty: 5, price: 5.90 },
    { ref: 'NUMCI10000', qty: 10, price: 5.90 },
    { ref: 'INOPA01003', qty: 40, price: 1.00 },
    { ref: 'HOSER01012', qty: 20, price: 1.00 },
    { ref: 'GASOP05000', qty: 5, price: 5.20 },
  ] },
  options: { supplierCode: 'Etasty' },
};

test('remise « chevallier » : les 10 ml retombent à 1,00 €, pas 1,236 €', () => {
  const r = compareInvoiceToOrder(ETASTY_083648);
  for (const ref of ['INOPA01003', 'HOSER01012']) {
    const l = byRef(r, ref);
    assert.ok(close(l.effectiveUnitCost, 1.00, 0.00001), `${ref} : coût réel ${l.effectiveUnitCost}`);
    assert.strictEqual(l.residualGapPrice, 0);
  }
  // Les lignes au bon prix ne reçoivent rien : leur coût est le prix facturé.
  for (const ref of ['FRLIM03000', 'NUMQU10000', 'NUMCI10000', 'GASOP05000', 'GCDZE10000']) {
    assert.strictEqual(byRef(r, ref).discountShare, 0, `${ref} a reçu une part de remise`);
  }
  const remise = r.lines.find((l) => l.verdict === 'discount');
  assert.strictEqual(remise.scope.deduced, true);
  assert.ok(close(remise.netGap, 0.17), `reliquat au pied ${remise.netGap}`);
});

test('remise « chevallier » : seul le DZEUS reste réclamable, et aucun tarif 10 ml', () => {
  const r = compareInvoiceToOrder(ETASTY_083648);
  assert.ok(close(r.summary.claimable, 3.50), `réclamable ${r.summary.claimable}`);
  const refs = listTariffUpdates(r).map((t) => t.ref);
  assert.ok(!refs.includes('INOPA01003') && !refs.includes('HOSER01012'), `tarifs proposés : ${refs}`);
  assert.ok(!refs.includes('FRLIM03000'), 'tarif proposé sur une ligne au bon prix');
  // La colonne « Écart total » vaut toujours l'écart global.
  const somme = r.lines.reduce((s, l) => s + (l.netGap || 0), 0);
  assert.ok(close(somme, r.totals.gap), `colonne ${somme} contre écart ${r.totals.gap}`);
});

test('deux sous-ensembles qui retombent sur la remise : elle reste générale', () => {
  const r = compareInvoiceToOrder({
    invoice: { lines: [
      { ref: 'A', label: 'A', qty: 10, lineTotalHt: 15 },
      { ref: 'B', label: 'B', qty: 10, lineTotalHt: 15 },
      { ref: 'C', label: 'C', qty: 10, lineTotalHt: 100 },
      { ref: null, label: 'Remise', qty: 1, lineTotalHt: -5, kind: 'discount' },
    ] },
    order: { lines: [
      { ref: 'A', qty: 10, price: 1 }, { ref: 'B', qty: 10, price: 1 }, { ref: 'C', qty: 10, price: 10 },
    ] },
  });
  assert.ok(byRef(r, 'C').discountShare > 0, 'remise ambiguë imputée à un sous-ensemble');
});

/* ─── Le seuil des tarifs, depuis que la base tient quatre décimales ────── */

test('un écart de 0,0025 € par pièce donne un tarif à appliquer', () => {
  // Le cas qui revenait à chaque facture LIPS : 1,45 € remisé à 15 % = 1,2325 €
  // contre 1,23 € commandé. Sous l'ancien seuil de 0,005 €, la ligne affichait
  // « Arrondi de remise » sans aucun bouton — donc pour toujours.
  const r = compareInvoiceToOrder({
    invoice: { lines: [{ ref: 'PECHE', label: 'Pêche 10mL', qty: 24, lineTotalHt: 29.58 }] },
    order: { lines: [{ ref: 'PECHE', productName: 'Pêche 10mL', qty: 24, price: 1.23 }] },
  });
  const t = listTariffUpdates(r).find((x) => x.ref === 'PECHE');
  assert.ok(t, 'aucun tarif proposé sur un écart de 0,0025 €');
  assert.ok(close(t.realPrice, 1.2325, 0.0001), `tarif ${t.realPrice}`);

  // Et une fois le tarif inscrit, la ligne ne revient plus : c'est tout l'objet.
  const apres = compareInvoiceToOrder({
    invoice: { lines: [{ ref: 'PECHE', label: 'Pêche 10mL', qty: 24, lineTotalHt: 29.58 }] },
    order: { lines: [{ ref: 'PECHE', productName: 'Pêche 10mL', qty: 24, price: t.realPrice }] },
  });
  assert.strictEqual(listTariffUpdates(apres).length, 0);
  assert.strictEqual(listDifferences(apres).length, 0);
});

if (failures > 0) {
  console.log(`\n${failures} test(s) en échec.`);
  process.exit(1);
}
console.log('\nTous les tests passent.');
