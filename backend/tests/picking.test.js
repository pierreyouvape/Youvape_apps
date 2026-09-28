/**
 * Banc du Picking : disponibilité des commandes et découpage en vagues.
 *
 * Sans dépendance ni base : `node tests/picking.test.js` (ou `npm test`).
 *
 * Ce qui est couvert :
 *   - la répartition du stock physique par date de paiement (même logique que
 *     la réservation BMS), et le classement En cours / Partielle / Hors stock ;
 *   - le stock physique de transition = disponible + RÉSERVÉ BMS (jamais
 *     + commandé : un manque disparaîtrait) ;
 *   - le cas réel du Booster 11152 (28/09/2026) ;
 *   - le découpage « Mondial Relay par 10 » : 58 commandes → 5×10 + 8 ;
 *   - l'ordre de passage des règles : une commande prise ne l'est pas deux fois ;
 *   - le bon de préparation (lot 2) : packs éclatés en composants, reste à
 *     expédier, choix du code-barres, et un vrai PDF produit (« Ω » compris).
 */

const assert = require('assert');
const { BUCKETS, allocateStock, physicalFromBms, planWaves, chunk, waveNumber } = require('../src/services/pickingPlanner');
const { buildWavePdf, buildWavesPdf, buildPrintLines } = require('../src/services/pickingPdf');
const { PDFDocument } = require('pdf-lib');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

const order = (orderNumber, paidAt, lines, shippingMethod = 'Mondial Relay - Point Relais') =>
  ({ orderNumber, paidAt, shippingMethod, lines: lines.map(([sku, qty]) => ({ sku, qty })) });

console.log('Disponibilité');

test('stock suffisant : tout est « En cours »', () => {
  const res = allocateStock(
    [order('1', '2026-09-28 09:00', [['A', 2]]), order('2', '2026-09-28 10:00', [['A', 3]])],
    { A: 10 }
  );
  assert.strictEqual(res.get('1').bucket, BUCKETS.READY);
  assert.strictEqual(res.get('2').bucket, BUCKETS.READY);
});

test('3 en rayon, 2 + 3 commandés : la plus anciennement payée d\'abord, la suivante partielle', () => {
  const res = allocateStock(
    [order('2', '2026-09-28 10:00', [['A', 3]]), order('1', '2026-09-28 09:00', [['A', 2]])],
    { A: 3 }
  );
  assert.strictEqual(res.get('1').bucket, BUCKETS.READY);
  assert.strictEqual(res.get('2').bucket, BUCKETS.PARTIAL);
  assert.strictEqual(res.get('2').lines[0].allocated, 1);
});

test('plus rien pour la plus récente : « Hors stock »', () => {
  const res = allocateStock(
    [order('1', '2026-09-28 09:00', [['A', 2]]), order('2', '2026-09-28 10:00', [['A', 2]])],
    { A: 2 }
  );
  assert.strictEqual(res.get('1').bucket, BUCKETS.READY);
  assert.strictEqual(res.get('2').bucket, BUCKETS.OUT);
});

test('stock physique négatif (écart d\'inventaire) : traité comme 0, rien n\'est couvert', () => {
  const res = allocateStock([order('1', '2026-09-28 09:00', [['A', 1]])], { A: -2 });
  assert.strictEqual(res.get('1').bucket, BUCKETS.OUT);
});

test('commande multi-lignes : une ligne manquante suffit à la rendre partielle', () => {
  const res = allocateStock(
    [order('1', '2026-09-28 09:00', [['A', 1], ['B', 1]])],
    { A: 5, B: 0 }
  );
  assert.strictEqual(res.get('1').bucket, BUCKETS.PARTIAL);
});

test('SKU inconnu de notre catalogue : rien à répartir, la ligne n\'est pas couverte', () => {
  const res = allocateStock([order('1', '2026-09-28 09:00', [['ZZZ', 1]])], { A: 5 });
  assert.strictEqual(res.get('1').bucket, BUCKETS.OUT);
});

test('physicalFromBms : disponible + RÉSERVÉ (3 en rayon, 5 commandés → 0 dispo, 3 réservés = 3)', () => {
  const physique = physicalFromBms(new Map([['A', 0]]), [{ sku: 'A', reserved: 2 }, { sku: 'A', reserved: 1 }]);
  assert.strictEqual(physique.get('A'), 3);
  const res = allocateStock(
    [order('1', '2026-09-28 09:00', [['A', 2]]), order('2', '2026-09-28 10:00', [['A', 3]])],
    physique
  );
  assert.strictEqual(res.get('1').bucket, BUCKETS.READY);
  assert.strictEqual(res.get('2').bucket, BUCKETS.PARTIAL);
});

test('physicalFromBms : un SKU réservé mais absent du catalogue reste inconnu', () => {
  const physique = physicalFromBms(new Map([['A', 1]]), [{ sku: 'ZZZ', reserved: 4 }]);
  assert.strictEqual(physique.has('ZZZ'), false);
});

test('cas réel 11152 (28/09) : 10 692 disponibles + 134 réservés, 134 à expédier → tout le monde servi', () => {
  const qtes = [10, 10, 12, 1, 10, 40, 10, 6, 4, 10, 10, 1, 10];
  const orders = qtes.map((q, i) => order(String(i), `2026-09-2${i % 3 + 6} 1${i % 10}:00`, [['11152', q]]));
  const physique = physicalFromBms(new Map([['11152', 10692]]), qtes.map(q => ({ sku: '11152', reserved: q })));
  assert.strictEqual(physique.get('11152'), 10826); // = wi_physical_quantity lu dans BMS ce jour-là
  const res = allocateStock(orders, physique);
  for (const o of orders) assert.strictEqual(res.get(o.orderNumber).bucket, BUCKETS.READY);
});

console.log('Vagues');

test('chunk : 58 par 10 → 5 vagues de 10 et 1 de 8', () => {
  const vagues = chunk([...Array(58).keys()], 10);
  assert.deepStrictEqual(vagues.map(v => v.length), [10, 10, 10, 10, 10, 8]);
});

test('planWaves : les commandes d\'une règle sont prises par date de paiement', () => {
  const regle = { id: 1, name: 'MR', prefix: 'MR', maxOrders: 2, priority: 1, active: true,
    denominations: ['Mondial Relay - Point Relais'] };
  const plan = planWaves([regle], [
    order('3', '2026-09-28 12:00', []), order('1', '2026-09-28 09:00', []), order('2', '2026-09-28 10:00', [])
  ]);
  assert.strictEqual(plan.length, 1);
  assert.deepStrictEqual(plan[0].waves, [['1', '2'], ['3']]);
});

test('planWaves : dénomination comparée sans casse ni espaces de bord', () => {
  const regle = { id: 1, prefix: 'MR', maxOrders: 10, priority: 1, active: true,
    denominations: ['  mondial relay - POINT RELAIS '] };
  const plan = planWaves([regle], [order('1', '2026-09-28 09:00', [])]);
  assert.deepStrictEqual(plan[0].waves, [['1']]);
});

test('planWaves : ordre de passage respecté, une commande n\'est jamais prise deux fois', () => {
  const large = { id: 1, prefix: 'TOUT', maxOrders: 50, priority: 2, active: true,
    denominations: ['Mondial Relay - Point Relais', 'Colissimo Domicile'] };
  const mr = { id: 2, prefix: 'MR', maxOrders: 50, priority: 1, active: true,
    denominations: ['Mondial Relay - Point Relais'] };
  const plan = planWaves([large, mr], [
    order('1', '2026-09-28 09:00', []),
    order('2', '2026-09-28 09:30', [], 'Colissimo Domicile')
  ]);
  assert.deepStrictEqual(plan.map(p => [p.rule.prefix, p.waves]), [['MR', [['1']]], ['TOUT', [['2']]]]);
});

test('planWaves : une règle inactive ne produit rien', () => {
  const regle = { id: 1, prefix: 'MR', maxOrders: 10, priority: 1, active: false,
    denominations: ['Mondial Relay - Point Relais'] };
  assert.deepStrictEqual(planWaves([regle], [order('1', '2026-09-28 09:00', [])]), []);
});

test('waveNumber : préfixe en majuscules + compteur sur 6 chiffres', () => {
  assert.strictEqual(waveNumber('mr', 123), 'MR-000123');
});


console.log('Bon de préparation');

// Cas réel 1264192 (28/09/2026) : un Lot 10 Boosters, ses 10 boosters à 0 €.
const PACK_ITEMS = [
  { type: 'simple', name: 'Numbers 5 - 100ml', qty: 1, line_total: 13.25, product_id: 5, sku: '867595', brand: 'E.Tasty', sub_brand: 'Numbers', location: 'A 4-3', barcodes: ['3701418821665'] },
  { type: 'woosb', name: 'Lot 10 Boosters YouBoost 50/50', qty: 1, line_total: 6.58, product_id: 14742, sku: '14742', woosb_ids: [{ id: 11152 }] },
  { type: 'simple', name: 'Booster YouBoost 50/50 dans le pack : Lot 10 Boosters YouBoost 50/50', qty: 10, line_total: 0, product_id: 11152, sku: '11152', brand: 'YouVape', location: 'E 1-1', barcodes: ['PB-11152', '3701418826240'] },
  { type: 'variation', name: 'Pack 5 Résistances GTX Dual Mesh - 0.20 Ω', qty: 1, line_total: 8.93, product_id: 7, sku: '1138995-1139001', location: 'C 1-1', barcodes: null }
];

test('buildPrintLines : le pack disparaît, ses composants portent son nom', () => {
  const lines = buildPrintLines(PACK_ITEMS);
  assert.deepStrictEqual(lines.map(l => l.sku), ['867595', '11152', '1138995-1139001']);
  const booster = lines.find(l => l.sku === '11152');
  assert.strictEqual(booster.name, 'Booster YouBoost 50/50');
  assert.strictEqual(booster.packName, 'Lot 10 Boosters YouBoost 50/50');
  assert.strictEqual(booster.qty, 10);
});

test('buildPrintLines : le code-barres imprimé est le premier EAN-13', () => {
  const booster = buildPrintLines(PACK_ITEMS).find(l => l.sku === '11152');
  assert.strictEqual(booster.barcode, '3701418826240');
  assert.strictEqual(buildPrintLines(PACK_ITEMS).find(l => l.sku === '1138995-1139001').barcode, null);
});

test('buildPrintLines : seul le reste à expédier est à préparer, le reste est « déjà expédié »', () => {
  const lines = buildPrintLines(PACK_ITEMS, new Map([['11152', 4], ['867595', 1]]));
  assert.deepStrictEqual(lines.map(l => [l.sku, l.qty, l.shipped]), [['867595', 1, 0], ['11152', 4, 6]]);
});

test('buildPrintLines : sans relevé BMS, tout ce qui a été commandé', () => {
  assert.strictEqual(buildPrintLines(PACK_ITEMS, null).reduce((s, l) => s + l.qty, 0), 12);
});

const pdfTest = (async () => {
  const wave = {
    waveNumber: 'MAN-000001', createdAt: new Date('2026-09-28T11:00:00Z'), ruleName: null,
    orders: [1, 2].map(n => ({
      orderNumber: `12640${n}`, orderDate: new Date('2026-09-28T12:32:00Z'), shippingMethod: '2Shop',
      carrier: { carrierCode: 'chronopost', accountCode: '2shop' },
      shipping: { name: 'Client Test', country: 'FR' },
      relayPoint: { id: '3416U', name: 'STATION AVIA', address: '80 Rue de Vesoul', postcode: '25000', city: 'BESANCON', country: 'FR' },
      lines: buildPrintLines(PACK_ITEMS)
    }))
  };
  // Une commande à 40 lignes doit continuer sur une seconde page.
  wave.orders[1].lines = Array.from({ length: 40 }, (_, i) => ({ ...wave.orders[1].lines[0], sku: `S${i}`, location: `A ${i}` }));
  const bytes = await buildWavePdf(wave);
  const doc = await PDFDocument.load(bytes);
  // Garde + commande 1 (1 page) + commande 2 (40 lignes : 2 pages ou plus).
  assert.ok(doc.getPageCount() >= 4, `pages : ${doc.getPageCount()}`);
  assert.strictEqual(doc.getTitle(), 'Vague MAN-000001');

  // Plusieurs vagues dans un seul document : chacune avec sa page de garde,
  // et le fichier ne grossit pas d'une police par vague.
  const one = { ...wave, orders: [wave.orders[0]] };
  const single = await buildWavePdf(one);
  const many = await buildWavesPdf([one, { ...one, waveNumber: 'MR-000002' }, { ...one, waveNumber: 'MR-000003' }]);
  assert.strictEqual((await PDFDocument.load(many)).getPageCount(), 3 * (await PDFDocument.load(single)).getPageCount());
  assert.ok(many.length < single.length * 1.5, `3 vagues = ${many.length} o, 1 vague = ${single.length} o`);
})().then(
  () => console.log('  ok   buildWavePdf : garde + bons, « Ω » et 2Shop compris, bon long sur plusieurs pages ; buildWavesPdf : 3 vagues, polices une seule fois'),
  (err) => { failures++; console.error(`  FAIL buildWavePdf\n       ${err.message}`); }
);

pdfTest.then(() => {
  console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} test(s) en échec.`);
  process.exit(failures === 0 ? 0 : 1);
});
