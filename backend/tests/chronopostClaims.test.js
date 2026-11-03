/**
 * Banc des réclamations Chronopost : échéances, décision, fichier d'import.
 *
 * Sans base ni réseau : `node tests/chronopostClaims.test.js` (ou `npm test`).
 *
 * Ce qui est couvert :
 *   - jours fériés (Pâques et ses fêtes mobiles, 11 novembre) ;
 *   - jour dû : lendemain ouvré, vendredi → lundi, option samedi, férié sauté,
 *     Express à J+3 ouvrés, 2Shop jamais ;
 *   - heure du contrôle : 16 h à Paris, été comme hiver ;
 *   - décision : livré / mis en relais avant 16 h, retard (RT), jamais pris en
 *     charge (PC), livraison après 16 h, code non classé ;
 *   - commentaire (commande 1273568, retard déclaré le 03/11/2026) ;
 *   - fichier : en-tête du modèle, `;`, CRLF, UTF-8 sans BOM, colonnes vides
 *     là où la notice les interdit ;
 *   - compte-rendu d'import de la notice Chronopost.
 */

const assert = require('assert');
const { holidaysOf, isHoliday, addBusinessDays } = require('../src/utils/frenchHolidays');
const rules = require('../src/services/claims/chronopostClaims');

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

const ev = (event_key, iso, extra = {}) => ({ event_key, occurred_at: iso, ...extra });
const STATES = {
  DC: 'label_created', SC: 'in_transit', TS: 'in_transit', SD: 'in_transit', CR: 'delayed',
  TA: 'out_for_delivery', N: 'delivery_failed', AB: 'at_pickup_point', D: 'delivered', SM: 'info',
};
const stateOf = (k) => STATES[k] || null;
const RELAIS = { method_code: '86' };
const C13 = { method_code: '01' };

console.log('Jours fériés');
test('2026 : Pâques le 5 avril, Ascension le 14 mai, Pentecôte le 25 mai', () => {
  const h = holidaysOf(2026);
  for (const d of ['2026-04-06', '2026-05-14', '2026-05-25', '2026-11-11', '2026-11-01']) assert.ok(h.has(d), d);
  assert.strictEqual(h.size, 11);
});
test('un jour ordinaire n\'est pas férié', () => assert.strictEqual(isHoliday('2026-11-03'), false));
test('jours ouvrés : le samedi ne compte qu\'avec l\'option', () => {
  assert.strictEqual(addBusinessDays('2026-10-30', 1), '2026-11-02');
  assert.strictEqual(addBusinessDays('2026-10-30', 1, { saturday: true }), '2026-10-31');
});

console.log('Jour dû');
test('Chrono Relais déposé lundi : dû mardi', () => assert.strictEqual(rules.dueDay('2026-11-02', '86'), '2026-11-03'));
test('Chrono 13 déposé vendredi : dû lundi', () => assert.strictEqual(rules.dueDay('2026-10-30', '01'), '2026-11-02'));
test('Chrono 13 déposé vendredi avec l\'option samedi : dû samedi', () =>
  assert.strictEqual(rules.dueDay('2026-10-30', '01-SAMEDI'), '2026-10-31'));
test('déposé la veille du 11 novembre : dû le 12', () => assert.strictEqual(rules.dueDay('2026-11-10', '86'), '2026-11-12'));
test('Chrono Express : J+3 ouvrés, férié sauté', () => {
  assert.strictEqual(rules.dueDay('2026-11-05', '17'), '2026-11-10');
  assert.strictEqual(rules.dueDay('2026-11-09', '17'), '2026-11-13');
});
test('2Shop n\'est jamais réclamé', () => {
  assert.strictEqual(rules.dueDay('2026-11-02', '5X'), null);
  assert.strictEqual(rules.dueDay('2026-11-02', '6B'), null);
});

console.log('Heure du contrôle');
test('16 h à Paris : 15 h UTC en hiver, 14 h UTC en été', () => {
  assert.strictEqual(rules.checkInstant('2026-11-03').toISOString(), '2026-11-03T15:00:00.000Z');
  assert.strictEqual(rules.checkInstant('2026-07-01').toISOString(), '2026-07-01T14:00:00.000Z');
});

console.log('Décision');
const DAY = '2026-11-03';
test('Relais mis à disposition avant 16 h : rien', () => {
  const r = rules.decide(RELAIS, [ev('DC', '2026-11-02T11:00:00Z'), ev('SC', '2026-11-02T16:40:00Z'), ev('AB', '2026-11-03T10:00:00Z')], stateOf, DAY);
  assert.strictEqual(r.object, null);
});
test('Chrono 13 livré avant 16 h : rien', () => {
  assert.strictEqual(rules.decide(C13, [ev('SC', '2026-11-02T16:40:00Z'), ev('D', '2026-11-03T11:46:38Z')], stateOf, DAY).object, null);
});
test('Chrono 13 présenté, client absent, laissé en point de retrait : rien', () => {
  assert.strictEqual(rules.decide(C13, [ev('SC', '2026-11-02T16:40:00Z'), ev('N', '2026-11-03T10:00:00Z'), ev('AB', '2026-11-03T12:00:00Z')], stateOf, DAY).object, null);
});
test('Chrono Relais en échec de livraison au relais : RT', () => {
  assert.strictEqual(rules.decide(RELAIS, [ev('SC', '2026-11-02T16:40:00Z'), ev('N', '2026-11-03T10:00:00Z')], stateOf, DAY).object, 'RT');
});
test('pris en charge, pas livré : RT, dernier évènement retenu (1273568)', () => {
  const r = rules.decide(RELAIS, [
    ev('DC', '2026-11-02T14:51:00Z'), ev('SC', '2026-11-02T16:48:00Z'), ev('TS', '2026-11-03T04:26:00Z'),
    ev('CR', '2026-11-03T10:03:00Z', { label: 'Colis retardé durant l\'acheminement', location: 'HUB CHILLY MAZARIN CHRONOPOST' }),
    ev('SM', '2026-11-03T10:24:00Z'),
  ], stateOf, DAY);
  assert.strictEqual(r.object, 'RT');
  assert.strictEqual(r.lastEvent.event_key, 'CR');
});
test('aucun scan Chronopost depuis le bordereau : PC', () => {
  assert.strictEqual(rules.decide(RELAIS, [ev('DC', '2026-11-02T11:00:00Z')], stateOf, DAY).object, 'PC');
  assert.strictEqual(rules.decide(RELAIS, [], stateOf, DAY).object, 'PC');
});
test('livré après 16 h : réclamé quand même (rattrapage identique au contrôle du jour)', () => {
  assert.strictEqual(rules.decide(C13, [ev('SC', '2026-11-02T16:40:00Z'), ev('D', '2026-11-03T15:30:00Z')], stateOf, DAY).object, 'RT');
});
test('un code jamais classé prouve la prise en charge', () => {
  assert.strictEqual(rules.decide(C13, [ev('DC', '2026-11-02T11:00:00Z'), ev('ZZ', '2026-11-02T17:00:00Z')], stateOf, DAY).object, 'RT');
});

console.log('Commentaire');
test('retard Chrono Relais : produit, bordereau, échéance, dernier évènement', () => {
  const c = rules.buildComment({
    object: 'RT', label: RELAIS, depositDay: '2026-11-02', bordereauNumber: 'CH-20261102-02', day: DAY,
    lastEvent: ev('CR', '2026-11-03T10:03:00Z', { label: 'Colis retardé durant l\'acheminement', location: 'HUB CHILLY MAZARIN CHRONOPOST' }),
  });
  assert.strictEqual(c, 'Chrono Relais remis au chauffeur le 02/11/2026 (bordereau CH-20261102-02), livraison due le '
    + '03/11/2026 avant 13h, non livré à 16h. Dernier évènement : 03/11 11:03 Colis retardé durant l\'acheminement '
    + '(HUB CHILLY MAZARIN CHRONOPOST).');
});
test('Express : pas de « avant 13h »', () => {
  const c = rules.buildComment({ object: 'RT', label: { method_code: '17' }, depositDay: '2026-11-05', bordereauNumber: null, day: '2026-11-10', lastEvent: null });
  assert.strictEqual(c, 'Chrono Express remis au chauffeur le 05/11/2026, livraison due le 10/11/2026, non livré à 16h.');
});
test('jamais pris en charge', () => {
  const c = rules.buildComment({ object: 'PC', label: C13, depositDay: '2026-11-02', bordereauNumber: 'CH-20261102-02', day: DAY });
  assert.strictEqual(c, 'Chrono 13 remis au chauffeur le 02/11/2026 (bordereau CH-20261102-02), aucune prise en charge '
    + 'enregistrée depuis. Merci de localiser le colis.');
});

console.log('Fichier d\'import');
test('en-tête du modèle, CRLF, colonnes vides pour RT, F1 et contenu pour PC', () => {
  const buf = rules.buildCsv([
    { trackingNumber: 'XS499219722FR', object: 'RT', content: 'ignoré', comment: 'Retard ; deux lignes\nici' },
    { trackingNumber: 'XN515953758FR', object: 'PC', content: '1 x Kit Armour; 2 x Accu', comment: 'Pas vu' },
  ]);
  const text = buf.toString('utf8');
  assert.strictEqual(text,
    'numeroColis;codeObjetDemande;codeMotif;contenuColis;codeFamilleProduit;commentaire\r\n'
    + 'XS499219722FR;RT;;;;Retard deux lignes ici\r\n'
    + 'XN515953758FR;PC;;1 x Kit Armour 2 x Accu;F1;Pas vu\r\n');
});
test('UTF-8 sans BOM : Chronopost a affiché « livr� » avec du Windows-1252 (03/11/2026)', () => {
  const buf = rules.buildCsv([{ trackingNumber: 'XS1', object: 'RT', comment: 'non livré à 16h, évènement' }]);
  assert.notStrictEqual(buf[0], 0xEF, 'pas de BOM devant numeroColis');
  assert.ok(buf.toString('utf8').endsWith('XS1;RT;;;;non livré à 16h, évènement\r\n'));
  assert.ok(buf.includes(Buffer.from('é', 'utf8')));
});

console.log('Compte-rendu d\'import');
test('lit les n° de ticket de la notice, garde les refus', () => {
  const r = rules.parseImportReport(
    'Lancement de l\'import: 10 ligne(s)\n'
    + 'Ligne 1 XY500962909FR : Ticket créé avec le numéro 01208493\n'
    + 'Ligne 2 xw001312035fr : Ticket créé avec le numéro 01208496\n'
    + 'Ligne 3 XW001312027FR : Colis inconnu\n'
    + 'Import terminé'
  );
  assert.deepStrictEqual(r, [
    { trackingNumber: 'XY500962909FR', ticket: '01208493', error: null },
    { trackingNumber: 'XW001312035FR', ticket: '01208496', error: null },
    { trackingNumber: 'XW001312027FR', ticket: null, error: 'Colis inconnu' },
  ]);
});

if (failures) {
  console.error(`\n${failures} test(s) en échec.`);
  process.exit(1);
}
console.log('\nTous les tests passent.');
