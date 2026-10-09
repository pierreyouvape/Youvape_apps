/**
 * Banc de l'Inventaire : `node tests/inventory.test.js` (ou `npm test`).
 *
 * Ce qui est couvert :
 *   - la règle de recomptage (5 pièces ET plus de 15 % du théorique) ;
 *   - l'allée d'un emplacement et le tri des emplacements ;
 *   - le prélevé non expédié d'une vague, déduit du physique BMS.
 */

const assert = require('assert');
const { needsRecount, aisleOf, compareLocations, pickedNotShipped } = require('../src/services/inventoryRules');

// ── Recomptage ──────────────────────────────────────────────────────────────
assert.strictEqual(needsRecount(10, 10), false, 'aucun écart');
assert.strictEqual(needsRecount(4, 0), false, 'théorique 0, 4 trouvés : ok');
assert.strictEqual(needsRecount(5, 0), true, 'théorique 0, 5 trouvés : on recompte');
assert.strictEqual(needsRecount(0, 4), false, '4 manquants : sous les 5 pièces');
assert.strictEqual(needsRecount(2, 7), true, '5 manquants sur 7 : 71 %');
assert.strictEqual(needsRecount(95, 100), false, '5 sur 100 = 5 % : ok');
assert.strictEqual(needsRecount(85, 100), false, '15 sur 100 = 15 % pile : ok');
assert.strictEqual(needsRecount(84, 100), true, '16 sur 100 : on recompte');
assert.strictEqual(needsRecount(40, 30), true, '+10 sur 30 = 33 %');
assert.strictEqual(needsRecount(206, 200), false, '+6 sur 200 = 3 %');

// ── Emplacements ────────────────────────────────────────────────────────────
assert.strictEqual(aisleOf('E 2-2-13'), 'E');
assert.strictEqual(aisleOf('b 3-4'), 'B');
assert.strictEqual(aisleOf('Z1-4'), 'Z1');
assert.strictEqual(aisleOf(''), '');
assert.deepStrictEqual(['A 10-1', '', 'A 2-1', 'B 1-1'].sort(compareLocations), ['A 2-1', 'A 10-1', 'B 1-1', '']);

// ── Prélevé non expédié ─────────────────────────────────────────────────────
// Vague de 3 commandes : 1001 (2 boosters) déjà expédiée, 1002 (1 booster +
// 1 kit) et 1003 (3 boosters) pas encore. 6 boosters pris, kit manquant.
const unshipped = [
  { orderNumber: '1002', lines: [{ sku: 'BOOST', productId: 11, name: 'Booster', qty: 1 }, { sku: 'KIT', productId: 12, name: 'Kit', qty: 1 }] },
  { orderNumber: '1003', lines: [{ sku: 'BOOST', productId: 11, name: 'Booster', qty: 3 }] },
];
const lines = [
  { line_key: 'BOOST', product_id: 11, picked: 6 },
  { line_key: 'KIT', product_id: 12, picked: 0 },
];
assert.deepStrictEqual([...pickedNotShipped(unshipped, lines)], [[11, 4]], '4 boosters hors rayon, pas le kit manquant');

// Une partie seulement prise : on ne déduit que ce qui a quitté le rayon.
assert.deepStrictEqual([...pickedNotShipped(unshipped, [{ line_key: 'BOOST', product_id: 11, picked: 3 }])], [[11, 3]]);

// Tout est parti : rien à déduire.
assert.strictEqual(pickedNotShipped([], lines).size, 0);

console.log('inventory.test.js : OK');
