/**
 * Le payload d'articles envoyé à BMS.
 *
 * Deux conventions cohabitent depuis toujours, et les confondre a déjà coûté un
 * bug de prix ×10 en production (project_bms_skippackqty_price_x10). Une
 * troisième arrive avec la commande construite dans l'app : une ligne peut
 * porter SON conditionnement, indépendamment du fournisseur.
 *
 * Ces tests figent les trois, parce qu'aucun n'est devinable à la lecture.
 */
const assert = require('assert');
const { buildBmsItems } = require('../src/models/purchaseOrderModel');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures += 1; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

console.log('\nPayload BMS — conventions de conditionnement');

test('fournisseur à l\'unité : qty tel quel, prix ramené au pack', () => {
  // JoshNoa : 100 pièces à 1,36 €, conditionnées par 10 au catalogue.
  // BMS veut des pièces et un prix de PACK.
  const [l] = buildBmsItems(
    [{ sku: 'X', qty_ordered: 100, unit_price: 1.36, pack_qty: 10 }], false,
  );
  assert.strictEqual(l.qty, 100);
  assert.strictEqual(l.price, 13.60);
  assert.strictEqual(l.pack_qty, 10);
});

test('fournisseur au pack : qty converti en pièces, prix INCHANGÉ', () => {
  // LCA : 1 pack de 200 à 54,00 €. Remultiplier le prix, c'est le bug ×10.
  const [l] = buildBmsItems(
    [{ sku: 'X', qty_ordered: 1, unit_price: 54, pack_qty: 200 }], true,
  );
  assert.strictEqual(l.qty, 200);
  assert.strictEqual(l.price, 54);
});

test('conditionnement choisi à la ligne : traité comme un pack, même chez un fournisseur à l\'unité', () => {
  // « 4 packs de 5 » chez un fournisseur normalement compté à l'unité.
  // 20 pièces doivent partir, au prix du pack.
  const [l] = buildBmsItems(
    [{ sku: 'X', qty_ordered: 4, unit_price: 7.5, pack_qty: 1, units_per_qty: 5 }], false,
  );
  assert.strictEqual(l.qty, 20);
  assert.strictEqual(l.price, 7.5);
  assert.strictEqual(l.pack_qty, 5);
});

test('le conditionnement de la ligne l\'emporte sur celui du catalogue', () => {
  const [l] = buildBmsItems(
    [{ sku: 'X', qty_ordered: 2, unit_price: 20, pack_qty: 10, units_per_qty: 25 }], false,
  );
  assert.strictEqual(l.pack_qty, 25);
  assert.strictEqual(l.qty, 50);
  assert.strictEqual(l.price, 20);
});

test('units_per_qty à 1 ne change rien : c\'est une ligne à l\'unité', () => {
  const [l] = buildBmsItems(
    [{ sku: 'X', qty_ordered: 30, unit_price: 2, pack_qty: 6, units_per_qty: 1 }], false,
  );
  assert.strictEqual(l.qty, 30);
  assert.strictEqual(l.price, 12);
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
