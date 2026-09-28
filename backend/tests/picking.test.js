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
 *   - l'ordre de passage des règles : une commande prise ne l'est pas deux fois.
 */

const assert = require('assert');
const { BUCKETS, allocateStock, physicalFromBms, planWaves, chunk, waveNumber } = require('../src/services/pickingPlanner');

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

console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} test(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
