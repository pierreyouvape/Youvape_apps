/**
 * Coût complet d'une ligne de colis (services/orderShippingCost.js).
 *
 * Sans base : `node tests/orderShippingCost.test.js` (ou `npm test`).
 *
 * Ces formules doivent rester celles des écrans d'analyse (ChronopostApp,
 * ColissimoApp) : la commande reçoit la somme de ses lignes, tous transporteurs.
 * Cas réels :
 *   - XF148868036FR (facture 13761419, Express) : 12,99 € + sûreté 0,70, carburant
 *     aérien 42,25 %, éco 0,09 → 19,56 € ; rectifié à 8,47 € → 13,13 € (HT imprimé sur 40971693).
 *   - XS488369607FR (13800049) : retour expéditeur, transport 0 + traitement 2,00 €
 *     → ni sûreté ni éco, carburant sur le supplément → 2,48 €.
 */
const assert = require('assert');
const { chronopostLineCosts, colissimoLineCosts, mondialRelayLineCosts } = require('../src/services/orderShippingCost');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.error(`  FAIL ${name}\n       ${e.message}`); }
}
const r2 = v => Math.round(v * 100) / 100;

console.log('orderShippingCost');

const EXPRESS = { global_charges: [
  { description: 'Redevance sûreté', detail: '28 colis × 0.70 EUR', amount_ht: 19.6 },
  { description: 'Participation eco-responsable', detail: '28 colis × 0.09 EUR', amount_ht: 2.52 },
  { description: 'Surcharge Carburant', detail: '42.25% sur 342.63 EUR', amount_ht: 144.76 },
] };

test('Chronopost aller : transport + sûreté, carburant, éco', () => {
  const [l] = chronopostLineCosts(EXPRESS, [{ id: 1, tracking: 'XF148868036FR', amount_ht: '12.99', is_return: false }], []);
  assert.strictEqual(r2(l.cost), 19.56);
});

test('Chronopost rectificative 8,47 € : 13,13 € (HT du PDF)', () => {
  const rect = { global_charges: [
    { description: 'Redevance sûreté', detail: '1 colis × 0.70 EUR', amount_ht: 0.7 },
    { description: 'Participation eco-responsable', detail: '1 colis × 0.09 EUR', amount_ht: 0.09 },
    { description: 'Surcharge Carburant', detail: '42.25% sur 9.17 EUR', amount_ht: 3.87 },
  ] };
  const [l] = chronopostLineCosts(rect, [{ id: 1, tracking: 'XF148868036FR', amount_ht: '8.47', is_return: false }], []);
  assert.strictEqual(r2(l.cost), 13.13);
});

test('Chronopost retour expéditeur : supplément × carburant, sans sûreté ni éco', () => {
  const inv = { global_charges: [
    { description: 'Redevance sûreté', detail: '668 colis × 0.70 EUR', amount_ht: 467.6 },
    { description: 'Participation eco-responsable', detail: '668 colis × 0.09 EUR', amount_ht: 60.12 },
    { description: 'Surcharge Carburant', detail: '24.2% sur 3756.88 EUR', amount_ht: 909.16 },
  ] };
  const [l] = chronopostLineCosts(inv,
    [{ id: 1, tracking: 'XS488369607FR', amount_ht: '0', is_return: true }],
    [{ tracking: 'XS488369607FR', description: 'Retour expéditeur', amount_ht: '2.00' }]);
  assert.strictEqual(r2(l.cost), 2.48);
});

test('Chronopost : étiquette non conforme hors carburant', () => {
  const inv = { global_charges: [{ description: 'Surcharge Carburant', detail: '5% sur 100 EUR', amount_ht: 5 }] };
  const [l] = chronopostLineCosts(inv,
    [{ id: 1, tracking: 'XR1', amount_ht: '3.72', is_return: false }],
    [{ tracking: 'XR1', description: 'Étiquette non conforme', amount_ht: '2.00' }]);
  assert.strictEqual(r2(l.cost), r2(3.72 * 1.05 + 2));
});

test('Chronopost : ligne sans montant → pas de coût', () => {
  const [l] = chronopostLineCosts(EXPRESS, [{ id: 1, tracking: 'X', amount_ht: null }], []);
  assert.strictEqual(l.cost, null);
});

test('Colissimo : Total HT + suppléments + décarbonation', () => {
  const inv = { parcels_detail: [{ tracking: '9L1', decarbonation_unit: 0.03 }] };
  const [l] = colissimoLineCosts(inv, [{ id: 1, tracking: '9L1', amount_ht: '8.55' }],
    [{ tracking: '9L1', amount_ht: '3.00' }]);
  assert.strictEqual(r2(l.cost), 11.58);
});

test('Mondial Relay : montant de l\'annexe tel quel', () => {
  const [l] = mondialRelayLineCosts({}, [{ id: 1, tracking: '00623180', amount_ht: '3.07' }]);
  assert.strictEqual(l.cost, 3.07);
});

if (failures) { console.error(`\n${failures} échec(s)`); process.exit(1); }
