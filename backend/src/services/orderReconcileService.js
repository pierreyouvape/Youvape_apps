/**
 * Rattrapage des commandes : compare le site et notre base, réimporte les écarts.
 *
 * C'est le filet de yousync, et il NE DÉPEND PAS de BMS (`importMissingBmsOrders`
 * part de la photo BMS et tombera avec lui). Mesuré le 30/10/2026 sur 72 h : aucune
 * commande manquante, mais 3 statuts faux sur 1059, dont une `completed` chez WC
 * restée `processing` ici. Comparer le statut ET la date : la 1272634 avait changé
 * de statut sans changer de date.
 *
 * Deux sources, dans cet ordre :
 *   1. la route légère du plugin, qui dit aussi quelles commandes ont un événement
 *      en attente (celles-là ne sont pas un trou, juste un peu de retard) ;
 *   2. à défaut, l'API WooCommerce : le filet ne doit pas tomber avec yousync. Elle
 *      charge chaque commande côté site, elle est donc bridée (toutes les 30 min
 *      au plus, 25 pages, une pause entre les pages).
 *
 * Toute trouvaille est un trou de yousync : elle est réimportée et signalée.
 * Le réimport passe par `wcSyncService.processOrder`, qui garde le rattachement
 * client corrigé : une commande invité (`customer_id` null) ne l'efface pas.
 */

const pool = require('../config/database');
const appConfigModel = require('../models/appConfigModel');
const { sendAlert } = require('./alertService');
const refundLinesService = require('./refundLinesService');
const yousyncClient = require('./yousyncClient');
const wcOrderImportService = require('./wcOrderImportService');

const FREQUENT_HOURS = 3;
const DAILY_HOURS = 5 * 24;

// Laisse à la synchro normale le temps de passer (elle tourne toutes les 60 s).
const GRACE_MINUTES = 10;
const MAX_IMPORTS_PER_RUN = 50;
const IMPORT_PAUSE_MS = 300;
const RETRY_AFTER_MS = 30 * 60 * 1000;
const RETRY_AFTER_404_MS = 6 * 60 * 60 * 1000;

const PLUGIN_PER_PAGE = 200;
const PLUGIN_MAX_PAGES = 100;
const WC_API_PER_PAGE = 100;
const WC_API_MAX_PAGES = 25;
const WC_API_PAUSE_MS = 1500;
const WC_API_EVERY_MINUTES = 30;

const LAST_RUN_KEY = 'wc_reconcile_last';
const DRAFT_STATUSES = ['checkout-draft', 'auto-draft', 'trash'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Dates du site en heure de Paris, comme `orders.post_modified`.
const parisDate = (date) => date.toLocaleString('sv-SE', { timeZone: 'Europe/Paris' });
const normalizeDate = (value) => (value ? String(value).replace('T', ' ').slice(0, 19) : '');

// wp_order_id → { retryAt, alerted } : une commande qui échoue n'est pas retentée à
// chaque passe. En mémoire : un redémarrage retente tout, c'est voulu.
const failures = new Map();

let running = false;

const listFromPlugin = async (conn, since) => {
  const orders = [];
  for (let page = 1; page <= PLUGIN_MAX_PAGES; page++) {
    const data = await yousyncClient.ordersIndex(conn, { since, page, perPage: PLUGIN_PER_PAGE });
    if (data.paused === true) return { source: 'plugin', paused: true, orders: [], truncated: false };
    orders.push(...data.orders);
    if (page >= (Number(data.pages) || 1)) return { source: 'plugin', paused: false, orders, truncated: false };
  }
  return { source: 'plugin', paused: false, orders, truncated: true };
};

const listFromWcApi = async (since) => {
  const after = new Date(since * 1000).toISOString().slice(0, 19);
  const orders = [];
  for (let page = 1; page <= WC_API_MAX_PAGES; page++) {
    const rows = await wcOrderImportService.wcRequest('get',
      `/orders?modified_after=${after}&dates_are_gmt=true&per_page=${WC_API_PER_PAGE}&page=${page}`
      + '&orderby=id&order=asc&status=any&_fields=id,status,date_modified');
    if (!Array.isArray(rows)) throw new Error('Réponse inattendue de l\'API WooCommerce');
    orders.push(...rows);
    if (rows.length < WC_API_PER_PAGE) return { source: 'wc-api', paused: false, orders, truncated: false };
    await sleep(WC_API_PAUSE_MS);
  }
  return { source: 'wc-api', paused: false, orders, truncated: true };
};

/**
 * Écarts entre le site et notre base.
 *
 * @param {{id, status, date_modified, pending?}[]} siteOrders
 * @param {{wp_order_id, post_status, modified}[]} dbOrders
 * @param {string} cutoff date de Paris : plus récent, on laisse passer la synchro
 * @returns {{id: number, reason: 'absente'|'desynchronisee'}[]}
 */
const findGaps = (siteOrders, dbOrders, cutoff) => {
  const known = new Map(dbOrders.map((o) => [Number(o.wp_order_id), o]));
  const gaps = [];

  for (const order of siteOrders) {
    if (DRAFT_STATUSES.includes(order.status) || order.pending === true) continue;
    const modified = normalizeDate(order.date_modified);
    if (modified > cutoff) continue;

    const local = known.get(Number(order.id));
    if (!local) {
      gaps.push({ id: Number(order.id), reason: 'absente' });
    } else if (local.post_status !== `wc-${order.status}` || modified > normalizeDate(local.modified)) {
      gaps.push({ id: Number(order.id), reason: 'desynchronisee' });
    }
  }
  return gaps;
};

const importGap = async (gap) => {
  const failure = failures.get(gap.id);
  if (failure && Date.now() < failure.retryAt) return { ...gap, skipped: true };

  try {
    const result = await wcOrderImportService.importOrder(gap.id);
    failures.delete(gap.id);
    if (!result.imported) return { ...gap, skipped: true };
    // Un remboursement perdu avec la commande ne reviendrait pas autrement.
    await refundLinesService.syncOrder(gap.id, { withRefunds: true }).catch((err) =>
      console.warn(`[Rattrapage] Remboursements de la commande #${gap.id} non relus :`, err.message));
    return { ...gap, imported: true };
  } catch (err) {
    const status = err.response?.status;
    failures.set(gap.id, {
      retryAt: Date.now() + (status === 404 ? RETRY_AFTER_404_MS : RETRY_AFTER_MS),
      alerted: true,
    });
    console.error(`[Rattrapage] Commande #${gap.id} : ${status ? `HTTP ${status}` : (err.code || 'échec de l\'import')}`);
    return { ...gap, error: true, firstFailure: !failure?.alerted };
  }
};

const describe = (lines) => lines.map((l) => `- #${l.id} (${l.reason})`).join('\n');

/**
 * Une passe de rattrapage. Ne lève jamais : un échec ne doit pas gêner le cron.
 * @param {{hours: number, frequent?: boolean}} options
 */
const run = async ({ hours, frequent = false }) => {
  if (running) return null;
  running = true;

  try {
    const status = await yousyncClient.readSetting('wc_sync_status');
    if (status !== 'running') return null;

    const since = Math.floor(Date.now() / 1000) - hours * 3600;
    const conn = await yousyncClient.connection();
    let listing;
    try {
      if (!conn) throw new Error('synchro non configurée');
      listing = await listFromPlugin(conn, since);
    } catch (err) {
      if (!yousyncClient.isNoRoute(err)) {
        console.warn(`[Rattrapage] Route du plugin indisponible (${err.response?.status || err.code || err.message}) : repli sur l'API WooCommerce`);
      }
      if (frequent && new Date().getMinutes() % WC_API_EVERY_MINUTES !== 0) return null;
      listing = await listFromWcApi(since);
    }
    if (listing.paused) return null;

    const ids = listing.orders.map((o) => Number(o.id));
    const { rows } = await pool.query(
      `SELECT wp_order_id, post_status, to_char(post_modified, 'YYYY-MM-DD HH24:MI:SS') AS modified
         FROM orders WHERE wp_order_id = ANY($1::bigint[])`,
      [ids]
    );

    const cutoff = parisDate(new Date(Date.now() - GRACE_MINUTES * 60 * 1000));
    const gaps = findGaps(listing.orders, rows, cutoff);

    const results = [];
    for (const gap of gaps.slice(0, MAX_IMPORTS_PER_RUN)) {
      results.push(await importGap(gap));
      await sleep(IMPORT_PAUSE_MS);
    }

    const imported = results.filter((r) => r.imported);
    const firstFailures = results.filter((r) => r.firstFailure);
    const trace = {
      at: new Date().toISOString(),
      source: listing.source,
      hours,
      scanned: listing.orders.length,
      gaps: gaps.length,
      imported: imported.map((r) => r.id),
      errors: results.filter((r) => r.error).map((r) => r.id),
      truncated: listing.truncated,
    };
    await appConfigModel.upsert(LAST_RUN_KEY, JSON.stringify(trace));

    if (imported.length > 0 || firstFailures.length > 0 || gaps.length > MAX_IMPORTS_PER_RUN) {
      console.warn(`[Rattrapage] ${gaps.length} écart(s) sur ${listing.orders.length} commande(s), ${imported.length} réimportée(s)`);
      const parts = [`Le rattrapage a trouve ${gaps.length} commande(s) en ecart sur ${listing.orders.length} verifiee(s) (${hours} h, source : ${listing.source}). C'est un trou de la synchro yousync.`];
      if (imported.length) parts.push(`Reimportees :\n${describe(imported)}`);
      if (firstFailures.length) parts.push(`Import en echec, nouvelle tentative plus tard :\n${describe(firstFailures)}`);
      if (gaps.length > MAX_IMPORTS_PER_RUN) parts.push(`Au plus ${MAX_IMPORTS_PER_RUN} commandes par passe : le reste suit aux passes suivantes.`);
      sendAlert(`YouSync: rattrapage de ${gaps.length} commande(s)`, parts.join('\n\n')).catch(() => {});
    }
    return trace;
  } catch (err) {
    console.error('[Rattrapage] Passe interrompue :', err.response?.status ? `HTTP ${err.response.status}` : err.message);
    return null;
  } finally {
    running = false;
  }
};

const runFrequent = () => run({ hours: FREQUENT_HOURS, frequent: true });
const runDaily = () => run({ hours: DAILY_HOURS });

module.exports = { run, runFrequent, runDaily, findGaps, LAST_RUN_KEY };
