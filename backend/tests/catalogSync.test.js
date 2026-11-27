/**
 * Banc du catalogue caisse : `node tests/catalogSync.test.js` (ou `npm test`).
 * Couvert : doublons par le nom, catégorie apprise, décision de prix.
 */

const assert = require('assert');
const {
  normalize, similarity, closest, isSameName, isResistance, pickBrand, DOUBLON_SCORE, pickCategory, pickSubcategory, refineCategoryName, cartridgeKind, priceDecision, priceGapPct,
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

// ── Même article sous un autre nom (cas réels de la simulation du 10/11/2026) ─
const same = (a, ab, b, bb) => isSameName({ name: a, brand: ab }, { name: b, brand: bb });
assert.ok(same('Box Aegis Solo 5 - Red', 'Geekvape', 'BOX AEGIS SOLO 5 - GEEKVAPE - RED', 'Geekvape'), 'même box, marque recopiée dans le nom caisse');
assert.ok(same('Fruizee Fraise Kiwi 10ml', 'Fruizee', 'FRAISE KIWI 10ML - FRUIZEE', 'Eliquid France'), 'mots dans un autre ordre');
assert.ok(same('Pack 5 Résistances B Series Coils MTL - 1.20 Ω', 'Geekvape', 'Pack 5 Résistances B Series Coils - 1.20 Ω MTL', ''), 'même résistance');
assert.ok(same('Kit Pod Kiwi 2 - Iron Gate', 'Kiwi Vapor', 'KIT KIWI 2 - KIWI VAPOR - IRON GATE', 'Kiwi Vapor'), '« pod » ne distingue pas');
assert.ok(!same('Puff JNR Falcon Mini 20K - Strawberry Watermelon Ice', 'JNR', 'Puff JNR Falcon Mini 20K - Watermelon Ice', 'JNR'), 'un parfum de plus');
assert.ok(!same('Dead Rabbit 4 RDA - Black Silver', 'Hellvape', 'Dead Rabbit 4 RDA - Black Red', 'Hellvape'), 'autre couleur');
assert.ok(!same('Pack 3 Cartouches Klypse V2 - 1.20 Ω', 'Innokin', 'Pack 3 Cartouches Klypse V2 - 0.60 Ω', 'Innokin'), 'autre résistance');
assert.ok(!same('Puff CBD Wilo 10% - White Window', 'Wilo', 'Recharges Wilo CBD 10% - White Window', 'Wilo'), 'puff ≠ recharge');
assert.ok(!same('Puff JNR Gorilla X 43k sans Nicotine - Cherry Ice', 'JNR', 'Gorilla X 43K - 20mg - Cherry Ice', 'JNR'), 'autre dosage');
// 2e passe (même jour) : marques différentes et mots répétés
assert.ok(!same('Don Cristo Custard 50ml', 'Don Cristo', 'CUSTARD 50ML - DOTMOD', 'DOTMOD'), 'autre marque');
assert.ok(!same('LE M - 3mg', 'Roykin', 'LE M  - LIQUIDEO - 3 MG', 'liquideo'), 'autre marque (Roykin / Liquideo)');
assert.ok(!same('Pack 2 Cartouches Pod Feelin', 'Nevoks', 'PACK 2 CARTOUCHES FEELIN 2 - NEVOKS', 'Nevoks'), 'Feelin ≠ Feelin 2');
assert.ok(!isSameName({ name: 'Mangue Passion 50ml', brand: 'Eliquid France', sub_brand: 'Fruizee Max' }, { name: 'PASSION MANGUE 50ML - PRODIGY', brand: 'PRODIGY' }), 'Fruizee ≠ Prodigy');
assert.ok(isSameName({ name: 'Babagada - 3mg', brand: 'Maison Fuel', sub_brand: 'Cupide' }, { name: 'BABAGADA - CUPIDE - 3 MG', brand: 'Cupide' }), 'la sous-marque du site compte');
assert.ok(same('Beginning 50ml Hors Série', 'Dilligaf', 'BEGINNING HORS SERIE 50ML - DILIGAF', 'DILIGAF'), 'faute de frappe sur la marque');
assert.ok(same('USA Classic - 6mg', 'Dlice', 'USA CLASSIC - DLIC - 6MG', 'DLIC'), 'DLIC / Dlice');
assert.ok(same('Bouteille Twist Graduée 120ml', 'Oem', 'BOUTEILLE GRADUEE TWIST 120ML', ''), 'caisse sans marque');

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

// ── Résistances laissées de côté ────────────────────────────────────────────
assert.ok(isResistance('Pack 5 Résistances M Series Coils - 0.15 Ω', 'RESISTANCES'));
assert.ok(isResistance('Pack 5 Résistances GTX - 1.20 Ω Mesh', null), 'par le nom seul');
assert.ok(!isResistance('Pack 10 Coils Dual Core Fused Clapton Ni80', 'COIL'), 'fils montés : créables');
assert.ok(!isResistance('Pack 3 Cartouches Xlim - résistance intégrée 1.20 Ω', 'CARTOUCHES'), 'cartouches : créables');

// ── Marque écrite sur la fiche caisse ───────────────────────────────────────
const nxBrands = ['Cupide', 'FRUITY FUEL', 'Liquideo', 'ASPIRE', 'Aspire', 'DILIGAF'];
assert.strictEqual(pickBrand({ brand: 'Maison Fuel', sub_brand: 'Cupide' }, nxBrands), 'Cupide', 'sous-marque connue');
assert.strictEqual(pickBrand({ brand: 'Maison Fuel', sub_brand: 'Fruity Fuel' }, nxBrands), 'FRUITY FUEL', 'orthographe Nextore reprise');
assert.strictEqual(pickBrand({ brand: 'Liquideo', sub_brand: 'Wpuff' }, nxBrands), 'Liquideo', 'sous-marque inconnue, marque connue');
assert.strictEqual(pickBrand({ brand: 'Dilligaf', sub_brand: null }, nxBrands), 'DILIGAF', 'une lettre d\'écart');
assert.strictEqual(pickBrand({ brand: 'JNR', sub_brand: '' }, nxBrands), 'JNR', 'marque nouvelle : celle du site');
assert.strictEqual(pickBrand({ brand: '', sub_brand: '' }, nxBrands), null);

// ── Prix ────────────────────────────────────────────────────────────────────
assert.strictEqual(priceDecision({ sitePrice: 5.9, nxPrice: 5.9, state: null }), 'same');
assert.strictEqual(priceDecision({ sitePrice: 5.9, nxPrice: 6.9, state: null }), 'review', '1re fois, écart : on demande');
assert.strictEqual(priceDecision({ sitePrice: 6.5, nxPrice: 5.9, state: { price_pushed: 5.9 } }), 'push', 'prix du site changé : on envoie');
assert.strictEqual(priceDecision({ sitePrice: 5.9, nxPrice: 7.0, state: { price_pushed: 5.9 } }), 'none', 'site inchangé : la caisse n\'est pas réécrite');
assert.strictEqual(priceDecision({ sitePrice: 6.5, nxPrice: 5.9, state: { price_pushed: 5.9, price_locked: true } }), 'locked');
assert.strictEqual(priceDecision({ sitePrice: 0, nxPrice: 5.9, state: null }), 'none', 'sans prix site : rien');
assert.strictEqual(priceGapPct(99, 69.9), -29.4);

// Sous-catégorie caisse des fiches créées (27/11/2026 : ~850 liquides en « E-LIQUIDES » seul).
const subs = [
  { id: '2', category_id: '1', name: '10 ml' }, { id: '1', category_id: '1', name: '50 ml' },
  { id: '7', category_id: '1', name: '100 ml' }, { id: '16', category_id: '1', name: '200 ml' },
  { id: '13', category_id: '1', name: 'Salt' }, { id: '14', category_id: '1', name: 'CBD' },
  { id: '5', category_id: '6', name: '10 ml' }, { id: '17', category_id: '6', name: '30 ml' },
];
const LIQ = { categoryId: '1', categoryName: 'E-LIQUIDES' };
const ARO = { categoryId: '6', categoryName: 'AROMES' };
const GF = 'Eliquides Grands Formats 50ml, 100ml, 200ml';
assert.strictEqual(pickSubcategory({ name: 'Menthe Intense 10ml', sub: 'Eliquides 10ml' }, { ...LIQ, nxName: 'MENTHE INTENSE 10ML - NATURAL - 12MG' }, subs), '2');
assert.strictEqual(pickSubcategory({ name: 'Green Dragon 50ml', sub: GF }, { ...LIQ, nxName: 'PACK GREEN DRAGON 60ML - MY PULP - 3MG' }, subs), '1', 'pack 60 ml = 50 ml');
assert.strictEqual(pickSubcategory({ name: 'Talok 100ml', sub: GF }, { ...LIQ, nxName: 'TALOK 100ML - ARTEFACT' }, subs), '7');
assert.strictEqual(pickSubcategory({ name: 'Flipz 200ml', sub: GF }, { ...LIQ, nxName: 'FLIPZ 200ML XXL - BELGI OHM' }, subs), '16');
assert.strictEqual(pickSubcategory({ name: 'Granité Fruits Bleus 10ml', sub: 'Eliquides Sel de Nicotine' }, { ...LIQ, nxName: 'GRANITE FRUITS BLEUS POD LIQUIDE 10ML - LE POD LIQUIDE - 10MG' }, subs), '13', 'sel avant contenance');
assert.strictEqual(pickSubcategory({ name: 'Jack Herer CBD', sub: 'E-liquides CBD - Cannabis' }, { ...LIQ, nxName: 'JACK HERER CBD 2000MG - WHITE RABIT' }, subs), '14');
assert.strictEqual(pickSubcategory({ name: 'Saturn 170ml', sub: GF }, { ...LIQ, nxName: 'SATURN 170ML - CUSTARD MISSION' }, subs), null, '170 ml : aucune sous-catégorie');
assert.strictEqual(pickSubcategory({ name: 'Caramel Latte 30ml', sub: 'Arômes et Concentrés Grands Formats' }, { ...ARO, nxName: 'CONCENTRE CARAMEL LATTE 30ML - VAMPIRE VAPE' }, subs), '17');
assert.strictEqual(pickSubcategory({ name: 'Bonbon Acidulé', sub: 'Arômes et Concentrés 10ml' }, { ...ARO, nxName: 'CONCENTRE BONBON ACIDULE - SUPERVAPE' }, subs), '5', 'contenance lue dans la catégorie du site');
assert.strictEqual(pickSubcategory({ name: 'Pod Xros 4', sub: 'Pods' }, { categoryId: '19', categoryName: 'POD', nxName: 'XROS 4' }, subs), null, 'hors liquides : rien');
assert.strictEqual(pickSubcategory({ name: 'X 10ml', sub: '' }, { ...LIQ, categoryId: '99', nxName: 'X 10ML' }, subs), null, 'sous-catégorie d\'une autre catégorie : jamais');

// Box / kit : attribut WC « Types de batteries ».
const accuSubs = [
  { id: '6', category_id: '7', name: '1 accu' }, { id: '15', category_id: '7', name: '2 accus' },
  { id: '20', category_id: '18', name: '1 accu' }, { id: '21', category_id: '18', name: '2 accus' },
];
const BOXA = { categoryId: '7', categoryName: 'BOX ACCU' };
const KITA = { categoryId: '18', categoryName: 'KIT ACCU' };
assert.strictEqual(pickSubcategory({ name: 'Box Huracan EX', battery: 'Simple accu' }, BOXA, accuSubs), '6');
assert.strictEqual(pickSubcategory({ name: 'Kit Gen Max', battery: 'Double accu' }, KITA, accuSubs), '21');
assert.strictEqual(pickSubcategory({ name: 'Box X', battery: 'Simple accu | Double accu' }, BOXA, accuSubs), null, 'deux valeurs : on ne tranche pas');
assert.strictEqual(pickSubcategory({ name: 'Batterie Elfa Turbo', battery: null }, BOXA, accuSubs), null, 'sans attribut : rien');
assert.strictEqual(refineCategoryName('KIT ACCU', 'Batterie intégrée'), 'KIT INTEGRE', 'Huracan LX');
assert.strictEqual(refineCategoryName('BOX ACCU', 'Batterie intégrée'), 'BOX INTEGRE', 'Kiwi Power Bank');
assert.strictEqual(refineCategoryName('BOX INTEGRE', 'Double accu'), 'BOX ACCU');
assert.strictEqual(refineCategoryName('BOX ACCU', 'Simple accu'), 'BOX ACCU');
assert.strictEqual(refineCategoryName('BOX ACCU', null), 'BOX ACCU', 'sans attribut : inchangée');
assert.strictEqual(refineCategoryName('POD', 'Batterie intégrée'), 'POD', 'autre catégorie : jamais déplacée');

// Cartouches (27/11/2026).
const CP = 'Cartouches Pods';
assert.strictEqual(cartridgeKind({ name: 'Cartouches CLK One 20mg - Fraise', sub: 'Cartouches Pré-remplies' }), 'PREREMPLIE');
assert.strictEqual(cartridgeKind({ name: 'Pack 2 Cartouches Pixo - 0.40 Ω', sub: CP }), 'Resistance');
assert.strictEqual(cartridgeKind({ name: 'Pack 2 Cartouches Fluffi - 1 Ω', sub: CP }), 'Resistance', 'Ω en fin de nom');
assert.strictEqual(cartridgeKind({ name: 'Pack 2X Cartouches J Series (résistances intégrées)', sub: CP }), 'Resistance');
assert.strictEqual(cartridgeKind({ name: 'Cartouche vide DotPod Max - Red', sub: CP }), 'Vide');
assert.strictEqual(cartridgeKind({ name: 'Pack 2 Cartouches Argus (résistance interchangeable)', sub: CP }), 'Vide');
assert.strictEqual(cartridgeKind({ name: 'Aegis Boost Rba', sub: CP }), 'Vide');
assert.strictEqual(cartridgeKind({ name: 'Pack 2 Cartouches Pod Feelin', sub: CP, coils_compatible: 'SPL 10 (Nevoks)' }), 'Vide');
assert.strictEqual(cartridgeKind({ name: 'Cartouche ElfX Mega - 10 ml', sub: CP, coil_value: '0.60 Ω' }), 'Resistance');
assert.strictEqual(cartridgeKind({ name: 'Pack 3 Cartouches Argus Multi-Ohm', sub: CP }), null, '« Multi-Ohm » sans valeur : on ne devine pas');
assert.strictEqual(cartridgeKind({ name: 'Cartouche Meteorite - Cyan', sub: CP }), null);
assert.strictEqual(cartridgeKind({ name: 'Reservoir Tank DotAio V4', sub: 'Réservoirs de Rechange' }), null);
const cartSubs = [{ id: '24', category_id: '2', name: 'PREREMPLIE' }, { id: '23', category_id: '2', name: 'Resistance' }, { id: '22', category_id: '2', name: 'Vide' }];
assert.strictEqual(pickSubcategory({ name: 'Cartouche Avata - 0.60 Ω', sub: CP }, { categoryId: '2', categoryName: 'CARTOUCHES' }, cartSubs), '23');

console.log('✓ catalogSync.test.js');
