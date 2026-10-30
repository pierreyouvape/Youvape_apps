/**
 * Rattrapage des commandes : `node tests/orderReconcile.test.js` (ou `npm test`).
 *
 * Reprend les écarts réels du 30/10/2026 (1272317, 1272634).
 */

const assert = require('assert');
const { state, db, config, route, called, test, finish } = require('./yousyncHarness');

const wcOrderImportService = require('../src/services/wcOrderImportService');
const refundLinesService = require('../src/services/refundLinesService');
const orderReconcileService = require('../src/services/orderReconcileService');

const { findGaps } = orderReconcileService;

const imported = [];
wcOrderImportService.importOrder = async (id) => { imported.push(id); return { imported: true, status: 'completed' }; };
refundLinesService.syncOrder = async () => true;

const INDEX = 'GET yousync/v2/orders/index';
const WC_ORDERS = 'GET wc/v3/orders';
const CUTOFF = '2026-10-30 12:00:00';
const site = (id, status, date, extra = {}) => ({ id, status, date_modified: date, ...extra });
const local = (id, status, date) => ({ wp_order_id: id, post_status: status, modified: date });
const index = (orders, extra = {}) => ({ success: true, orders, page: 1, pages: 1, paused: false, ...extra });
const OLD = '2026-10-28 20:34:24';

const quiet = async (fn) => {
  const { log, warn, error } = console;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; console.error = error; }
};

(async () => {
  await test('commande absente de notre base', async () => {
    assert.deepStrictEqual(findGaps([site(1, 'processing', OLD)], [], CUTOFF), [{ id: 1, reason: 'absente' }]);
  });
  await test('1272317 : statut et date en retard', async () => {
    const gaps = findGaps([site(1272317, 'completed', '2026-10-29T11:03:29')], [local(1272317, 'wc-processing', OLD)], CUTOFF);
    assert.deepStrictEqual(gaps, [{ id: 1272317, reason: 'desynchronisee' }]);
  });
  await test('1272634 : statut différent à date identique', async () => {
    const gaps = findGaps([site(1272634, 'cancelled', OLD)], [local(1272634, 'wc-checkout-draft', OLD)], CUTOFF);
    assert.strictEqual(gaps.length, 1);
  });
  await test('à jour : aucun écart', async () => {
    assert.deepStrictEqual(findGaps([site(1, 'completed', OLD)], [local(1, 'wc-completed', OLD)], CUTOFF), []);
  });
  await test('notre base plus fraîche que le site : aucun écart', async () => {
    assert.deepStrictEqual(findGaps([site(1, 'completed', OLD)], [local(1, 'wc-completed', '2026-10-29 10:00:00')], CUTOFF), []);
  });
  await test('modifiée à l\'instant : on laisse passer la synchro', async () => {
    assert.deepStrictEqual(findGaps([site(1, 'processing', '2026-10-30 12:00:01')], [], CUTOFF), []);
  });
  await test('événement en attente : pas un trou', async () => {
    assert.deepStrictEqual(findGaps([site(1, 'processing', OLD, { pending: true })], [], CUTOFF), []);
  });
  await test('brouillon : ignoré', async () => {
    assert.deepStrictEqual(findGaps([site(1, 'checkout-draft', OLD)], [], CUTOFF), []);
  });

  await test('route du plugin : réimporte, alerte, sans donnée client', async () => {
    imported.length = 0;
    route(INDEX, index([site(1, 'processing', OLD)]));
    const trace = await quiet(() => orderReconcileService.run({ hours: 3 }));
    assert.deepStrictEqual(imported, [1]);
    assert.strictEqual(trace.source, 'plugin');
    assert.deepStrictEqual(JSON.parse(config.get('wc_reconcile_last')).imported, [1]);
    assert.strictEqual(state.alerts.length, 1);
    assert.ok(state.alerts[0].body.includes('#1 (absente)'));
    assert.strictEqual(called(WC_ORDERS).length, 0);
  });

  await test('rien à signaler : aucune alerte', async () => {
    imported.length = 0;
    db.orders = [local(1, 'wc-processing', OLD)];
    route(INDEX, index([site(1, 'processing', OLD)]));
    await quiet(() => orderReconcileService.run({ hours: 3 }));
    assert.strictEqual(imported.length, 0);
    assert.strictEqual(state.alerts.length, 0);
  });

  await test('pause du plugin : aucune comparaison', async () => {
    imported.length = 0;
    route(INDEX, index([], { paused: true }));
    const trace = await quiet(() => orderReconcileService.run({ hours: 3 }));
    assert.strictEqual(trace, null);
    assert.strictEqual(called(WC_ORDERS).length, 0);
  });

  await test('synchro désactivée : rien ne tourne', async () => {
    config.set('wc_sync_status', 'disabled');
    await quiet(() => orderReconcileService.run({ hours: 3 }));
    assert.strictEqual(state.calls.length, 0);
  });

  await test('plugin sans la route : repli sur l\'API WooCommerce, sans charger', async () => {
    imported.length = 0;
    route(WC_ORDERS, [site(2, 'processing', OLD)]);
    const trace = await quiet(() => orderReconcileService.run({ hours: 3 }));
    assert.strictEqual(trace.source, 'wc-api');
    assert.deepStrictEqual(imported, [2]);
    const url = called(WC_ORDERS)[0].config.url;
    assert.ok(url.includes('_fields=id,status,date_modified'));
    assert.ok(url.includes('per_page=100'));
  });

  await test('passe fréquente en repli : au plus toutes les 30 minutes', async () => {
    const realMinutes = Date.prototype.getMinutes;
    route(WC_ORDERS, []);
    Date.prototype.getMinutes = () => 15;
    await quiet(() => orderReconcileService.runFrequent());
    assert.strictEqual(called(WC_ORDERS).length, 0);
    Date.prototype.getMinutes = () => 30;
    await quiet(() => orderReconcileService.runFrequent());
    Date.prototype.getMinutes = realMinutes;
    assert.strictEqual(called(WC_ORDERS).length, 1);
  });

  await test('repli : plafonné à 25 pages', async () => {
    const realTimeout = global.setTimeout;
    global.setTimeout = (fn) => realTimeout(fn, 0);
    db.orders = [];
    route(WC_ORDERS, Array.from({ length: 100 }, (_, i) => site(i + 1, 'draft-inconnu', '2099-01-01 00:00:00')));
    const trace = await quiet(() => orderReconcileService.run({ hours: 120 }));
    global.setTimeout = realTimeout;
    assert.strictEqual(called(WC_ORDERS).length, 25);
    assert.strictEqual(trace.truncated, true);
  });

  await test('au plus 50 réimports par passe, le reste suit', async () => {
    imported.length = 0;
    const realTimeout = global.setTimeout;
    global.setTimeout = (fn) => realTimeout(fn, 0);
    route(INDEX, index(Array.from({ length: 60 }, (_, i) => site(i + 1, 'processing', OLD))));
    const trace = await quiet(() => orderReconcileService.run({ hours: 3 }));
    global.setTimeout = realTimeout;
    assert.strictEqual(imported.length, 50);
    assert.strictEqual(trace.gaps, 60);
  });

  await test('import en échec : une seule alerte, nouvelle tentative différée', async () => {
    imported.length = 0;
    const realImport = wcOrderImportService.importOrder;
    wcOrderImportService.importOrder = async () => { throw Object.assign(new Error('x'), { response: { status: 500 } }); };
    route(INDEX, index([site(777, 'processing', OLD)]));
    await quiet(() => orderReconcileService.run({ hours: 3 }));
    await quiet(() => orderReconcileService.run({ hours: 3 }));
    wcOrderImportService.importOrder = realImport;
    assert.strictEqual(state.alerts.length, 1);
    assert.ok(state.alerts[0].body.includes('#777'));
  });

  finish('orderReconcile');
})();
