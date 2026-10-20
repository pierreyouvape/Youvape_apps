/**
 * Google Search Console — synchronisation et lecture
 *
 * Recopie chaque nuit les performances de recherche de youvape.fr dans
 * PostgreSQL, pour suivre les positions par groupe de requêtes (plan SEO JNR
 * du 16/10/2026) et les croiser avec les ventes (orders.attribution_*).
 *
 * Accès : un compte de service Google en LECTURE SEULE (droit « Restreint »
 * dans la Search Console). Jamais le compte Google de quelqu'un.
 * Variables d'environnement (.env du backend) :
 *   - GSC_SERVICE_ACCOUNT_B64 : le fichier JSON de la clé, encodé en base64
 *     (ou GSC_CLIENT_EMAIL + GSC_PRIVATE_KEY, la clé avec des \n littéraux)
 *   - GSC_SITE_URL (facultatif) : la propriété, ex. « sc-domain:youvape.fr ».
 *     Absente, on prend la propriété youvape.fr visible par le compte.
 *
 * Deux tables de données :
 *   - gsc_search_daily  : jour × requête × page × pays. Google y retire les
 *     requêtes « anonymisées » (trop rares) : les totaux y sont donc un peu
 *     sous-estimés, comme dans l'export de l'interface.
 *   - gsc_search_totals : jour × pays × appareil, SANS dimension requête,
 *     donc les vrais totaux du site.
 *
 * Positions : la moyenne d'un groupe est pondérée par les impressions,
 * comme le fait la Search Console.
 */

const axios = require('axios');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { sendMail } = require('./alertService');

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://searchconsole.googleapis.com/webmasters/v3';
const ROW_LIMIT = 25000;
const REQUEST_TIMEOUT_MS = 120000;
const INSERT_CHUNK = 2000;
// Google ne garde que 16 mois de données.
const MAX_BACKFILL_DAYS = 480;

// Groupes de requêtes du plan SEO JNR (partie 11 « Mesure »). Insérés une
// seule fois : ensuite, la table fait foi (on peut en ajouter en base).
const DEFAULT_GROUPS = [
  { slug: 'jnr', name: 'Toutes les requêtes « jnr »', pattern: 'jnr', sort: 10 },
  { slug: 'sans-nicotine-jnr', name: 'Sans nicotine JNR',
    pattern: 'jnr.*(sans nicotine|0 ?mg|0 nicotine|zero nicotine|0 de nicotine|0 ?%)|(sans nicotine|0 ?mg|0 nicotine|zero nicotine|0 de nicotine).*jnr', sort: 20 },
  { slug: 'shisha-jnr', name: 'Shisha / chicha JNR',
    pattern: 'jnr.*(shisha|chicha|hookah)|(shisha|chicha|hookah).*jnr', sort: 30 },
  { slug: 'marque-jnr', name: 'Marque (jnr, puff jnr)',
    pattern: '^(puff |puffs )?jnr( puff| puffs| vape)?$', sort: 40 },
  { slug: 'gorilla-x', name: 'Gorilla X 43K',
    pattern: 'jnr.*(gorill|43 ?k|43000)|(gorill|43 ?k|43000).*jnr', sort: 50 },
  { slug: 'falcon-x', name: 'Falcon X 28K / Nexus 40K',
    pattern: 'jnr.*(falcon|28 ?k|nexus|40 ?k)|(falcon|28 ?k|nexus|40 ?k).*jnr', sort: 60 },
  { slug: 'meteorite', name: 'Meteorite 100K',
    pattern: 'jnr.*(m[eé]t[eé]orite|100 ?k)|(m[eé]t[eé]orite|100 ?k).*jnr', sort: 70 },
  { slug: 'z-pulse', name: 'Z Pulse / double goût',
    pattern: 'jnr.*(z ?pul|z ?plu|double|2 go|deux go|dual|duo|bi go)|(z ?pul|z ?plu|double|dual).*jnr', sort: 80 },
  { slug: 'eliquide-jnr', name: 'E-liquides JNR',
    pattern: 'jnr.*liqui|liqui.*jnr', sort: 90 },
  { slug: 'garde-fou-puff-sans-nicotine', name: 'Garde-fou : « puff sans nicotine »',
    pattern: '^puffs? sans nicotine$', sort: 100 },
];

const COUNTRIES = { all: null, fra: 'fra', bel: 'bel' };

let tokenCache = { token: null, expiresAt: 0 };
let resolvedSiteUrl = null;
let syncState = { running: false, startedAt: null, progress: null, lastError: null };

/* ─── Accès Google ─────────────────────────────────────── */

const loadCredentials = () => {
  const b64 = process.env.GSC_SERVICE_ACCOUNT_B64;
  if (b64) {
    const json = JSON.parse(Buffer.from(b64.trim(), 'base64').toString('utf8'));
    if (!json.client_email || !json.private_key) {
      throw new Error('GSC_SERVICE_ACCOUNT_B64 ne contient pas client_email / private_key');
    }
    return { clientEmail: json.client_email, privateKey: json.private_key };
  }
  if (process.env.GSC_CLIENT_EMAIL && process.env.GSC_PRIVATE_KEY) {
    return {
      clientEmail: process.env.GSC_CLIENT_EMAIL,
      privateKey: process.env.GSC_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }
  return null;
};

const isConfigured = () => {
  try {
    return !!loadCredentials();
  } catch {
    return false;
  }
};

const getAccessToken = async () => {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60000) return tokenCache.token;
  const creds = loadCredentials();
  if (!creds) throw new Error('Search Console non configurée (GSC_SERVICE_ACCOUNT_B64 absent)');
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    { iss: creds.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 },
    creds.privateKey,
    { algorithm: 'RS256' }
  );
  const res = await axios.post(
    TOKEN_URL,
    new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 }
  );
  tokenCache = { token: res.data.access_token, expiresAt: Date.now() + (res.data.expires_in || 3600) * 1000 };
  return tokenCache.token;
};

const googleError = (error) => {
  const msg = error.response?.data?.error?.message || error.response?.data?.error_description || error.message;
  return new Error(`Search Console : ${msg}`);
};

const listSites = async () => {
  const token = await getAccessToken();
  try {
    const res = await axios.get(`${API_BASE}/sites`, {
      headers: { Authorization: `Bearer ${token}` }, timeout: 30000,
    });
    return res.data.siteEntry || [];
  } catch (error) {
    throw googleError(error);
  }
};

// La propriété : GSC_SITE_URL, sinon celle de youvape.fr que le compte voit
// (une propriété « domaine » de préférence, elle couvre www et sans www).
const getSiteUrl = async () => {
  if (process.env.GSC_SITE_URL) return process.env.GSC_SITE_URL;
  if (resolvedSiteUrl) return resolvedSiteUrl;
  const sites = (await listSites()).filter((s) => /youvape\.fr/.test(s.siteUrl) && s.permissionLevel !== 'siteUnverifiedUser');
  if (!sites.length) {
    throw new Error("Le compte de service n'a accès à aucune propriété youvape.fr : l'ajouter dans la Search Console (Paramètres > Utilisateurs et autorisations)");
  }
  const domain = sites.find((s) => s.siteUrl.startsWith('sc-domain:'));
  resolvedSiteUrl = (domain || sites[0]).siteUrl;
  return resolvedSiteUrl;
};

const queryAnalytics = async (body) => {
  const token = await getAccessToken();
  const site = await getSiteUrl();
  try {
    const res = await axios.post(
      `${API_BASE}/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
      body,
      { headers: { Authorization: `Bearer ${token}` }, timeout: REQUEST_TIMEOUT_MS }
    );
    return res.data.rows || [];
  } catch (error) {
    throw googleError(error);
  }
};

// Toutes les lignes d'une journée, page par page (25 000 lignes par appel).
const fetchDay = async (date, dimensions) => {
  const rows = [];
  for (let startRow = 0; ; startRow += ROW_LIMIT) {
    const batch = await queryAnalytics({
      startDate: date, endDate: date, dimensions, type: 'web',
      dataState: 'final', rowLimit: ROW_LIMIT, startRow,
    });
    rows.push(...batch);
    if (batch.length < ROW_LIMIT) break;
  }
  return rows;
};

/* ─── Tables ───────────────────────────────────────────── */

const ensureTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gsc_search_daily (
      date        date         NOT NULL,
      query       text         NOT NULL,
      page        text         NOT NULL,
      country     varchar(3)   NOT NULL,
      clicks      integer      NOT NULL,
      impressions integer      NOT NULL,
      position    numeric(8,2) NOT NULL,
      PRIMARY KEY (date, query, page, country)
    );
    CREATE INDEX IF NOT EXISTS gsc_search_daily_query_idx ON gsc_search_daily (query, date);
    CREATE TABLE IF NOT EXISTS gsc_search_totals (
      date        date         NOT NULL,
      country     varchar(3)   NOT NULL,
      device      varchar(10)  NOT NULL,
      clicks      integer      NOT NULL,
      impressions integer      NOT NULL,
      position    numeric(8,2) NOT NULL,
      PRIMARY KEY (date, country, device)
    );
    CREATE TABLE IF NOT EXISTS gsc_query_groups (
      id      serial PRIMARY KEY,
      slug    varchar(80) UNIQUE NOT NULL,
      name    text NOT NULL,
      pattern text NOT NULL,
      sort    integer NOT NULL DEFAULT 100,
      active  boolean NOT NULL DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS gsc_sync_runs (
      id          serial PRIMARY KEY,
      started_at  timestamp NOT NULL DEFAULT now(),
      finished_at timestamp,
      date_from   date,
      date_to     date,
      days_done   integer DEFAULT 0,
      rows_saved  integer DEFAULT 0,
      status      varchar(20) NOT NULL DEFAULT 'running',
      error       text
    );
  `);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM gsc_query_groups');
  if (rows[0].n === 0) {
    for (const g of DEFAULT_GROUPS) {
      await pool.query(
        'INSERT INTO gsc_query_groups (slug, name, pattern, sort) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING',
        [g.slug, g.name, g.pattern, g.sort]
      );
    }
  }
};

/* ─── Synchronisation ──────────────────────────────────── */

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (dateStr, n) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
};

const saveDay = async (date, detailRows, totalRows) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM gsc_search_daily WHERE date = $1', [date]);
    await client.query('DELETE FROM gsc_search_totals WHERE date = $1', [date]);
    for (let i = 0; i < detailRows.length; i += INSERT_CHUNK) {
      const chunk = detailRows.slice(i, i + INSERT_CHUNK);
      await client.query(
        `INSERT INTO gsc_search_daily (date, query, page, country, clicks, impressions, position)
         SELECT $1::date, q, p, c, cl, im, po
         FROM unnest($2::text[], $3::text[], $4::text[], $5::int[], $6::int[], $7::numeric[]) AS t(q, p, c, cl, im, po)
         ON CONFLICT DO NOTHING`,
        [
          date,
          chunk.map((r) => r.keys[0]),
          chunk.map((r) => r.keys[1]),
          chunk.map((r) => r.keys[2]),
          chunk.map((r) => Math.round(r.clicks)),
          chunk.map((r) => Math.round(r.impressions)),
          chunk.map((r) => Number(r.position.toFixed(2))),
        ]
      );
    }
    if (totalRows.length) {
      await client.query(
        `INSERT INTO gsc_search_totals (date, country, device, clicks, impressions, position)
         SELECT $1::date, c, dv, cl, im, po
         FROM unnest($2::text[], $3::text[], $4::int[], $5::int[], $6::numeric[]) AS t(c, dv, cl, im, po)
         ON CONFLICT DO NOTHING`,
        [
          date,
          totalRows.map((r) => r.keys[0]),
          totalRows.map((r) => r.keys[1]),
          totalRows.map((r) => Math.round(r.clicks)),
          totalRows.map((r) => Math.round(r.impressions)),
          totalRows.map((r) => Number(r.position.toFixed(2))),
        ]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Synchronise les jours de dateFrom à dateTo (inclus), un jour à la fois.
 * Chaque jour est remplacé en entier : relancer une plage est sans risque.
 */
const syncRange = async (dateFrom, dateTo) => {
  if (syncState.running) throw new Error('Une synchronisation Search Console est déjà en cours');
  if (!isConfigured()) throw new Error('Search Console non configurée');
  syncState = { running: true, startedAt: new Date(), progress: { dateFrom, dateTo, done: 0 }, lastError: null };
  const run = await pool.query(
    'INSERT INTO gsc_sync_runs (date_from, date_to) VALUES ($1, $2) RETURNING id',
    [dateFrom, dateTo]
  );
  const runId = run.rows[0].id;
  let rowsSaved = 0;
  let daysDone = 0;
  try {
    for (let date = dateFrom; date <= dateTo; date = addDays(date, 1)) {
      const detail = await fetchDay(date, ['query', 'page', 'country']);
      const totals = await fetchDay(date, ['country', 'device']);
      // Jour pas encore consolidé par Google (dataState final) : on n'écrase
      // pas ce qu'on a déjà, il sera repris au passage suivant.
      if (detail.length || totals.length) {
        await saveDay(date, detail, totals);
        rowsSaved += detail.length;
      }
      daysDone += 1;
      syncState.progress = { dateFrom, dateTo, done: daysDone, current: date };
      await pool.query('UPDATE gsc_sync_runs SET days_done = $2, rows_saved = $3 WHERE id = $1', [runId, daysDone, rowsSaved]);
    }
    await pool.query("UPDATE gsc_sync_runs SET status = 'done', finished_at = now() WHERE id = $1", [runId]);
    return { dateFrom, dateTo, daysDone, rowsSaved };
  } catch (error) {
    syncState.lastError = error.message;
    await pool.query(
      "UPDATE gsc_sync_runs SET status = 'error', finished_at = now(), error = $2 WHERE id = $1",
      [runId, error.message]
    );
    throw error;
  } finally {
    syncState.running = false;
  }
};

// Passage quotidien : Google consolide ses chiffres sous 2 à 3 jours, on
// reprend donc les 6 derniers jours. Base vide : on part sur 90 jours.
const syncRecent = async () => {
  const { rows } = await pool.query('SELECT MAX(date) AS max FROM gsc_search_daily');
  const today = ymd(new Date());
  const from = rows[0].max ? addDays(today, -6) : addDays(today, -90);
  return syncRange(from, addDays(today, -1));
};

const startBackfill = (days) => {
  const n = Math.min(Math.max(parseInt(days, 10) || 90, 1), MAX_BACKFILL_DAYS);
  const today = ymd(new Date());
  const from = addDays(today, -n);
  const to = addDays(today, -1);
  // Lancé en tâche de fond : une reprise de 16 mois prend plusieurs minutes.
  syncRange(from, to).catch((error) => console.error('[GSC] Reprise en échec :', error.message));
  return { dateFrom: from, dateTo: to };
};

/* ─── Lecture ──────────────────────────────────────────── */

const countryClause = (country, alias = 'd', idx = 3) => {
  const c = COUNTRIES[country];
  return c ? { sql: ` AND ${alias}.country = $${idx}`, params: [c] } : { sql: '', params: [] };
};

const getStatus = async () => {
  const configured = isConfigured();
  const [range, runs] = await Promise.all([
    pool.query('SELECT MIN(date) AS min, MAX(date) AS max, COUNT(*)::int AS rows FROM gsc_search_daily'),
    pool.query('SELECT * FROM gsc_sync_runs ORDER BY id DESC LIMIT 5'),
  ]);
  let site = process.env.GSC_SITE_URL || resolvedSiteUrl || null;
  let siteError = null;
  if (configured && !site) {
    try {
      site = await getSiteUrl();
    } catch (error) {
      siteError = error.message;
    }
  }
  return {
    configured,
    site,
    siteError,
    // pg renvoie un Date à minuit local : repasser en AAAA-MM-JJ, sinon le
    // JSON (UTC) afficherait la veille.
    dataFrom: range.rows[0].min ? ymd(new Date(range.rows[0].min)) : null,
    dataTo: range.rows[0].max ? ymd(new Date(range.rows[0].max)) : null,
    rows: range.rows[0].rows,
    sync: syncState,
    lastRuns: runs.rows,
  };
};

/**
 * Séries hebdomadaires par groupe. Les semaines sont des fenêtres glissantes
 * de 7 jours qui se terminent au dernier jour disponible : jamais de semaine
 * à moitié remplie en bout de courbe.
 */
const getGroupsSeries = async ({ weeks = 12, country = 'all' } = {}) => {
  const nWeeks = Math.min(Math.max(parseInt(weeks, 10) || 12, 2), 70);
  const maxRes = await pool.query('SELECT MAX(date) AS max FROM gsc_search_daily');
  const maxDate = maxRes.rows[0].max;
  if (!maxDate) return { dataTo: null, groups: [] };
  const toStr = ymd(new Date(maxDate));
  const fromStr = addDays(toStr, -(nWeeks * 7) + 1);
  const cc = countryClause(country, 'd', 3);
  const { rows } = await pool.query(
    `WITH g AS (SELECT slug, pattern FROM gsc_query_groups WHERE active),
     q AS (SELECT DISTINCT query FROM gsc_search_daily WHERE date BETWEEN $1 AND $2),
     m AS (SELECT g.slug, q.query FROM q JOIN g ON q.query ~* g.pattern)
     SELECT m.slug,
            (($2::date - d.date) / 7) AS k,
            SUM(d.clicks)::int AS clicks,
            SUM(d.impressions)::int AS impressions,
            ROUND(SUM(d.position * d.impressions) / NULLIF(SUM(d.impressions), 0), 2) AS position
     FROM m JOIN gsc_search_daily d ON d.query = m.query
     WHERE d.date BETWEEN $1 AND $2${cc.sql}
     GROUP BY m.slug, k`,
    [fromStr, toStr, ...cc.params]
  );
  const groupsRes = await pool.query('SELECT slug, name, pattern, sort FROM gsc_query_groups WHERE active ORDER BY sort, id');
  const groups = groupsRes.rows.map((g) => {
    const series = [];
    for (let k = nWeeks - 1; k >= 0; k -= 1) {
      const r = rows.find((x) => x.slug === g.slug && Number(x.k) === k);
      const end = addDays(toStr, -7 * k);
      series.push({
        weekStart: addDays(end, -6),
        weekEnd: end,
        clicks: r ? r.clicks : 0,
        impressions: r ? r.impressions : 0,
        position: r && r.position !== null ? Number(r.position) : null,
      });
    }
    return { ...g, series };
  });
  return { dataTo: toStr, weeks: nWeeks, country, groups };
};

/**
 * Détail d'un groupe : requêtes et pages sur une période, comparées à la
 * période précédente de même longueur.
 */
const getGroupDetail = async (slug, { days = 28, country = 'all', limit = 200 } = {}) => {
  const groupRes = await pool.query('SELECT slug, name, pattern FROM gsc_query_groups WHERE slug = $1', [slug]);
  const group = groupRes.rows[0];
  if (!group) return null;
  const nDays = Math.min(Math.max(parseInt(days, 10) || 28, 7), 480);
  const maxRes = await pool.query('SELECT MAX(date) AS max FROM gsc_search_daily');
  if (!maxRes.rows[0].max) return { group, queries: [], pages: [] };
  const to = ymd(new Date(maxRes.rows[0].max));
  const from = addDays(to, -nDays + 1);
  const prevFrom = addDays(from, -nDays);
  const cc = countryClause(country, 'd', 5);
  const lim = Math.min(parseInt(limit, 10) || 200, 1000);
  const params = [prevFrom, from, to, group.pattern, ...cc.params];

  const agg = (dim) => pool.query(
    `SELECT d.${dim} AS key,
            SUM(d.clicks) FILTER (WHERE d.date >= $2)::int AS clicks,
            SUM(d.impressions) FILTER (WHERE d.date >= $2)::int AS impressions,
            ROUND(SUM(d.position * d.impressions) FILTER (WHERE d.date >= $2)
                  / NULLIF(SUM(d.impressions) FILTER (WHERE d.date >= $2), 0), 2) AS position,
            SUM(d.clicks) FILTER (WHERE d.date < $2)::int AS prev_clicks,
            SUM(d.impressions) FILTER (WHERE d.date < $2)::int AS prev_impressions,
            ROUND(SUM(d.position * d.impressions) FILTER (WHERE d.date < $2)
                  / NULLIF(SUM(d.impressions) FILTER (WHERE d.date < $2), 0), 2) AS prev_position
     FROM gsc_search_daily d
     WHERE d.date BETWEEN $1 AND $3 AND d.query ~* $4${cc.sql}
     GROUP BY d.${dim}
     HAVING SUM(d.impressions) FILTER (WHERE d.date >= $2) > 0
     ORDER BY impressions DESC
     LIMIT ${lim}`,
    params
  );
  const [queries, pages] = await Promise.all([agg('query'), agg('page')]);
  return { group, from, to, prevFrom, days: nDays, country, queries: queries.rows, pages: pages.rows };
};

// Requêtes apparues : des impressions sur les N derniers jours, aucune sur
// les 28 jours d'avant.
const getNewQueries = async ({ days = 7, pattern = 'jnr', country = 'all' } = {}) => {
  const nDays = Math.min(Math.max(parseInt(days, 10) || 7, 1), 60);
  const maxRes = await pool.query('SELECT MAX(date) AS max FROM gsc_search_daily');
  if (!maxRes.rows[0].max) return { queries: [] };
  const to = ymd(new Date(maxRes.rows[0].max));
  const from = addDays(to, -nDays + 1);
  const before = addDays(from, -28);
  const cc = countryClause(country, 'd', 5);
  const { rows } = await pool.query(
    `SELECT d.query,
            SUM(d.clicks)::int AS clicks,
            SUM(d.impressions)::int AS impressions,
            ROUND(SUM(d.position * d.impressions) / NULLIF(SUM(d.impressions), 0), 2) AS position,
            (ARRAY_AGG(d.page ORDER BY d.impressions DESC))[1] AS top_page
     FROM gsc_search_daily d
     WHERE d.date BETWEEN $1 AND $2 AND d.query ~* $4${cc.sql}
       AND NOT EXISTS (
         SELECT 1 FROM gsc_search_daily o
         WHERE o.query = d.query AND o.date >= $3 AND o.date < $1
       )
     GROUP BY d.query
     ORDER BY impressions DESC
     LIMIT 200`,
    [from, to, before, pattern, ...cc.params]
  );
  return { from, to, queries: rows };
};

/* ─── Rapport hebdomadaire ─────────────────────────────── */

const fmtPos = (p) => (p === null || p === undefined ? '—' : String(p).replace('.', ','));
const fmtInt = (n) => new Intl.NumberFormat('fr-FR').format(n || 0);

const buildWeeklyReport = async () => {
  const { dataTo, groups } = await getGroupsSeries({ weeks: 3, country: 'fra' });
  if (!dataTo) return null;
  const lines = [];
  const alerts = [];
  for (const g of groups) {
    const [w2, w1, w0] = g.series; // w0 = dernière semaine
    const delta = w0.position !== null && w1.position !== null ? Number((w1.position - w0.position).toFixed(2)) : null;
    lines.push({ name: g.name, slug: g.slug, w0, w1, delta });
    // Critères de retour arrière du plan : -2 places deux semaines de suite,
    // et « puff sans nicotine » sous la 4e place deux semaines de suite.
    if (g.slug === 'garde-fou-puff-sans-nicotine' && w0.position > 4 && w1.position > 4) {
      alerts.push(`« puff sans nicotine » est sous la 4e place depuis 2 semaines (${fmtPos(w1.position)} puis ${fmtPos(w0.position)}).`);
    }
    if (w2.position !== null && w1.position !== null && w0.position !== null
        && w1.position - w2.position > 2 && w0.position - w1.position > 0) {
      alerts.push(`${g.name} : recul de ${fmtPos((w0.position - w2.position).toFixed(2))} places en 2 semaines.`);
    }
  }
  return { dataTo, lines, alerts };
};

const sendWeeklyReport = async () => {
  const report = await buildWeeklyReport();
  if (!report) return { skipped: 'aucune donnée' };
  const cfg = await pool.query(
    "SELECT config_key, config_value FROM app_config WHERE config_key IN ('seo_report_email_to', 'alert_email_to')"
  );
  const conf = Object.fromEntries(cfg.rows.map((r) => [r.config_key, r.config_value]));
  const to = conf.seo_report_email_to || conf.alert_email_to;
  if (!to) return { skipped: 'aucun destinataire' };

  const rowsHtml = report.lines.map((l) => {
    const arrow = l.delta === null ? '' : l.delta > 0 ? `<span style="color:#15803d">▲ ${fmtPos(l.delta)}</span>` : l.delta < 0 ? `<span style="color:#b91c1c">▼ ${fmtPos(Math.abs(l.delta))}</span>` : '=';
    return `<tr><td style="padding:4px 8px">${l.name}</td><td style="padding:4px 8px;text-align:right">${fmtPos(l.w0.position)}</td><td style="padding:4px 8px">${arrow}</td><td style="padding:4px 8px;text-align:right">${fmtInt(l.w0.clicks)}</td><td style="padding:4px 8px;text-align:right">${fmtInt(l.w0.impressions)}</td></tr>`;
  }).join('');
  const alertsHtml = report.alerts.length
    ? `<p style="color:#b91c1c"><b>À regarder :</b><br>${report.alerts.join('<br>')}</p>`
    : '<p>Aucun critère de retour arrière déclenché.</p>';
  const html = `<p>Positions Google sur la semaine du ${report.lines[0]?.w0.weekStart} au ${report.dataTo} (France), comparées à la semaine précédente.</p>
${alertsHtml}
<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px" border="1">
<tr style="background:#f2f6f8"><th style="padding:4px 8px">Groupe</th><th style="padding:4px 8px">Position</th><th style="padding:4px 8px">Évolution</th><th style="padding:4px 8px">Clics</th><th style="padding:4px 8px">Impressions</th></tr>
${rowsHtml}
</table>
<p>Détail dans l'app « Suivi SEO ».</p>`;
  const text = report.lines.map((l) => `${l.name} : position ${fmtPos(l.w0.position)} (${l.delta === null ? '—' : (l.delta > 0 ? '+' : '') + fmtPos(l.delta)}), ${l.w0.clicks} clics`).join('\n');
  const res = await sendMail({ to, subject: `Suivi SEO : semaine au ${report.dataTo}`, html, text: `${report.alerts.join('\n')}\n\n${text}` });
  return { sent: !!res?.success, to, alerts: report.alerts.length };
};

module.exports = {
  ensureTables,
  isConfigured,
  listSites,
  syncRange,
  syncRecent,
  startBackfill,
  getStatus,
  getGroupsSeries,
  getGroupDetail,
  getNewQueries,
  buildWeeklyReport,
  sendWeeklyReport,
  DEFAULT_GROUPS,
};
