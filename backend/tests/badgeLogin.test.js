/**
 * Connexion du PDA par badge : lecture du code et frein sur les échecs.
 *
 * Sans dépendance ni base : `node tests/badgeLogin.test.js` (ou `npm test`).
 */

const assert = require('assert');
const { normalizeBadge, createFailureLimiter } = require('../src/utils/badgeLogin');

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

test('normalizeBadge : badge réel accepté, tel quel ou avec préfixe AIM / espaces', () => {
  assert.strictEqual(normalizeBadge('2522161300037'), '2522161300037');   // Pierre Merle
  assert.strictEqual(normalizeBadge(']E02522161300037'), '2522161300037');
  assert.strictEqual(normalizeBadge(' 2522 1613 0003 7 '), '2522161300037');
});

test('normalizeBadge : mauvaise clé, longueur fausse ou vide → null', () => {
  assert.strictEqual(normalizeBadge('2522161300038'), null);
  assert.strictEqual(normalizeBadge('252216130003'), null);
  assert.strictEqual(normalizeBadge(''), null);
  assert.strictEqual(normalizeBadge(null), null);
});

test('limiteur : 10 échecs bloquent l\'adresse, pas les autres, et la fenêtre se referme', () => {
  const lim = createFailureLimiter({ windowMs: 1000, maxPerIp: 10, maxTotal: 60 });
  for (let i = 0; i < 9; i++) lim.recordFailure('a', 0);
  assert.strictEqual(lim.isBlocked('a', 1), false);
  lim.recordFailure('a', 1);
  assert.strictEqual(lim.isBlocked('a', 2), true);
  assert.strictEqual(lim.isBlocked('b', 2), false);
  assert.strictEqual(lim.isBlocked('a', 1001), false);
});

test('limiteur : le total bloque tout le monde (adresses falsifiées)', () => {
  const lim = createFailureLimiter({ windowMs: 1000, maxPerIp: 10, maxTotal: 60 });
  for (let i = 0; i < 60; i++) lim.recordFailure(`ip${i}`, 0);
  assert.strictEqual(lim.isBlocked('nouvelle', 1), true);
  assert.strictEqual(lim.isBlocked('nouvelle', 1000), false);
});

console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} test(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
