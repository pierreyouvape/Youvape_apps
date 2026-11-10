/**
 * Banc du catalogue caisse : `node tests/catalogSync.test.js` (ou `npm test`).
 * Couvert : doublons par le nom, catégorie apprise, décision de prix.
 */

const assert = require('assert');
const {
  normalize, similarity, closest, DOUBLON_SCORE, pickCategory, priceDecision, priceGapPct,
} = require('../src/services/catalogSyncRules');

// ── Normalisation ───────────────────────────────────────────────────────────
assert.strictEqual(normalize('Fraise Kiwi 10 ml - Fruizée'), 'fraise kiwi 10ml fruizee');
assert.strictEqual(normalize('Box &amp; Batterie 3000 mAh'), 'box batterie 3000mah');

// ── Doublons ────────────────────────────────────────────────────────────────
const site = { name: 'Fruizee Fraise Kiwi 10ml', brand: 'Fruizee' };
assert.ok(similarity(site, { name: 'FRAISE KIWI 10ML - FRUIZEE', brand: 'Eliquid France' }) >= DOUBLON_SCORE,
  'même article nommé autrement : doublon');
assert.ok(similarity(site, { name: 'POMME KIWI 10ML - FRUIZEE', brand: 'Eliquid France' }) < DOUBLON_SCORE,
  'autre parfum de la gamme : pas un doublon');
assert.ok(similarity(site, { name: 'FRAISE KIWI 50ML - FRUIZEE', brand: '' }) < DOUBLON_SCORE,
  'autre contenance : pas un doublon');
assert.ok(similarity({ name: 'Concentré The Wooky Oil 30ml', brand: 'Fruity Fuel' }, { name: 'THE WOOKY OIL 100ML - FRUITY FUEL', brand: 'Fruity Fuel' }) < DOUBLON_SCORE,
  '30 ml contre 100 ml');
assert.ok(similarity({ name: 'Kit Pod Kiwi 2 - Iron Gate', brand: 'Kiwi Vapor' }, { name: 'KIT KIWI 2 - KIWI VAPOR - IRON GATE', brand: 'Kiwi Vapor' }) >= DOUBLON_SCORE,
  'kit nommé autrement');
assert.ok(similarity({ name: 'Booster YouBoost 50/50', brand: 'YouBoost' }, { name: 'RESISTANCES M SERIES COIL', brand: 'Geekvape' }) < 0.2, 'sans rapport');

const list = [
  { id: '1', name: 'FRAISE KIWI 10ML - FRUIZEE', brand: '' },
  { id: '2', name: 'POMME KIWI 10ML - FRUIZEE', brand: '' },
  { id: '3', name: 'MENTHE VERTE 10ML', brand: '' },
];
assert.deepStrictEqual(closest(site, list).map((c) => c.id), ['1', '2'], 'les plus proches d\'abord, sans les éloignées');

// ── Catégorie ───────────────────────────────────────────────────────────────
const stats = [
  { cat: 'E-liquide', sub: 'Eliquides 10ml', nx_category_id: '1', n: 358, tot: 363 },
  { cat: 'Kits', sub: 'Kits Format Box', nx_category_id: '18', n: 125, tot: 184 },
  { cat: 'Accessoires', sub: 'Chargeurs', nx_category_id: '13', n: 6, tot: 6 },
];
assert.deepStrictEqual(pickCategory(stats, 'E-liquide', 'Eliquides 10ml').sure, true, '99 % sur 363 : sûre');
assert.strictEqual(pickCategory(stats, 'Kits', 'Kits Format Box').sure, false, '68 % : à vérifier');
assert.strictEqual(pickCategory(stats, 'Kits', 'Kits Format Box').categoryId, '18', 'mais proposée');
assert.strictEqual(pickCategory(stats, 'Accessoires', 'Chargeurs').sure, false, '6 paires : trop peu');
assert.strictEqual(pickCategory(stats, 'Inconnue', null).categoryId, null);

// ── Prix ────────────────────────────────────────────────────────────────────
assert.strictEqual(priceDecision({ sitePrice: 5.9, nxPrice: 5.9, state: null }), 'same');
assert.strictEqual(priceDecision({ sitePrice: 5.9, nxPrice: 6.9, state: null }), 'review', '1re fois, écart : on demande');
assert.strictEqual(priceDecision({ sitePrice: 6.5, nxPrice: 5.9, state: { price_pushed: 5.9 } }), 'push', 'prix du site changé : on envoie');
assert.strictEqual(priceDecision({ sitePrice: 5.9, nxPrice: 7.0, state: { price_pushed: 5.9 } }), 'none', 'site inchangé : la caisse n\'est pas réécrite');
assert.strictEqual(priceDecision({ sitePrice: 6.5, nxPrice: 5.9, state: { price_pushed: 5.9, price_locked: true } }), 'locked');
assert.strictEqual(priceDecision({ sitePrice: 0, nxPrice: 5.9, state: null }), 'none', 'sans prix site : rien');
assert.strictEqual(priceGapPct(99, 69.9), -29.4);

console.log('✓ catalogSync.test.js');
