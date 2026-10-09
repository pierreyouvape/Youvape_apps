/**
 * Dernier tarif validé (pré-remplissage de l'import, colonne « Tarif achat » des
 * Besoins). `node tests/verifiedPrice.test.js` (ou `npm test`).
 *
 * Imports LCA 358982 et 359495 (01 et 05/10/2026) : sans tarif catalogue, le prix
 * du pack (8,70 €, ligne comptée par 10) était remultiplié par 10 — 87 € le pack,
 * soit 8,70 € la pièce envoyés à BMS. L'écart s'est vu à la facture F2610415977.
 */

const assert = require('assert');
const { normalizeVerifiedPrice } = require('../src/utils/verifiedPrice');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); } catch (err) { failures++; console.log(`  FAIL ${name}\n       ${err.message}`); }
}

console.log('\nDernier tarif validé');

test('LCA, ligne en packs, sans tarif catalogue : prix du pack, pas ×10', () => {
  assert.strictEqual(normalizeVerifiedPrice({ supplierCode: 'LCA', unitPrice: '8.7000', unitsPerQty: 10, packQty: 10, supplierPrice: null }), 8.7);
});
test('LCA, ligne en pièces, sans tarif catalogue : pièce × pack', () => {
  assert.strictEqual(normalizeVerifiedPrice({ supplierCode: 'LCA', unitPrice: '0.8700', unitsPerQty: 1, packQty: 10, supplierPrice: null }), 8.7);
});
test('LCA avec tarif catalogue : le catalogue prime', () => {
  assert.strictEqual(normalizeVerifiedPrice({ supplierCode: 'LCA', unitPrice: '8.7000', unitsPerQty: 10, packQty: 10, supplierPrice: '8.70' }), 8.7);
});
test('fournisseur normal, ligne en lots : prix de la pièce', () => {
  assert.strictEqual(normalizeVerifiedPrice({ supplierCode: 'JOSHNOA', unitPrice: '6.50', unitsPerQty: 5, packQty: 5, supplierPrice: null }), 1.3);
});

if (failures) { console.log(`\n${failures} échec(s)`); process.exit(1); }
console.log('\nTous les tests passent.');
