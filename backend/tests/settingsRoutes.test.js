/**
 * Droits sur les réglages : `node tests/settingsRoutes.test.js` (ou `npm test`).
 *
 * Trouvé le 30/10/2026 : tout compte connecté lisait tout `app_config` (jetons,
 * mots de passe) et pouvait réécrire `wc_sync_wp_url`, donc détourner le jeton
 * de synchro. Même fuite par `/api/reviews/config` et, pour les clés WooCommerce,
 * par `/api/rewards/config`.
 *
 * Le vrai routeur tourne sur un port local ; la base est remplacée.
 */

const assert = require('assert');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'secret-de-test';

const pool = require('../src/config/database');
const appConfigModel = require('../src/models/appConfigModel');
const rewardsConfigModel = require('../src/models/rewardsConfigModel');
const userPermissionsModel = require('../src/models/userPermissionsModel');

const USERS = [{ id: 1, is_admin: true }, { id: 2, is_admin: false }];
let store;
let rewards;

pool.query = async (sql, params = []) => {
  if (/FROM users WHERE disabled_at/.test(sql)) return { rows: USERS.map(u => ({ id: u.id })) };
  if (/SELECT is_admin FROM users/.test(sql)) return { rows: USERS.filter(u => u.id === params[0]) };
  throw new Error(`Requête inattendue : ${sql}`);
};
appConfigModel.get = async (key) => (key in store ? { config_key: key, config_value: store[key] } : undefined);
appConfigModel.upsert = async (key, value) => { store[key] = value; return { config_key: key, config_value: value, updated_at: 'x' }; };
appConfigModel.getAll = async () => Object.entries(store).map(([config_key, config_value]) => ({ config_key, config_value }));
rewardsConfigModel.get = async () => rewards;
rewardsConfigModel.upsert = async (data) => { rewards = { ...rewards, ...data }; return rewards; };
rewardsConfigModel.toggleEnabled = async (enabled) => { rewards = { ...rewards, enabled }; return rewards; };
userPermissionsModel.isSuperAdmin = () => false;
userPermissionsModel.hasPermission = async () => true;

const reset = () => {
  store = {
    wc_sync_interval: '60', wc_sync_wp_token: 'JETON-SECRET', wc_sync_wp_url: 'https://site.test',
    smtp_pass: 'MOT-DE-PASSE', api_key: 'CLE-AVIS', review_type: 'site', limit: '100', cron_enabled: 'true',
  };
  rewards = { id: 1, woocommerce_url: 'https://site.test', consumer_key: 'ck', consumer_secret: 'CS-SECRET', htaccess_user: 'u', htaccess_password: 'HT-SECRET', enabled: true };
};

const app = express();
app.use(express.json());
app.use('/api/settings', require('../src/routes/settingsRoutes'));
app.use('/api/reviews', require('../src/routes/reviewsRoutes'));
app.use('/api/rewards', require('../src/routes/rewardsRoutes'));

const tokenFor = (id) => jwt.sign({ id, email: `u${id}@test` }, process.env.JWT_SECRET);
let base;
const call = async (method, path, { as, body } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(as ? { Authorization: `Bearer ${tokenFor(as)}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
};

const ADMIN = 1;
const SALARIE = 2;
let failures = 0;
const test = async (name, fn) => {
  reset();
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
};

const server = app.listen(0, '127.0.0.1', async () => {
  base = `http://127.0.0.1:${server.address().port}`;

  await test('/api/settings : sans jeton → 401', async () => {
    assert.strictEqual((await call('GET', '/api/settings')).status, 401);
  });
  await test('/api/settings : compte non admin → 403 en lecture comme en écriture', async () => {
    assert.strictEqual((await call('GET', '/api/settings', { as: SALARIE })).status, 403);
    assert.strictEqual((await call('GET', '/api/settings/sync-health', { as: SALARIE })).status, 403);
    assert.strictEqual((await call('GET', '/api/settings/wc_sync_interval', { as: SALARIE })).status, 403);
    assert.strictEqual((await call('PUT', '/api/settings/wc_sync_wp_url', { as: SALARIE, body: { value: 'https://pirate.test' } })).status, 403);
    assert.strictEqual(store.wc_sync_wp_url, 'https://site.test');
  });
  await test('/api/settings : un admin ne reçoit que les clés exposées', async () => {
    const { status, json, text } = await call('GET', '/api/settings', { as: ADMIN });
    assert.strictEqual(status, 200);
    assert.deepStrictEqual(json.settings, { wc_sync_interval: '60' });
    assert.ok(!text.includes('JETON-SECRET') && !text.includes('MOT-DE-PASSE'));
  });
  await test('/api/settings/:key : une clé hors liste n\'existe pas, même pour un admin', async () => {
    assert.strictEqual((await call('GET', '/api/settings/wc_sync_wp_token', { as: ADMIN })).status, 404);
    assert.strictEqual((await call('GET', '/api/settings/smtp_pass', { as: ADMIN })).status, 404);
  });
  await test('PUT : une clé hors liste est refusée, même pour un admin', async () => {
    const { status } = await call('PUT', '/api/settings/wc_sync_wp_url', { as: ADMIN, body: { value: 'https://pirate.test' } });
    assert.strictEqual(status, 404);
    assert.strictEqual(store.wc_sync_wp_url, 'https://site.test');
  });
  await test('PUT wc_sync_interval : valeur validée', async () => {
    assert.strictEqual((await call('PUT', '/api/settings/wc_sync_interval', { as: ADMIN, body: { value: 'abc' } })).status, 400);
    assert.strictEqual((await call('PUT', '/api/settings/wc_sync_interval', { as: ADMIN, body: { value: -1 } })).status, 400);
    assert.strictEqual((await call('PUT', '/api/settings/wc_sync_interval', { as: ADMIN })).status, 400);
    assert.strictEqual(store.wc_sync_interval, '60');
  });

  await test('/api/reviews/config : plus aucun secret, juste « clé renseignée »', async () => {
    const { status, json, text } = await call('GET', '/api/reviews/config', { as: SALARIE });
    assert.strictEqual(status, 200);
    assert.ok(!text.includes('CLE-AVIS') && !text.includes('MOT-DE-PASSE') && !text.includes('JETON-SECRET'));
    assert.strictEqual(json.config.api_key_set, true);
    assert.strictEqual(json.config.review_type, 'site');
  });
  await test('/api/reviews/config : enregistrer sans ressaisir garde la clé', async () => {
    const body = { api_key: '', review_type: 'site', limit: 50, interval: 'once_daily' };
    assert.strictEqual((await call('POST', '/api/reviews/config', { as: ADMIN, body })).status, 200);
    assert.strictEqual(store.api_key, 'CLE-AVIS');
    assert.strictEqual(store.limit, '50');
  });

  await test('/api/rewards/config : ni consumer_secret ni htaccess_password', async () => {
    const { json, text } = await call('GET', '/api/rewards/config', { as: SALARIE });
    assert.ok(!text.includes('CS-SECRET') && !text.includes('HT-SECRET'));
    assert.strictEqual(json.config.consumer_secret_set, true);
    assert.strictEqual(json.config.htaccess_password_set, true);
    assert.strictEqual(json.config.consumer_key, 'ck');
  });
  await test('POST /api/rewards/config : vide = secrets conservés, réponse sans secret', async () => {
    const body = { woocommerce_url: 'https://site.test', consumer_key: 'ck2', consumer_secret: '', points_site: 1, points_product: 2 };
    const { status, text } = await call('POST', '/api/rewards/config', { as: ADMIN, body });
    assert.strictEqual(status, 200);
    assert.strictEqual(rewards.consumer_secret, 'CS-SECRET');
    assert.strictEqual(rewards.htaccess_password, 'HT-SECRET');
    assert.strictEqual(rewards.consumer_key, 'ck2');
    assert.ok(!text.includes('CS-SECRET') && !text.includes('HT-SECRET'));
  });
  await test('POST /api/rewards/config : un secret saisi remplace l\'ancien', async () => {
    const body = { woocommerce_url: 'https://site.test', consumer_key: 'ck', consumer_secret: 'NOUVEAU', points_site: 1, points_product: 2 };
    await call('POST', '/api/rewards/config', { as: ADMIN, body });
    assert.strictEqual(rewards.consumer_secret, 'NOUVEAU');
  });
  await test('POST /api/rewards/toggle : réponse sans secret', async () => {
    const { text } = await call('POST', '/api/rewards/toggle', { as: ADMIN, body: { enabled: false } });
    assert.ok(!text.includes('CS-SECRET') && !text.includes('HT-SECRET'));
  });

  server.close();
  if (failures) { console.log(`\n${failures} échec(s)`); process.exit(1); }
  console.log('\nsettingsRoutes : tout est bon');
  process.exit(0);
});
