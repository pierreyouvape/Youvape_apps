/**
 * API Mollie en LECTURE SEULE : paiements, pour rapprocher chaque facture
 * paiement par paiement (tr_…) avec nos commandes.
 *
 * Jeton : « advanced access token » créé dans le tableau de bord Mollie, avec
 * des droits `.read` uniquement (payments, refunds, invoices, settlements,
 * payment-links). Stocké dans app_config.mollie_api_token, jamais renvoyé au
 * navigateur (hors EXPOSED_SETTINGS), saisi par un admin depuis /mollie.
 *
 * Les paiements sont recopiés dans mollie_payments (sans données personnelles :
 * ni nom, ni IBAN, ni carte) par une synchro qui tourne en tâche de fond.
 */
const axios = require('axios');
const pool = require('../config/database');
const appConfigModel = require('../models/appConfigModel');

const TOKEN_KEY = 'mollie_api_token';
const API = 'https://api.mollie.com/v2';
const BACKFILL_FROM = '2025-03-01';

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS mollie_payments (
        id                  VARCHAR(40) PRIMARY KEY,
        created_at          TIMESTAMPTZ NOT NULL,
        paid_at             TIMESTAMPTZ,
        status              VARCHAR(20) NOT NULL,
        method              VARCHAR(40),
        amount              NUMERIC(12,2) NOT NULL,
        currency            VARCHAR(3),
        amount_refunded     NUMERIC(12,2),
        amount_charged_back NUMERIC(12,2),
        order_id            BIGINT,
        description         VARCHAR(255),
        card_country        VARCHAR(2),
        card_label          VARCHAR(40),
        card_audience       VARCHAR(20),
        synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_mollie_payments_paid_at ON mollie_payments (paid_at);
      CREATE INDEX IF NOT EXISTS idx_mollie_payments_order ON mollie_payments (order_id);
    `).catch((e) => { tableReady = null; throw e; });
  }
  return tableReady;
}

async function getToken() {
  const row = await appConfigModel.get(TOKEN_KEY);
  return row?.config_value || null;
}

const client = (token) => axios.create({
  baseURL: API,
  timeout: 30000,
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
});

/**
 * Teste chaque droit utile. Un 200 n'est pas une preuve : on exige la forme
 * attendue (`_embedded`), sinon c'est une page intermédiaire, pas l'API.
 */
async function probe(token) {
  const api = client(token);
  const checks = { payments: 'payments', refunds: 'refunds', invoices: 'invoices', settlements: 'settlements', 'payment-links': 'payment_links' };
  const permissions = {};
  for (const [path, key] of Object.entries(checks)) {
    try {
      const { data } = await api.get(`/${path}`, { params: { limit: 1 } });
      permissions[path] = !!data?._embedded && Array.isArray(data._embedded[key] ?? data._embedded[path] ?? []);
    } catch (e) {
      permissions[path] = e.response?.status === 401 || e.response?.status === 403 ? false : `erreur ${e.response?.status || e.code}`;
    }
  }
  return permissions;
}

/** Enregistre un jeton après l'avoir testé (le droit `payments` est obligatoire). */
async function saveToken(token) {
  token = String(token || '').trim();
  if (!token) throw Object.assign(new Error('Jeton vide'), { status: 400 });
  if (/^test_/.test(token)) throw Object.assign(new Error('Clé de TEST : il faut une clé live ou un jeton d\'accès'), { status: 400 });
  const permissions = await probe(token);
  if (permissions.payments !== true) {
    throw Object.assign(new Error('Mollie refuse ce jeton pour la lecture des paiements (droit payments.read manquant ou jeton invalide)'), { status: 400, permissions });
  }
  await appConfigModel.upsert(TOKEN_KEY, token);
  return permissions;
}

/* ─── Synchro des paiements ───────────────────────────────────────────── */

const job = { running: false, startedAt: null, finishedAt: null, pages: 0, upserted: 0, oldest: null, error: null, mode: null };

const num = (a) => (a?.value != null ? parseFloat(a.value) : null);

async function upsertPayments(list) {
  if (!list.length) return;
  const cols = list.map((p) => ({
    id: p.id,
    created_at: p.createdAt,
    paid_at: p.paidAt || null,
    status: p.status,
    method: p.method || null,
    amount: num(p.amount),
    currency: p.amount?.currency || null,
    amount_refunded: num(p.amountRefunded),
    amount_charged_back: num(p.amountChargedBack),
    // Le plugin WooCommerce range le n° de commande dans metadata.order_id.
    order_id: /^\d+$/.test(String(p.metadata?.order_id ?? '')) ? Number(p.metadata.order_id) : null,
    description: (p.description || '').slice(0, 255),
    card_country: p.details?.cardCountryCode || null,
    card_label: p.details?.cardLabel ? String(p.details.cardLabel).slice(0, 40) : null,
    card_audience: p.details?.cardAudience || null,
  }));
  const k = Object.keys(cols[0]);
  await pool.query(`
    INSERT INTO mollie_payments (${k.join(', ')}, synced_at)
    SELECT ${k.join(', ')}, NOW() FROM json_populate_recordset(NULL::mollie_payments, $1::json)
    ON CONFLICT (id) DO UPDATE SET
      paid_at = EXCLUDED.paid_at, status = EXCLUDED.status, method = EXCLUDED.method,
      amount_refunded = EXCLUDED.amount_refunded, amount_charged_back = EXCLUDED.amount_charged_back,
      order_id = COALESCE(EXCLUDED.order_id, mollie_payments.order_id), synced_at = NOW()
  `, [JSON.stringify(cols)]);
}

/**
 * Parcourt les paiements du plus récent au plus ancien (ordre de l'API) jusqu'à
 * `until`. Mode « incrémental » : jusqu'à 10 jours avant le dernier paiement
 * connu, de quoi reprendre les virements confirmés et les remboursements récents.
 */
async function runSync({ full = false } = {}) {
  if (job.running) return job;
  const token = await getToken();
  if (!token) throw Object.assign(new Error('Aucun jeton API Mollie enregistré'), { status: 400 });
  await ensureTable();

  let until = BACKFILL_FROM;
  if (!full) {
    const { rows: [r] } = await pool.query(`SELECT max(created_at) AS last, min(created_at) AS first FROM mollie_payments`);
    if (r.last && r.first && r.first.toISOString().slice(0, 10) <= BACKFILL_FROM) {
      until = new Date(r.last.getTime() - 10 * 86400000).toISOString().slice(0, 10);
    }
  }

  Object.assign(job, { running: true, startedAt: new Date(), finishedAt: null, pages: 0, upserted: 0, oldest: null, error: null, mode: full ? 'complète' : `depuis le ${until}` });
  const api = client(token);
  (async () => {
    try {
      let url = '/payments';
      let params = { limit: 250 };
      while (url) {
        const { data } = await api.get(url, { params });
        const list = data?._embedded?.payments;
        if (!Array.isArray(list)) throw new Error('Réponse Mollie inattendue (pas de liste de paiements)');
        await upsertPayments(list);
        job.pages++;
        job.upserted += list.length;
        const oldest = list[list.length - 1]?.createdAt;
        if (oldest) job.oldest = oldest;
        if (!list.length || (oldest && oldest.slice(0, 10) < until)) break;
        url = data._links?.next?.href || null;
        params = undefined;
        await new Promise((r) => setTimeout(r, 150));
      }
    } catch (e) {
      job.error = e.response?.data?.detail || e.message;
    } finally {
      job.running = false;
      job.finishedAt = new Date();
    }
  })();
  return job;
}

async function status() {
  const token = await getToken();
  let stats = null;
  if (token) {
    await ensureTable();
    const { rows: [s] } = await pool.query(`
      SELECT count(*)::int AS payments, min(created_at) AS first, max(created_at) AS last, max(synced_at) AS synced
      FROM mollie_payments`);
    stats = s;
  }
  return {
    configured: !!token,
    tokenHint: token ? `${token.slice(0, 7)}…${token.slice(-4)}` : null,
    stats,
    job: { ...job },
  };
}

/* ─── Rapprochement paiement par paiement ─────────────────────────────── */

const MOLLIE_METHOD = { creditcard: 'cards', bancontact: 'bancontact', alma: 'alma', paybybank: 'paybybank', banktransfer: 'paybybank' };

/**
 * Paiements Mollie payés sur la période (heure de Paris, comme nos commandes)
 * confrontés à nos commandes : chaque écart nommé, avec sa raison probable.
 */
async function reconcile(periodStart, periodEnd, paidStatuses, titleMethods = {}) {
  await ensureTable();
  const { rows: pays } = await pool.query(`
    SELECT p.id, p.method, p.amount::float, COALESCE(p.amount_refunded, 0)::float AS refunded,
           COALESCE(p.amount_charged_back, 0)::float AS charged_back, p.order_id, p.description,
           to_char(p.paid_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD HH24:MI') AS paid_at,
           o.wp_order_id::bigint AS our_order, o.post_status, o.payment_method_title AS order_title, o.mollie_payment_id AS order_payment, o.order_total::float AS order_total,
           to_char(COALESCE(o.paid_date, o.post_date), 'YYYY-MM-DD HH24:MI') AS order_paid_at
    FROM mollie_payments p
    -- Sans metadata (lien de paiement fait à la main), le n° est dans la description :
    -- « Complément commande N°1269313 ».
    LEFT JOIN orders o ON o.wp_order_id = COALESCE(p.order_id, NULLIF(substring(p.description from '(\\d{6,8})'), '')::bigint)
    WHERE p.paid_at IS NOT NULL
      AND (p.paid_at AT TIME ZONE 'Europe/Paris') >= $1::date
      AND (p.paid_at AT TIME ZONE 'Europe/Paris') <  $2::date + 1
  `, [periodStart, periodEnd]);

  const { rows: ours } = await pool.query(`
    SELECT o.wp_order_id::bigint AS id, o.payment_method_title AS title, o.order_total::float AS total, o.post_status,
           o.mollie_payment_id, to_char(COALESCE(o.paid_date, o.post_date), 'YYYY-MM-DD HH24:MI') AS paid_at
    FROM orders o
    WHERE COALESCE(o.paid_date, o.post_date) >= $1::date AND COALESCE(o.paid_date, o.post_date) < $2::date + 1
      AND (o.post_status = ANY($3) OR o.paid_date IS NOT NULL) AND o.order_total > 0
      AND o.mollie_payment_id IS NOT NULL
  `, [periodStart, periodEnd, paidStatuses]);

  const payIds = new Set(pays.map((p) => p.id));
  // Paiements Mollie par commande : une commande réglée en plusieurs fois.
  const perOrder = {};
  for (const p of pays) if (p.our_order) (perOrder[p.our_order] = perOrder[p.our_order] || []).push(p);
  const byMethod = {};
  const mollieOnly = [];
  for (const p of pays) {
    const m = MOLLIE_METHOD[p.method] || p.method || 'autre';
    byMethod[m] = byMethod[m] || { count: 0, amount: 0 };
    byMethod[m].count++;
    byMethod[m].amount += p.amount;
    let reason = null;
    const siblings = p.our_order ? perOrder[p.our_order] : [];
    const isPartial = p.our_order && siblings.length > 1 && Math.abs(siblings.reduce((a, x) => a + x.amount, 0) - p.order_total) < 0.05;
    const viaLink = p.our_order && !p.order_id;
    if (isPartial) {
      const other = siblings.filter((x) => x.id !== p.id).map((x) => `${x.amount} € en ${MOLLIE_METHOD[x.method] || x.method}`).join(' + ');
      reason = `Commande réglée en plusieurs fois (${p.amount} € ici + ${other}) : chez nous, tout est compté sur un seul moyen`;
    } else if (viaLink && p.order_payment !== p.id) {
      reason = `Lien de paiement « ${p.description} » (commande ${p.our_order} de ${p.order_total} €, réglée par ailleurs) : encaissement en plus de la commande`;
    } else if (!p.our_order) reason = p.order_id ? 'Commande inconnue chez nous' : 'Paiement sans commande (lien de paiement, paiement manuel ?)';
    else if (p.order_payment && p.order_payment !== p.id) reason = `Paiement en double : la commande est réglée par ${p.order_payment}`;
    else if (!paidStatuses.includes(p.post_status) && !p.order_paid_at) reason = `Commande « ${p.post_status} » chez nous alors que Mollie l'a encaissée`;
    else if (p.order_paid_at && (p.order_paid_at.slice(0, 10) < periodStart || p.order_paid_at.slice(0, 10) > periodEnd)) reason = `Payée le ${p.order_paid_at} chez nous (autre mois)`;
    else if (titleMethods[p.order_title] !== m) reason = `Payée en ${m} chez Mollie, enregistrée « ${p.order_title || 'sans libellé'} » chez nous (le client a changé de moyen sur la page Mollie)`;
    else if (p.order_total != null && Math.abs(p.order_total - p.amount) > 0.015) reason = `Montant différent de la commande (${p.amount} € encaissés pour ${p.order_total} €)`;
    if (reason) mollieOnly.push({ ...p, methodKey: m, reason });
  }
  // Une commande Systempay garde parfois l'identifiant d'une tentative Mollie abandonnée : hors sujet.
  const oursOnly = ours.filter((o) => titleMethods[o.title] && !payIds.has(o.mollie_payment_id)).map((o) => ({ ...o, reason: 'Paiement Mollie absent ou payé un autre mois' }));

  const { rows: [sync] } = await pool.query('SELECT max(created_at) AS last, min(created_at) AS first FROM mollie_payments');
  return {
    synced: { first: sync.first, last: sync.last },
    complete: !!(sync.first && sync.last && sync.first.toISOString().slice(0, 10) <= periodStart && sync.last.toISOString().slice(0, 10) >= periodEnd),
    byMethod: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, { count: v.count, amount: Math.round(v.amount * 100) / 100 }])),
    mollieOnly,
    oursOnly,
  };
}

/**
 * Chaque nuit à 5h40 : synchro incrémentale (10 derniers jours), pour que le
 * rapprochement paiement par paiement reste à jour sans clic. Sans jeton : rien.
 */
function setupMollieSyncCron() {
  const cron = require('node-cron');
  cron.schedule('40 5 * * *', async () => {
    try {
      if (await getToken()) await runSync();
    } catch (e) {
      console.error('Cron synchro paiements Mollie :', e.message);
    }
  }, { timezone: 'Europe/Paris' });
  console.log('Cron synchro paiements Mollie configure: tous les jours a 5h40 (Europe/Paris)');
}

module.exports = { getToken, saveToken, probe, runSync, status, reconcile, ensureTable, setupMollieSyncCron };
