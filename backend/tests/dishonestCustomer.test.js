/**
 * Banc des clients ayant été malhonnêtes : reconnaître leurs commandes futures,
 * même sous un nouveau compte.
 *
 * Sans base : `node tests/dishonestCustomer.test.js` (ou `npm test`).
 *
 * Ce qui est couvert :
 *   - les quatre critères (compte, email, téléphone, nom et prénom) et leur ordre ;
 *   - le téléphone sur ses 9 derniers chiffres (06…, +33 6…), les numéros de remplissage écartés ;
 *   - le nom sans casse, accents, tirets ni ordre ; un prénom seul ne suffit pas ;
 *   - seules les commandes payées, non nulles, créées après le signalement ;
 *   - blocage automatique : signalement coché ET même téléphone, rien d'autre ; note et mail.
 */

const assert = require('assert');
const { normPhone, nameKey, buildSignature, matchSignature, describeMatch } = require('../src/utils/customerIdentity');
const { matchOrderRow } = require('../src/models/dishonestCustomerModel');

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

const signature = buildSignature({
  wpUserId: 4242,
  emails: ['Fraudeur@Example.com '],
  phones: ['06 12 34 56 78', null, '0000000000'],
  names: [['Jean-Pierre', 'DUPONT'], ['', 'Dupont']]
});

console.log('Critères');

test('même compte, avant tout autre critère', () => {
  const m = matchSignature({ wpUserId: '4242', emails: ['fraudeur@example.com'] }, signature);
  assert.deepStrictEqual(m, { matchedBy: 'compte', matchedValue: null });
});

test('email sans casse ni espaces', () => {
  const m = matchSignature({ wpUserId: 1, emails: ['  FRAUDEUR@example.COM'] }, signature);
  assert.strictEqual(m.matchedBy, 'email');
  assert.strictEqual(m.matchedValue, 'fraudeur@example.com');
});

test('téléphone : +33, 0033 et 06 se valent', () => {
  for (const p of ['+33 6 12 34 56 78', '0033612345678', '06.12.34.56.78']) {
    const m = matchSignature({ wpUserId: 1, emails: ['autre@example.com'], phones: [p] }, signature);
    assert.strictEqual(m?.matchedBy, 'telephone', p);
    assert.strictEqual(m.matchedValue, p);
  }
});

test('téléphone de remplissage ou trop court : ignoré', () => {
  assert.strictEqual(normPhone('0000000000'), null);
  assert.strictEqual(normPhone('12345'), null);
  assert.strictEqual(matchSignature({ wpUserId: 1, phones: ['00 00 00 00 00'] }, signature), null);
});

test('nom et prénom : sans casse, accents, tirets ni ordre', () => {
  assert.strictEqual(nameKey('Jean-Pierre', 'DUPONT'), nameKey('dupont', 'jean pierre'));
  assert.strictEqual(nameKey('Jéan Piérre', 'Dupont'), nameKey('Jean-Pierre', 'dupont'));
  const m = matchSignature({ wpUserId: 1, names: [['DUPONT', 'Jean Pierre']] }, signature);
  assert.strictEqual(m.matchedBy, 'nom');
  assert.strictEqual(describeMatch(m), 'même nom et prénom (DUPONT Jean Pierre)');
});

test('un nom seul, ou un autre prénom, ne suffit pas', () => {
  assert.strictEqual(nameKey('', 'Dupont'), null);
  assert.strictEqual(matchSignature({ wpUserId: 1, names: [['Paul', 'Dupont'], ['', 'Dupont']] }, signature), null);
});

test('rien en commun : pas de correspondance', () => {
  assert.strictEqual(matchSignature({
    wpUserId: 1, emails: ['x@example.com'], phones: ['0699999999'], names: [['Marie', 'Curie']]
  }, signature), null);
});

console.log('Commandes');

const flag = { id: 7, wpUserId: '4242', flaggedLocal: new Date('2026-11-02T10:00:00'), signature };
const order = (over = {}) => ({
  post_status: 'wc-processing', order_total: '42.00', post_date: new Date('2026-11-02T11:00:00'),
  wp_customer_id: '9999', billing_email: 'nouveau@example.com', billing_phone: '+33612345678',
  shipping_phone: null, billing_first_name: 'Max', billing_last_name: 'Martin',
  shipping_first_name: 'Max', shipping_last_name: 'Martin', ...over
});

test('nouveau compte, même téléphone : reconnue', () => {
  const m = matchOrderRow(order(), [flag]);
  assert.strictEqual(m.matchedBy, 'telephone');
  assert.strictEqual(m.flag.id, 7);
});

test('nom du destinataire (livraison) : reconnu aussi', () => {
  const m = matchOrderRow(order({ billing_phone: null, shipping_first_name: 'Jean-Pierre', shipping_last_name: 'Dupont' }), [flag]);
  assert.strictEqual(m.matchedBy, 'nom');
});

test('commande créée avant le signalement : ignorée (seules les futures comptent)', () => {
  assert.strictEqual(matchOrderRow(order({ post_date: new Date('2026-11-02T09:59:00') }), [flag]), null);
});

test('commande non payée ou à 0 € : ignorée', () => {
  assert.strictEqual(matchOrderRow(order({ post_status: 'wc-pending' }), [flag]), null);
  assert.strictEqual(matchOrderRow(order({ post_status: 'wc-refunded' }), [flag]), null);
  assert.strictEqual(matchOrderRow(order({ order_total: '0.00' }), [flag]), null);
});

test('plusieurs signalements : le critère le plus sûr l\'emporte', () => {
  const other = { id: 8, wpUserId: '9999', flaggedLocal: new Date('2026-11-01T00:00:00'), signature: buildSignature({ wpUserId: 9999 }) };
  const m = matchOrderRow(order(), [flag, other]);
  assert.strictEqual(m.flag.id, 8);
  assert.strictEqual(m.matchedBy, 'compte');
});

console.log('Blocage automatique par téléphone et mail d\'alerte');

const { autoBlockMatch } = require('../src/models/dishonestCustomerModel');
const { buildNote, buildAlertMail } = require('../src/services/dishonestOrderService');

const flagAuto = {
  id: 2, wpUserId: '85991', reason: 'arnaque', autoBlock: true, flaggedLocal: new Date('2026-11-09T17:01:36'),
  signature: buildSignature({ wpUserId: 85991, emails: ['legoataya@gmail.com'], phones: ['+33756829187'] })
};
const paid = (over = {}) => ({
  post_status: 'wc-processing', order_total: '17.80', post_date: new Date('2026-11-10T09:12:00'),
  billing_phone: null, shipping_phone: null, ...over
});

test('signalement coché, autre compte et autre email, même téléphone (écrit autrement) : à bloquer', () => {
  const m = autoBlockMatch(paid({ billing_phone: '07 56 82 91 87' }), [flagAuto]);
  assert.strictEqual(m.flag.id, 2);
  assert.strictEqual(m.phone, '07 56 82 91 87');
});

test('téléphone de livraison seul : à bloquer aussi', () => {
  assert.ok(autoBlockMatch(paid({ billing_phone: '0600000001', shipping_phone: '0033 7 56 82 91 87' }), [flagAuto]));
});

test('signalement NON coché : jamais bloqué, même téléphone ou pas', () => {
  assert.strictEqual(autoBlockMatch(paid({ billing_phone: '+33756829187' }), [{ ...flagAuto, autoBlock: false }]), null);
});

test('coché mais autre téléphone : pas bloqué (l\'email ou le compte ne suffisent pas)', () => {
  assert.strictEqual(autoBlockMatch(paid({ billing_phone: '0612345678' }), [flagAuto]), null);
});

test('coché, même téléphone, mais commande antérieure au signalement, non payée ou à 0 € : pas bloquée', () => {
  assert.strictEqual(autoBlockMatch(paid({ billing_phone: '+33756829187', post_date: new Date('2026-11-09T16:50:29') }), [flagAuto]), null);
  assert.strictEqual(autoBlockMatch(paid({ billing_phone: '+33756829187', post_status: 'wc-pending' }), [flagAuto]), null);
  assert.strictEqual(autoBlockMatch(paid({ billing_phone: '+33756829187', order_total: '0.00' }), [flagAuto]), null);
});

const alertTel = {
  wpUserId: '85991', customerName: 'mary obeun', reason: 'arnaque', flaggedAt: new Date('2026-11-09T16:01:36Z'),
  flaggedBy: 'Pierre', matchedBy: 'telephone', matchedValue: '+33756829187'
};
const mailOrder = {
  wp_order_id: 1275700, created_label: '10/11/2026 09:12', order_total: '17.80', payment_method_title: 'PayPal (x@y.fr)',
  billing_first_name: 'Marie', billing_last_name: 'O.', billing_email: 'autre@mail.fr', billing_phone: '07 56 82 91 87'
};

test('note du ticket : bloquée, pas bloquée (et pourquoi), ou signalement sans blocage automatique', () => {
  assert.ok(buildNote(mailOrder, alertTel, { blocked: true, phone: '07 56 82 91 87' }).includes('Bloquée automatiquement au Picking (même téléphone 07 56 82 91 87)'));
  assert.ok(buildNote(mailOrder, alertTel, { blocked: false, note: 'étiquette déjà faite' }).includes('Pas bloquée automatiquement — étiquette déjà faite'));
  const sans = buildNote(mailOrder, alertTel, null);
  assert.ok(sans.includes('règles de vague') && !sans.includes('Bloquée'));
});

test('mail : une ligne par commande, compte des bloquées dans l\'objet, valeurs échappées', () => {
  const mail = buildAlertMail([
    { id: 1, order: mailOrder, alert: alertTel, block: { blocked: true, phone: '07 56 82 91 87' }, ticketId: 4321 },
    { id: 2, order: { ...mailOrder, wp_order_id: 1275701, billing_last_name: '<b>' }, alert: alertTel,
      block: { blocked: false, note: 'étiquette déjà faite', phone: '+33756829187' }, ticketId: null }
  ]);
  assert.strictEqual(mail.subject, 'Client malhonnête : 2 commandes (1 bloquée) — mary obeun');
  assert.ok(mail.html.includes('/orders/1275700'));
  assert.ok(mail.html.includes('même téléphone (07 56 82 91 87)'));
  assert.ok(mail.html.includes('#4321'));
  assert.ok(mail.html.includes('Pas bloquée : étiquette déjà faite'));
  assert.ok(mail.html.includes('&lt;b&gt;') && !mail.html.includes('<b>'));
  assert.ok(mail.text.includes('Commande 1275700') && mail.text.includes('BLOQUÉE'));
});

console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} test(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
