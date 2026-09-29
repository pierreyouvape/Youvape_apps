/**
 * Le payload d'articles envoyé à BMS.
 *
 * BMS N'ACCEPTE PAS le conditionnement qu'on lui envoie : il applique toujours
 * celui du catalogue produit, et lit `qty` comme des PIÈCES qu'il divise par ce
 * conditionnement. Vérifié en production le 29/09/2026 sur trois commandes.
 *
 * D'où une règle unique — qty en PIÈCES, price au LOT CATALOGUE — et ces tests,
 * qui rejouent les quatre cas réels observés. Chacun a coûté un aller-retour
 * avec BMS ; aucun n'est devinable à la lecture du code.
 */
const assert = require('assert');
const { buildBmsItems, packChoisi } = require('../src/models/purchaseOrderModel');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures += 1; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

console.log('\nPayload BMS — qty en pièces, prix au lot catalogue');

test('import LCA : 1 lot de 200 à 54 € → 200 pièces, lot à 54 €', () => {
  // Commande 356948, ligne #REF11324-36716. Remultiplier le prix ici, c'est le
  // bug ×10 de mémoire.
  const [l] = buildBmsItems(
    [{ sku: 'X', qty_ordered: 1, unit_price: 54, pack_qty: 200, units_per_qty: 200 }], true,
  );
  assert.strictEqual(l.qty, 200);
  assert.strictEqual(l.price, 54);
  assert.strictEqual(l.pack_qty, 200);
});

test('import e.tasty : 40 pièces à 1 € → 40 pièces, lot de 10 à 10 €', () => {
  // Commande UOPZIWQDN, ligne INOPA01003. BMS l'a rangée en 4 lots de 10 à
  // 10,00 € : 40,00 € au total, comme chez nous.
  const [l] = buildBmsItems(
    [{ sku: 'X', qty_ordered: 40, unit_price: 1, pack_qty: 10, units_per_qty: 1 }], false,
  );
  assert.strictEqual(l.qty, 40);
  assert.strictEqual(l.price, 10);
});

test('app, « par 1 » sur un produit conditionné par 5 : le prix suit le catalogue', () => {
  // Commande « Test Maxime 3 », FRM 0mg. Dix pièces à 1,50 € la pièce.
  // Envoyer 1,50 € tel quel donnait 2 lots à 1,50 € = 3,00 € au lieu de 15,00 €.
  const [l] = buildBmsItems(
    [{ sku: '9736-9852', qty_ordered: 10, unit_price: 1.5,
       pack_qty: 1, catalogue_pack_qty: 5, units_per_qty: 1 }], true,
  );
  assert.strictEqual(l.qty, 10, 'dix pièces commandées, dix pièces envoyées');
  assert.strictEqual(l.price, 7.5, 'le lot de 5 vaut 7,50 € puisque la pièce vaut 1,50 €');
  // BMS en fera 2 lots de 5 à 7,50 € : 15,00 €, comme chez nous.
  assert.strictEqual((l.qty / l.pack_qty) * l.price, 15);
});

test('app, « par 5 » : 10 lots de 5 à 7,50 € → 50 pièces, 75,00 €', () => {
  // Même commande, FRM 12mg. Celle-là passait déjà.
  const [l] = buildBmsItems(
    [{ sku: '9736-993233', qty_ordered: 10, unit_price: 7.5,
       pack_qty: 5, catalogue_pack_qty: 5, units_per_qty: 5 }], true,
  );
  assert.strictEqual(l.qty, 50);
  assert.strictEqual(l.price, 7.5);
  assert.strictEqual((l.qty / l.pack_qty) * l.price, 75);
});

test('l\'argent envoyé égale toujours l\'argent commandé', () => {
  // L'invariant qui aurait attrapé le bug tout seul : quoi qu'il arrive,
  // pièces × prix de la pièce doit retomber sur qty_ordered × unit_price.
  const lignes = [
    { sku: 'A', qty_ordered: 10, unit_price: 1.5, pack_qty: 1, catalogue_pack_qty: 5, units_per_qty: 1 },
    { sku: 'B', qty_ordered: 10, unit_price: 7.5, pack_qty: 5, units_per_qty: 5 },
    { sku: 'C', qty_ordered: 1, unit_price: 3.92, pack_qty: 1, units_per_qty: 1 },
    { sku: 'D', qty_ordered: 2, unit_price: 12, pack_qty: 6, catalogue_pack_qty: 3, units_per_qty: 6 },
  ];
  for (const ligne of lignes) {
    const [l] = buildBmsItems([ligne], false);
    const chezNous = ligne.qty_ordered * ligne.unit_price;
    const chezBms = (l.qty / l.pack_qty) * l.price;
    assert.ok(Math.abs(chezNous - chezBms) < 0.01,
      `${ligne.sku} : ${chezNous.toFixed(2)} € commandés, ${chezBms.toFixed(2)} € envoyés`);
  }
});

test('« par 1 » contredit le catalogue sur les PIÈCES, pas sur le prix du lot', () => {
  const [l] = buildBmsItems(
    [{ sku: 'X', qty_ordered: 30, unit_price: 2, pack_qty: 1, catalogue_pack_qty: 6, units_per_qty: 1 }], false,
  );
  assert.strictEqual(l.qty, 30, 'trente pièces, pas trente lots');
  assert.strictEqual(l.price, 12, 'le lot catalogue de 6 vaut 12 € si la pièce vaut 2 €');
});

test('packChoisi distingue « non fourni » de « fourni à 1 »', () => {
  assert.strictEqual(packChoisi(undefined), null);
  assert.strictEqual(packChoisi(null), null);
  assert.strictEqual(packChoisi(''), null);
  assert.strictEqual(packChoisi(1), 1);
  assert.strictEqual(packChoisi('5'), 5);
  assert.strictEqual(packChoisi(0), null);
});

test('une ligne sans SKU ne part pas : BMS la refuserait en bloc', () => {
  assert.strictEqual(buildBmsItems([{ qty_ordered: 5, unit_price: 1 }], false).length, 0);
});

test('la remise n\'est portée que si elle existe', () => {
  const [avec] = buildBmsItems([{ sku: 'X', qty_ordered: 1, unit_price: 1, discount_percent: 15 }], false);
  const [sans] = buildBmsItems([{ sku: 'X', qty_ordered: 1, unit_price: 1, discount_percent: 0 }], false);
  assert.strictEqual(avec.discount_percent, 15);
  assert.ok(!('discount_percent' in sans));
});

if (failures > 0) { console.log(`\n${failures} test(s) en échec.`); process.exit(1); }
console.log('\nTous les tests passent.');
