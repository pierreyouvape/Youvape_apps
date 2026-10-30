/**
 * Banc commun des tests yousync : axios, la base, les réglages et les alertes sont
 * remplacés, rien ne sort. À charger AVANT les services testés (ils gardent une
 * référence à axios et à sendAlert).
 */

const axiosPath = require.resolve('axios');
const realAxios = require('axios');

const state = { routes: new Map(), calls: [], alerts: [] };

const httpError = (status, data) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });

const axiosStub = async (config) => {
  const path = config.url.replace(/^https?:\/\/[^/]+\/wp-json\//, '').split('?')[0];
  const key = `${config.method.toUpperCase()} ${path}`;
  state.calls.push({ key, config });
  const handler = state.routes.get(key);
  if (!handler) throw httpError(404, { code: 'rest_no_route' });
  const answer = await handler(config);
  if (answer instanceof Error) throw answer;
  return { data: answer };
};
axiosStub.create = realAxios.create;
axiosStub.get = async () => ({ data: [] });

require.cache[axiosPath].exports = axiosStub;

const pool = require('../src/config/database');
const appConfigModel = require('../src/models/appConfigModel');
const alertService = require('../src/services/alertService');

const config = new Map();
appConfigModel.get = async (key) => (config.has(key) ? { config_key: key, config_value: config.get(key) } : undefined);
appConfigModel.upsert = async (key, value) => { config.set(key, String(value)); return { config_key: key, config_value: String(value) }; };
appConfigModel.delete = async (key) => { config.delete(key); };

alertService.sendAlert = async (subject, body) => { state.alerts.push({ subject, body }); };

const db = { queries: [], failOn: null, rewards: { woocommerce_url: 'https://site.test/', consumer_key: 'ck', consumer_secret: 'cs' }, orders: [] };

const runQuery = async (sql, params = []) => {
  db.queries.push({ sql, params });
  if (db.failOn && db.failOn.test(sql)) throw Object.assign(new Error('valeur client dans le message'), { code: '23505', constraint: 'une_contrainte' });
  if (/FROM rewards_config/.test(sql)) return { rows: [db.rewards] };
  if (/FROM orders WHERE wp_order_id = ANY/.test(sql)) return { rows: db.orders };
  return { rows: [], rowCount: 1 };
};
pool.query = runQuery;
pool.connect = async () => ({ query: runQuery, release() {} });

const reset = () => {
  state.routes.clear();
  state.calls.length = 0;
  state.alerts.length = 0;
  config.clear();
  config.set('wc_sync_wp_url', 'https://site.test');
  config.set('wc_sync_wp_token', 'jeton-actuel');
  config.set('wc_sync_status', 'running');
  db.queries.length = 0;
  db.failOn = null;
  db.orders = [];
};

const route = (key, handler) => state.routes.set(key, typeof handler === 'function' ? handler : () => handler);
const called = (key) => state.calls.filter(c => c.key === key);

let failures = 0;
const test = async (name, fn) => {
  reset();
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}\n       ${err.stack.split('\n').slice(0, 3).join('\n       ')}`);
  }
};
const finish = (label) => {
  if (failures) { console.log(`\n${failures} échec(s)`); process.exit(1); }
  console.log(`\n${label} : tout est bon`);
  process.exit(0);
};

module.exports = { state, db, config, httpError, route, called, test, finish };
