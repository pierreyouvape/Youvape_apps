/**
 * Banc du passage en Livrée par l'app (liste d'essai, plugin youvape-logistique).
 *
 * Sans base ni réseau : `node tests/logistiqueDelivered.test.js` (ou `npm test`).
 *
 * Invariants : rien ne part hors de la liste ; l'interrupteur des statuts est
 * TOUJOURS recoupé, même si l'envoi échoue ; une commande ne quitte la liste
 * que si le plugin a tranché (appliqué, déjà Livrée ou refus définitif).
 */

const assert = require('assert');
const pool = require('../src/config/database');
const appConfigModel = require('../src/models/appConfigModel');
const logistiqueService = require('../src/services/logistiqueService');
const alertService = require('../src/services/alertService');
const service = require('../src/services/logistiqueDeliveredService');

let failures = 0;
let serie = Promise.resolve();
function test(name, fn) {
  serie = serie.then(async () => {
    try {
      await fn();
      console.log(`  ok   ${name}`);
    } catch (err) {
      failures++;
      console.error(`  FAIL ${name}\n       ${err.message}`);
    }
  });
}

const LABEL = { id: 9832, order_number: '1279632', tracking_number: '6A08350298269', tracking_delivered_at: new Date('2026-11-26T10:12:00Z') };

let journal;
const monter = ({ list = ['1279632'], labels = [LABEL], post = null, switchOn = true } = {}) => {
  journal = { settings: [], posts: [], upserts: [], alerts: [], queries: [] };
  appConfigModel.get = async (key) => (key === service.LIST_KEY && list ? { config_value: JSON.stringify(list) } : undefined);
  appConfigModel.upsert = async (key, value) => { journal.upserts.push({ key, value: JSON.parse(value) }); };
  pool.query = async (sql, params) => { journal.queries.push(params); return { rows: labels.filter(l => params[0].includes(l.order_number)) }; };
  logistiqueService.updateSettings = async (patch) => {
    journal.settings.push(patch.status_changes_enabled);
    const value = patch.status_changes_enabled ? switchOn : false;
    return { installed: true, settings: { status_changes_enabled: value } };
  };
  logistiqueService.postBatch = async (path, key, lines) => {
    journal.posts.push({ path, key, lines });
    if (post instanceof Error) throw post;
    return (post || lines.map((l, index) => ({ index, order_id: l.order_id, result: 'applied', status_before: 'completed', status_after: 'delivered' })));
  };
  alertService.sendAlert = async (subject) => { journal.alerts.push(subject); };
};

console.log('\nPassage en Livrée par l\'app — aucun appel réseau, aucune base');

test('liste vide ou absente : aucun appel au site', async () => {
  monter({ list: null });
  assert.deepStrictEqual(await service.runDue(), { skipped: 'liste vide' });
  assert.strictEqual(journal.settings.length + journal.posts.length, 0);
});

test('colis pas encore livré : on attend, statuts jamais allumés', async () => {
  monter({ labels: [] });
  assert.deepStrictEqual(await service.runDue(), { waiting: 1 });
  assert.strictEqual(journal.settings.length, 0);
});

test('livré : Livrée AVEC mail, interrupteur allumé puis recoupé, commande retirée de la liste', async () => {
  monter({ list: ['1279632', '1279700'] });
  const r = await service.runDue();
  assert.strictEqual(r.delivered, 1);
  assert.deepStrictEqual(journal.settings, [true, false]);
  assert.strictEqual(journal.posts[0].path, '/order/status');
  assert.strictEqual(journal.posts[0].key, 'orders');
  const line = journal.posts[0].lines[0];
  assert.strictEqual(line.order_id, 1279632);
  assert.strictEqual(line.step, 'delivered');
  assert.strictEqual(line.notify_customer, true);
  assert.match(line.note, /6A08350298269 livré selon le transporteur le 26\/11\/2026 11:12/);
  assert.deepStrictEqual(journal.upserts, [{ key: service.LIST_KEY, value: ['1279700'] }]);
});

test('envoi en échec : interrupteur QUAND MÊME recoupé, commande gardée', async () => {
  monter({ post: new Error('timeout') });
  const r = await service.runDue();
  assert.deepStrictEqual(r, { retry: 1 });
  assert.deepStrictEqual(journal.settings, [true, false]);
  assert.strictEqual(journal.upserts.length, 0);
});

test('interrupteur qui ne s\'allume pas : rien n\'est envoyé', async () => {
  monter({ switchOn: false });
  assert.deepStrictEqual(await service.runDue(), { retry: 1 });
  assert.strictEqual(journal.posts.length, 0);
});

test('déjà Livrée (Vikings passé avant) : retirée sans alerte', async () => {
  monter({ post: [{ index: 0, order_id: 1279632, result: 'already', status_after: 'delivered' }] });
  await service.runDue();
  assert.deepStrictEqual(journal.upserts[0].value, []);
  assert.strictEqual(journal.alerts.length, 0);
});

test('commande verrouillée : gardée pour le passage suivant', async () => {
  monter({ post: [{ index: 0, order_id: 1279632, result: 'error', code: 'ORDER_LOCKED', message: 'x' }] });
  const r = await service.runDue();
  assert.strictEqual(r.retry, 1);
  assert.strictEqual(journal.upserts.length, 0);
});

test('refus définitif : retirée ET alerte', async () => {
  monter({ post: [{ index: 0, order_id: 1279632, result: 'error', code: 'ORDER_NOT_ELIGIBLE', message: 'statut annulée' }] });
  const r = await service.runDue();
  assert.strictEqual(r.error, 1);
  assert.deepStrictEqual(journal.upserts[0].value, []);
  assert.strictEqual(journal.alerts.length, 1);
});

test('liste illisible = vide', () => {
  assert.deepStrictEqual(service.parseList({ config_value: 'pas du json' }), []);
  assert.deepStrictEqual(service.parseList({ config_value: '[1279632, "1279632"]' }), ['1279632']);
});

serie.then(() => {
  console.log(failures === 0 ? '\nTous les tests passent.' : `\n${failures} test(s) en échec.`);
  process.exit(failures === 0 ? 0 : 1);
});
