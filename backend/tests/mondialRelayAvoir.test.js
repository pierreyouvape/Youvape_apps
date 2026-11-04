/**
 * Avoirs Mondial Relay : texte tel que pdf-parse le sort des PDF « AVC26_… ».
 *
 * Les deux formes rencontrées :
 *   • remise oubliée, une ligne par FACTURE, décimale virgule (AVC26_006095) ;
 *   • erreur de poids, une ligne par COLIS (n° d'expédition sans ses zéros de
 *     tête), décimale POINT et pays de livraison (forme d'AVC26_000006).
 */

const assert = require('assert');
const { parseMondialRelayAvoir, isMondialRelayAvoir, parseAmount } = require('../src/parsers/mondialRelayAvoirParser');
const { parseMondialRelayPdf } = require('../src/parsers/mondialRelayParser');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const FOOTER = 'SAS au capital de 500 400 € - N° RCS 385218631 LILLE METROPOLE - Code APE : 5229A\nPaiement à 30 jours sans escompte.\nBIC : INGBFRPP / IBAN : FR76 0000 0000 0000 0000 0000 000\nPage : 1 / 1\n\n-- 1 of 1 --\n';

const REMISE = `EMC
FR00000000000
Mondial Relay - SAS
N° donneur d'ordre LGYOUVAP
Avoir n° AVC26_006095
N° document externe AVC26_006095
Date d'échéance 08/10/26
Villeneuve d'Ascq, le 08 octobre 2026
AVOIR REMISE 1% MANQUANTE 1ER SEMESTRE
Description Quantité Prix unitaire Montant
REMISE 1% LGYOUVAP2600000048 1 28,58 € 28,58 €
REMISE 1% LGYOUVAP2600000049 1 26,40 € 26,40 €
REMISE 1% LGYOUVAP2600000054 1 0,04 € 0,04 €
Montant TVA Montant
Montant HT(€) % TVA Montant TVA Montant TTC(€)
55,02 20,00 11,00 66,02\tMONTANT TOTAL DE VOTRE AVOIR
${FOOTER}`;

const POIDS = `EMC
Avoir n° AVC26_000099
N° donneur d'ordre LGYOUVAP
Date d'échéance 07/02/26
Pays de livraison France
Villeneuve d'Ascq, le 7 février 2026
AVOIR ERREUR POIDS COLIS 657030/ 581673
Description Quantité Prix unitaire Montant
ERREUR POIDS COLIS 657030 1 9.21 € 9.21 €
ERREUR POIDS COLIS 581673 1 1 008.11 € 1 008.11 €
Montant TVA Montant
Montant HT(€) % TVA Montant TVA Montant TTC(€)
1 017.32 20.00 203.46 1 220.78\tMONTANT TOTAL DE VOTRE AVOIR
${FOOTER}`;

console.log('Avoirs Mondial Relay');

test('reconnu comme avoir, pas comme facture', () => {
  assert.ok(isMondialRelayAvoir(REMISE));
  assert.strictEqual(parseMondialRelayPdf(REMISE).invoiceNumber, null);
});

test('en-tête : numéro, date en toutes lettres, motif', () => {
  const a = parseMondialRelayAvoir(REMISE);
  assert.strictEqual(a.creditNumber, 'AVC26_006095');
  assert.strictEqual(a.creditDate, '08/10/2026');
  assert.strictEqual(a.dueDate, '08/10/2026');
  assert.strictEqual(a.title, 'REMISE 1% MANQUANTE 1ER SEMESTRE');
});

test('remise : une ligne par facture, totaux réconciliés', () => {
  const a = parseMondialRelayAvoir(REMISE);
  assert.deepStrictEqual(a.lines.map(l => [l.relatedInvoice, l.montant, l.tracking]), [
    ['LGYOUVAP2600000048', 28.58, null],
    ['LGYOUVAP2600000049', 26.40, null],
    ['LGYOUVAP2600000054', 0.04, null],
  ]);
  assert.deepStrictEqual([a.totalHT, a.tvaRate, a.totalTVA, a.totalTTC], [55.02, 20, 11, 66.02]);
  assert.ok(a.reconcileOk);
});

test('erreur de poids : colis en n° d\'expédition à 8 chiffres, décimale point, milliers', () => {
  const a = parseMondialRelayAvoir(POIDS);
  assert.strictEqual(a.creditDate, '07/02/2026');
  assert.strictEqual(a.pays, 'France');
  assert.deepStrictEqual(a.lines.map(l => [l.tracking, l.montant, l.relatedInvoice]), [
    ['00657030', 9.21, null],
    ['00581673', 1008.11, null],
  ]);
  assert.deepStrictEqual([a.totalHT, a.totalTTC], [1017.32, 1220.78]);
  assert.ok(a.reconcileOk);
});

test('montants : virgule, point, milliers', () => {
  assert.strictEqual(parseAmount('28,58'), 28.58);
  assert.strictEqual(parseAmount('0.05'), 0.05);
  assert.strictEqual(parseAmount('1.234,56'), 1234.56);
  assert.strictEqual(parseAmount('1 234.56 €'), 1234.56);
});

test('une facture n\'est pas prise pour un avoir', () => {
  assert.ok(!isMondialRelayAvoir('<ref>codeClient:LGYOUVAP--libelleClient:EMC--numeroFacture:LGYOUVAP2600000087</ref>\nMONTANT TOTAL FACTURE'));
});

if (failed) { console.log(`\n${failed} test(s) en échec`); process.exit(1); }
