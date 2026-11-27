/**
 * Catégorie retenue pour un produit : `node tests/categoryRules.test.js` (ou `npm test`).
 */

const assert = require('assert');
const { pickCategory, primarySlug } = require('../src/services/categoryRules');

const terms = [
  { id: 1, name: 'E-liquide pour cigarette électronique', slug: 'eliquides', parent: 0 },
  { id: 2, name: 'Eliquides 10ml', slug: 'eliquides-10ml', parent: 1 },
  { id: 3, name: 'Eliquides Sel de Nicotine', slug: 'eliquides-sels-de-nicotine', parent: 1 },
  { id: 4, name: 'DLUO', slug: 'dluo', parent: 0 },
  { id: 5, name: 'Non classé', slug: 'non-classe', parent: 0 },
  { id: 6, name: 'Promo E-liquides DLUO', slug: 'promo-eliquides-dluo', parent: 1 },
  { id: 7, name: 'Box &amp; Mods Experts', slug: 'box-mods-experts', parent: 0 },
];
const byId = new Map(terms.map((t) => [t.id, t]));
const P = (ids, permalink) => ({ categories: ids.map((id) => ({ id })), permalink });
const SELS = { category: 'E-liquide pour cigarette électronique', sub_category: 'Eliquides Sel de Nicotine' };
const DIX = { category: 'E-liquide pour cigarette électronique', sub_category: 'Eliquides 10ml' };

// ── Permalien ───────────────────────────────────────────────────────────────
assert.strictEqual(primarySlug('https://www.youvape.fr/produit/eliquides/eliquides-sels-de-nicotine/banana-ice-salt/'), 'eliquides-sels-de-nicotine');
assert.strictEqual(primarySlug('https://www.youvape.fr/produit/eliquides/eliquides-10ml/x'), 'eliquides-10ml');
assert.strictEqual(primarySlug('https://www.youvape.fr/?post_type=product&p=12'), null, 'brouillon');
assert.strictEqual(primarySlug('https://www.youvape.fr/produit/x'), null, 'pas de dossier catégorie');
assert.strictEqual(primarySlug(''), null);
assert.strictEqual(primarySlug('pas une url'), null);

// ── Catégorie principale (Yoast) d'abord ────────────────────────────────────
assert.deepStrictEqual(pickCategory(P([2, 3], 'https://s/produit/eliquides/eliquides-sels-de-nicotine/a'), byId), SELS);
assert.deepStrictEqual(pickCategory(P([2, 3], 'https://s/produit/eliquides/eliquides-10ml/a'), byId), DIX,
  'la principale choisie sur le site fait foi');

// ── Sans principale lisible : sels avant 10 ml (yousync aurait pris 10 ml, par le nom) ──
assert.deepStrictEqual(pickCategory(P([2, 3]), byId), SELS);
assert.deepStrictEqual(pickCategory(P([3, 2, 1]), byId), SELS, 'le terme le plus profond');
assert.deepStrictEqual(pickCategory(P([1]), byId), { category: 'E-liquide pour cigarette électronique', sub_category: null });

// ── Destockage : jamais choisi s'il y a une vraie famille ───────────────────
assert.deepStrictEqual(pickCategory(P([4, 2]), byId), DIX, 'DLUO passait avant par ordre alphabétique');
assert.deepStrictEqual(pickCategory(P([5, 3]), byId), SELS);
assert.deepStrictEqual(pickCategory(P([6, 2]), byId), DIX, 'sous-catégorie promo écartée');
assert.deepStrictEqual(pickCategory(P([4, 2], 'https://s/produit/dluo/a'), byId), DIX, 'même désignée principale');
assert.deepStrictEqual(pickCategory(P([4]), byId), { category: 'DLUO', sub_category: null }, 'seule catégorie : gardée');
assert.deepStrictEqual(pickCategory(P([6]), byId), { category: 'E-liquide pour cigarette électronique', sub_category: 'Promo E-liquides DLUO' });

// ── Principale = parent, produit aussi dans l'enfant : l'enfant ─────────────
const dluoSels = { id: 8, name: 'Eliquides Sel de Nicotine', slug: 'dluo-sels', parent: 4 };
const byId2 = new Map([...byId, [8, dluoSels]]);
assert.deepStrictEqual(pickCategory(P([4, 8], 'https://s/produit/dluo/a'), byId2), { category: 'DLUO', sub_category: 'Eliquides Sel de Nicotine' });
assert.deepStrictEqual(pickCategory(P([1, 3], 'https://s/produit/eliquides/a'), byId), SELS);

// ── Divers ──────────────────────────────────────────────────────────────────
assert.strictEqual(pickCategory(P([]), byId), null);
assert.strictEqual(pickCategory(P([99]), byId), null, 'terme inconnu');
assert.deepStrictEqual(pickCategory(P([7]), byId), { category: 'Box &amp; Mods Experts', sub_category: null },
  'nom brut, comme yousync');

console.log('categoryRules : OK');
