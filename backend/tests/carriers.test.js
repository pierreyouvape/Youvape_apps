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
 *   - le respect du contrat par les adaptateurs enregistrés ;
 *   - Colissimo (lot 2) : code produit service × pays, point de retrait Bpost,
 *     CN23 sur des commandes réelles, réponse multipart — avec des échanges
 *     simulés, aucun appel ne sort.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { PDFDocument } = require('pdf-lib');
const laposte = require('../src/services/carriers/laposteAdapter');
const { sanitizeAddressField } = require('../src/services/carriers/addressFields');
const { buildUserMessage } = require('../src/services/carriers/errors');
const { assertAdapter } = require('../src/services/carriers/contract');
const { getAdapter, listCarrierCodes } = require('../src/services/carriers');

const reference = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'laposte-reference.json'), 'utf-8')
);

let failures = 0;
// Les tests asynchrones doivent être ATTENDUS, sinon une promesse rejetée
// s'échappe du try/catch et le test s'affiche « ok » alors qu'il a échoué.
// Un banc qui ment est pire que pas de banc : on collecte les promesses ici et
// on les attend avant de conclure.
const pending = [];
function test(name, fn) {
  const ok = () => console.log(`  ok   ${name}`);
  const ko = (err) => {
    failures++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') {
      pending.push(out.then(ok, ko));
    } else {
      ok();
    }
  } catch (err) {
    ko(err);
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

// ── Nom du fichier téléchargé (détection AutoPrint) ──────────────────────────
console.log('\nNom de fichier des étiquettes');

test('la lettre suivie garde EXACTEMENT son nom historique', () => {
  // AutoPrint est réglé sur « LS-… » depuis la mise en service : le tiret et
  // les deux majuscules ne sont pas un choix de style. Les changer ferait
  // cesser l'impression automatique des lettres suivies.
  assert.strictEqual(laposte.labelFileName('1259134'), 'LS-1259134.pdf');
});

test('Mondial Relay suit sa propre convention', () => {
  assert.strictEqual(getAdapter('mondial_relay').labelFileName('1259134'), 'mondialrelay_1259134.pdf');
});

test('chaque transporteur a un nom distinct : c\'est ce qui permet le routage', () => {
  const noms = listCarrierCodes().map(c => getAdapter(c).labelFileName('1259134'));
  assert.strictEqual(new Set(noms).size, noms.length, `noms en double : ${noms.join(', ')}`);
  for (const n of noms) assert.ok(n.endsWith('.pdf'), n);
});

test('un adaptateur sans nom de fichier casse au chargement', () => {
  assert.throws(
    () => assertAdapter({ code: 'x', accountCode: 'a', methodCode: 'm', label: 'X', logTag: 'X',
                          bmsShipmentTitle: 't', resolveWeight() {}, createLabel() {},
                          cancelLabel() {}, cancelWindow() {} }),
    /labelFileName/
  );
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

test('aucune balise ne peut être injectée par une adresse', () => {
  // Double protection : le jeu de caractères retire déjà « < » et « > » des
  // champs d'adresse, l'échappement XML couvre les champs qui n'y sont pas
  // soumis (courriel, téléphone).
  const x = mrXml({ receiver: { last_name: 'Durand', address: '3 rue <test>' } });
  assert.ok(!/<Streetname>[^<]*<test>/.test(x), 'balise injectée dans l\'adresse');
});

test('les champs non filtrés restent échappés en XML', () => {
  // Le courriel n'est pas restreint à un jeu de caractères : c'est l'échappement
  // qui empêche qu'un « & » y casse le document.
  const x = mrXml({ receiver: { email: 'a&b<c>@exemple.fr' } });
  assert.ok(x.includes('a&amp;b&lt;c&gt;@exemple.fr'), 'courriel non échappé');
  assert.ok(!x.includes('<c>@'), 'balise injectée par le courriel');
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

// ── Point relais manquant ou mal formé ───────────────────────────────────────
console.log('\nContrôle du point relais');

const relais = (rp) => () => mr.assertRelayPoint(rp, '1259200');
const messageDe = (rp) => {
  try { mr.assertRelayPoint(rp, '1259200'); return null; }
  catch (e) { return e.userMessage; }
};

test('aucun point relais : refus expliqué, avec la marche à suivre', () => {
  for (const vide of [null, undefined, {}, { id: '' }, { id: '   ' }]) {
    assert.throws(relais(vide), /aucun point relais/i, JSON.stringify(vide));
  }
  const m = messageDe(null);
  assert.ok(/WooCommerce/.test(m), 'le message ne dit pas quoi faire');
  assert.ok(/1259200/.test(m), 'le message ne dit pas quelle commande');
});

test('un code d\'un autre transporteur est attrapé', () => {
  // Chronopost fait 5 caractères alphanumériques : « 5761X » sur une commande
  // Mondial Relay est un point de retrait qui n'est pas le bon.
  const m = messageDe({ id: '5761X', country: 'FR' });
  assert.ok(/6 chiffres/.test(m), m);
  assert.ok(/5761X/.test(m), 'le message ne montre pas le code fautif');
  assert.ok(/autre transporteur/.test(m), m);
});

test('les formats voisins sont refusés, pas devinés', () => {
  for (const id of ['12345', '1234567', '04198a', '41983', 'ABCDEF', '04 1983', '-041983']) {
    assert.throws(relais({ id, country: 'FR' }), /format attendu/, `« ${id} » aurait dû être refusé`);
  }
});

test('un identifiant valide passe, zéros de tête compris', () => {
  for (const id of ['041983', '000123', '022112']) {
    assert.doesNotThrow(relais({ id, country: 'FR' }), `« ${id} » aurait dû passer`);
  }
});

test('un identifiant numérique est traité comme les autres', () => {
  // Le type ne change rien : seul le format compte. 6 chiffres passent, le
  // reste est refusé sans tentative de complétion — on ne sait pas ce qu'est
  // une valeur hors format, et chaque correction supposée enverrait le colis
  // quelque part sans qu'on puisse dire où.
  assert.doesNotThrow(relais({ id: 410983, country: 'BE' }), 'un nombre à 6 chiffres devrait passer');
  assert.throws(relais({ id: 41983, country: 'BE' }), /format attendu/);
});

test('pays absent ou invalide : refus expliqué', () => {
  for (const country of [null, '', 'FRA', 'F', '12']) {
    assert.throws(relais({ id: '041983', country }), /pays du point relais/i, `pays « ${country} »`);
  }
  const m = messageDe({ id: '041983', country: 'FRA' });
  assert.ok(/FR, BE, LU/.test(m), m);
});

test('les trois pays de nos points relais sont acceptés', () => {
  for (const country of ['FR', 'BE', 'LU', 'be']) {
    assert.doesNotThrow(relais({ id: '041983', country }), `pays ${country}`);
  }
});

test('le refus arrive AVANT tout appel réseau', async () => {
  // createLabel doit échouer sur la validation, sans toucher à l'API.
  await assert.rejects(
    mr.createLabel({ orderNumber: '1259200', receiver: {}, weightGrams: 400,
      account: { credentials: { login: 'l', password: 'p', customer_id: 'c' },
                 settings: { api_url: 'http://127.0.0.1:1/inatteignable' } },
      options: { deliveryMode: '24R', relayPoint: { id: 'XXX' } } }),
    /format attendu/
  );
});

// ── Caractères refusés par les transporteurs ─────────────────────────────────
console.log('\nCaractères spéciaux et invisibles');

const { restrictToCharset } = require('../src/services/carriers/addressFields');
const JEU_NOM = /[A-Za-zÀ-ÖØ-öø-ÿ_'.,\s-]/;

const destinataire = (over = {}) => {
  const x = mrXml({ receiver: over, options: { deliveryMode: '24R',
    relayPoint: { id: '010041', country: over.country || 'FR' } } });
  const bloc = x.match(/<Recipient>[\s\S]*<\/Recipient>/)[0];
  const lire = (t) => bloc.match(new RegExp(`<${t}>([^<]*)<`))[1];
  return { firstname: lire('Firstname'), lastname: lire('Lastname'),
           street: lire('Streetname'), houseNo: lire('HouseNo'), city: lire('City') };
};

test('le caractère invisible U+202A de la commande 1259134 est retiré', () => {
  // Venu d'un clavier arabe, invisible à l'écran, il faisait échouer la clé de
  // sécurité Mondial Relay côté BMS.
  const d = destinataire({ first_name: '\u202aHassan', last_name: 'Alkhadour',
    address: 'BERLARIJ 54', city: 'LIER', postcode: '2500', country: 'BE' });
  assert.strictEqual(d.firstname, 'Hassan');
});

test('les autres invisibles passent aussi à la trappe', () => {
  for (const c of ['\u200b', '\u200e', '\u202e', '\ufeff', '\u00ad', '\u2066']) {
    assert.strictEqual(restrictToCharset(`Du${c}rand`, JEU_NOM), 'Durand',
      `caractère U+${c.codePointAt(0).toString(16)} non retiré`);
  }
});

test('les latines étendues sont ramenées à leur base, pas supprimées', () => {
  // « Gőz » doit devenir « Goz », pas « Gz » : le nom reste lisible et livrable.
  assert.strictEqual(restrictToCharset('Gőz Ğül', JEU_NOM), 'Goz Gül');
  assert.strictEqual(restrictToCharset('Sœur Łucja', JEU_NOM), 'Soeur Lucja');
  // « ř » est refusé donc ramené à « r » ; « á » est admis donc conservé tel quel.
  assert.strictEqual(restrictToCharset('Ivan Dvořák', JEU_NOM), 'Ivan Dvorák');
  assert.strictEqual(restrictToCharset('Mustafa Yıldız', JEU_NOM), 'Mustafa Yildiz');
});

test('ce que Mondial Relay accepte déjà n\'est pas transformé', () => {
  // Le jeu admis va jusqu'à « ÿ » : ß, ü, ø et les accents français en font
  // partie. Les translittérer abîmerait le nom du client sans raison.
  assert.strictEqual(restrictToCharset('Straße', JEU_NOM), 'Straße');
  assert.strictEqual(restrictToCharset('Jørgen Müller', JEU_NOM), 'Jørgen Müller');
});

test('les accents français, eux, sont conservés', () => {
  assert.strictEqual(restrictToCharset("José-Marie D'Argent", JEU_NOM), "José-Marie D'Argent");
});

test('« & » devient « et » au lieu de disparaître', () => {
  assert.strictEqual(restrictToCharset('Durand & Fils', JEU_NOM), 'Durand et Fils');
});

test('la ponctuation refusée devient une espace, sans coller les mots', () => {
  assert.strictEqual(restrictToCharset('Dupont(Fils)', JEU_NOM), 'Dupont Fils');
});

test('un champ obligatoire vidé par le nettoyage fait échouer, avec le champ nommé', () => {
  // Un nom entièrement cyrillique ne laisse rien : mieux vaut refuser que
  // d'imprimer une étiquette sans destinataire.
  assert.throws(
    () => destinataire({ first_name: 'Ivan', last_name: 'Петров',
      address: '12 rue des Lilas', city: 'Lyon', postcode: '69003' }),
    /« nom »/
  );
});

console.log('\nNuméro de voie selon le pays');

test('France : le numéro précède la rue', () => {
  const d = destinataire({ first_name: 'Jean', last_name: 'Test',
    address: '12 rue des Lilas', city: 'Lyon', postcode: '69003', country: 'FR' });
  assert.strictEqual(d.houseNo, '12');
  assert.strictEqual(d.street, 'rue des Lilas');
});

test('Belgique et Luxembourg : le numéro suit la rue', () => {
  for (const [pays, adr, rue, no] of [
    ['BE', 'BERLARIJ 54', 'BERLARIJ', '54'],
    ['LU', 'Rue de Hollerich 22', 'Rue de Hollerich', '22'],
    ['BE', 'Chaussee de Wavre 1234 B', 'Chaussee de Wavre', '1234B']
  ]) {
    const d = destinataire({ first_name: 'Jean', last_name: 'Test',
      address: adr, city: 'Ville', postcode: '2500', country: pays });
    assert.strictEqual(d.street, rue, `${pays} ${adr}`);
    assert.strictEqual(d.houseNo, no, `${pays} ${adr}`);
  }
});

test('« Rue du 8 Mai 1945 » ne se fait pas prendre l\'année pour un numéro', () => {
  const d = destinataire({ first_name: 'Jean', last_name: 'Test',
    address: 'Rue du 8 Mai 1945', city: 'Nimes', postcode: '30000', country: 'FR' });
  assert.strictEqual(d.houseNo, '');
  assert.strictEqual(d.street, 'Rue du 8 Mai 1945');
});

test('« 3 bis » reste un numéro complet', () => {
  const d = destinataire({ first_name: 'Jean', last_name: 'Test',
    address: '3 bis avenue Foch', city: 'Paris', postcode: '75116', country: 'FR' });
  assert.strictEqual(d.houseNo, '3BIS');
});

// ── Retrait magasin ──────────────────────────────────────────────────────────
console.log('\nRetrait magasin (adaptateur interne)');

const interne = require('../src/services/carriers/interneAdapter');

test('ne réclame aucun contrat : il n\'appelle aucune API', () => {
  assert.strictEqual(interne.requiresAccount, false);
});

test('confirme quand même l\'expédition à BMS : le colis sort du stock', () => {
  assert.notStrictEqual(interne.confirmsShipmentInBms, false);
  assert.strictEqual(interne.bmsShipmentTitle, 'Retrait magasin');
});

test('l\'étiquette met le NOM en avant, pas le numéro de commande', async () => {
  // On cherche le colis au nom du client qui se présente au comptoir ; le
  // numéro ne sert qu'à départager deux commandes du même client.
  const { pdfBase64, trackingNumber } = await interne.createLabel({
    orderNumber: '1259103',
    receiver: { first_name: 'Jean-Baptiste', last_name: 'Dupont-Lachapelle' }
  });
  assert.strictEqual(trackingNumber, null, 'un numéro de suivi a été inventé');
  const pdf = await PDFDocument.load(Buffer.from(pdfBase64, 'base64'));
  const [page] = pdf.getPages();
  // 10 × 15 cm en points PDF.
  assert.ok(Math.abs(page.getWidth() - 283.46) < 1, `largeur ${page.getWidth()}`);
  assert.ok(Math.abs(page.getHeight() - 425.2) < 1, `hauteur ${page.getHeight()}`);
});

test('un nom très long rétrécit au lieu de déborder', async () => {
  const { pdfBase64 } = await interne.createLabel({
    orderNumber: '1',
    receiver: { first_name: 'Marie-Christine', last_name: 'Vandenbroucke-Vermeulen' }
  });
  assert.ok(pdfBase64.length > 100);
});

test('ne déclare aucun poids : rien n\'est transporté', async () => {
  assert.strictEqual(await interne.resolveWeight({}), 0);
});

// ── Colissimo ────────────────────────────────────────────────────────────────
console.log('\nColissimo — code produit selon le service et la destination');

const coli = require('../src/services/carriers/colissimoAdapter');
const { customsArticles } = require('../src/services/orderCustomsService');
const { customsDocumentFileName } = require('../src/services/carriers/contract');

const COLI_ACCOUNT = {
  carrierCode: 'colissimo', accountCode: 'production',
  credentials: { contract_number: '906524', password: 'secret' },
  settings: {
    api_url: 'https://ws.colissimo.fr/sls-ws/SlsServiceWSRest/3.1',
    commercial_name: 'EMC',
    sender: { company_name: 'SAS EMC', line2: "580 avenue de l'aube rouge", zip_code: '34170',
              city: 'Castelnau le Lez', country_code: 'FR', email: 'contact@youvape.fr', phone: '04 99 78 24 53' },
    customs: { hs_code: '85437070', origin_country: 'FR', category: '3' }
  }
};
// shipping_phone vide, billing_phone renseigné : c'est la situation de 100 % des
// commandes Bpost.
const COLI_RECEIVER = {
  first_name: 'Marie', last_name: 'Testeuse', address: '12 rue de la République',
  postcode: '69003', city: 'Lyon', country: 'FR', phone: '', billing_phone: '0600000000', email: 't@e.com'
};
const NOW = new Date('2026-09-10T10:00:00Z');
// Point réel, relevé en base (commande « Bpost Relais »).
const BPOST = { id: '315300', city: 'BELOEIL', name: 'BBOX 24/7 PROXY BELOEIL', type: 'PCS',
  address: 'RUE DES VIVIERS AU BOIS 206', country: 'BE', network: 'colissimo', postcode: '7970' };

const coliPayload = (over = {}) => coli.buildLabelPayload({
  orderNumber: over.orderNumber ?? '1259808',
  receiver: { ...COLI_RECEIVER, ...(over.receiver || {}) },
  account: over.account ?? COLI_ACCOUNT,
  weightGrams: over.weightGrams ?? 480,
  options: over.options ?? { deliveryMode: 'domicile', shippingMethod: 'Colissimo Domicile' },
  customs: over.customs ?? null,
  now: over.now ?? NOW
});
const dest = (service, country, relayPoint) => coli.resolveDestination({
  receiver: { country }, options: { deliveryMode: service, relayPoint }, orderNumber: '1'
});
const refusDe = (fn) => {
  try { fn(); return null; } catch (e) { return e.userMessage || e.message; }
};

test('« Colissimo Domicile » vers la France : DOM, sans CN23', () => {
  assert.deepStrictEqual(dest('domicile', 'FR'), { service: 'domicile', pays: 'FR', productCode: 'DOM', cn23: false });
});

test('la MÊME dénomination vers l\'outre-mer : COM, et CN23 obligatoire', () => {
  for (const pays of ['GF', 'GP', 'MQ', 'RE', 'PF']) {
    assert.strictEqual(dest('domicile', pays).productCode, 'COM', pays);
    assert.strictEqual(dest('domicile', pays).cn23, true, pays);
  }
});

test('Monaco reste en DOM, sans CN23', () => {
  assert.strictEqual(dest('domicile', 'MC').productCode, 'DOM');
  assert.strictEqual(dest('domicile', 'MC').cn23, false);
});

test('avec signature : DOS en métropole et en Europe, CDS outre-mer', () => {
  assert.strictEqual(dest('signature', 'FR').productCode, 'DOS');
  assert.strictEqual(dest('signature', 'DK').productCode, 'DOS');
  assert.strictEqual(dest('signature', 'MQ').productCode, 'CDS');
});

test('toutes les destinations des 90 derniers jours sont couvertes', () => {
  // Relevé le 08/09/2026, par service.
  const vues = {
    domicile: 'FR GF GP MQ RE PF MC BE',
    signature: 'FR AT CZ DK ES GB HR HU IE LT LV NL PL PT BE LU',
    relais: 'BE'
  };
  for (const [service, pays] of Object.entries(vues)) {
    for (const p of pays.split(' ')) {
      assert.doesNotThrow(() => dest(service, p, service === 'relais' ? { country: p } : undefined), `${service} vers ${p}`);
    }
  }
});

test('la CN23 est exigée exactement pour l\'outre-mer et le Royaume-Uni', () => {
  const nos = 'FR MC BE LU AT CZ DK ES GB HR HU IE LT LV NL PL PT GF GP MQ RE PF'.split(' ');
  assert.deepStrictEqual(nos.filter(p => coli.DESTINATIONS[p].cn23).sort(), ['GB', 'GF', 'GP', 'MQ', 'PF', 'RE']);
});

test('sans signature vers le Danemark : refus qui indique la solution', () => {
  const m = refusDe(() => dest('domicile', 'DK'));
  assert.ok(/ne propose pas/.test(m), m);
  assert.ok(/Domicile avec signature/.test(m), 'le message ne dit pas quoi choisir');
});

test('un pays hors matrice est refusé, pas deviné', () => {
  for (const pays of ['US', 'XX', '', 'MF']) {
    assert.throws(() => dest('domicile', pays), /pas pris en charge/, `« ${pays} »`);
  }
});

test('un mode inconnu est refusé, avec la liste des modes', () => {
  assert.ok(/domicile, signature, relais/.test(refusDe(() => dest('24R', 'FR'))));
});

test('en point de retrait, c\'est le pays du POINT qui compte', () => {
  assert.strictEqual(coli.resolveDestination({ receiver: { country: 'FR' },
    options: { deliveryMode: 'relais', relayPoint: { country: 'BE' } }, orderNumber: '1' }).pays, 'BE');
});

console.log('\nColissimo — corps de la requête');

test('le poids part en kilogrammes à deux décimales, 10 g minimum', () => {
  assert.strictEqual(coliPayload({ weightGrams: 480 }).letter.parcel.weight, '0.48');
  assert.strictEqual(coliPayload({ weightGrams: 1234 }).letter.parcel.weight, '1.23');
  assert.strictEqual(coliPayload({ weightGrams: 3 }).letter.parcel.weight, '0.01');
});

test('la date de dépôt est celle de Paris, pas celle du serveur en UTC', () => {
  // 22 h 30 UTC le 09/09 = 0 h 30 à Paris le 10/09 ; une date passée est refusée.
  assert.strictEqual(coli.dateDepot(new Date('2026-09-09T22:30:00Z')), '2026-09-10');
  assert.strictEqual(coli.dateDepot(new Date('2026-01-15T23:30:00Z')), '2026-01-16');
});

test('domicile France : contrat, code produit, référence, aucun point de retrait', () => {
  const p = coliPayload();
  assert.strictEqual(p.contractNumber, '906524');
  assert.strictEqual(p.letter.service.productCode, 'DOM');
  assert.strictEqual(p.letter.service.orderNumber, '1259808');
  assert.strictEqual(p.letter.sender.senderParcelRef, '1259808');
  assert.strictEqual(p.outputFormat.outputPrintingType, 'PDF_10x15_300dpi');
  assert.strictEqual(p.letter.parcel.pickupLocationId, undefined, 'point hors HD : Colissimo refuse');
  assert.strictEqual(p.letter.customsDeclarations, undefined);
  assert.strictEqual(p.letter.service.reseauPostal, undefined);
});

test('le téléphone vient de billing_phone quand shipping_phone est vide', () => {
  assert.strictEqual(coliPayload().letter.addressee.address.phoneNumber, '0600000000');
});

test('Bpost relais : HD, le point, son adresse, le mobile belge au format international', () => {
  const p = coliPayload({
    orderNumber: '1259784',
    receiver: { first_name: 'Hassan', last_name: 'Alkhadour', address: 'Rue du Client 1', postcode: '7970',
      city: 'Beloeil', country: 'BE', billing_phone: '0470 12 34 56' },
    options: { deliveryMode: 'relais', relayPoint: BPOST, shippingMethod: 'Bpost Relais' }
  });
  const a = p.letter.addressee.address;
  assert.strictEqual(p.letter.service.productCode, 'HD');
  assert.strictEqual(p.letter.parcel.pickupLocationId, '315300');
  assert.strictEqual(p.letter.service.commercialName, 'EMC');
  assert.strictEqual(a.companyName, 'BBOX 24/7 PROXY BELOEIL');
  assert.strictEqual(a.line2, 'RUE DES VIVIERS AU BOIS 206');
  assert.strictEqual(a.zipCode, '7970');
  assert.strictEqual(a.countryCode, 'BE');
  assert.strictEqual(a.lastName, 'Alkhadour', 'le colis est remis au CLIENT');
  assert.strictEqual(a.mobileNumber, '+32470123456');
  assert.strictEqual(a.phoneNumber, undefined);
});

test('un mobile français part aussi comme mobile : c\'est lui que Colissimo imprime', () => {
  // Commande 1260104 : mobile envoyé comme fixe seulement → « Téléphone : / ».
  const a = coliPayload({ receiver: { billing_phone: '+33783246892' } }).letter.addressee.address;
  assert.strictEqual(a.mobileNumber, '+33783246892');
  assert.strictEqual(a.phoneNumber, '+33783246892');
});

test('un mobile d\'outre-mer est reconnu, un fixe reste un fixe', () => {
  assert.strictEqual(coliPayload({ receiver: { country: 'RE', postcode: '97400', billing_phone: '0692123456' },
    customs: { articles: [{ name: 'Liquide', sku: 'L', quantity: 1, unitValue: 10, unitWeightKg: 0.1 }], shippingTotal: 7.9 }
  }).letter.addressee.address.mobileNumber, '0692123456');
  // Même mobile écrit avec l'indicatif de la Guadeloupe.
  assert.strictEqual(coliPayload({ receiver: { country: 'GP', postcode: '97110', billing_phone: '+590690123456' },
    customs: { articles: [{ name: 'Liquide', sku: 'L', quantity: 1, unitValue: 10, unitWeightKg: 0.1 }], shippingTotal: 7.9 }
  }).letter.addressee.address.mobileNumber, '+590690123456');
  const fixe = coliPayload({ receiver: { billing_phone: '0499782453' } }).letter.addressee.address;
  assert.strictEqual(fixe.phoneNumber, '0499782453');
  assert.strictEqual(fixe.mobileNumber, undefined);
});

test('le décalage garde le format de page, et 0 mm ne touche à rien', async () => {
  const { shiftContentDown } = require('../src/services/carriers/labelPdf');
  const d = await PDFDocument.create();
  d.addPage([283.46, 425.2]).drawText('X', { x: 5, y: 415, size: 10 });
  const b64 = Buffer.from(await d.save()).toString('base64');
  assert.strictEqual(await shiftContentDown(b64, 0), b64);
  const decale = await PDFDocument.load(Buffer.from(await shiftContentDown(b64, 8), 'base64'));
  assert.strictEqual(decale.getPageCount(), 1);
  assert.ok(Math.abs(decale.getPage(0).getWidth() - 283.46) < 0.01);
  assert.ok(Math.abs(decale.getPage(0).getHeight() - 425.2) < 0.01);
});

test('toutes les écritures d\'un mobile belge sont ramenées à +324…', () => {
  for (const brut of ['0470123456', '+32470123456', '0032470123456', '0470 12 34 56', '0470.12.34.56']) {
    assert.strictEqual(coli.normaliserTelephone(brut, 'BE'), '+32470123456', brut);
  }
  // Le fixe français de la commande 1250863 part tel quel : Colissimo tranchera.
  assert.strictEqual(coli.normaliserTelephone('+33493549851', 'BE'), '+33493549851');
});

test('point de retrait sans aucun téléphone : refus, avant tout appel', () => {
  const m = refusDe(() => coliPayload({ receiver: { country: 'BE', billing_phone: '' },
    options: { deliveryMode: 'relais', relayPoint: BPOST } }));
  assert.ok(/mobile/.test(m), m);
});

test('réseau partenaire en signature : BE et LU oui, NL non, France sans objet', () => {
  const svc = (country, postcode = '1000') => coliPayload({ receiver: { country, postcode },
    options: { deliveryMode: 'signature' } }).letter.service;
  assert.strictEqual(svc('BE').reseauPostal, 1);
  assert.strictEqual(svc('LU', 'L-1234').reseauPostal, 1);
  assert.strictEqual(svc('NL').reseauPostal, 0);
  assert.strictEqual(svc('FR', '69003').reseauPostal, undefined);
});

test('Luxembourg : le préfixe « L- » est retiré du code postal', () => {
  assert.strictEqual(coliPayload({ receiver: { country: 'LU', postcode: 'L-1234' },
    options: { deliveryMode: 'signature' } }).letter.addressee.address.zipCode, '1234');
});

test('noms en ASCII, adresse en latin-1', () => {
  const a = coliPayload({ receiver: { first_name: 'José', last_name: 'Müller-Łukasz',
    address: "3 rue de l'Église", city: 'Saint-Étienne' } }).letter.addressee.address;
  assert.strictEqual(a.firstName, 'Jose');
  assert.strictEqual(a.lastName, 'Muller-Lukasz');
  assert.strictEqual(a.line2, "3 rue de l'Église");
  assert.strictEqual(a.city, 'Saint-Étienne');
});

test('« ø » est ramené à « o » dans un nom ASCII, pas supprimé', () => {
  // Client danois réel : « Søren » devenait « S ren ».
  assert.strictEqual(coliPayload({ receiver: { first_name: 'Søren', last_name: 'Jørgensen' } })
    .letter.addressee.address.firstName, 'Soren');
});

test('le « N° » d\'une adresse devient « No » au lieu de disparaître', () => {
  const a = coliPayload({ receiver: { address: 'Résidence Les Pins, Bât. B N°12' } }).letter.addressee.address;
  assert.strictEqual(a.line2, 'Résidence Les Pins, Bât. B No12');
});

test('une rue trop longue déborde sur line3, coupée entre deux mots', () => {
  const { line2, line3 } = coli.lignesAdresse('12 avenue du Général Charles de Gaulle Prolongée', 'Bât C', 'FR');
  assert.strictEqual(line2, '12 avenue du Général Charles de');
  assert.strictEqual(line3, 'Gaulle Prolongée Bât C');
});

test('Belgique : le complément remonte en line2, la seule que l\'étiquette imprime', () => {
  assert.deepStrictEqual(coli.lignesAdresse('Rue Haute 5', 'Boîte 3', 'BE'), { line2: 'Rue Haute 5 Boîte 3', line3: '' });
});

test('un destinataire sans nom exploitable est refusé', () => {
  const m = refusDe(() => coliPayload({ receiver: { first_name: '', last_name: 'Петров' } }));
  assert.ok(/prénom et un nom/.test(m), m);
});

console.log('\nColissimo — point de retrait');

const pointRefuse = (rp) => refusDe(() => coli.assertRelayPoint(rp, '1259784'));

test('point absent : refus, avec la marche à suivre', () => {
  for (const vide of [null, undefined, {}, { id: '' }]) {
    assert.ok(/aucun point/.test(pointRefuse(vide)), JSON.stringify(vide));
  }
});

test('un point d\'un autre réseau est refusé, même au bon format', () => {
  // Constaté : une commande « Bpost Relais » du 05/09/2026 porte un point mondial_relay.
  assert.ok(/mondial_relay/.test(pointRefuse({ id: '041983', network: 'mondial_relay', country: 'BE' })));
});

test('un code hors format est refusé, pas corrigé', () => {
  for (const id of ['31530', '3153000', '5761X']) {
    assert.ok(/6 chiffres/.test(pointRefuse({ ...BPOST, id })), id);
  }
});

test('les trois types de point Bpost relevés passent', () => {
  for (const type of ['PCS', 'CMT', 'BDP']) assert.strictEqual(pointRefuse({ ...BPOST, type }), null, type);
});

console.log('\nColissimo — déclaration douanière (CN23)');

// Lignes réelles relevées en base le 10/09/2026 (SKU fictifs).
const CMD_1254235 = [ // Guadeloupe : un pack et ses dix composants à 0 €
  { name: 'Pack 3 Cartouches Pod Oby', qty: 4, line_total: '23.70', product_type: 'simple', sku: 'A', weight_kg: '0.030' },
  { name: 'Pack 10 Boosters YouBoost 50/50', qty: 1, line_total: '6.58', product_type: 'woosb', sku: 'B', weight_kg: '0.200' },
  { name: 'Booster YouBoost 50/50', qty: 10, line_total: '0.00', product_type: 'simple', sku: 'C', weight_kg: '0.010' }
];
const CMD_1240410 = [ // Polynésie : un article offert, sans aucun pack
  { name: 'Philippines Mango 100ml', qty: 2, line_total: '31.69', product_type: 'simple', sku: 'A', weight_kg: '0.140' },
  { name: 'Freezy Pineapple 100ml', qty: 1, line_total: '15.85', product_type: 'simple', sku: 'B', weight_kg: '0.140' },
  { name: 'Grapple Apple 100ml', qty: 1, line_total: '15.85', product_type: 'simple', sku: 'C', weight_kg: '0.140' },
  { name: 'The Green Oil 100ml', qty: 1, line_total: '0.00', product_type: 'simple', sku: 'D', weight_kg: '0.140' },
  { name: 'The White Oil 100ml', qty: 1, line_total: '11.67', product_type: 'simple', sku: 'E', weight_kg: '0.140' },
  { name: 'Booster YouBoost 50/50', qty: 6, line_total: '1.00', product_type: 'simple', sku: 'F', weight_kg: '0.010' },
  { name: 'Accu 18650 P28A - 2800mAh - 35A', qty: 2, line_total: '13.35', product_type: 'simple', sku: 'G', weight_kg: '0.050' }
];

test('1254235 : le pack est déclaré à son prix, ses composants à 0 € ignorés', () => {
  const a = customsArticles(CMD_1254235);
  assert.deepStrictEqual(a.map(x => x.name), ['Pack 3 Cartouches Pod Oby', 'Pack 10 Boosters YouBoost 50/50']);
  assert.strictEqual(a[1].unitValue, 6.58, 'le plugin officiel aurait déclaré 10 × 1 €');
});

test('1240410 : un article offert sans pack figure sur la déclaration', () => {
  const a = customsArticles(CMD_1240410);
  assert.strictEqual(a.length, 7);
  assert.strictEqual(a.find(x => x.name === 'The Green Oil 100ml').unitValue, 1, 'l\'API refuse une valeur nulle');
});

test('la valeur unitaire est calculée en centimes : 31,69 / 2 = 15,85, pas 15,84', () => {
  assert.strictEqual(customsArticles(CMD_1240410)[0].unitValue, 15.85);
  assert.strictEqual(customsArticles(CMD_1254235)[0].unitValue, 5.93);
});

test('angle mort documenté : un offert dans une commande qui a un pack est omis', () => {
  const a = customsArticles([...CMD_1254235, { name: 'Offert', qty: 1, line_total: '0', product_type: 'simple' }]);
  assert.ok(!a.some(x => x.name === 'Offert'));
});

const CUSTOMS_RE = {
  articles: customsArticles([
    { name: 'Cartouche Avata - 0.40 Ω', qty: 2, line_total: '11.80', product_type: 'simple', sku: 'AVATA040', weight_kg: '0.010' },
    { name: 'Liquide Crème Brûlée à la Vanille de Madagascar Édition Spéciale 50ml', qty: 1,
      line_total: '19.90', product_type: 'simple', sku: 'CB50', weight_kg: '0.080' }
  ]),
  shippingTotal: 7.9
};
const payloadRE = (over = {}) => coliPayload({
  orderNumber: '1258878', receiver: { country: 'RE', postcode: '97400', city: 'Saint-Denis', address: '5 rue de Paris' },
  customs: CUSTOMS_RE, ...over
});

test('outre-mer : COM, déclaration jointe, port en centimes', () => {
  const p = payloadRE();
  assert.strictEqual(p.letter.service.productCode, 'COM');
  assert.strictEqual(p.letter.service.totalAmount, 790);
  assert.strictEqual(p.letter.service.transportationAmount, 790);
  const d = p.letter.customsDeclarations;
  assert.strictEqual(d.includeCustomsDeclarations, 1);
  assert.strictEqual(d.contents.category.value, 3);
  assert.strictEqual(d.invoiceNumber, '1258878');
  assert.ok(p.fields.field.some(f => f.key === 'OUTPUT_PRINT_TYPE_CN23' && f.value === 'PDF_A4_300dpi'));
});

test('CN23 : code SH et origine du contrat, les mêmes pour tout le catalogue', () => {
  for (const a of payloadRE().letter.customsDeclarations.contents.article) {
    assert.strictEqual(a.hsCode, '85437070');
    assert.strictEqual(a.originCountry, 'FR');
    assert.strictEqual(a.currency, 'EUR');
  }
});

test('CN23 : l\'oméga d\'un vrai libellé produit devient « ohm »', () => {
  assert.strictEqual(payloadRE().letter.customsDeclarations.contents.article[0].description, 'Cartouche Avata - 0.40 ohm');
});

test('CN23 : désignation sans accent ni symbole, 64 caractères au plus', () => {
  const d = payloadRE().letter.customsDeclarations.contents.article[1].description;
  assert.ok(d.length <= 64, `${d.length} caractères`);
  assert.ok(/^[A-Za-z0-9 '.,\/()%+-]+$/.test(d), d);
  assert.ok(d.startsWith('Liquide Creme Brulee a la Vanille'), d);
});

test('CN23 : aucun EORI envoyé tant qu\'il n\'est pas renseigné', () => {
  assert.ok(!payloadRE().fields.field.some(f => f.key === 'EORI'));
  const avec = { ...COLI_ACCOUNT, settings: { ...COLI_ACCOUNT.settings,
    customs: { ...COLI_ACCOUNT.settings.customs, eori_number: 'FR12345678900012' } } };
  assert.ok(payloadRE({ account: avec }).fields.field.some(f => f.key === 'EORI' && f.value === 'FR12345678900012'));
});

test('CN23 : port gratuit refusé en clair, avant l\'appel', () => {
  assert.ok(/port gratuit/.test(refusDe(() => payloadRE({ customs: { ...CUSTOMS_RE, shippingTotal: 0 } }))));
});

test('CN23 : réglage douanier manquant = erreur de configuration nommant le champ', () => {
  const sans = { ...COLI_ACCOUNT, settings: { ...COLI_ACCOUNT.settings, customs: { origin_country: 'FR', category: '3' } } };
  let e = null;
  try { payloadRE({ account: sans }); } catch (x) { e = x; }
  assert.ok(e, 'aucune erreur');
  assert.strictEqual(e.statusCode, 500);
  assert.ok(/customs\.hs_code/.test(e.message), e.message);
});

test('pas de CN23 vers la France, même avec des lignes fournies', () => {
  assert.strictEqual(coliPayload({ customs: CUSTOMS_RE }).letter.customsDeclarations, undefined);
});

test('DDP outre-mer désactivé par défaut : c\'est le client qui paie les droits', () => {
  assert.strictEqual(payloadRE().letter.parcel.ftd, undefined);
});

console.log('\nColissimo — réponse multipart');

const FRONTIERE = 'uuid:7c5b1f0e-3a41-4d1b-9a0c-5d2e8b6f4a11';
const multipart = (parts, frontiere = FRONTIERE) => Buffer.concat([
  Buffer.from('\r\n', 'latin1'),
  ...parts.flatMap(([id, type, contenu]) => [
    Buffer.from(`--${frontiere}\r\nContent-Type: ${type}\r\nContent-Transfer-Encoding: binary\r\n`
      + `Content-ID: <${id}>\r\n\r\n`, 'latin1'),
    Buffer.isBuffer(contenu) ? contenu : Buffer.from(contenu, 'utf8'),
    Buffer.from('\r\n', 'latin1')
  ]),
  Buffer.from(`--${frontiere}--\r\n`, 'latin1')
]);
const CT = `multipart/mixed; boundary="${FRONTIERE}"; type="application/json"`;
// Un faux PDF qui contient TOUS les octets et des CRLF : exactement ce qu'une
// conversion en chaîne abîmerait sans rien dire.
const OCTETS = Buffer.concat([Buffer.from('%PDF-1.4\r\n\r\n', 'latin1'),
  Buffer.from([...Array(256).keys()]), Buffer.from('\r\n%%EOF', 'latin1')]);
const infos = (o) => ['jsonInfos', 'application/json', JSON.stringify(o)];
const SUCCES = (extra = []) => multipart([
  infos({ messages: [{ id: '0', type: 'INFOS', messageContent: 'La requête a été traitée avec succès' }],
    labelV31Response: { parcelNumber: '6A07657471207' } }),
  ['label', 'application/octet-stream', OCTETS],
  ...extra
]);

test('les trois parties sont séparées, et les octets de l\'étiquette arrivent intacts', () => {
  const p = coli.parseMultipart(SUCCES([['cn23', 'application/octet-stream', Buffer.from('CN23')]]), CT);
  assert.strictEqual(p.jsonInfos.labelV31Response.parcelNumber, '6A07657471207');
  assert.ok(p.label.equals(OCTETS), 'étiquette corrompue');
  assert.strictEqual(p.cn23.toString(), 'CN23');
});

test('la frontière est retrouvée dans le corps quand l\'en-tête ne la donne pas', () => {
  assert.ok(coli.parseMultipart(SUCCES(), 'multipart/mixed').label.equals(OCTETS));
});

test('une réponse JSON seule est lue comme jsonInfos', () => {
  const p = coli.parseMultipart(Buffer.from('{"messages":[{"id":"30108","messageContent":"x"}]}'), 'application/json');
  assert.strictEqual(p.jsonInfos.messages[0].id, '30108');
});

console.log('\nColissimo — contrat');

test('Colissimo suit sa convention de nom, et la CN23 la sienne', () => {
  assert.strictEqual(coli.labelFileName(1259808), 'colissimo_1259808.pdf');
  assert.strictEqual(customsDocumentFileName(1258878), 'customs_document_1258878.pdf');
});

test('Colissimo se déclare non annulable, avec la raison', () => {
  const w = coli.cancelWindow();
  assert.strictEqual(w.cancellable, false);
  assert.ok(/annuler/i.test(w.reason));
});

test('le mappage propose les trois services, « domicile » par défaut', () => {
  assert.deepStrictEqual(coli.deliveryModes.map(m => m.code), ['domicile', 'signature', 'relais']);
  assert.strictEqual(coli.methodCode, 'domicile');
});

test('la table de symboles ne touche pas la lettre suivie', () => {
  // La Poste ne passe que par sanitizeAddressField : ses payloads sont figés.
  assert.strictEqual(sanitizeAddressField('Cartouche 0.40 Ω - N° 5'), 'Cartouche 0.40 Ω - N° 5');
});

// ── Échanges simulés ─────────────────────────────────────────────────────────
// axios est remplacé le temps de ces tests : aucun appel ne sort. Ils tournent
// EN SÉRIE, sinon deux tests se disputeraient la même réponse simulée.

const axiosModule = require('axios');
const postReel = axiosModule.post;
let appels = [];
const simuler = (status, corps, contentType = CT) => {
  appels = [];
  axiosModule.post = async (url, body) => {
    appels.push({ url, body: JSON.parse(body) });
    return { status, headers: { 'content-type': contentType }, data: corps };
  };
};
let serie = Promise.resolve();
const testEnSerie = (name, fn) => {
  serie = serie.then(fn).then(
    () => console.log(`  ok   ${name}`),
    (err) => { failures++; console.error(`  FAIL ${name}\n       ${err.message}`); }
  );
  pending.push(serie);
};
const entree = (over = {}) => ({
  orderNumber: '1259808', receiver: COLI_RECEIVER, account: COLI_ACCOUNT, weightGrams: 480,
  options: { deliveryMode: 'domicile', shippingMethod: 'Colissimo Domicile' }, ...over
});

serie = serie.then(() => console.log('\nColissimo — échanges simulés (aucun appel réseau)'));

// Une vraie étiquette 10 × 15 cm, nom collé au bord supérieur comme chez
// Colissimo : l'adaptateur la décale, il lui faut un PDF lisible.
let VRAI_PDF = null;
serie = serie.then(async () => {
  const d = await PDFDocument.create();
  d.addPage([283.46, 425.2]).drawText('SEGURA LAURIE', { x: 5, y: 415, size: 10 });
  VRAI_PDF = Buffer.from(await d.save());
});
const SUCCES_PDF = (extra = []) => multipart([
  infos({ messages: [{ id: '0', type: 'INFOS', messageContent: 'La requête a été traitée avec succès' }],
    labelV31Response: { parcelNumber: '6A07657471207' } }),
  ['label', 'application/octet-stream', VRAI_PDF],
  ...extra
]);

testEnSerie('succès : numéro de colis, étiquette décalée, code produit, libellé BMS du service', async () => {
  simuler(200, SUCCES_PDF());
  const r = await coli.createLabel(entree());
  assert.strictEqual(appels.length, 1);
  assert.ok(appels[0].url.endsWith('/3.1/generateLabel'), appels[0].url);
  assert.strictEqual(r.trackingNumber, '6A07657471207');
  // Décalée de 8 mm par défaut : autre PDF, même format de page.
  const pdf = await PDFDocument.load(Buffer.from(r.pdfBase64, 'base64'));
  assert.ok(!Buffer.from(r.pdfBase64, 'base64').equals(VRAI_PDF), 'étiquette non décalée');
  assert.ok(Math.abs(pdf.getPage(0).getHeight() - 425.2) < 0.01, 'format de page modifié');
  assert.strictEqual(r.cn23Base64, null);
  assert.strictEqual(r.methodCode, 'DOM');
  assert.strictEqual(r.bmsShipmentTitle, 'La Poste : Colissimo - Domicile sans signature');
});

testEnSerie('La Réunion : COM et CN23, mais libellé BMS « sans signature » — il suit le service', async () => {
  simuler(200, SUCCES_PDF([['cn23', 'application/octet-stream', Buffer.from('%PDF cn23')]]));
  const pool = { query: async (sql) => (/order_items/.test(sql)
    ? { rows: CMD_1254235 } : { rows: [{ order_shipping: '7.90' }] }) };
  const r = await coli.createLabel(entree({ orderNumber: '1258878', pool,
    receiver: { ...COLI_RECEIVER, country: 'RE', postcode: '97400', city: 'Saint-Denis' } }));
  assert.strictEqual(r.methodCode, 'COM');
  assert.strictEqual(r.bmsShipmentTitle, 'La Poste : Colissimo - Domicile sans signature');
  assert.strictEqual(Buffer.from(r.cn23Base64, 'base64').toString(), '%PDF cn23');
  // La déclaration envoyée porte le pack, pas ses dix composants.
  assert.deepStrictEqual(appels[0].body.letter.customsDeclarations.contents.article.map(a => a.value), ['5.93', '6.58']);
  assert.strictEqual(appels[0].body.letter.service.totalAmount, 790);
});

testEnSerie('Bpost relais : libellé BMS « Point de retrait »', async () => {
  simuler(200, SUCCES_PDF());
  const r = await coli.createLabel(entree({ receiver: { ...COLI_RECEIVER, country: 'BE', billing_phone: '0470123456' },
    options: { deliveryMode: 'relais', relayPoint: BPOST } }));
  assert.strictEqual(r.methodCode, 'HD');
  assert.strictEqual(r.bmsShipmentTitle, 'La Poste : Colissimo - Point de retrait');
});

testEnSerie('un refus Colissimo remonte au préparateur, avec son code', async () => {
  simuler(400, multipart([infos({ messages: [{ id: '30108', type: 'ERROR',
    messageContent: 'Le code postal du destinataire est invalide' }] })]));
  await assert.rejects(coli.createLabel(entree()), (e) => {
    assert.strictEqual(e.statusCode, 400);
    assert.ok(/code postal du destinataire est invalide/.test(e.userMessage), e.userMessage);
    assert.ok(/30108/.test(e.userMessage));
    return true;
  });
});

testEnSerie('HTTP 200 avec un message d\'erreur : c\'est un refus, pas un succès', async () => {
  simuler(200, multipart([infos({ messages: [{ id: '30220', type: 'ERROR', messageContent: 'Poids invalide' }] })]));
  await assert.rejects(coli.createLabel(entree()), /30220/);
});

testEnSerie('succès annoncé sans étiquette : erreur 502, rien d\'enregistré', async () => {
  simuler(200, multipart([infos({ messages: [{ id: '0' }], labelV31Response: { parcelNumber: 'X' } })]));
  await assert.rejects(coli.createLabel(entree()), (e) => e.statusCode === 502);
});

testEnSerie('une page HTML d\'erreur : message « indisponible » au packing', async () => {
  simuler(503, Buffer.from('<html>Service Unavailable</html>'), 'text/html');
  await assert.rejects(coli.createLabel(entree()), (e) => {
    assert.strictEqual(e.statusCode, 503);
    assert.ok(/indisponible/.test(buildUserMessage(e, 'Colissimo')));
    return true;
  });
});

testEnSerie('contrat de test : validé par checkGenerateLabel, aucune étiquette produite', async () => {
  simuler(200, multipart([infos({ messages: [{ id: '0', type: 'INFOS' }] })]));
  const contratTest = { ...COLI_ACCOUNT, settings: { ...COLI_ACCOUNT.settings, sandbox: 'true' } };
  await assert.rejects(coli.createLabel(entree({ account: contratTest })), /VALIDE/);
  assert.strictEqual(appels.length, 1);
  assert.ok(appels[0].url.endsWith('/checkGenerateLabel'), appels[0].url);
});

testEnSerie('validateLabel passe par checkGenerateLabel', async () => {
  simuler(200, multipart([infos({ messages: [{ id: '0' }] })]));
  assert.strictEqual((await coli.validateLabel(entree())).valid, true);
  assert.ok(appels[0].url.endsWith('/checkGenerateLabel'));
});

testEnSerie('un format ZPL est refusé AVANT l\'appel : l\'étiquette serait payée puis perdue', async () => {
  simuler(200, SUCCES_PDF());
  const zpl = { ...COLI_ACCOUNT, settings: { ...COLI_ACCOUNT.settings, output_format: 'ZPL_10x15_203dpi' } };
  await assert.rejects(coli.createLabel(entree({ account: zpl })), /PDF/);
  assert.strictEqual(appels.length, 0, 'l\'API a été appelée');
});

testEnSerie('point d\'un autre réseau : refus, et aucun appel à l\'API', async () => {
  simuler(200, SUCCES_PDF());
  await assert.rejects(coli.createLabel(entree({ receiver: { ...COLI_RECEIVER, country: 'BE' },
    options: { deliveryMode: 'relais', relayPoint: { ...BPOST, network: 'mondial_relay' } } })), /mondial_relay/);
  assert.strictEqual(appels.length, 0);
});

testEnSerie('décalage réglé à 0 dans le contrat : étiquette rendue telle quelle', async () => {
  simuler(200, SUCCES_PDF());
  const sansDecalage = { ...COLI_ACCOUNT, settings: { ...COLI_ACCOUNT.settings, label_top_offset_mm: '0' } };
  const r = await coli.createLabel(entree({ account: sansDecalage }));
  assert.ok(Buffer.from(r.pdfBase64, 'base64').equals(VRAI_PDF));
});

serie = serie.then(() => { axiosModule.post = postReel; });

// ── Point relais saisi à la main ─────────────────────────────────────────────
console.log('\nPoint relais saisi dans la fiche commande');

const { relayNetworks, expectedNetwork, buildManualRelayPoint } = require('../src/services/carriers/relayPoints');
const saisie = (s) => buildManualRelayPoint(s, {
  orderNumber: '1259888', enteredBy: 'Pierre', enteredById: 1, now: new Date('2026-09-11T08:00:00Z')
});
const refusSaisie = (s) => {
  try { saisie(s); return null; } catch (e) { return e.userMessage; }
};

test('on ne saisit un point que chez un transporteur qui sait le contrôler', () => {
  assert.deepStrictEqual(relayNetworks().map(r => r.code).sort(), ['colissimo', 'mondial_relay']);
});

test('le cas réel : point Bpost 305025 de la commande 1259888, créée au back-office', () => {
  const p = saisie({ network: 'colissimo', id: ' 305025 ', country: 'be' });
  assert.strictEqual(p.id, '305025');
  assert.strictEqual(p.country, 'BE');
  assert.strictEqual(p.network, 'colissimo');
  assert.strictEqual(p.entered_by, 'Pierre');
  assert.strictEqual(p.entered_at, '2026-09-11T08:00:00.000Z');
});

test('un point accepté à la saisie passe le contrôle du packing', () => {
  assert.doesNotThrow(() => coli.assertRelayPoint(saisie({ network: 'colissimo', id: '305025', country: 'BE' }), '1'));
  assert.doesNotThrow(() => mr.assertRelayPoint(saisie({ network: 'mondial_relay', id: '022112', country: 'FR' }), '1'));
});

test('un point saisi sans adresse donne une étiquette Colissimo à l\'adresse du client', () => {
  const p = coliPayload({ receiver: { country: 'BE', postcode: '7970', billing_phone: '0470123456' },
    options: { deliveryMode: 'relais', relayPoint: saisie({ network: 'colissimo', id: '305025', country: 'BE' }) } });
  assert.strictEqual(p.letter.parcel.pickupLocationId, '305025');
  assert.strictEqual(p.letter.addressee.address.line2, '12 rue de la République');
});

test('un numéro mal formé est refusé à la saisie, pas colis en main', () => {
  assert.ok(/6 chiffres/.test(refusSaisie({ network: 'colissimo', id: '30502', country: 'BE' })));
  assert.ok(/6 chiffres/.test(refusSaisie({ network: 'mondial_relay', id: '5761X', country: 'FR' })));
});

test('réseau, numéro et pays sont contrôlés', () => {
  assert.ok(/Réseau/.test(refusSaisie({ network: 'laposte', id: '305025', country: 'BE' })));
  assert.ok(/obligatoire/.test(refusSaisie({ network: 'colissimo', id: '  ', country: 'BE' })));
  assert.ok(/deux lettres/.test(refusSaisie({ network: 'colissimo', id: '305025', country: 'Belgique' })));
});

test('la fiche sait quels modes exigent un point', () => {
  assert.strictEqual(expectedNetwork('colissimo', 'relais').code, 'colissimo');
  assert.strictEqual(expectedNetwork('colissimo', 'domicile'), null);
  assert.strictEqual(expectedNetwork('mondial_relay', '24R').code, 'mondial_relay');
  assert.strictEqual(expectedNetwork('laposte', null), null);
  assert.strictEqual(expectedNetwork(null, null), null);
  assert.strictEqual(expectedNetwork('inconnu', 'relais'), null);
});

test('le refus du packing mène à la fiche commande', () => {
  assert.ok(/fiche/.test(messageDe(null)), 'Mondial Relay');
  assert.ok(/fiche/.test(pointRefuse(null)), 'Colissimo');
});

Promise.all(pending).then(() => {
  console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} test(s) en échec.`);
  process.exit(failures === 0 ? 0 : 1);
});
