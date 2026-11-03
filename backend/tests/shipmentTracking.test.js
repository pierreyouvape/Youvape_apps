/**
 * Banc du suivi des colis : lecteurs transporteurs et calcul de l'état.
 *
 * Sans base ni réseau : `node tests/shipmentTracking.test.js` (ou `npm test`).
 *
 * Les réponses sont réelles (tests/fixtures/tracking/, relevées les 02 et
 * 03/11/2026 ; nom du réceptionnaire masqué). La correspondance code → état est
 * relue dans la migration elle-même : un libellé Mondial Relay mal recopié
 * (accent, apostrophe) y laisserait un colis « à classer » pour toujours.
 *
 * Ce qui est couvert :
 *   - chaque lecteur : évènements, dates (heure de Paris pour Mondial Relay),
 *     numéro inconnu (pas une panne), réponse en erreur (une panne) ;
 *   - livré, en retour, revenu chez nous, sur des colis réels ;
 *   - un retour est sans retour arrière ; un « livré » après un retour est un
 *     colis revenu (Chronopost 1264731) ;
 *   - un code non classé ou « information » ne change rien ;
 *   - le calendrier des passages.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseLaPoste, parseChronopost, parseMondialRelay, parisDate, mondialRelaySecurity } =
  require('../src/services/tracking/readers');
const { computeState, nextCheckAt } = require('../src/services/tracking/states');

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

const FIX = path.join(__dirname, 'fixtures', 'tracking');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');

// Correspondance pré-remplie, relue dans la migration.
const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'migrations', 'add_shipment_tracking.sql'), 'utf8');
const MAP = new Map();
for (const m of sql.matchAll(/\('(laposte|chronopost|mondial_relay)', '((?:[^']|'')*)', (?:NULL|'(?:[^']|'')*'), '(\w+)'\)/g)) {
  MAP.set(`${m[1]}|${m[2].replace(/''/g, "'")}`, m[3]);
}
const stateOf = (source) => (key) => MAP.get(`${source}|${key}`) || null;

const etat = (source, events) => computeState(events, stateOf(source));
const lp = (f) => parseLaPoste(200, JSON.parse(read(f)));
const ch = (f) => parseChronopost(200, read(f));
const mr = (f) => parseMondialRelay(200, read(f));

console.log('Correspondance');

test('la migration pré-remplit les trois sources', () => {
  const n = (s) => [...MAP.keys()].filter(k => k.startsWith(`${s}|`)).length;
  assert.ok(n('laposte') >= 14 && n('chronopost') >= 29 && n('mondial_relay') >= 17, `${n('laposte')}/${n('chronopost')}/${n('mondial_relay')}`);
});

test('chaque code reçu dans les réponses réelles est déjà classé', () => {
  const fichiers = {
    laposte: ['laposte-lettre-livree.json', 'laposte-colissimo-retour.json', 'laposte-colissimo-relais.json'].map(lp),
    chronopost: ['chronopost-relais-livre.xml', 'chronopost-retour.xml', 'chronopost-fin-instance.xml'].map(ch),
    mondial_relay: ['mondialrelay-livre.xml', 'mondialrelay-retour.xml'].map(mr),
  };
  const manquants = [];
  for (const [source, reponses] of Object.entries(fichiers)) {
    for (const r of reponses) for (const e of r.events) {
      if (!MAP.has(`${source}|${e.event_key}`)) manquants.push(`${source}:${e.event_key}`);
    }
  }
  assert.deepStrictEqual([...new Set(manquants)], []);
});

console.log('La Poste');

test('Lettre suivie livrée en boîte aux lettres', () => {
  const r = lp('laposte-lettre-livree.json');
  assert.strictEqual(r.notFound, false);
  assert.strictEqual(r.events.length, 4);
  const s = etat('laposte', r.events);
  assert.strictEqual(s.state, 'delivered');
  assert.strictEqual(s.deliveredAt.toISOString(), '2026-11-02T10:05:58.000Z');
  assert.strictEqual(s.lastLabel, 'Votre envoi a été distribué dans la boîte à lettres.');
});

test('Colissimo non retiré, en retour vers nous (RE1, puis transit)', () => {
  const s = etat('laposte', lp('laposte-colissimo-retour.json').events);
  assert.strictEqual(s.state, 'returning');
  assert.strictEqual(s.deliveredAt, null);
});

test('Colissimo passé par le point de retrait puis livré', () => {
  assert.strictEqual(etat('laposte', lp('laposte-colissimo-relais.json').events).state, 'delivered');
});

test('numéro inconnu (400) : pas une panne', () => {
  const r = parseLaPoste(400, { returnCode: 400, returnMessage: "Le numéro que vous avez saisi n'est pas valide." });
  assert.strictEqual(r.notFound, true);
  assert.deepStrictEqual(r.events, []);
});

test('réponse HTML (pare-feu) : une panne', () => {
  assert.throws(() => parseLaPoste(200, '<html>blocked</html>'));
  assert.throws(() => parseLaPoste(503, {}));
});

console.log('Chronopost');

test('codes nettoyés de leurs espaces, lieu et date', () => {
  const r = ch('chronopost-relais-livre.xml');
  assert.deepStrictEqual(r.events.map(e => e.event_key), ['DC', 'SC', 'SD', 'RB', 'AB', 'SM', 'SM', 'D']);
  assert.strictEqual(r.events[1].location, 'MONTPELLIER CHRONOPOST');
  const s = etat('chronopost', r.events);
  assert.strictEqual(s.state, 'delivered');
  assert.strictEqual(s.deliveredAt.toISOString(), '2026-10-15T14:00:12.000Z');
});

test('retour : le « D » final est le colis revenu, pas une livraison (1264731)', () => {
  const r = ch('chronopost-retour.xml');
  const s = etat('chronopost', r.events);
  assert.strictEqual(s.state, 'returned');
  assert.strictEqual(s.deliveredAt, null);
  assert.ok(r.events.some(e => e.detail === "Délai d'instance dépassé"), 'motif du retour');
});

test('fin d\'instance (non retiré) : retour vers nous', () => {
  assert.strictEqual(etat('chronopost', ch('chronopost-fin-instance.xml').events).state, 'returning');
});

test('numéro sans évènement : pas une panne', () => {
  const xml = '<soap:Envelope><soap:Body><ns2:trackSkybillV2Response><return><errorCode>0</errorCode>'
    + '<listEventInfoComp><skybillNumber>ZZ123</skybillNumber></listEventInfoComp></return></ns2:trackSkybillV2Response></soap:Body></soap:Envelope>';
  const r = parseChronopost(200, xml);
  assert.strictEqual(r.notFound, true);
  assert.throws(() => parseChronopost(502, '<html>Bad gateway</html>'));
});

console.log('Mondial Relay');

test('heure de Paris : été (+2 h) et hiver (+1 h)', () => {
  assert.strictEqual(parisDate('01/10/26', '10:54').toISOString(), '2026-10-01T08:54:00.000Z');
  assert.strictEqual(parisDate('02/11/26', '10:39').toISOString(), '2026-11-02T09:39:00.000Z');
  assert.strictEqual(parisDate('', '10:00'), null);
});

test('colis livré en point relais', () => {
  const r = mr('mondialrelay-livre.xml');
  assert.strictEqual(r.events[0].event_key, 'RÉCEPTION DES DONNÉES');
  assert.strictEqual(etat('mondial_relay', r.events).state, 'delivered');
});

test('non retiré, retour à l\'expéditeur (1264965)', () => {
  const r = mr('mondialrelay-retour.xml');
  assert.strictEqual(r.events.at(-1).event_key, "RETOUR A L'EXPÉDITEUR");
  assert.strictEqual(etat('mondial_relay', r.events).state, 'returning');
});

test('STAT d\'erreur : une panne, pas un colis vide', () => {
  assert.throws(() => mr('mondialrelay-inconnu.xml'), /STAT 99/);
});

test('signature WSI2 : MD5 en majuscules', () => {
  assert.strictEqual(mondialRelaySecurity('BDTEST13', '12345678', 'FR', 'PrivateK'),
    require('crypto').createHash('md5').update('BDTEST1312345678FRPrivateK').digest('hex').toUpperCase());
});

console.log('État d\'un colis');

const ev = (event_key, occurred_at, label = null) => ({ event_key, occurred_at, label });

test('un code non classé ou « information » ne change rien', () => {
  const s = computeState([ev('A', '2026-10-01T10:00Z'), ev('X', '2026-10-01T11:00Z'), ev('I', '2026-10-01T12:00Z')],
    k => ({ A: 'in_transit', I: 'info' })[k] || null);
  assert.strictEqual(s.state, 'in_transit');
  assert.strictEqual(s.stateAt.toISOString(), '2026-10-01T10:00:00.000Z');
  assert.strictEqual(s.lastEventAt.toISOString(), '2026-10-01T12:00:00.000Z');
});

test('livré le reste, même si un scan arrive après', () => {
  const s = computeState([ev('D', '2026-10-01T10:00Z'), ev('T', '2026-10-01T11:00Z')],
    k => ({ D: 'delivered', T: 'in_transit' })[k]);
  assert.strictEqual(s.state, 'delivered');
});

test('l\'ordre du journal n\'importe pas', () => {
  const s = computeState([ev('D', '2026-10-02T10:00Z'), ev('T', '2026-10-01T10:00Z')],
    k => ({ D: 'delivered', T: 'in_transit' })[k]);
  assert.strictEqual(s.state, 'delivered');
});

test('aucun évènement : pas d\'état', () => {
  assert.strictEqual(computeState([], () => null).state, null);
});

console.log('Calendrier');

const now = new Date('2026-11-03T12:00:00Z');
test('en livraison : 1 h ; en point relais : 12 h ; sans état : 6 h', () => {
  assert.strictEqual(nextCheckAt('out_for_delivery', '2026-11-01T10:00Z', now).toISOString(), '2026-11-03T13:00:00.000Z');
  assert.strictEqual(nextCheckAt('at_pickup_point', '2026-11-01T10:00Z', now).toISOString(), '2026-11-04T00:00:00.000Z');
  assert.strictEqual(nextCheckAt(null, '2026-11-01T10:00Z', now).toISOString(), '2026-11-03T18:00:00.000Z');
});

test('livré, revenu ou trop ancien : plus de passage', () => {
  assert.strictEqual(nextCheckAt('delivered', '2026-11-01T10:00Z', now), null);
  assert.strictEqual(nextCheckAt('returned', '2026-11-01T10:00Z', now), null);
  assert.strictEqual(nextCheckAt('in_transit', '2026-09-01T10:00Z', now), null);
});

console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} test(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
