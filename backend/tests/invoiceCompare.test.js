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
const { compareInvoiceToOrder } = require('../src/utils/invoiceCompare');
const { buildClaimMessage } = require('../src/utils/invoiceClaimMessage');

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

if (failures > 0) {
  console.log(`\n${failures} test(s) en échec.`);
  process.exit(1);
}
console.log('\nTous les tests passent.');
