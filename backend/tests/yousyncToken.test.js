/**
 * Renouvellement du jeton yousync : `node tests/yousyncToken.test.js` (ou `npm test`).
 *
 * Un échec à N'IMPORTE QUELLE étape ne doit pas couper la synchro.
 */

const assert = require('assert');
const { config, db, httpError, route, called, test, finish } = require('./yousyncHarness');

const appConfigModel = require('../src/models/appConfigModel');
const yousyncTokenService = require('../src/services/yousyncTokenService');
const wcSyncService = require('../src/services/wcSyncService');

const HEALTHY = { success: true, version: '2.0.0' };
const TOKEN_ROUTE = 'POST wc-yousync/v1/token';
const HEALTH_ROUTE = 'GET yousync/v2/health';

const rotateFails = async (status) => {
  await assert.rejects(yousyncTokenService.rotate(), (err) => {
    assert.strictEqual(err.statusCode, status);
    assert.ok(!/401/.test(String(err.statusCode)));
    return true;
  });
};

(async () => {
  await test('parcours normal : nouveau jeton adopté, jamais renvoyé', async () => {
    route(TOKEN_ROUTE, { success: true });
    route(HEALTH_ROUTE, HEALTHY);
    const result = await yousyncTokenService.rotate();
    const sent = called(TOKEN_ROUTE)[0].config.data.token;
    assert.match(sent, /^[0-9a-f]{64}$/);
    assert.strictEqual(config.get('wc_sync_wp_token'), sent);
    assert.strictEqual(config.get('wc_sync_wp_token_pending'), undefined);
    assert.strictEqual(called(HEALTH_ROUTE)[0].config.headers['X-YouSync-Token'], sent);
    assert.ok(!JSON.stringify(result).includes(sent));
    assert.deepStrictEqual(Object.keys(called(TOKEN_ROUTE)[0].config.params).sort(), ['consumer_key', 'consumer_secret']);
  });

  await test('échec à l\'étape 1 (jeton non noté) : rien ne part vers le site', async () => {
    const realUpsert = appConfigModel.upsert;
    appConfigModel.upsert = async () => { throw new Error('base indisponible'); };
    await assert.rejects(yousyncTokenService.rotate());
    appConfigModel.upsert = realUpsert;
    assert.strictEqual(called(TOKEN_ROUTE).length, 0);
    assert.strictEqual(config.get('wc_sync_wp_token'), 'jeton-actuel');
  });

  await test('échec réseau à l\'étape 2 : jeton courant intact, reprise avec le même jeton', async () => {
    route(TOKEN_ROUTE, Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
    await rotateFails(502);
    assert.strictEqual(config.get('wc_sync_wp_token'), 'jeton-actuel');
    const pending = config.get('wc_sync_wp_token_pending');
    assert.ok(pending);

    route(TOKEN_ROUTE, { success: true });
    route(HEALTH_ROUTE, HEALTHY);
    await yousyncTokenService.rotate();
    assert.strictEqual(called(TOKEN_ROUTE)[1].config.data.token, pending);
    assert.strictEqual(config.get('wc_sync_wp_token'), pending);
  });

  await test('étape 2 refusée par le site (4xx) : rien n\'a changé, jeton en attente oublié', async () => {
    route(TOKEN_ROUTE, httpError(403, { code: 'woocommerce_rest_cannot_edit' }));
    await rotateFails(502);
    assert.strictEqual(config.get('wc_sync_wp_token'), 'jeton-actuel');
    assert.strictEqual(config.get('wc_sync_wp_token_pending'), undefined);
  });

  await test('plugin pas encore en 2.0 : message clair, rien n\'a changé', async () => {
    await rotateFails(409);
    assert.strictEqual(config.get('wc_sync_wp_token'), 'jeton-actuel');
    assert.strictEqual(config.get('wc_sync_wp_token_pending'), undefined);
  });

  await test('200 HTML à l\'étape 2 : considéré interrompu, jeton en attente gardé', async () => {
    route(TOKEN_ROUTE, '<html></html>');
    await rotateFails(502);
    assert.strictEqual(config.get('wc_sync_wp_token'), 'jeton-actuel');
    assert.ok(config.get('wc_sync_wp_token_pending'));
  });

  await test('échec à l\'étape 3 : puis l\'ancien expire, le polling adopte le nouveau', async () => {
    route(TOKEN_ROUTE, { success: true });
    route(HEALTH_ROUTE, httpError(500, {}));
    await rotateFails(502);
    assert.strictEqual(config.get('wc_sync_wp_token'), 'jeton-actuel');
    const pending = config.get('wc_sync_wp_token_pending');

    route('GET yousync/v2/queue', (c) => (c.headers['X-YouSync-Token'] === pending
      ? { success: true, events: [], stats: {} } : httpError(401, {})));
    const { log } = console;
    console.log = () => {};
    await wcSyncService.poll();
    console.log = log;
    assert.strictEqual(config.get('wc_sync_wp_token'), pending);
    assert.strictEqual(config.get('wc_sync_wp_token_pending'), undefined);
  });

  await test('échec à l\'étape 4 : le jeton en attente reste, reprise possible', async () => {
    route(TOKEN_ROUTE, { success: true });
    route(HEALTH_ROUTE, HEALTHY);
    const realUpsert = appConfigModel.upsert;
    appConfigModel.upsert = async (key, value) => {
      if (key === 'wc_sync_wp_token') throw new Error('base indisponible');
      return realUpsert(key, value);
    };
    await assert.rejects(yousyncTokenService.rotate());
    appConfigModel.upsert = realUpsert;
    assert.strictEqual(config.get('wc_sync_wp_token'), 'jeton-actuel');
    assert.ok(config.get('wc_sync_wp_token_pending'));
  });

  await test('un renouvellement à la fois', async () => {
    let release;
    route(TOKEN_ROUTE, () => new Promise((resolve) => { release = () => resolve({ success: true }); }));
    route(HEALTH_ROUTE, HEALTHY);
    const first = yousyncTokenService.rotate();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await rotateFails(409);
    release();
    await first;
  });

  await test('clés WooCommerce d\'un autre site : le jeton ne part pas', async () => {
    db.rewards.woocommerce_url = 'https://preprod.test/';
    await rotateFails(409);
    db.rewards.woocommerce_url = 'https://site.test/';
    assert.strictEqual(called(TOKEN_ROUTE).length, 0);
    assert.strictEqual(config.get('wc_sync_wp_token_pending'), undefined);
  });

  finish('yousyncToken');
})();
