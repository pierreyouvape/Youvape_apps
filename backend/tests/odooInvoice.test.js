/**
 * Lecture des factures Odoo — JoshNoa, Levest, LIPS, Cloud Vapor.
 *
 * Sans dépendance ni base : `node tests/odooInvoice.test.js` (ou `npm test`).
 *
 * Levest, LIPS et Cloud Vapor tournent sur le texte pdf-parse des VRAIS PDF,
 * repris intégralement : leur total imprimé doit retomber sur la somme des
 * lignes lues. JoshNoa reste un texte saisi à la main — son PDF n'a pas été
 * fourni — mais il couvre le gabarit à cinq colonnes, le seul qui imprime un
 * prix unitaire TTC.
 *
 * Ce que ces quatre documents cassent et qu'il faut garder en non-régression :
 *   • l'étiquette d'en-tête coupée en deux (« Date de » / « facturation ») ;
 *   • les colonnes d'une ligne éclatées sur trois lignes (LIPS) ;
 *   • la colonne TAXES (« TVA 20% ») intercalée avant le montant ;
 *   • une remise globale négative et une ligne de port à zéro ;
 *   • deux règlements portés par une seule facture (Cloud Vapor).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseInvoice } = require('../src/parsers/invoices/odooInvoice');

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

// Copie de cleanPdfText (pdfImportModel), comme dans parsers.test.js.
function cleanPdfText(text) {
  return text
    .replace(/[       ﻿]/g, ' ')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/([A-Za-z0-9])-\n([A-Za-z0-9])/g, '$1-$2')
    .replace(/[^\S\n]+/g, ' ');
}
const fixture = (name) =>
  cleanPdfText(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8'));

/* ─── Levest — FAC/2025/11/0470, PDF réel ────────────────────────────────── */

const levest = parseInvoice(fixture('levest-FAC-2025-11-0470.txt'));

console.log('\nLevest — FAC/2025/11/0470 (PDF réel)');

test('en-tête : numéro, dates, origine', () => {
  assert.strictEqual(levest.number, 'FAC/2025/11/0470');
  assert.strictEqual(levest.date, '2025-11-12');
  assert.strictEqual(levest.dueDate, '2025-11-12');
  assert.strictEqual(levest.orderRefOnDoc, '202508374');
});

test('les 7 lignes retombent sur le total imprimé', () => {
  assert.strictEqual(levest.lines.length, 7);
  const somme = levest.lines.reduce((s, l) => s + l.lineTotalHt, 0);
  assert.ok(close(somme, 793.80, 0.02), `somme ${somme}`);
  assert.strictEqual(levest.warnings.length, 0);
});

test('la colonne TAXES n\'est jamais prise pour une remise', () => {
  const l = byRef(levest, 'VOLBCC0050N00');
  assert.strictEqual(l.qty, 24);
  assert.ok(close(l.unitPriceNet, 4.90));   // pas 20, le taux de TVA
  assert.strictEqual(l.discountPercent, 0);
  assert.ok(close(l.lineTotalHt, 117.60));
});

test('la ligne de port est reconnue comme telle', () => {
  const l = byRef(levest, 'SHIPPING');
  assert.strictEqual(l.kind, 'shipping');
  assert.strictEqual(l.lineTotalHt, 0);
});

test('le règlement déjà porté par la facture est remonté', () => {
  assert.strictEqual(levest.payments.length, 1);
  assert.strictEqual(levest.payments[0].paidAt, '2025-11-12');
  assert.ok(close(levest.payments[0].amount, 952.56));
});

/* ─── LIPS — FAC/2026/04162, PDF réel ────────────────────────────────────── */

const lips = parseInvoice(fixture('lips-FAC-2026-04162.txt'));

console.log('\nLIPS — FAC/2026/04162 (PDF réel)');

test('les 17 lignes retombent sur le total imprimé', () => {
  assert.strictEqual(lips.lines.length, 17);
  const somme = lips.lines.reduce((s, l) => s + l.lineTotalHt, 0);
  assert.ok(close(somme, 443.25, 0.02), `somme ${somme}`);
  assert.strictEqual(lips.warnings.length, 0);
});

test('des colonnes éclatées sur trois lignes sont recollées', () => {
  // « 24,000 » seul sur sa ligne, « Unité(s) » sur la suivante, le reste après.
  const l = byRef(lips, 'SEV-PASTEQUEGIVREE-10-10');
  assert.strictEqual(l.qty, 24);
  assert.ok(close(l.lineTotalHt, 29.58));
  assert.strictEqual(l.discountPercent, 15);
  assert.ok(close(l.unitPriceNet, 1.2325));   // 1,45 − 15 %
});

test('« Source » vaut « Origine » : la commande est retrouvée pareil', () => {
  assert.strictEqual(lips.orderRefOnDoc, 'S04517');
});

/* ─── Cloud Vapor — INV/2025/04126, PDF réel ─────────────────────────────── */

const cv = parseInvoice(fixture('cloudvapor-INV-2025-04126.txt'));

console.log('\nCloud Vapor — INV/2025/04126 (PDF réel)');

test('une étiquette d\'en-tête coupée en deux est quand même lue', () => {
  // Le document imprime « Date de » puis, à la ligne, « facturation ».
  assert.strictEqual(cv.date, '2025-10-21');
  assert.strictEqual(cv.dueDate, '2025-11-05');
  assert.strictEqual(cv.orderRefOnDoc, 'S05169');
});

test('le document est reconnu comme PRO FORMA', () => {
  assert.strictEqual(cv.isProforma, true);
  assert.strictEqual(cv.number, 'INV/2025/04126');
});

test('les 18 lignes retombent sur le total imprimé', () => {
  assert.strictEqual(cv.lines.length, 18);
  const somme = cv.lines.reduce((s, l) => s + l.lineTotalHt, 0);
  assert.ok(close(somme, 2164.89, 0.02), `somme ${somme}`);
  assert.strictEqual(cv.warnings.length, 0);
});

test('la remise globale négative est isolée, pas fondue dans les articles', () => {
  const remise = cv.lines.find((l) => l.kind === 'discount');
  assert.ok(close(remise.lineTotalHt, -927.81));
  const produits = cv.lines.filter((l) => l.kind === 'product');
  assert.strictEqual(produits.length, 16);
  assert.ok(produits.every((l) => l.lineTotalHt > 0));
});

test('les deux règlements d\'une même facture sont remontés', () => {
  assert.strictEqual(cv.payments.length, 2);
  const montants = cv.payments.map((p) => p.amount).sort((a, b) => a - b);
  assert.ok(close(montants[0], 259.79));
  assert.ok(close(montants[1], 2338.08));
});

/* ─── JoshNoa — V3/2026/36621, texte saisi (PDF non fourni) ──────────────── */

const JOSHNOA = `ELENA COGLITORE, YOUVAPE - M. COGLITORE
580 AV DE L AUBE ROUGE
34170 CASTELNAU LE LEZ
France
Facture V3/2026/36621
Date de la facture
25/09/2026
Date d'échéance
25/09/2026
Origine
S311485
DESCRIPTION QTÉ P.U TTC REM. % P.U
REMISÉ
HT
TAXES MONTANT
[josh00013448] Gum Bull 100ml - Baby Bear 40,00 7,08 33.90 3,90 20% 156,01 €
[josh00008069] Résistances Sector Mesh pour Falcon 2 (0.14ohm) -
HorizonTech (pack de 3)
10,00 8,28 12.00 6,07 20% 60,72 €
[josh00014009] Pod de remplacement Hookah Air (0.4) - Fumytech (2 pièces)
(0.4 Ohms)
2,00 5,16 12.00 3,78 20% 7,57 €
[josh00009370] Ragnarok Zero 50ml Ultimate - Arômes et Liquides 12,00 9,48 27.85 5,70 20% 68,40 €
[josh00009358] Bouteille graduée Diudiu 120ml (10 pièces) 3,00 6,60 12.00 4,84 20% 14,52 €
[josh00024231] The Bear 10ml Secret Garden - SECRET'S LAB (10 pièces) (06
mg/ml)
3,00 19,20 25.00 12,00 20% 36,00 €
[josh00024232] The Bear 10ml Secret Garden - SECRET'S LAB (10 pièces) (12
mg/ml)
2,00 19,20 25.00 12,00 20% 24,00 €
[josh00045197] Crystal Bay 200ml - Hello Cloudy 15,00 9,00 17.33 6,20 20% 93,00 €
[josh00045196] Tropical Berries 200ml - Hello Cloudy 7,00 9,00 17.33 6,20 20% 43,40 €
[josh00008058] Concentré Shiva SWEET EDITION 30ml Ultimate - Arômes et
Liquides (5 pièces)
2,00 35,40 16.95 24,50 20% 49,00 €
[josh00002973] Cinema Réserve Act 1 100ml - Cloud of Icarus 5,00 19,08 31.45 10,90 20% 54,50 €
[josh00009668] Concentré Purple Key 30ml Secret's Keys - SECRET'S LAB (5
pièces)
1,00 27,00 13.34 19,50 20% 19,50 €
[josh00036732] Raisin Fruit du Dragon 200ml - Biggy Bear 10,00 9,00 34.67 4,90 20% 49,00 €
[josh00009356] Bouteille graduée Twist 250ml (10 pièces) 1,00 9,48 12.00 6,95 20% 6,95 €
[josh00014494] Limonade Citron Vert Myrtilles Sauvages 200ml - Biggy Bear 5,00 9,00 34.67 4,90 20% 24,50 €
[josh00043017] Puff Le Bar 40K 1000mAh 22ml - Lost Vape (20 mg/ml, Cerise
Cola)
20,00 11,40 15.79 8,00 20% 160,00 €
[josh00013559] Melon Berry Lychee 100ml - Baby Bear 3,00 7,08 33.90 3,90 20% 11,70 €
[josh00008054] Concentré Ragnarok Primal SWEET EDITION 30ml Ultimate
- Arômes et Liquides (5 pièces)
2,00 35,40 16.95 24,50 20% 49,00 €
[josh00014137] Concentré The Snake 30ml Secret Garden - SECRET'S LAB (5
pièces)
1,00 29,40 0.00 24,50 20% 24,50 €
Livraison 1,00 0,00 0.00 0,00 0,00 €
Montant HT 952,27 €
TVA 20% 190,44 €
Total 1 142,71 €
Règlement
Mode de paiement
Transfert bancaire
À régler avant le
25/09/2026
Référence à rappeler
V3/2026/36621`;

const josh = parseInvoice(JOSHNOA);

console.log('\nJoshNoa — V3/2026/36621 (texte saisi)');

test('les 20 lignes retombent sur le total imprimé', () => {
  assert.strictEqual(josh.lines.length, 20);
  const somme = josh.lines.reduce((s, l) => s + l.lineTotalHt, 0);
  assert.ok(close(somme, 952.27, 0.02), `somme ${somme}`);
  assert.strictEqual(josh.warnings.length, 0);
});

test('un prix unitaire TTC assorti d\'une remise est lu par le montant', () => {
  // 7,08 € TTC − 33,90 % : ni 40 × 3,90 = 156,00 € ni la reconstitution exacte
  // ne donnent les 156,01 € imprimés. Le montant fait foi, à un demi-centime
  // par unité près.
  const l = byRef(josh, 'josh00013448');
  assert.strictEqual(l.qty, 40);
  assert.ok(close(l.lineTotalHt, 156.01));
  assert.strictEqual(l.discountPercent, 33.90);
});

test('la quantité manquante du cas Tropical Berries est bien 7', () => {
  const l = byRef(josh, 'josh00045196');
  assert.strictEqual(l.qty, 7);            // la commande en portait 8
  assert.ok(close(l.lineTotalHt, 43.40));
});

test('en-tête : origine, échéance, mode de règlement', () => {
  assert.strictEqual(josh.number, 'V3/2026/36621');
  assert.strictEqual(josh.orderRefOnDoc, 'S311485');
  assert.strictEqual(josh.dueDate, '2026-09-25');
  assert.strictEqual(josh.statedPaymentMethod, 'Transfert bancaire');
});

test('la ligne Livraison sans référence est classée en port', () => {
  const port = josh.lines.find((l) => l.kind === 'shipping');
  assert.ok(port, 'ligne de port non trouvée');
  assert.strictEqual(port.lineTotalHt, 0);
});

if (failures > 0) {
  console.log(`\n${failures} test(s) en échec.`);
  process.exit(1);
}
console.log('\nTous les tests passent.');
