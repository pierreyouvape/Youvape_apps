/**
 * Banc de non-régression de l'étiquetage transporteur.
 *
 * Sans dépendance ni base : `node tests/carriers.test.js` (ou `npm test`).
 *
 * Ce banc existe pour une raison précise. Le lot 0 du chantier expédition a
 * sorti La Poste de son contrôleur pour la mettre derrière un contrat commun,
 * à comportement strictement identique — un refactor invisible, donc
 * indémontrable autrement. La fixture `laposte-reference.json` a été produite
 * par la VERSION D'ORIGINE du code : elle fige ce que le packing envoyait
 * réellement à La Poste avant la bascule. Si le payload change, le test casse.
 *
 * Ce qui est couvert :
 *   - le corps de la requête d'étiquette, cas réalistes compris (entités HTML
 *     laissées par WooCommerce dans les adresses) ;
 *   - le nettoyage des champs d'adresse ;
 *   - la fenêtre d'annulation La Poste (7 jours ET même mois civil) ;
 *   - les messages rendus au packing en cas de panne d'API ;
 *   - le respect du contrat par les adaptateurs enregistrés.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const laposte = require('../src/services/carriers/laposteAdapter');
const { sanitizeAddressField } = require('../src/services/carriers/addressFields');
const { buildUserMessage } = require('../src/services/carriers/errors');
const { assertAdapter } = require('../src/services/carriers/contract');
const { getAdapter, listCarrierCodes } = require('../src/services/carriers');

const reference = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'laposte-reference.json'), 'utf-8')
);

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

// Le contrat tel que la migration add_shipment_labels.sql le sème dans
// carrier_accounts, à partir des clés laposte_* d'app_config.
const ACCOUNT = {
  carrierCode: 'laposte',
  accountCode: 'lettre_suivie',
  credentials: { token_url: 'https://exemple/token', client_id: 'id', client_secret: 'secret' },
  settings: {
    api_url: 'https://apim-gw-vente.extra.laposte.fr/postage/v1',
    contract_number: 'D-1153498-1',
    cust_acc_number: '2109320',
    cust_invoice: '2109320',
    offer_code: '3125',
    product_code: 'K7',
    visual_format: 'rollA',
    country_code: '250',
    fixed_weight_g: 20,
    sender: {
      email: 'contact@youvape.fr', phone: '0499782453', name: 'SAS EMC',
      address: '580 avenue de l aube rouge', zipcode: '34170', town: 'Castelnau le lez'
    }
  }
};

// ── Payload d'étiquette : identique à la version d'origine ───────────────────
console.log('\nLa Poste — corps de la requête d\'étiquette');

for (const c of reference.payloads) {
  test(`payload inchangé : ${c.label}`, () => {
    const actual = laposte.buildLabelPayload({
      orderNumber: c.orderNumber,
      receiver: c.receiver,
      account: ACCOUNT,
      weightGrams: 20
    });
    // Comparaison sur le JSON sérialisé : l'ORDRE des clés compte aussi, c'est
    // ce que l'API reçoit réellement.
    assert.strictEqual(JSON.stringify(actual, null, 2), JSON.stringify(c.payload, null, 2));
  });
}

test('le poids déclaré vient du contrat, pas du code', () => {
  const p = laposte.buildLabelPayload({
    orderNumber: '1', receiver: reference.payloads[0].receiver, account: ACCOUNT, weightGrams: 37
  });
  assert.strictEqual(p.order.offer.products[0].productOptions.weight, 37);
});

test('réglages absents : repli sur les valeurs historiques', () => {
  const bare = { ...ACCOUNT, settings: {
    contract_number: 'D-1153498-1', cust_acc_number: '2109320', cust_invoice: '2109320'
  } };
  const p = laposte.buildLabelPayload({
    orderNumber: '1', receiver: reference.payloads[0].receiver, account: bare, weightGrams: 20
  });
  assert.strictEqual(p.order.offer.offerCode, '3125');
  assert.strictEqual(p.order.offer.products[0].productCode, 'K7');
  assert.strictEqual(p.order.offer.masterOutputOptions.visualFormatCode, 'rollA');
  assert.strictEqual(p.order.offer.products[0].sender.address.name1, 'SAS EMC');
  assert.strictEqual(p.order.offer.products[0].receiver.address.countryCode, '250');
});

// ── Nettoyage des champs d'adresse ───────────────────────────────────────────
console.log('\nNettoyage des champs d\'adresse');

test(`${reference.sanitize.length} cas de référence inchangés`, () => {
  for (const c of reference.sanitize) {
    assert.strictEqual(sanitizeAddressField(c.in), c.out,
      `entrée ${JSON.stringify(c.in)} : attendu ${JSON.stringify(c.out)}, obtenu ${JSON.stringify(sanitizeAddressField(c.in))}`);
  }
});

test('null et undefined traversent sans conversion', () => {
  assert.strictEqual(sanitizeAddressField(null), null);
  assert.strictEqual(sanitizeAddressField(undefined), undefined);
});

// ── Fenêtre d'annulation ─────────────────────────────────────────────────────
console.log('\nFenêtre d\'annulation La Poste');

const at = (iso) => ({ created_at: iso });

test('étiquette du jour : annulable', () => {
  const r = laposte.cancelWindow(at('2026-09-10T09:00:00'), new Date('2026-09-10T18:00:00'));
  assert.strictEqual(r.cancellable, true);
});

test('6 jours, même mois : annulable', () => {
  const r = laposte.cancelWindow(at('2026-09-04T09:00:00'), new Date('2026-09-10T09:00:00'));
  assert.strictEqual(r.cancellable, true);
});

test('8 jours : hors délai', () => {
  const r = laposte.cancelWindow(at('2026-09-01T09:00:00'), new Date('2026-09-10T09:00:00'));
  assert.strictEqual(r.cancellable, false);
  assert.ok(r.reason.includes('7 jours'));
});

test('3 jours mais mois civil différent : refusé (contrainte de facturation)', () => {
  const r = laposte.cancelWindow(at('2026-08-30T09:00:00'), new Date('2026-09-02T09:00:00'));
  assert.strictEqual(r.cancellable, false);
});

test('même mois, année différente : refusé', () => {
  const r = laposte.cancelWindow(at('2025-09-08T09:00:00'), new Date('2026-09-10T09:00:00'));
  assert.strictEqual(r.cancellable, false);
});

// ── Messages rendus au packing ───────────────────────────────────────────────
console.log('\nMessages d\'erreur pour le packing');

const msg = (error) => buildUserMessage(error, 'La Poste');

test('timeout', () => {
  assert.strictEqual(msg(new Error('Timeout La Poste API')),
    'La Poste ne répond pas (délai dépassé). Réessayez dans quelques instants.');
});

test('503', () => {
  assert.ok(msg(Object.assign(new Error('x'), { statusCode: 503 })).includes('temporairement indisponible (erreur 503)'));
});

test('réponse non-JSON', () => {
  assert.ok(msg(Object.assign(new Error('x'), { statusCode: 500, nonJson: true })).includes('réponse inattendue'));
});

test('401 : jeton expiré', () => {
  assert.strictEqual(msg(Object.assign(new Error('x'), { statusCode: 401 })),
    'Authentification La Poste expirée. Réessayez — le jeton va être renouvelé automatiquement.');
});

test('erreur sans cas connu : pas de message inventé', () => {
  assert.strictEqual(msg(Object.assign(new Error('x'), { statusCode: 400 })), null);
});

// ── Contrat ──────────────────────────────────────────────────────────────────
console.log('\nContrat transporteur');

test('tous les adaptateurs enregistrés respectent le contrat', () => {
  for (const code of listCarrierCodes()) {
    assertAdapter(getAdapter(code));
  }
});

test('un transporteur inconnu est refusé, pas ignoré', () => {
  assert.throws(() => getAdapter('dhl'), /non pris en charge/);
});

test('une méthode manquante casse au chargement', () => {
  assert.throws(
    () => assertAdapter({ code: 'x', accountCode: 'a', methodCode: 'm', label: 'X', logTag: 'X',
                          bmsShipmentTitle: 't', resolveWeight() {}, createLabel() {}, cancelLabel() {} }),
    /cancelWindow/
  );
});

test('une propriété manquante casse au chargement', () => {
  assert.throws(
    () => assertAdapter({ code: 'x', accountCode: 'a', methodCode: 'm', label: 'X',
                          bmsShipmentTitle: 't', resolveWeight() {}, createLabel() {},
                          cancelLabel() {}, cancelWindow() {} }),
    /logTag/
  );
});

test('le tag de log La Poste reste celui des logs de production', () => {
  assert.strictEqual(laposte.logTag, 'LaPoste');
});

test('le libellé BMS de La Poste est celui attendu par BMS', () => {
  assert.strictEqual(laposte.bmsShipmentTitle, 'La poste - Courrier suivi (port payé)');
});

console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} test(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
