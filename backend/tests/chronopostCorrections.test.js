/**
 * Factures rectificatives et avoirs Chronopost (réclamation de poids acceptée).
 *
 * Sans base ni réseau : `node tests/chronopostCorrections.test.js` (ou `npm test`).
 *
 * Cas réel du 05/10/2026 : colis XF148868036FR facturé 1,600 kg (12,99 €) sur la
 * facture 13761419. Chronopost renvoie l'avoir 40971692 « sur facture 13761419 »
 * et la facture rectificative 40971693 (0,130 kg, 8,47 €) qui ne cite pas 13761419.
 *
 * Ce qui est couvert :
 *   - la rectificative est reconnue comme telle, avec son TTC ;
 *   - l'avoir n'emprunte PAS le n° de la facture d'origine (l'import ZIP d'un avoir
 *     écrasait sinon le PDF de 13761419) ;
 *   - les totaux de l'avoir sont lus sur « TOTAL AVOIR HT TVA TTC ».
 */

const assert = require('assert');
const { _parsePdf } = require('../src/controllers/chronopostController');
const { chronopostCreditLines, chronopostLineCosts } = require('../src/services/orderShippingCost');

const RECTIF = `Compte 34751303
Facture 40971693
Date 05/10/2026
FACTURATION PRESTATIONS
09/09/2026 1 1 0,130 8,47
Facture rectificative / Prestation de service
1 09/09/2026 XF148868036FR 128000068272 34170 4450 DK Z2 0,130 8,47 S EXPRE Z2 1259607 N
TOTAL FACTURE 13,13 2,63 15,76`;

const AVOIR = `Compte 34751303
Avoir 40971692
Date 05/10/2026
AVOIR SUR FACTURE 13761419 DU 30/09/2026
1 XF148182251FR Supp Retour Expediteur Inter -45,00 N
2 09/09/2026 XF148868036FR 34170 4450 DK V 1,600 -12,99 S N
TOTAL AVOIR -83,58 -16,72 -100,30`;

const CLASSIQUE = `Compte 34751303
Facture 13761419
Date 30/09/2026
FACTURATION DU MOIS DE SEPTEMBRE
Facture commerciale / Prestation de service
11 09/09/2026 XF148868036FR 128000068272 34170 4450 DK Z2 V 1,600 12,99 S EXPRE Z2 1259607 N
TOTAL FACTURE 489,91 97,98 587,89`;

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.error(`  FAIL ${name}\n       ${e.message}`); }
}

console.log('chronopostCorrections');

test('rectificative reconnue, colis et TTC lus', () => {
  const r = _parsePdf(RECTIF);
  assert.strictEqual(r.invoiceNumber, '40971693');
  assert.strictEqual(r.isRectificative, true);
  assert.strictEqual(r.totalTtc, 15.76);
  assert.strictEqual(r.orders.length, 1);
  assert.strictEqual(r.orders[0].tracking, 'XF148868036FR');
  assert.strictEqual(r.orders[0].order_id, 1259607);
  assert.strictEqual(r.orders[0].amount_ht, 8.47);
});

test("rectificative sans la mention : reconnue à l'en-tête FACTURATION PRESTATIONS", () => {
  const r = _parsePdf(RECTIF.replace('Facture rectificative / Prestation de service\n', ''));
  assert.strictEqual(r.isRectificative, true);
});

test('facture classique : pas rectificative', () => {
  const r = _parsePdf(CLASSIQUE);
  assert.strictEqual(r.invoiceNumber, '13761419');
  assert.strictEqual(r.isRectificative, false);
});

test("avoir : n° d'avoir et facture d'origine, jamais pris pour une facture", () => {
  const r = _parsePdf(AVOIR);
  assert.strictEqual(r.invoiceNumber, null);
  assert.strictEqual(r.creditNumber, '40971692');
  assert.strictEqual(r.relatedInvoiceNumber, '13761419');
});

test('avoir : totaux HT / TTC du récapitulatif', () => {
  const r = _parsePdf(AVOIR);
  assert.strictEqual(r.creditTotalHt, -83.58);
  assert.strictEqual(r.creditTotalTtc, -100.3);
});

// Avoirs réels du 04/11/2026 : suppléments, pénalités et corrections de poids mêlés
const AVOIR_MIXTE = `Avoir 40984082
Date 04/11/2026
AVOIR SUR FACTURE 13821509 DU 31/10/2026
1 XR706079665TS Supplément Zones Difficiles d'accès -5,00 N
5 XR708943438TS Etiquette non conforme -2,00 N
6 06/10/2026 XR708913590TS 34170 78160 P 1,050 -4,34 N
Participation eco-responsable 1 colis à 0,22 EUR -0,22
Surcharge Carburant Routier : 5,00 % sur montant de 9,34 EUR -0,47
TOTAL AVOIR -12,03 -2,41 -14,44`;

const AVOIR_REACHEMINEMENT = `Avoir 40984106
Date 04/11/2026
AVOIR SUR FACTURE 13800049 DU 31/10/2026
22 XV911418595JB Traitement Réacheminement -8,00 N
XV911418595JB Traitement Retour expéditeur -2,00 N
Surcharge Carburant Routier : 24,20 % sur montant de 2,00 EUR -0,48
TOTAL AVOIR -10,48 -2,10 -12,58`;

const creditsOf = text => {
  const r = _parsePdf(text);
  return { r, lines: chronopostCreditLines(r.orders, r.globalCharges) };
};

test("avoir : l'éco-participation ne touche que le colis, la pénalité n'a pas de carburant", () => {
  const { lines } = creditsOf(AVOIR_MIXTE);
  assert.deepStrictEqual(lines, [-5.25, -2, -4.78]);
});

test('avoir : la somme des lignes égale le total HT du document', () => {
  const { r, lines } = creditsOf(AVOIR_MIXTE);
  assert.ok(Math.abs(lines.reduce((s, x) => s + x, 0) - r.creditTotalHt) < 0.02);
});

test('avoir : réacheminement hors carburant, retour expéditeur avec', () => {
  const { lines } = creditsOf(AVOIR_REACHEMINEMENT);
  assert.deepStrictEqual(lines, [-8, -2.48]);
});

// Facture 13800049 : ligne restée ignorée jusqu'au 09/11/2026, hors base carburant (3756,88 €)
test("correction d'adresse : lue sur le colis qui précède, sans carburant", () => {
  const r = _parsePdf(`Facture 13800049
Date 31/10/2026
1 22/10/2026 XN500035414FR 1271046 34170 38240 NT 0,500 6,99 S C13 1271046 N
Correction d'adresse 6,00 N
Surcharge Carburant Routier : 24,20 % sur montant de 6,99 EUR 1,69`);
  assert.deepStrictEqual(r.supplements.map(s => [s.description, s.amount_ht, s.related_tracking, s.related_order_id]),
    [["Correction d'adresse", 6, 'XN500035414FR', 1271046]]);
  const [line] = chronopostLineCosts(
    { global_charges: r.globalCharges },
    [{ id: 1, tracking: 'XN500035414FR', amount_ht: 6.99, is_return: false }],
    [{ tracking: 'XN500035414FR', description: "Correction d'adresse", amount_ht: 6 }]);
  assert.ok(Math.abs(line.cost - (6.99 * 1.242 + 6)) < 0.001);
});

if (failures) { console.error(`\n${failures} échec(s)`); process.exit(1); }
