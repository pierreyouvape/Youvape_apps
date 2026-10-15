/**
 * Points fidélité : `node tests/loyalty.test.js` (ou `npm test`).
 *
 * Ce qui est couvert (axios et la base sont remplacés, rien ne part) :
 *   - le plugin youvape-loyalty reçoit type, motif et n° de commande ;
 *   - plugin absent (404 rest_no_route) → repli sur l'API WPLoyalty ;
 *   - toute autre erreur du plugin remonte, sans repli ;
 *   - l'API WPLoyalty répond 200 + `success: false` quand elle échoue :
 *     le repli doit le traiter comme un échec.
 */

const assert = require('assert');
const axios = require('axios');
const pool = require('../src/config/database');
const loyaltyService = require('../src/services/loyaltyService');

pool.query = async () => ({ rows: [{ woocommerce_url: 'https://site.test/', consumer_key: 'ck', consumer_secret: 'cs' }] });

const httpError = (status, data) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });
const NO_ROUTE = httpError(404, { code: 'rest_no_route', message: 'Aucune route ne correspond.' });

let calls;
const stubPost = (...answers) => {
  calls = [];
  axios.post = async (url, body) => {
    calls.push({ url, body });
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return { data: answer };
  };
};

const silenced = async (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = warn; }
};

(async () => {
  // ── Le plugin répond ──────────────────────────────────────────────────────
  stubPost({ success: true, points: 954, requested: 954, balance: 954 });
  let res = await loyaltyService.addPoints('a@b.fr', 954, { type: 'avoir', note: 'Avoir commande N°1264475', orderId: '1264475' });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://site.test/wp-json/wc-youvape-loyalty/v1/points/add');
  assert.deepStrictEqual(calls[0].body, {
    user_email: 'a@b.fr', points: 954, type: 'avoir', note: 'Avoir commande N°1264475', order_id: 1264475,
  });
  assert.strictEqual(res.via, 'plugin');

  // Sans n° de commande exploitable : pas d'order_id envoyé.
  stubPost({ success: true, points: 50, requested: 50 });
  await loyaltyService.addPoints('a@b.fr', 50, { type: 'avis', note: 'Avis site', orderId: 'XXXXXX' });
  assert.ok(!('order_id' in calls[0].body));

  // Retrait plafonné au solde : `points` dit ce qui a vraiment été retiré.
  stubPost({ success: true, points: 300, requested: 954, balance: 0 });
  res = await loyaltyService.reducePoints('a@b.fr', 954, { type: 'avoir', note: 'Annulation avoir commande N°1264475', orderId: 1264475 });
  assert.strictEqual(calls[0].url, 'https://site.test/wp-json/wc-youvape-loyalty/v1/points/reduce');
  assert.strictEqual(res.points, 300);

  // ── Plugin absent : repli sur l'API WPLoyalty ─────────────────────────────
  stubPost(NO_ROUTE, { success: true, data: { message: 'Successfully added customer points via REST API.' } });
  res = await silenced(() => loyaltyService.addPoints('a@b.fr', 954, { type: 'avoir', note: 'Avoir commande N°1264475', orderId: 1264475 }));
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[1].url, 'https://site.test/wp-json/wc/v3/wployalty/customers/points/add');
  assert.deepStrictEqual(calls[1].body, { user_email: 'a@b.fr', points: 954 });
  assert.strictEqual(res.via, 'wployalty');
  assert.strictEqual(res.points, 954);

  // L'API WPLoyalty échoue en HTTP 200 : ce n'est PAS un succès.
  stubPost(NO_ROUTE, { success: false, data: { message: 'Customer have only 300 Points' } });
  await assert.rejects(
    silenced(() => loyaltyService.reducePoints('a@b.fr', 954, { type: 'avoir', note: 'x', orderId: 1 })),
    /Customer have only 300 Points/
  );
  stubPost(NO_ROUTE, {});
  await assert.rejects(silenced(() => loyaltyService.addPoints('a@b.fr', 1, { type: 'avis', note: 'x' })), /refusé/);

  // ── Le plugin refuse : l'erreur remonte, pas de repli ─────────────────────
  for (const err of [
    httpError(409, { code: 'no_points', message: 'a@b.fr n\'a plus aucun point.' }),
    httpError(404, { code: 'customer_not_found', message: 'a@b.fr est inconnu de WPLoyalty.' }),
    httpError(503, { code: 'wployalty_missing', message: 'WPLoyalty est absent.' }),
    httpError(401, { code: 'woocommerce_rest_cannot_view', message: 'Désolé…' }),
  ]) {
    stubPost(err);
    await assert.rejects(loyaltyService.reducePoints('a@b.fr', 10, { type: 'avoir', note: 'x', orderId: 1 }), (e) => e === err);
    assert.strictEqual(calls.length, 1, `pas de repli sur ${err.response.data.code}`);
  }

  // ── Décision de repli ─────────────────────────────────────────────────────
  assert.strictEqual(loyaltyService.isNoRoute(NO_ROUTE), true);
  assert.strictEqual(loyaltyService.isNoRoute(httpError(404, { code: 'customer_not_found' })), false);
  assert.strictEqual(loyaltyService.isNoRoute(new Error('timeout')), false);

  console.log('loyalty.test.js : OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
