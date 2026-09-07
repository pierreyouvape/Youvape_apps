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

// ── Mondial Relay ────────────────────────────────────────────────────────────
console.log('\nMondial Relay — corps de la requête');

const mr = require('../src/services/carriers/mondialRelayAdapter');

const MR_ACCOUNT = {
  carrierCode: 'mondial_relay', accountCode: 'sandbox',
  credentials: { login: 'X@business-api.mondialrelay.com', password: 'secret', customer_id: 'TTMRSDBX' },
  settings: {
    api_url: 'https://exemple/api/shipment', output_format: '10x15', output_type: 'PdfUrl',
    culture: 'fr-FR', version_api: '1.0', collection_mode: 'CCC',
    sender: { firstname: 'Youvape', lastname: 'SAS EMC', house_no: '580',
              streetname: 'avenue de l aube rouge', postcode: '34170',
              city: 'Castelnau le lez', country_code: 'FR', email: 'c@y.fr', phone: '0499782453' }
  }
};
const MR_RECEIVER = {
  first_name: 'Marie', last_name: 'Testeuse', address: '12 rue de la Republique',
  postcode: '69003', city: 'Lyon 3e', country: 'FR', phone: '0600000000', email: 't@e.com'
};
const mrXml = (over = {}) => mr.buildLabelPayload({
  orderNumber: over.orderNumber ?? '1258938',
  receiver: { ...MR_RECEIVER, ...(over.receiver || {}) },
  account: MR_ACCOUNT, weightGrams: over.weightGrams ?? 480,
  options: over.options ?? { deliveryMode: '24R', relayPoint: { id: '022112', country: 'FR' } }
});

test('le point relais est préfixé du pays du POINT, pas « FR » en dur', () => {
  const be = mrXml({ options: { deliveryMode: '24R', relayPoint: { id: '041212', country: 'BE' } } });
  assert.ok(be.includes('Location="BE-041212"'), 'préfixe pays perdu');
  const lu = mrXml({ options: { deliveryMode: '24R', relayPoint: { id: '000123', country: 'lu' } } });
  assert.ok(lu.includes('Location="LU-000123"'), 'pays non mis en majuscules');
});

test('les consignes passent en 24R comme les points relais', () => {
  assert.ok(mrXml({ options: { deliveryMode: '24R', relayPoint: { id: '016834', country: 'FR' } } })
    .includes('Mode="24R"'));
});

test('le poids part en grammes', () => {
  assert.ok(mrXml({ weightGrams: 323 }).includes('<Weight Value="323" Unit="gr"/>'));
});

test('le numéro de voie est séparé du nom de rue', () => {
  const x = mrXml();
  assert.ok(x.includes('<HouseNo>12</HouseNo>'), x.match(/<HouseNo>[^<]*/)?.[0]);
  assert.ok(x.includes('<Streetname>rue de la Republique</Streetname>'));
});

test('une adresse sans numéro reste entière dans Streetname', () => {
  const x = mrXml({ receiver: { address: 'Lieu-dit Les Chenes' } });
  assert.ok(x.includes('<HouseNo></HouseNo>'), 'numéro inventé');
  assert.ok(x.includes('<Streetname>Lieu-dit Les Chenes</Streetname>'));
});

test('la ville perd ses chiffres, que l\'API refuse', () => {
  assert.ok(mrXml({ receiver: { city: 'Lyon 3e' } }).includes('<City>Lyon e</City>'));
});

test('Title+Firstname+Lastname est ramené à 32 caractères', () => {
  const x = mrXml({ receiver: { first_name: 'Jean-Baptiste-Emmanuel', last_name: 'De La Tour Du Pin Verclause' } });
  const [, t] = x.match(/<Title>([^<]*)<\/Title>/);
  const [, f] = x.match(/<Firstname>([^<]*)<\/Firstname>/);
  const [, l] = x.match(/<Lastname>([^<]*)<\/Lastname>/);
  assert.ok((t + f + l).length <= 32, `${(t + f + l).length} caractères au lieu de 32 max`);
  assert.ok(f.length > 0, 'le prénom a été entièrement rogné');
});

test('Streetname+HouseNo est ramené à 40 caractères', () => {
  const x = mrXml({ receiver: { address: '1234 avenue du General Charles De Gaulle Prolongee' } });
  const [, st] = x.match(/<Streetname>([^<]*)<\/Streetname>/);
  const [, ho] = x.match(/<HouseNo>([^<]*)<\/HouseNo>/);
  assert.ok((st + ho).length <= 40, `${(st + ho).length} caractères au lieu de 40 max`);
});

test('le numéro de commande est mis en majuscules et filtré', () => {
  assert.ok(mrXml({ orderNumber: 'test-abc/123' }).includes('<OrderNo>TEST-ABC123</OrderNo>'));
});

test('les caractères XML des adresses sont échappés', () => {
  const x = mrXml({ receiver: { last_name: 'Durand & Fils', address: '3 rue <test>' } });
  assert.ok(x.includes('Durand &amp; Fils'), 'esperluette non échappée');
  assert.ok(!/<Streetname>[^<]*<test>/.test(x), 'balise injectée dans l\'adresse');
});

test('le mot de passe est caviardé avant journalisation', () => {
  const r = mr.redact({ contextField: { passwordField: 'secret', loginField: 'moi' }, autre: 1 });
  assert.strictEqual(r.contextField.passwordField, '***');
  assert.strictEqual(r.contextField.loginField, '***');
  assert.strictEqual(r.autre, 1);
});

test('Mondial Relay se déclare non annulable, avec la raison', () => {
  const w = mr.cancelWindow();
  assert.strictEqual(w.cancellable, false);
  assert.ok(/annuler/i.test(w.reason));
});

// ── Retrait magasin ──────────────────────────────────────────────────────────
console.log('\nRetrait magasin (adaptateur interne)');

const interne = require('../src/services/carriers/interneAdapter');

test('ne réclame ni contrat ni confirmation BMS', () => {
  assert.strictEqual(interne.requiresAccount, false);
  assert.strictEqual(interne.confirmsShipmentInBms, false);
});

test('ne déclare aucun poids : rien n\'est transporté', async () => {
  assert.strictEqual(await interne.resolveWeight({}), 0);
});

console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} test(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
