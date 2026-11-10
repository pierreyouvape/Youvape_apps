/**
 * Polling yousync : `node tests/yousyncSync.test.js` (ou `npm test`).
 *
 * Passage v1 → v2, acquittement par identifiants, ligne invalide ou en échec,
 * objet disparu, écriture interrompue, réponse HTML en 200, jeton adopté.
 */

const assert = require('assert');
const { state, db, config, httpError, route, called, test, finish } = require('./yousyncHarness');

const paymentController = require('../src/controllers/paymentController');
const shippingController = require('../src/controllers/shippingController');
const ordersController = require('../src/controllers/ordersController');
paymentController.applyPaymentCostToOrder = async () => {};
shippingController.applyShippingCostToOrder = async () => {};
ordersController.reimportIncompleteOrders = async () => ({});

const wcSyncService = require('../src/services/wcSyncService');

const ROW_ID_COMMANDE = 101;
const order = (id, over = {}) => ({
  wp_order_id: id, status: 'processing', total: 10, total_tax: 2, shipping_total: 0, discount_total: 0,
  customer_id: 5, date_created: '2026-10-30 10:00:00', date_modified: '2026-10-30 10:01:00', date_paid: null,
  customer_email: 'client@test', items: [{ product_id: 1, variation_id: 0, name: 'Produit', quantity: 1, subtotal: 8, total: 8, tax: 2 }],
  ...over,
});
const orderEvent = (id, ids, over = {}) => ({ ids, type: 'order', action: 'update', wp_id: id, gone: false, data: order(id), ...over });
const queue = (events, extra = {}) => ({ success: true, version: '2.0.0', paused: false, events, stats: { pending: events.length, failed: 0 }, ...extra });
const ack = () => called('POST yousync/v2/queue/ack').map(c => c.config.data);
const quiet = async (fn) => {
  const { log, error } = console;
  const lines = [];
  console.log = () => {};
  console.error = (...args) => lines.push(args.join(' '));
  try { await fn(); } finally { console.log = log; console.error = error; }
  return lines;
};

(async () => {
  await test('v2 : acquitte exactement les identifiants lus', async () => {
    route('GET yousync/v2/queue', queue([orderEvent(1, [ROW_ID_COMMANDE, 105])]));
    route('POST yousync/v2/queue/ack', { success: true });
    await quiet(() => wcSyncService.poll());
    assert.deepStrictEqual(ack(), [{ acked: [101, 105], failed: [] }]);
    assert.ok(db.queries.some(q => /COMMIT/.test(q.sql)));
    assert.strictEqual(called('GET yousync/v2/queue')[0].config.headers['X-YouSync-Token'], 'jeton-actuel');
    assert.strictEqual(called('GET yousync/v2/queue')[0].config.maxRedirects, 0);
  });

  await test('un événement arrivé après la lecture n\'est pas acquitté', async () => {
    let lecture = 0;
    route('GET yousync/v2/queue', () => queue(++lecture === 1 ? [orderEvent(1, [101])] : [orderEvent(1, [106])]));
    route('POST yousync/v2/queue/ack', { success: true });
    await quiet(() => wcSyncService.poll());
    assert.deepStrictEqual(ack()[0].acked, [101]);
    await quiet(() => wcSyncService.poll());
    assert.deepStrictEqual(ack()[1].acked, [106]);
  });

  await test('ack partiel : un échec n\'empêche pas d\'acquitter les autres', async () => {
    route('GET yousync/v2/queue', queue([orderEvent(1, [101]), orderEvent(2, [102], { data: order(2, { total: 'abc' }) }), orderEvent(3, [103])]));
    route('POST yousync/v2/queue/ack', { success: true });
    await quiet(() => wcSyncService.poll());
    assert.deepStrictEqual(ack(), [{ acked: [101, 103], failed: [{ ids: [102], code: 'INVALID_PAYLOAD' }] }]);
  });

  await test('ligne invalide : aucune écriture, et le motif ne cite que le champ', async () => {
    route('GET yousync/v2/queue', queue([orderEvent(2, [102], { data: order(2, { wp_order_id: 3, customer_email: 'secret@client.test' }) })]));
    route('POST yousync/v2/queue/ack', { success: true });
    const logs = await quiet(() => wcSyncService.poll());
    assert.ok(!db.queries.some(q => /INSERT INTO orders/.test(q.sql)));
    assert.ok(!JSON.stringify([logs, state.alerts]).includes('secret@client.test'));
    assert.ok(logs.join().includes('wp_order_id'));
  });

  await test('écriture interrompue : ROLLBACK, signalée par un code, sans le message de la base', async () => {
    route('GET yousync/v2/queue', queue([orderEvent(9, [109])]));
    route('POST yousync/v2/queue/ack', { success: true });
    db.failOn = /INSERT INTO order_items/;
    const logs = await quiet(() => wcSyncService.poll());
    assert.ok(db.queries.some(q => q.sql === 'ROLLBACK'));
    assert.ok(!db.queries.some(q => q.sql === 'COMMIT'));
    assert.deepStrictEqual(ack(), [{ acked: [], failed: [{ ids: [109], code: 'DB_23505' }] }]);
    assert.ok(!JSON.stringify([logs, state.alerts]).includes('valeur client'));
  });

  await test('objet disparu : commande et client conservés, remboursement retiré, produit marqué', async () => {
    route('GET yousync/v2/queue', queue([
      { ids: [1], type: 'order', action: 'delete', wp_id: 1, gone: true, data: null },
      { ids: [2], type: 'customer', action: 'delete', wp_id: 2, gone: true, data: null },
      { ids: [3], type: 'refund', action: 'delete', wp_id: 3, parent_id: 1, gone: true, data: null },
      { ids: [4], type: 'product', action: 'delete', wp_id: 4, gone: true, data: null },
    ]));
    route('POST yousync/v2/queue/ack', { success: true });
    await quiet(() => wcSyncService.poll());
    assert.deepStrictEqual(ack()[0].acked, [1, 2, 3, 4]);
    assert.ok(!db.queries.some(q => /DELETE FROM (orders|customers|order_items)/.test(q.sql)));
    assert.ok(db.queries.some(q => /DELETE FROM refunds/.test(q.sql)));
    assert.ok(db.queries.some(q => /wc_deleted_at/.test(q.sql)));
  });

  await test('suppression de commande sans marqueur `gone` : refusée', async () => {
    route('GET yousync/v2/queue', queue([{ ids: [7], type: 'order', action: 'delete', wp_id: 7, data: {} }]));
    route('POST yousync/v2/queue/ack', { success: true });
    await quiet(() => wcSyncService.poll());
    assert.ok(!db.queries.some(q => /DELETE FROM orders/.test(q.sql)));
    assert.strictEqual(ack()[0].failed[0].code, 'INVALID_PAYLOAD');
  });

  await test('réimport d\'une commande invité : ne touche pas au rattachement client', async () => {
    const data = order(1, { customer_id: null });
    await quiet(() => wcSyncService.processOrder('update', 1, data));
    const upsert = db.queries.find(q => /INSERT INTO orders/.test(q.sql));
    assert.strictEqual(upsert.params[1], null);
    assert.ok(upsert.sql.includes('COALESCE(EXCLUDED.wp_customer_id, orders.wp_customer_id)'));
  });

  await test('remboursement : la TVA de l\'avoir est écrite', async () => {
    await quiet(() => wcSyncService.processRefund('create', 8, { wp_refund_id: 8, wp_order_id: 1, refund_amount: 12, refund_reason: '', refund_date: '2026-10-30 10:00:00', order_total: -12, order_tax: -2 }));
    const insert = db.queries.find(q => /INSERT INTO refunds/.test(q.sql));
    assert.deepStrictEqual(insert.params.slice(5), [-12, -2]);
  });

  await test('page HTML en HTTP 200 : erreur et alerte, pas une file vide', async () => {
    route('GET yousync/v2/queue', '<!DOCTYPE html><html></html>');
    await quiet(() => wcSyncService.poll());
    assert.strictEqual(config.get('wc_sync_last_poll_ok_at'), undefined);
    assert.ok(config.get('wc_sync_last_error').includes('BAD_RESPONSE'));
    assert.ok(state.alerts.some(a => /polling en panne/.test(a.subject)));
  });

  await test('un 200 sans `success` : erreur, pas une file vide', async () => {
    route('GET yousync/v2/queue', { events: [] });
    await quiet(() => wcSyncService.poll());
    assert.strictEqual(config.get('wc_sync_last_poll_ok_at'), undefined);
  });

  await test('adresse en http : aucun appel, le jeton ne part pas', async () => {
    config.set('wc_sync_wp_url', 'http://site.test');
    await quiet(() => wcSyncService.poll());
    assert.strictEqual(state.calls.length, 0);
    assert.ok(config.get('wc_sync_last_error').includes('URL_NOT_HTTPS'));
  });

  await test('401 avec un jeton en attente : adopté, la synchro ne coupe pas', async () => {
    config.set('wc_sync_wp_token_pending', 'jeton-neuf');
    route('GET yousync/v2/queue', (c) => (c.headers['X-YouSync-Token'] === 'jeton-neuf' ? queue([orderEvent(1, [101])]) : httpError(401, { code: 'yousync_bad_token' })));
    route('POST yousync/v2/queue/ack', (c) => (c.headers['X-YouSync-Token'] === 'jeton-neuf' ? { success: true } : httpError(401, {})));
    await quiet(() => wcSyncService.poll());
    assert.strictEqual(config.get('wc_sync_wp_token'), 'jeton-neuf');
    assert.strictEqual(config.get('wc_sync_wp_token_pending'), undefined);
    assert.deepStrictEqual(ack()[0].acked, [101]);
  });

  await test('401 sans jeton en attente : erreur franche', async () => {
    route('GET yousync/v2/queue', httpError(401, { code: 'yousync_bad_token' }));
    await quiet(() => wcSyncService.poll());
    assert.ok(config.get('wc_sync_last_error').includes('yousync_bad_token'));
  });

  await test('lignes en échec côté plugin : alerte une fois, sans donnée client', async () => {
    const stats = { pending: 0, failed: 2, failed_sample: [{ type: 'order', wp_id: 12, code: 'READ_ERROR' }] };
    route('GET yousync/v2/queue', queue([], { stats }));
    await quiet(() => wcSyncService.poll());
    await quiet(() => wcSyncService.poll());
    const alerts = state.alerts.filter(a => /en echec/.test(a.subject));
    assert.strictEqual(alerts.length, 1);
    assert.ok(alerts[0].body.includes('order #12 : READ_ERROR'));
    assert.strictEqual(JSON.parse(config.get('wc_sync_queue')).failed, 2);
  });

  await test('redémarrage du backend : les échecs déjà signalés ne repartent pas', async () => {
    const stats = { pending: 0, failed: 10, failed_sample: [{ type: 'product', wp_id: 1274828, code: 'INVALID_PAYLOAD' }] };
    route('GET yousync/v2/queue', queue([], { stats }));
    await quiet(() => wcSyncService.poll());
    assert.strictEqual(state.alerts.filter(a => /en echec/.test(a.subject)).length, 1);

    // Même état de file relu par un backend fraîchement démarré (déploiement).
    const modulePath = require.resolve('../src/services/wcSyncService');
    delete require.cache[modulePath];
    const restarted = require('../src/services/wcSyncService');
    await quiet(() => restarted.poll());
    assert.strictEqual(state.alerts.filter(a => /en echec/.test(a.subject)).length, 1);

    // Un nouvel échec, lui, est signalé.
    route('GET yousync/v2/queue', queue([], { stats: { ...stats, failed: 11 } }));
    await quiet(() => restarted.poll());
    assert.strictEqual(state.alerts.filter(a => /en echec/.test(a.subject)).length, 2);
  });

  await test('pause : signalée, rien n\'est traité', async () => {
    route('GET yousync/v2/queue', queue([], { paused: true }));
    await quiet(() => wcSyncService.poll());
    assert.ok(state.alerts.some(a => /en pause/.test(a.subject)));
    assert.strictEqual(JSON.parse(config.get('wc_sync_queue')).paused, true);
    route('GET yousync/v2/queue', queue([]));
    await quiet(() => wcSyncService.poll());
    assert.ok(state.alerts.some(a => /reprise/.test(a.subject)));
  });

  await test('plugin en 1.4 : 404 rest_no_route → v1, puis plus de v2 pendant 5 min', async () => {
    route('GET yousync/v1/queue', { success: true, events: [{ type: 'order', action: 'update', wp_id: 1, data: order(1) }] });
    route('POST yousync/v1/queue/ack', { success: true });
    await quiet(() => wcSyncService.poll());
    assert.strictEqual(called('GET yousync/v2/queue').length, 1);
    assert.deepStrictEqual(called('POST yousync/v1/queue/ack')[0].config.data, { events: [{ type: 'order', wp_id: 1 }] });
    await quiet(() => wcSyncService.poll());
    assert.strictEqual(called('GET yousync/v2/queue').length, 1);
    assert.strictEqual(called('GET yousync/v1/queue').length, 2);
  });

  await test('le plugin passe en 2.0 : la v1 répond 404, bascule immédiate en v2', async () => {
    route('GET yousync/v2/queue', queue([orderEvent(1, [101])]));
    route('POST yousync/v2/queue/ack', { success: true });
    await quiet(() => wcSyncService.poll());
    assert.deepStrictEqual(ack()[0].acked, [101]);
    assert.strictEqual(state.alerts.filter(a => /panne/.test(a.subject)).length, 0);
  });

  // Déclinaisons copiées par une duplication puis remplacées (06/11/2026,
  // 1274828 à 1274837) : fiche illisible, détachée de son parent sur le site.
  const PARENT = 1274827;
  let orphanId = 1274828;
  let ORPHELINE;
  let VARIATION_ROUTE;
  // Un identifiant par test : l'anti-doublon des alertes vit dans le module.
  const nextOrphan = () => {
    ORPHELINE = orphanId++;
    VARIATION_ROUTE = `GET wc/v3/products/${PARENT}/variations/${ORPHELINE}`;
  };
  const orphanEvent = () => ({
    ids: [201, 202], type: 'product', action: 'update', wp_id: ORPHELINE, gone: false,
    data: { wp_product_id: ORPHELINE, parent_id: PARENT, type: null, name: 'Copie', status: 'publish' },
  });
  const knownVariation = () => { db.products = [{ wp_product_id: ORPHELINE, product_type: 'variation', wp_parent_id: PARENT }]; };
  const eventAlerts = () => state.alerts.filter(a => /echec traitement/.test(a.subject));

  await test('le motif nomme le champ exact de la fiche produit', async () => {
    nextOrphan();
    route('GET yousync/v2/queue', queue([orphanEvent()]));
    route('POST yousync/v2/queue/ack', { success: true });
    const logs = await quiet(() => wcSyncService.poll());
    assert.ok(logs.some(l => /champ invalide : type$/.test(l)));
  });

  await test('déclinaison orpheline confirmée par le site : marquée supprimée, acquittée, sans alerte', async () => {
    nextOrphan();
    knownVariation();
    route('GET yousync/v2/queue', queue([orphanEvent()]));
    route('POST yousync/v2/queue/ack', { success: true });
    route(VARIATION_ROUTE, httpError(404, { code: 'woocommerce_rest_product_variation_invalid_id', message: 'ID non valide.', data: { status: 404 } }));
    await quiet(() => wcSyncService.poll());
    assert.deepStrictEqual(ack(), [{ acked: [201, 202], failed: [] }]);
    assert.ok(db.queries.some(q => /wc_deleted_at/.test(q.sql) && q.params[0] === ORPHELINE));
    assert.strictEqual(eventAlerts().length, 0);
    assert.strictEqual(called(VARIATION_ROUTE)[0].config.params.consumer_key, 'ck');
  });

  await test('déclinaison que son parent reconnaît : échec et alerte, rien de supprimé', async () => {
    nextOrphan();
    knownVariation();
    route('GET yousync/v2/queue', queue([orphanEvent()]));
    route('POST yousync/v2/queue/ack', { success: true });
    route(VARIATION_ROUTE, { id: ORPHELINE, parent_id: PARENT });
    await quiet(() => wcSyncService.poll());
    assert.deepStrictEqual(ack(), [{ acked: [], failed: [{ ids: [201, 202], code: 'INVALID_PAYLOAD' }] }]);
    assert.ok(!db.queries.some(q => /wc_deleted_at/.test(q.sql)));
    assert.strictEqual(eventAlerts().length, 1);
  });

  await test('site en maintenance (page HTML en 503) : pas une preuve, alerte', async () => {
    nextOrphan();
    knownVariation();
    route('GET yousync/v2/queue', queue([orphanEvent()]));
    route('POST yousync/v2/queue/ack', { success: true });
    route(VARIATION_ROUTE, httpError(503, '<!DOCTYPE html><title>Maintenance temporaire</title>'));
    await quiet(() => wcSyncService.poll());
    assert.ok(!db.queries.some(q => /wc_deleted_at/.test(q.sql)));
    assert.strictEqual(ack()[0].failed.length, 1);
  });

  await test('404 sans le code WooCommerce (route absente) : pas une preuve', async () => {
    nextOrphan();
    knownVariation();
    route('GET yousync/v2/queue', queue([orphanEvent()]));
    route('POST yousync/v2/queue/ack', { success: true });
    route(VARIATION_ROUTE, httpError(404, { code: 'rest_no_route' }));
    await quiet(() => wcSyncService.poll());
    assert.ok(!db.queries.some(q => /wc_deleted_at/.test(q.sql)));
    assert.strictEqual(ack()[0].failed.length, 1);
  });

  await test('produit qui n\'est pas une déclinaison chez nous : le site n\'est pas interrogé', async () => {
    nextOrphan();
    db.products = [{ wp_product_id: ORPHELINE, product_type: 'simple', wp_parent_id: null }];
    route('GET yousync/v2/queue', queue([orphanEvent()]));
    route('POST yousync/v2/queue/ack', { success: true });
    await quiet(() => wcSyncService.poll());
    assert.strictEqual(called(VARIATION_ROUTE).length, 0);
    assert.strictEqual(eventAlerts().length, 1);
  });

  await test('les clés WC ne partent pas vers un autre site que celui synchronisé', async () => {
    nextOrphan();
    knownVariation();
    config.set('wc_sync_wp_url', 'https://preprod.test');
    route('GET yousync/v2/queue', queue([orphanEvent()]));
    route('POST yousync/v2/queue/ack', { success: true });
    route(VARIATION_ROUTE, httpError(404, { code: 'woocommerce_rest_product_variation_invalid_id' }));
    await quiet(() => wcSyncService.poll());
    assert.strictEqual(called(VARIATION_ROUTE).length, 0);
    assert.strictEqual(ack()[0].failed.length, 1);
  });

  finish('yousyncSync');
})();
