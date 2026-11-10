/**
 * Banc des prélèvements boutique : `node tests/prelevement.test.js` (ou `npm test`).
 *
 * Couvert : coût d'achat figé, pièces boutique (résistances à l'unité), fiche
 * Nextore créée depuis le site, codes-barres à ajouter, choix du produit caisse.
 */

const assert = require('assert');
const {
  siteUnitCost, boutiqueQty, nextoreProductPayload, splitBarcodes, barcodesToAdd, resolveNx, isCleanRefusal,
} = require('../src/services/prelevementRules');

// ── Coût d'achat du site : même règle que la valeur de stock ────────────────
assert.strictEqual(siteUnitCost({ computed_cost: '3.12345', wc_cog_cost: '9' }), 3.1235, 'PMP d\'abord, 4 décimales');
assert.strictEqual(siteUnitCost({ computed_cost: null, wc_cog_cost: '2.5' }), 2.5, 'repli sur le coût WC');
assert.strictEqual(siteUnitCost({ computed_cost: '0', wc_cog_cost: null }), null, 'coût nul = inconnu');

// ── Pièces boutique ─────────────────────────────────────────────────────────
const resistance = { category_name: 'RESISTANCES' };
assert.strictEqual(boutiqueQty(2, 'Pack 5 résistances Zenith 0.4', resistance), 10, 'résistances : 2 packs de 5 = 10 pièces');
assert.strictEqual(boutiqueQty(2, 'Pack 5 cartouches Xros', { category_name: 'CARTOUCHES' }), 2, 'cartouches : à la boîte');
assert.strictEqual(boutiqueQty(3, 'Fruizee 50ml', null), 3, 'sans produit caisse : 1 pour 1');

// ── Fiche créée dans la caisse ──────────────────────────────────────────────
const site = { name: 'Flacon Unicorn V3 10ml', regular_price: '1.50', price: '1.20', computed_cost: '0.31', wp_product_id: 4242 };
const payload = nextoreProductPayload(site, { categoryId: 12, barcodes: ['3700000000011', '3700000000028'] });
assert.deepStrictEqual(payload, {
  name: 'Flacon Unicorn V3 10ml', price: 1.5, cost: 0.31, category_id: '12', tax_rate: '4', type: 'standard',
  barcode: '3700000000011;3700000000028', link_code: '4242',
}, 'prix normal du site (pas la promo), TVA 20 % = code 4');
assert.strictEqual(nextoreProductPayload({ ...site, regular_price: '' }, { categoryId: 1, barcodes: [] }).price, 1.2, 'sans prix normal : prix courant');
assert.throws(() => nextoreProductPayload({ ...site, regular_price: '0', price: '0' }, { categoryId: 1, barcodes: [] }), /sans prix/);
assert.throws(() => nextoreProductPayload(site, { categoryId: '', barcodes: [] }), /catégorie/);

// ── Codes-barres ────────────────────────────────────────────────────────────
assert.deepStrictEqual(splitBarcodes('123; 456;;789'), ['123', '456', '789']);
assert.deepStrictEqual(barcodesToAdd('111;222', ['222', '333', '333']), ['333'], 'seulement ceux qui manquent, sans doublon');
assert.deepStrictEqual(barcodesToAdd(null, ['111']), ['111']);

// ── Produit caisse ──────────────────────────────────────────────────────────
assert.deepStrictEqual(resolveNx({ nx_product_id: '9', source: 'manual' }, ['1', '2']), { nxProductId: '9', how: 'manual' }, 'le lien enregistré prime');
assert.deepStrictEqual(resolveNx(null, ['5', '5']), { nxProductId: '5', how: 'ean' }, 'un seul produit par code-barres');
assert.strictEqual(resolveNx(null, ['5', '6']).how, 'ambiguous', 'deux produits : on ne choisit pas');
assert.strictEqual(resolveNx(null, []).nxProductId, null);

// ── Refus net ───────────────────────────────────────────────────────────────
assert.ok(isCleanRefusal('Nextore PUT /stocks → HTTP 422 x'));
assert.ok(!isCleanRefusal('fetch failed'));

console.log('✓ prelevement.test.js');
