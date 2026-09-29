/**
 * Lecture des factures Odoo — JoshNoa, Levest, LIPS, Cloud Vapor.
 *
 * Sans dépendance ni base : `node tests/odooInvoice.test.js` (ou `npm test`).
 *
 * Les quatre tournent sur le texte pdf-parse des VRAIS PDF, repris
 * intégralement : leur total imprimé doit retomber sur la somme des lignes
 * lues. JoshNoa porte en plus le gabarit à cinq colonnes, le seul qui imprime
 * un prix unitaire TTC.
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

/* ─── JoshNoa — V3/2026/36311, facture entière (PDF réel) ────────────────── */

const josh = parseInvoice(fixture('joshnoa-V3202636311.txt'));

console.log('\nJoshNoa — V3/2026/36311 (PDF réel)');

test('les 15 lignes retombent sur le total imprimé', () => {
  assert.strictEqual(josh.lines.length, 15);
  const somme = josh.lines.reduce((s, l) => s + l.lineTotalHt, 0);
  assert.ok(close(somme, 556.92, 0.02), `somme ${somme}`);
  assert.strictEqual(josh.warnings.length, 0);
});

test('un prix unitaire TTC assorti d\'une remise est lu par le montant', () => {
  // Cinq colonnes : 2 × 15,85 € net après 12 % de remise = 31,69 €. Ni le TTC
  // ni la remise imprimés ne permettent de retomber dessus au centime : seul le
  // montant fait foi, à un demi-centime par unité près.
  const l = byRef(josh, 'josh00004324');
  assert.strictEqual(l.qty, 2);
  assert.ok(close(l.unitPriceNet, 15.85));
  assert.strictEqual(l.discountPercent, 12);
  assert.ok(close(l.lineTotalHt, 31.69));
});

test('les goodies offerts sont lus, à zéro euro', () => {
  const offerts = josh.lines.filter((l) => l.lineTotalHt === 0 && l.kind === 'product');
  assert.strictEqual(offerts.length, 3);
  assert.ok(offerts.every((l) => l.ref.startsWith('josh000458')));
});

test('en-tête : origine, échéance à 30 jours, mode de règlement', () => {
  assert.strictEqual(josh.number, 'V3/2026/36311');
  assert.strictEqual(josh.orderRefOnDoc, 'S312372');
  assert.strictEqual(josh.date, '2026-09-24');
  // Trente jours pleins — le délai réellement accordé, quand la facture
  // précédente datait son échéance au jour même. L'échéance imprimée ne vaut
  // donc rien en soi : c'est `suppliers.payment_terms_days` qui tranche.
  assert.strictEqual(josh.dueDate, '2026-10-24');
  assert.strictEqual(josh.statedPaymentMethod, 'Transfert bancaire');
});

test('la ligne Livraison sans référence est classée en port', () => {
  const port = josh.lines.find((l) => l.kind === 'shipping');
  assert.ok(port, 'ligne de port non trouvée');
  assert.strictEqual(port.lineTotalHt, 0);
});

/* ─── Avoirs Odoo — JoshNoa RV3/2026/02731 et Levest RFAC/2026/07/0016 ───── */

const joshAvoir = parseInvoice(fixture('joshnoa-avoir-RV3202602731.txt'));
const levestAvoir = parseInvoice(fixture('levest-avoir-RFAC2026070016.txt'));

console.log('\nAvoirs Odoo (PDF réels)');

test('un avoir est reconnu et rangé en négatif', () => {
  assert.strictEqual(joshAvoir.docType, 'credit_note');
  assert.strictEqual(joshAvoir.number, 'RV3/2026/02731');
  assert.ok(close(joshAvoir.totalHt, -13.80));
  assert.strictEqual(levestAvoir.docType, 'credit_note');
  assert.ok(close(levestAvoir.totalHt, -665.10));
});

test('l\'avoir dit quelle facture il corrige, et sur quelle commande', () => {
  // « Extourne de : V3/2026/33473, ERREUR FACTURATION » et « Origine S309145 ».
  assert.strictEqual(joshAvoir.correctsInvoice, 'V3/2026/33473');
  assert.strictEqual(joshAvoir.orderRefOnDoc, 'S309145');
  assert.strictEqual(joshAvoir.date, '2026-09-21');
});

test('un avoir a une colonne de moins que la facture du même fournisseur', () => {
  // Les factures JoshNoa impriment « QTÉ | P.U TTC | REM. % | P.U REMISÉ HT |
  // TAXES | MONTANT ». Les avoirs n'ont pas la remise : quatre nombres au lieu
  // de cinq, et la ligne devenait illisible.
  assert.strictEqual(joshAvoir.lines.length, 1);
  const l = joshAvoir.lines[0];
  assert.strictEqual(l.qty, 1);
  assert.ok(close(l.unitPriceNet, 13.80));
  assert.ok(close(l.lineTotalHt, -13.80));
});

test('les trois lignes de l\'avoir Levest retombent sur son total', () => {
  assert.strictEqual(levestAvoir.lines.length, 3);
  const s = levestAvoir.lines.reduce((a, l) => a + l.lineTotalHt, 0);
  assert.ok(close(s, -665.10, 0.02), `somme ${s}`);
  assert.strictEqual(levestAvoir.warnings.length, 0);
  assert.ok(close(byRef(levestAvoir, 'PNGP050N00').lineTotalHt, -400.50));
});

/* ─── LIPS, deuxième gabarit : incwo ─────────────────────────────────────── */

test('LIPS incwo F2603-09576 : les 17 lignes, au centime et à la pièce', () => {
  // LIPS édite depuis DEUX logiciels. Le parseur Odoo ne lisait aucune ligne de
  // celui-ci : l'écran affichait « Aucune ligne lue dans ce document ».
  const { parseInvoice } = require('../src/parsers/invoices');
  const parser = require('../src/parsers/invoices').getInvoiceParser('LIPS - French Liquide');
  const brut = fs.readFileSync(path.join(__dirname, 'fixtures', 'lips-incwo-F2603-09576.txt'), 'utf-8');
  const r = parser.parseInvoice(cleanPdfText(brut));

  assert.strictEqual(r.number, 'F2603-09576');
  assert.strictEqual(r.orderRefOnDoc, 'H2026-0005-2299');
  assert.strictEqual(r.lines.length, 17);
  assert.deepStrictEqual(r.warnings, []);

  // Les deux contrôles qui valent une relecture complète : le total imprimé et
  // la quantité totale imprimée.
  const somme = r.lines.reduce((s, l) => s + l.lineTotalHt, 0);
  assert.ok(close(somme, 836.88), `${somme} ≠ 836,88`);
  assert.strictEqual(r.lines.reduce((s, l) => s + l.qty, 0), 411);
  assert.ok(close(r.totalHt, 836.88));
  assert.ok(close(r.totalTtc, 1004.29));

  // La référence est au MILIEU du libellé : « Marque - RÉFÉRENCE - Libellé ».
  const refs = r.lines.map((l) => l.ref);
  assert.ok(refs.includes('E2S-LACHOSE-5050-60-03'), refs.join(', '));
  assert.ok(refs.includes('NEKTAR-MYRCACRAN-50-00'), refs.join(', '));
  // La cellule de chiffres coupée sur trois lignes (« 1,39 72 / flacons / 100,08 »).
  const moon = r.lines.find((l) => l.ref === 'MOON-SLT-AVANTPREMIERE-10-10');
  assert.strictEqual(moon.qty, 72);
  assert.ok(close(moon.lineTotalHt, 100.08));
  // La PLV à 0 €, qui doit passer le contrôle « quantité × prix = total ».
  const plv = r.lines.find((l) => l.ref === 'PLV-DISPLAY-CLK-X10');
  assert.strictEqual(plv.qty, 3);
  assert.strictEqual(plv.lineTotalHt, 0);
});

test('l\'aiguillage LIPS reconnaît le gabarit, pas le numéro', () => {
  const { getInvoiceParser } = require('../src/parsers/invoices');
  const parser = getInvoiceParser('LIPS - French Liquide');
  const odoo = parser.parseInvoice(cleanPdfText(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'lips-FAC-2026-04162.txt'), 'utf-8'),
  ));
  assert.strictEqual(odoo.number, 'FAC/2026/04162');
  assert.ok(odoo.lines.length > 0, 'le gabarit Odoo doit continuer de se lire');
});

if (failures > 0) {
  console.log(`\n${failures} test(s) en échec.`);
  process.exit(1);
}
console.log('\nTous les tests passent.');
