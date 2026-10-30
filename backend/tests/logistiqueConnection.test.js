/**
 * Banc de la connexion au plugin youvape-logistique.
 *
 * Sans base ni réseau : `node tests/logistiqueConnection.test.js` (ou `npm test`).
 *
 * L'invariant : les clés d'un site ne partent jamais vers un autre, et aucun
 * secret n'est effacé par un champ laissé vide.
 */

const assert = require('assert');
const { mergeConnection } = require('../src/services/logistiqueService');

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

const saved = {
  url: 'https://www.exemple.fr',
  consumer_key: 'ck_prod',
  consumer_secret: 'cs_prod',
  htaccess_user: '',
  htaccess_password: '',
};

test('première saisie complète', () => {
  const { connection } = mergeConnection(null, { url: 'https://test.exemple.fr/', consumer_key: 'ck_a', consumer_secret: 'cs_a' });
  assert.deepStrictEqual(connection, {
    url: 'https://test.exemple.fr', consumer_key: 'ck_a', consumer_secret: 'cs_a', htaccess_user: '', htaccess_password: '',
  });
});

test('même adresse, champs secrets vides : valeurs gardées', () => {
  const { connection } = mergeConnection(saved, { url: 'https://www.exemple.fr/', consumer_key: '', consumer_secret: '' });
  assert.strictEqual(connection.consumer_key, 'ck_prod');
  assert.strictEqual(connection.consumer_secret, 'cs_prod');
});

test('adresse changée sans ressaisir les clés : refusé', () => {
  const { errors, connection } = mergeConnection(saved, { url: 'https://autre.exemple.fr', consumer_key: '', consumer_secret: '' });
  assert.strictEqual(connection, undefined);
  assert.ok(errors.some(e => e.includes('ressaisir')));
});

test('adresse changée, secret seul ressaisi : refusé', () => {
  const { errors } = mergeConnection(saved, { url: 'https://autre.exemple.fr', consumer_key: '', consumer_secret: 'cs_b' });
  assert.ok(errors.some(e => e.includes('ressaisir')));
});

test('adresse changée, clés ressaisies : accepté', () => {
  const { connection } = mergeConnection(saved, { url: 'https://autre.exemple.fr', consumer_key: 'ck_b', consumer_secret: 'cs_b' });
  assert.strictEqual(connection.consumer_key, 'ck_b');
});

test('mot de passe du site non repris sur une autre adresse', () => {
  const current = { ...saved, htaccess_user: 'u', htaccess_password: 'p' };
  const { errors } = mergeConnection(current, {
    url: 'https://autre.exemple.fr', consumer_key: 'ck_b', consumer_secret: 'cs_b', htaccess_user: 'u',
  });
  assert.ok(errors.some(e => e.includes('Mot de passe')));
});

test('identifiant du site vidé : mot de passe effacé', () => {
  const current = { ...saved, htaccess_user: 'u', htaccess_password: 'p' };
  const { connection } = mergeConnection(current, { url: saved.url, htaccess_user: '' });
  assert.strictEqual(connection.htaccess_password, '');
});

test('adresses refusées : http, identifiants, paramètres, texte', () => {
  for (const url of ['http://www.exemple.fr', 'https://a:b@www.exemple.fr', 'https://www.exemple.fr/?x=1', 'nimporte quoi', '']) {
    const { errors } = mergeConnection(null, { url, consumer_key: 'ck_a', consumer_secret: 'cs_a' });
    assert.ok(errors?.length, url);
  }
});

test('clé et secret inversés : refusé', () => {
  const { errors } = mergeConnection(null, { url: 'https://www.exemple.fr', consumer_key: 'cs_a', consumer_secret: 'ck_a' });
  assert.strictEqual(errors.length, 2);
});

console.log(failures ? `\nlogistiqueConnection : ${failures} échec(s)` : '\nlogistiqueConnection : tout est bon');
process.exit(failures ? 1 : 0);
