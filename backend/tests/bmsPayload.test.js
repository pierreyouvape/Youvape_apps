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

test('« par 1 » CONTREDIT le catalogue, il ne s\'y soumet pas', () => {
  // Le catalogue conditionne par 6 ; la ligne dit « par 1 ». C'est la ligne qui
  // gagne : 30 pièces à 2 €, et BMS reçoit un conditionnement de 1.
  const [l] = buildBmsItems(
    [{ sku: 'X', qty_ordered: 30, unit_price: 2, pack_qty: 6, units_per_qty: 1 }], false,
  );
  assert.strictEqual(l.qty, 30);
  assert.strictEqual(l.price, 2);
  assert.strictEqual(l.pack_qty, 1);
});

test('« par 1 » tient même chez un fournisseur compté au pack (bug LCA du 29/09/2026)', () => {
  // Commande « test Maxime 2 » : 5 FRM 3mg par 1 à 1,50 €. Le test « > 1 »
  // écartait l'intention, la ligne retombait sur le pack catalogue de LCA et
  // BMS recevait 25 pièces en packs de 5 — cinq fois la commande.
  const [l] = buildBmsItems(
    [{ sku: '9736-9850', qty_ordered: 5, unit_price: 1.5, pack_qty: 5, units_per_qty: 1 }], true,
  );
  assert.strictEqual(l.qty, 5, 'cinq pièces commandées, cinq pièces envoyées');
  assert.strictEqual(l.pack_qty, 1);
  assert.strictEqual(l.price, 1.5);
});

test('sans units_per_qty, le catalogue décide comme avant', () => {
  // Chemin de l'import PDF : rien n'est imposé, la convention fournisseur joue.
  const [aUnite] = buildBmsItems([{ sku: 'X', qty_ordered: 30, unit_price: 2, pack_qty: 6 }], false);
  assert.strictEqual(aUnite.qty, 30);
  assert.strictEqual(aUnite.price, 12);

  const [auPack] = buildBmsItems([{ sku: 'X', qty_ordered: 1, unit_price: 54, pack_qty: 200 }], true);
  assert.strictEqual(auPack.qty, 200);
  assert.strictEqual(auPack.price, 54);
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
