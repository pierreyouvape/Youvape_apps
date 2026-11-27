/**
 * Banc des transferts de stock site ↔ boutiques : `node tests/stockTransfer.test.js` (ou `npm test`).
 *
 * Couvert : quantités saisies dans l'unité de l'origine (résistances « Pack N »
 * au site, à l'unité en boutique), coût d'une pièce boutique, montant de la
 * refacturation, état de la réception lu sur la commande.
 */

const assert = require('assert');
const {
  lineQuantities, shopUnitCost, lineTotal, receptionState, isEditable, SITE_SUPPLIER_BY_WAREHOUSE,
} = require('../src/services/transferRules');

// ── Quantités ───────────────────────────────────────────────────────────────
// Site → boutique : on compte des articles du site
assert.deepStrictEqual(lineQuantities('site_to_shop', 3, 1), { qtySite: 3, qtyShop: 3 });
assert.deepStrictEqual(lineQuantities('site_to_shop', 2, 5), { qtySite: 2, qtyShop: 10 }, '2 packs de 5 résistances = 10 pièces boutique');
// Boutique → site : on compte des pièces boutique
assert.deepStrictEqual(lineQuantities('shop_to_site', 10, 5), { qtySite: 2, qtyShop: 10 });
assert.ok(lineQuantities('shop_to_site', 7, 5).error, '7 résistances ne font pas un nombre entier de packs du site');
assert.ok(lineQuantities('site_to_shop', 0, 1).error, 'zéro refusé');
assert.ok(lineQuantities('site_to_shop', 1.5, 1).error, 'pas de demi-pièce');
assert.ok(lineQuantities('site_to_shop', '', 1).error, 'vide refusé');

// ── Coûts ───────────────────────────────────────────────────────────────────
assert.strictEqual(shopUnitCost(4.5, 2, 10), 0.9, 'pack de 5 à 4,50 € = 0,90 € la pièce boutique');
assert.strictEqual(shopUnitCost(3.12345, 1, 1), 3.1235, '4 décimales');
assert.strictEqual(lineTotal(4.5, 2), 9, 'refacturation = articles du site × coût du site');
assert.strictEqual(lineTotal(null, 2), null);

// ── Réception ───────────────────────────────────────────────────────────────
assert.strictEqual(receptionState(null), 'none', 'commande pas encore créée');
assert.strictEqual(receptionState({ kind: 'boutique', status: 'open', received: 0 }), 'waiting');
assert.strictEqual(receptionState({ kind: 'boutique', status: 'open', received: 4 }), 'partial');
assert.strictEqual(receptionState({ kind: 'boutique', status: 'received', received: 4 }), 'received', 'soldée avec un manquant = reçue');
assert.strictEqual(receptionState({ kind: 'achat', status: 'sent', received: 0 }), 'waiting');
assert.strictEqual(receptionState({ kind: 'achat', status: 'partial', received: 3 }), 'partial');
assert.strictEqual(receptionState({ kind: 'achat', status: 'completed', received: 3 }), 'received');
assert.strictEqual(receptionState({ kind: 'achat', status: 'cancelled', received: 0 }), 'cancelled');

// ── Divers ──────────────────────────────────────────────────────────────────
assert.strictEqual(isEditable({ status: 'draft' }), true);
assert.strictEqual(isEditable({ status: 'sent' }), false, 'un transfert envoyé ne se modifie plus');
assert.deepStrictEqual(SITE_SUPPLIER_BY_WAREHOUSE, { 1: 39, 2: 38 }, 'Montpellier → YouVape Montpelliier, Castelnau → YouVape Castelnau');

console.log('stockTransfer.test.js : OK');
