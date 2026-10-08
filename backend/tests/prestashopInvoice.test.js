/**
 * Lecture des factures PrestaShop — Cosmer, Highbuy, Curieux, CigAccess,
 * e.tasty, MG Vape, Pulp.
 *
 * Sans dépendance ni base : `node tests/prestashopInvoice.test.js` (ou `npm test`).
 *
 * Les sept tournent sur le texte pdf-parse des VRAIS PDF, repris intégralement :
 * leur total imprimé doit retomber sur la somme des lignes lues. C'est le seul
 * contrôle qui prouve qu'aucune ligne n'a été perdue, et il vaut mieux que tous
 * les tests unitaires du monde sur ce genre de code.
 *
 * Ce gabarit inverse l'ordre des colonnes : le PRIX précède la QUANTITÉ. Les
 * intervertir ne lève aucune erreur, ça fabrique des écarts imaginaires — d'où
 * les vérifications explicites de quantité ci-dessous.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseInvoice } = require('../src/parsers/invoices/prestashopInvoice');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}
const close = (a, b, eps = 0.005) => Math.abs(a - b) < eps;
const byRef = (res, ref) => res.lines.find((l) => l.ref === ref);

function cleanPdfText(text) {
  return text
    .replace(/[       ﻿]/g, ' ')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/([A-Za-z0-9])-\n([A-Za-z0-9])/g, '$1-$2')
    .replace(/[^\S\n]+/g, ' ');
}
const parse = (name) =>
  parseInvoice(cleanPdfText(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8')));

const somme = (r) => r.lines.reduce((s, l) => s + l.lineTotalHt, 0);

/* ─── Le contrôle qui compte : les sept totaux retombent ─────────────────── */

console.log('\nPrestaShop — réconciliation des sept factures');

const DOCS = [
  ['cosmer-FA018801.txt', 1705.10, 12, '#FA018801', 'YECQOOSHL'],
  ['highbuy-FA018841.txt', 903.10, 19, '#FA018841', 'NSDRGZXNK'],
  ['curieux-FA063171.txt', 525.46, 15, '#FA063171', 'GIAOHSGSX'],
  ['cigaccess-FA122879.txt', 604.35, 14, '#FA122879', 'BSZZSPUMO'],
  ['cigaccess-FA129179.txt', 2023.54, 33, '#FA129179/2026', 'XKVGXPIDD'],
  ['etasty-FA060440.txt', 739.20, 1, '#FA060440/2025', 'PEVEZEXDK'],
  ['mgvape-MD035105.txt', 1120.75, 23, 'MD035105', 'QXJQZUKPX'],
  ['pulp-FA165024.txt', 2618.90, 33, '#FA165024', '168213'],
];

const parsed = {};
for (const [file, total, count, number, orderRef] of DOCS) {
  const key = file.startsWith('cigaccess-FA129179') ? 'cigaccess2026' : file.split('-')[0];
  parsed[key] = parse(file);
  test(`${key.padEnd(10)} ${count} lignes, ${total.toFixed(2)} € HT`, () => {
    const r = parsed[key];
    assert.strictEqual(r.number, number);
    assert.strictEqual(r.orderRefOnDoc, orderRef);
    assert.strictEqual(r.lines.length, count);
    assert.ok(close(somme(r), total, 0.02), `somme ${somme(r).toFixed(2)} ≠ ${total}`);
    assert.strictEqual(r.warnings.length, 0);
  });
}

/* ─── Les pièges, un par un ──────────────────────────────────────────────── */

console.log('\nCe que chaque fournisseur casse');

test('Cosmer : le prix précède la quantité, et non l\'inverse', () => {
  // « 20 % 6,80 € 80 544,00 € » : 80 pièces à 6,80 €, pas 6,80 pièces à 80 €.
  const l = byRef(parsed.cosmer, 'REF0654');
  assert.strictEqual(l.qty, 80);
  assert.ok(close(l.unitPriceNet, 6.80));
  assert.ok(close(l.lineTotalHt, 544));
});

test('Cosmer : la remise de pied devient une ligne négative', () => {
  const remise = parsed.cosmer.lines.find((l) => l.kind === 'discount');
  assert.ok(close(remise.lineTotalHt, -300.90));
  // 11 articles à 2 006,00 €, moins 15 % de remise globale = 1 705,10 €.
  const produits = parsed.cosmer.lines.filter((l) => l.kind === 'product');
  assert.strictEqual(produits.length, 11);
  assert.ok(close(produits.reduce((s, l) => s + l.lineTotalHt, 0), 2006, 0.02));
});

test('Pulp : ni le prix barré ni l\'écotaxe ne sont pris pour le prix payé', () => {
  // « 0 % 1,03 € / -30% 1,47 € / 80 82,40 € » réparti sur trois lignes.
  const l = byRef(parsed.pulp, '2020101005245');
  assert.strictEqual(l.qty, 80);
  assert.ok(close(l.unitPriceNet, 1.03));     // pas 1,47 €, le prix barré
  assert.ok(close(l.lineTotalHt, 82.40));

  // Starter Kit : prix remisé 6,24 €, écotaxe 0,08 €, prix barré 7,70 €.
  const kit = byRef(parsed.pulp, '3666528048084');
  assert.strictEqual(kit.qty, 25);
  assert.ok(close(kit.unitPriceNet, 6.24));   // ni 0,08 € ni 7,70 €
  assert.ok(close(kit.lineTotalHt, 156));
});

test('MG Vape : un titre de rayon n\'est jamais pris pour une référence', () => {
  // « MPV » et « Candy Shake » s'intercalent entre les articles.
  const refs = parsed.mgvape.lines.map((l) => l.ref);
  assert.ok(!refs.includes('MPV'), 'le rayon MPV est devenu une référence');
  assert.ok(!refs.includes('Candy'), 'le rayon Candy Shake est devenu une référence');
  assert.ok(refs.every((r) => r && /\d/.test(r)), 'une référence sans chiffre a été retenue');
});

test('MG Vape : une référence coupée en deux lignes est recollée', () => {
  // « MPV-ACC-21 » puis, à la ligne, « 700-5000 ».
  const l = byRef(parsed.mgvape, 'MPV-ACC-21700-5000');
  assert.ok(l, 'référence ACCUS non recollée');
  assert.strictEqual(l.qty, 100);
  assert.ok(close(l.lineTotalHt, 392));
});

test('CigAccess : l\'échantillon offert est lu, à zéro euro', () => {
  const l = byRef(parsed.cigaccess, '012800');
  assert.strictEqual(l.qty, 1);
  assert.strictEqual(l.lineTotalHt, 0);
});

test('CigAccess : la réf. de déclinaison coupée par la colonne ou le saut de page est recollée', () => {
  const refs = parsed.cigaccess2026.lines.map((l) => l.ref);
  for (const r of ['012825-1-Gunm', '013101-0-7.5M', '013101-1-9ML', '012865-0-S.S', '013167-3-Blue', '013167-4-Rain']) {
    assert.ok(refs.includes(r), `${r} absente`);
  }
  assert.ok(refs.every((r) => /^\d{6}(-\d+-[\w.]{3,4})?$/.test(r)), `réf. tronquée : ${refs.join(', ')}`);
});

test('Highbuy : le prix de base ne remplace pas le prix remisé', () => {
  // « 20 % 13,90 € 7,90 € 4 31,60 € » : c'est 7,90 € qui est facturé.
  const l = byRef(parsed.highbuy, 'HB1232');
  assert.strictEqual(l.qty, 4);
  assert.ok(close(l.unitPriceNet, 7.90));
  assert.ok(close(l.lineTotalHt, 31.60));
});

test('Curieux : une référence seule sur sa ligne reste rattachée', () => {
  const l = byRef(parsed.curieux, 'AST-LICO-50-0MG');
  assert.ok(l, 'référence La Licorne 50ml non trouvée');
  assert.strictEqual(l.qty, 12);
  assert.ok(close(l.lineTotalHt, 74.52));
});

test('e.tasty : une facture d\'une seule ligne et 3 360 pièces', () => {
  const l = byRef(parsed.etasty, 'YOY5001020');
  assert.strictEqual(l.qty, 3360);
  assert.ok(close(l.unitPriceNet, 0.22));
  assert.ok(close(l.lineTotalHt, 739.20));
});

test('le mode de règlement imprimé est remonté, sans lui faire confiance', () => {
  // Il sert de valeur proposée à la saisie, rien de plus : une facture marquée
  // « virement » peut très bien partir en Amex groupé à 30 jours.
  assert.strictEqual(parsed.mgvape.statedPaymentMethod, 'Paiement AMEX');
  assert.strictEqual(parsed.curieux.statedPaymentMethod, 'Paiement VISA');
  assert.strictEqual(parsed.cosmer.statedPaymentMethod, 'e-Transactions');
  assert.strictEqual(parsed.etasty.statedPaymentMethod, 'Transfert bancaire');
});

test('référence coupée par le saut de page : les deux moitiés se retrouvent (Curieux #FA063171)', () => {
  // Dans ce document, « SPE- » ferme la page 1 et « MACA-50-00MG » ouvre la
  // page 2 ; le reste de la cellule (désignation ET montants) s'intercale entre
  // les deux moitiés. Sans réparation, les deux lignes de 37,26 € sortaient sous
  // « 50ml » et « MACA-50-00MG » — donc quatre fausses anomalies en face de la
  // commande : deux articles facturés non commandés, deux commandés non facturés.
  const r = parse('curieux-FA063171.txt');
  const refs = r.lines.map((l) => l.ref);

  assert.ok(refs.includes('SPE-MACA-50-00MG'), `SPE-MACA-50-00MG absent : ${refs.join(', ')}`);
  assert.ok(refs.includes('SPE-SOUL-50-00MG'), `SPE-SOUL-50-00MG absent : ${refs.join(', ')}`);
  assert.ok(!refs.includes('50ml'), 'un fragment de désignation sert encore de référence');
  assert.ok(!refs.includes('MACA-50-00MG'), 'la moitié orpheline subsiste');
});

if (failures > 0) {
  console.log(`\n${failures} test(s) en échec.`);
  process.exit(1);
}
console.log('\nTous les tests passent.');
