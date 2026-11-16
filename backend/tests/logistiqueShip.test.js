/**
 * Banc de l'envoi du suivi au site (plugin youvape-logistique, order/ship).
 *
 * Sans base ni réseau : `node tests/logistiqueShip.test.js` (ou `npm test`).
 *
 * Les invariants : jamais de mail, le libellé transporteur est exactement celui
 * que BMS écrit aujourd'hui sur le site, et un colis refusé n'est jamais tenu
 * pour écrit.
 */

const assert = require('assert');
const rules = require('../src/services/logistiqueShipRules');

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

const base = {
  id: 9001, order_number: '1272001', wp_order_id: '1272001', country: 'FR', replace: false,
  created_at_tz: new Date('2026-11-16T09:30:00Z'),
};

// Couples réels titre BMS → libellé du site (étiquettes des 20 derniers jours, 16/11/2026).
const REAL = [
  ['colissimo', 'La Poste : Colissimo - Domicile sans signature', 'La Poste : Colissimo - Domicile sans signature'],
  ['colissimo', 'La Poste : Colissimo - Point de retrait', 'La Poste : Colissimo - Point de retrait'],
  ['chronopost', 'Chrono Relais FR - Livraison en point relais en France', 'Chrono Relais FR - Livraison en point relais en France'],
  ['chronopost', 'Chrono 13 - Livraison express à domicile avant 13H', 'Chrono 13 - Livraison express à domicile avant 13H'],
  ['laposte', 'La poste - Courrier suivi (port payé)', 'La poste - Courrier suivi (port payé)'],
  ['mondial_relay', 'Mondial Relay', 'Mondial Relay - Point Relais'],
  ['interne', 'Retrait magasin', 'Store Pickup - Entrepot'],
];

for (const [carrier, title, site] of REAL) {
  test(`libellé ${carrier} « ${title} » → « ${site} »`, () => {
    assert.strictEqual(rules.siteCarrierLabel({ carrier_code: carrier, bms_ship_title: title }), site);
  });
}

test('sans titre BMS : repli par transporteur', () => {
  assert.strictEqual(rules.siteCarrierLabel({ carrier_code: 'mondial_relay', bms_ship_title: null }), 'Mondial Relay - Point Relais');
  assert.strictEqual(rules.siteCarrierLabel({ carrier_code: 'colissimo', bms_ship_title: null }), 'colissimo');
});

test('ligne Colissimo : jamais de mail, lien La Poste, date UTC', () => {
  const line = rules.buildShipLine({
    ...base, carrier_code: 'colissimo', tracking_number: '6A12345678901',
    bms_ship_title: 'La Poste : Colissimo - Domicile sans signature',
  });
  assert.deepStrictEqual(line, {
    shipment_id: 'label-9001',
    order_id: 1272001,
    pickup: false,
    replace: false,
    carrier: 'colissimo',
    carrier_label: 'La Poste : Colissimo - Domicile sans signature',
    tracking_number: '6A12345678901',
    tracking_url: 'https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901',
    shipped_at: '2026-11-16T09:30:00.000Z',
    notify_customer: false,
  });
});

test('lettre suivie : lien La Poste', () => {
  const line = rules.buildShipLine({ ...base, carrier_code: 'laposte', tracking_number: '1L00112233445', bms_ship_title: 'La poste - Courrier suivi (port payé)' });
  assert.ok(line.tracking_url.startsWith('https://www.laposte.fr/'));
});

test('Mondial Relay : lien avec l\'enseigne et le pays', () => {
  const line = rules.buildShipLine({ ...base, carrier_code: 'mondial_relay', tracking_number: '12345678', country: 'BE', bms_ship_title: 'Mondial Relay' });
  assert.ok(line.tracking_url.includes('exp=12345678') && line.tracking_url.includes('pays=BE') && line.tracking_url.includes('ens='));
});

test('retrait entrepôt : pickup, sans lien ni numéro, jamais en « remplacer »', () => {
  const line = rules.buildShipLine({ ...base, carrier_code: 'interne', tracking_number: null, bms_ship_title: 'Retrait magasin', replace: true });
  assert.strictEqual(line.pickup, true);
  assert.strictEqual(line.replace, false);
  assert.strictEqual(line.tracking_url, '');
  assert.strictEqual(line.tracking_number, '');
  assert.strictEqual(line.carrier_label, 'Store Pickup - Entrepot');
  assert.strictEqual(line.notify_customer, false);
});

test('étiquette refaite : replace', () => {
  const line = rules.buildShipLine({ ...base, carrier_code: 'chronopost', tracking_number: 'XW123', bms_ship_title: 'Chrono 2 Shop Direct - 2Shop Direct', replace: true });
  assert.strictEqual(line.replace, true);
});

test('applied et already = écrit', () => {
  assert.deepStrictEqual(rules.classifyResult({ result: 'applied' }, 1), { status: 'sent', error: null });
  assert.deepStrictEqual(rules.classifyResult({ result: 'already' }, 3), { status: 'sent', error: null });
});

test('refus du plugin = erreur à regarder, pas de renvoi', () => {
  for (const code of ['ORDER_NOT_FOUND', 'ORDER_ALREADY_SHIPPED', 'ORDER_NOT_SHIPPABLE', 'SHIPMENT_ID_CONFLICT', 'SHIPMENT_PENDING', 'EXCEPTION_AFTER_WRITE', 'INVALID_LINE']) {
    const r = rules.classifyResult({ result: 'error', code, message: 'x' }, 1);
    assert.strictEqual(r.status, 'error', code);
    assert.ok(r.error.startsWith(code));
  }
});

test('échec passager = renvoi, puis erreur au-delà du plafond', () => {
  assert.strictEqual(rules.classifyResult({ result: 'not_processed', code: 'TIME_BUDGET' }, 1).status, 'retry');
  assert.strictEqual(rules.classifyResult({ result: 'error', code: 'ORDER_LOCKED' }, 2).status, 'retry');
  assert.strictEqual(rules.classifyResult({ result: 'error', code: 'ORDER_LOCKED' }, rules.MAX_ATTEMPTS).status, 'error');
});

test('ligne de réponse absente ou illisible : jamais tenue pour écrite', () => {
  assert.notStrictEqual(rules.classifyResult(undefined, 1).status, 'sent');
  assert.notStrictEqual(rules.classifyResult({ index: 0 }, 1).status, 'sent');
});

test('un seul colis par commande et par passage', () => {
  const out = rules.onePerOrder([{ id: 1, order_number: 'A' }, { id: 2, order_number: 'A' }, { id: 3, order_number: 'B' }]);
  assert.deepStrictEqual(out.map(l => l.id), [1, 3]);
});

if (failures) {
  console.log(`\n${failures} test(s) en échec`);
  process.exit(1);
}
console.log('\nlogistiqueShip : tout passe');
