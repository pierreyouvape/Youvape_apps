/**
 * Relance code promo : filtres et CSV pour Probance.
 *
 * Sans base : `node tests/relanceCode.test.js` (ou `npm test`).
 */

const assert = require('assert');
const { _test: { parseFilters, csvField, parseSentAt } } = require('../src/controllers/relanceCodeController');
const { buildQuery } = require('../src/models/relanceCodeModel');

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

console.log('relanceCode');

test('valeurs par défaut : TEAMYOUVAPE, 1re commande, sans borne', () => {
  assert.deepStrictEqual(parseFilters({}), {
    code: 'TEAMYOUVAPE', ref: 'first', minDays: null, maxDays: null, oneOrderOnly: false, country: '',
  });
});

test('relance J+21 : 21 à 27 jours, une seule commande', () => {
  const f = parseFilters({ code: ' teamyouvape ', minDays: '21', maxDays: '27', oneOrderOnly: '1', country: 'FR' });
  assert.strictEqual(f.minDays, 21);
  assert.strictEqual(f.maxDays, 27);
  assert.strictEqual(f.oneOrderOnly, true);
  assert.strictEqual(f.country, 'FR');
  assert.strictEqual(f.code, 'teamyouvape');
});

test('jours invalides ou inversés refusés', () => {
  assert.throws(() => parseFilters({ minDays: '-1' }));
  assert.throws(() => parseFilters({ minDays: '2.5' }));
  assert.throws(() => parseFilters({ minDays: '30', maxDays: '10' }));
});

test('date de référence et pays inconnus : repli sans injection', () => {
  const f = parseFilters({ ref: 'x; drop table', country: "FR' or 1=1" });
  assert.strictEqual(f.ref, 'first');
  assert.strictEqual(f.country, '');
});

test('la requête passe le code et les jours en paramètres', () => {
  const { sql, params } = buildQuery({ code: 'TEAMYOUVAPE', ref: 'registered', minDays: 21, maxDays: 27, oneOrderOnly: true, country: 'BE' });
  assert.ok(!sql.includes('TEAMYOUVAPE'));
  assert.deepStrictEqual(params.slice(1), ['TEAMYOUVAPE', 21, 27, 'BE']);
  assert.ok(sql.includes('cu.user_registered::date <= '));
  assert.ok(sql.includes('cl.nb_orders = 1'));
  assert.ok(!/NOT IN \(SELECT/.test(sql), 'NOT IN sur sous-requête : 57 s en prod');
});

test('CSV : point-virgule, guillemets, retour ligne et formule neutralisés', () => {
  assert.strictEqual(csvField('Marie'), 'Marie');
  assert.strictEqual(csvField('A;B'), '"A;B"');
  assert.strictEqual(csvField('Le "Boss"'), '"Le ""Boss"""');
  assert.strictEqual(csvField('a\nb'), 'a b');
  assert.strictEqual(csvField('=HYPERLINK(1)'), "'=HYPERLINK(1)");
  assert.strictEqual(csvField(null), '');
});

const { readCsv, writeCsv } = require('../src/utils/csvRecords');

test('CSV Probance UTF-8 avec BOM : colonne trouvée, lignes recopiées à l’octet près', () => {
  const src = Buffer.from('﻿id;Prénom;EMAIL;optin\r\n1;Hélène;Helene@Mail.fr ;1\r\n2;"Jo; ""Le"" Boss";jo@x.fr;1\r\n', 'utf8');
  const csv = readCsv(src);
  assert.strictEqual(csv.delimiter, ';');
  assert.strictEqual(csv.emailColumn, 'EMAIL');
  assert.deepStrictEqual(csv.rows.map((r) => r.email), ['helene@mail.fr', 'jo@x.fr']);
  assert.ok(writeCsv(csv).equals(src), 'fichier réécrit identique');
  const out = writeCsv({ ...csv, rows: csv.rows.slice(1) }).toString('utf8');
  assert.strictEqual(out, '﻿id;Prénom;EMAIL;optin\r\n2;"Jo; ""Le"" Boss";jo@x.fr;1\r\n');
});

test('CSV Windows-1252, virgules, retour ligne dans un champ', () => {
  const src = Buffer.concat([Buffer.from('mail,nom\n"a@b.fr","Ren'), Buffer.from([0xe9]), Buffer.from('\nsuite"\nc@d.com,X\n')]);
  const csv = readCsv(src);
  assert.strictEqual(csv.delimiter, ',');
  assert.strictEqual(csv.rows.length, 2);
  assert.ok(writeCsv(csv).equals(src));
});

test('CSV sans en-tête et fichier sans adresse', () => {
  const csv = readCsv(Buffer.from('a@b.fr;1\nc@d.fr;0\n'));
  assert.strictEqual(csv.header, null);
  assert.strictEqual(csv.rows.length, 2);
  assert.throws(() => readCsv(Buffer.from('nom;ville\nJo;Paris\n')), /colonne/);
});

test("date d'envoi : jour seul, jour et heure, refus du reste", () => {
  assert.strictEqual(parseSentAt('2026-11-05'), '2026-11-05 00:00:00');
  assert.strictEqual(parseSentAt('2026-11-05T10:30'), '2026-11-05 10:30:00');
  assert.strictEqual(parseSentAt(''), null);
  assert.throws(() => parseSentAt("2026-11-05'; drop"));
});

if (failures) {
  console.error(`\n${failures} échec(s)`);
  process.exit(1);
}
console.log('\nrelanceCode : tout est vert');
