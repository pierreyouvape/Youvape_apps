/**
 * Lecture des factures OpenSi — LCA, LVP, GFC.
 *
 * Sans dépendance ni base : `node tests/opensiInvoice.test.js` (ou `npm test`).
 *
 * Les textes ci-dessous reprennent la couche texte des PDF reçus le 25/09/2026
 * (LCA F2609412942, LVP F2511243065, GFC F2511358971), y compris ce qui casse
 * les parseurs : désignation qui passe à la ligne, chiffres seuls sur la leur,
 * colonne « Rist. % » qui n'existe que chez LCA, code-barres chez GFC, remise de
 * pied chez GFC, et pied de page bourré de nombres (IBAN, SIREN, taux de TVA)
 * qu'il ne faut surtout pas lire comme des articles.
 *
 * LVP et GFC tournent sur le texte pdf-parse des VRAIS PDF (fixtures
 * lvp-F2511243065.txt et gfc-F2511358971.txt), repris intégralement : leur total
 * imprimé doit retomber sur la somme des lignes lues, ce qui prouve qu'aucune
 * ligne n'a été perdue.
 *
 * LCA reste un extrait saisi à la main — le PDF n'a pas été fourni. À remplacer
 * par une fixture dès qu'on l'a, comme les deux autres.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseInvoice } = require('../src/parsers/invoices/opensiInvoice');

// Copie de cleanPdfText (pdfImportModel), comme dans parsers.test.js : les
// parseurs tournent sur le texte NETTOYÉ, jamais sur le brut.
function cleanPdfText(text) {
  return text
    .replace(/[\u00a0\u2007\u202f\u2009\u200a\u2002\u2003\ufeff]/g, ' ')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/([A-Za-z0-9])-\n([A-Za-z0-9])/g, '$1-$2')
    .replace(/[^\S\n]+/g, ' ');
}
const fixture = (name) =>
  cleanPdfText(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8'));

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

/* ─── LCA — extrait de F2609412942 ───────────────────────────────────────── */

const LCA = `IJkH OpenSi v10.0.0 | 25/09/2026 - 14:38:31
LCA DISTRIBUTION
205 avenue du Chateau de Jouques
13420 GEMENOS
Tél : 0491754009
E-Mail : contact@lca-distribution.com
Facture N° F2609412942 Date : 25/09/2026
Client N° 1-002445 - SAS EMC
Interlocuteur : YOUVAPE Site WEB
Page 1 / 3
SAS EMC
580 avenue de l'Aube Rouge
YOUVAPE
34170 CASTELNAU LE LEZ
FRANCE
F A C T U R E
Réf. Affaire : AC26094060
N° Commande : CC26094080
Réf. Commande : 356948
Réf. BL : BL26094426
Référence Désignation Quantité PU HT Rist. % PU Net HT Montant HT
#REF8398-27584 Gold Digger 10ML à l'unité - Ben Northon (Dosage
Nicotine : 11mg)
5 1.50 1.50 7.50
#REF15320-49707 Cartouches pour Nexi par 3 - 20mg - Aspire (Saveur :
Classic Blond)
240 2.89 2.89 693.60
#REF11324-36716 Sac de 200 boosters - Salt Freaks (Contenance : 10ml) 1 60.00 60.00 60.00
#REF18588-62291 Résistances Z Series / Z series XM Boost par 5 -
GeekVape (Valeur : 0.4?)
30 6.46 16.00 5.43 162.79
#REF25850-25849 OFFERT - PLV Elfbar-A4 Display Sheet 1 0.00 0.00 0.00
Sous-total HT : 3 222.58
Lca Distribution - SARL au capital de 20 000 Euros - immatriculée au RCS MARSEILLE 791 016 181 - N° TVA : FR09791016181 - Code NAF : 6190Z
Aucun escompte ne sera accordé pour paiement
anticipé.
IBAN (International Bank Account Number) FR76 4097
8000 2315 1095 9000 180
BIC (Bank Identifier Code) BSPFFRPPXXX
Base HT Taux TVA Montant TVA
4 189.92 20.00 % 837.98
Option pour le paiement de la taxe d'après les débits
Date d'échéance : 25/09/2026
Mode de règlement : Virement bancaire
N° SIREN Client : 789 508 439
N° TVA Client : FR87789508439
Total HT : 4 189.92 €
Total TVA : 837.98 €
Total TTC : 5 027.90 €`;

const lca = parseInvoice(LCA);

console.log('\nLCA — facture F2609412942');

test('en-tête : numéro, date, référence de commande, échéance, règlement', () => {
  assert.strictEqual(lca.number, 'F2609412942');
  assert.strictEqual(lca.date, '2026-09-25');
  assert.strictEqual(lca.orderRefOnDoc, '356948');     // = bms_reference
  assert.strictEqual(lca.dueDate, '2026-09-25');
  assert.strictEqual(lca.statedPaymentMethod, 'Virement bancaire');
});

test('totaux du pied, séparateur de milliers compris', () => {
  assert.ok(close(lca.totalHt, 4189.92));
  assert.ok(close(lca.totalTva, 837.98));
  assert.ok(close(lca.totalTtc, 5027.90));
});

test('une désignation à cheval sur deux lignes ne perd pas son article', () => {
  const l = byRef(lca, '#REF8398-27584');
  assert.strictEqual(l.qty, 5);
  assert.ok(close(l.lineTotalHt, 7.50));
  assert.ok(l.label.includes('Gold Digger'));
  assert.ok(l.label.includes('11mg'));       // la suite de la désignation est recollée
});

test('la colonne Rist. % est lue sans confondre la remise avec un prix', () => {
  const l = byRef(lca, '#REF18588-62291');
  assert.strictEqual(l.qty, 30);
  assert.ok(close(l.unitPriceNet, 5.43));
  assert.strictEqual(l.discountPercent, 16);
  assert.ok(close(l.lineTotalHt, 162.79));   // le montant imprimé, pas 30 × 5,43
});

test('un article tenant sur une seule ligne passe aussi', () => {
  const l = byRef(lca, '#REF11324-36716');
  assert.strictEqual(l.qty, 1);
  assert.ok(close(l.lineTotalHt, 60));
});

test('la PLV offerte est lue, à zéro euro', () => {
  const l = byRef(lca, '#REF25850-25849');
  assert.strictEqual(l.qty, 1);
  assert.strictEqual(l.lineTotalHt, 0);
});

test('ni l\'IBAN, ni le SIREN, ni le taux de TVA ne deviennent des articles', () => {
  assert.strictEqual(lca.lines.length, 5);
  const refs = lca.lines.map((l) => l.ref);
  assert.ok(refs.every((r) => r.startsWith('#REF')));
});

test('un extrait ne retombant pas sur le total imprimé est signalé', () => {
  // 5 lignes sur 51 : le garde-fou DOIT crier. C'est exactement son rôle.
  const w = lca.warnings.find((x) => x.type === 'total_mismatch');
  assert.ok(w, 'aucun avertissement de réconciliation');
  assert.ok(w.message.includes('4189.92'));
});

/* ─── LVP — F2511243065, facture entière ─────────────────────────────────── */

const lvp = parseInvoice(fixture('lvp-F2511243065.txt'));

console.log('\nLVP — facture F2511243065 (PDF réel, entière)');

test('les 17 lignes sont lues et retombent sur le total imprimé', () => {
  assert.strictEqual(lvp.lines.length, 17);
  const somme = lvp.lines.reduce((s, l) => s + l.lineTotalHt, 0);
  assert.ok(close(somme, 446.29, 0.02), `somme ${somme}`);
  assert.strictEqual(lvp.warnings.filter((w) => w.type === 'total_mismatch').length, 0);
});

test('gabarit sans colonne de remise : trois nombres suffisent', () => {
  const l = byRef(lvp, 'ADDSWEETY10');
  assert.strictEqual(l.qty, 20);
  assert.ok(close(l.unitPriceNet, 1.33));
  assert.ok(close(l.lineTotalHt, 26.60));
});

test('une réf seule sur sa ligne reste rattachée à son article', () => {
  const l = byRef(lvp, 'S30467-TJCSFSDENSWE100FRRB');
  assert.ok(l, 'réf TJuice non trouvée');
  assert.strictEqual(l.qty, 6);
  assert.ok(close(l.lineTotalHt, 29.40));
});

test('le mode de règlement est repris tel qu\'imprimé, même tronqué', () => {
  assert.strictEqual(lvp.orderRefOnDoc, '244904');
  assert.strictEqual(lvp.statedPaymentMethod, 'Paiement par carte bancai');
});

/* ─── GFC — F2511358971, facture entière avec code-barres et remise ──────── */

const gfc = parseInvoice(fixture('gfc-F2511358971.txt'));

console.log('\nGFC — facture F2511358971 (PDF réel, entière)');

test('le code-barres n\'est jamais pris pour une quantité', () => {
  const l = byRef(gfc, 'GFC29577');
  assert.strictEqual(l.qty, 10);            // pas 3010000877974
  assert.ok(close(l.unitPriceNet, 4.43));
  assert.ok(close(l.lineTotalHt, 44.30));
});

test('les 14 articles sont lus', () => {
  const produits = gfc.lines.filter((l) => l.kind === 'product');
  assert.strictEqual(produits.length, 14);
  const somme = produits.reduce((s, l) => s + l.lineTotalHt, 0);
  assert.ok(close(somme, 538.19, 0.02), `somme ${somme}`);
});

test('la remise de pied devient une ligne négative, et le total retombe', () => {
  const remise = gfc.lines.find((l) => l.kind === 'discount');
  assert.ok(close(remise.lineTotalHt, -42));
  const somme = gfc.lines.reduce((s, l) => s + l.lineTotalHt, 0);
  assert.ok(close(somme, 496.19, 0.02), `somme ${somme}`);
  assert.strictEqual(gfc.warnings.filter((w) => w.type === 'total_mismatch').length, 0);
});

test('une référence courte suivie d\'un code-barres court reste lisible', () => {
  // GFC317-6397 … 3176397 5 1.75 8.75 : le « code-barres » ne fait que 7 chiffres.
  const l = byRef(gfc, 'GFC317-6397');
  assert.strictEqual(l.qty, 5);
  assert.ok(close(l.lineTotalHt, 8.75));
});

test('la référence de commande imprimée est remontée même si elle ne matche pas', () => {
  // Chez GFC, « Réf. Commande » est le numéro interne du FOURNISSEUR : aucune
  // commande ne porte 530456 en base. On le remonte quand même, l'écran tranche.
  assert.strictEqual(gfc.orderRefOnDoc, '530456');
});

if (failures > 0) {
  console.log(`\n${failures} test(s) en échec.`);
  process.exit(1);
}
console.log('\nTous les tests passent.');
