/**
 * Google Ads API — Planificateur de mots clés (KeywordPlanIdeaService).
 *
 * Accès « Basic » : 15 000 opérations par jour, remises à zéro à minuit
 * heure du Pacifique. Tous les appels de l'app passent par ici :
 *  - compteur quotidien en base (google_ads_usage), réservé AVANT l'appel,
 *    plafonné à GOOGLE_ADS_DAILY_CAP (10 000 par défaut, marge de 5 000) ;
 *  - cache de 30 jours (google_ads_cache) : les volumes sont mensuels, une
 *    recherche déjà faite ne consomme rien ;
 *  - un appel à la fois, espacés d'au moins 1,1 s (limite de débit du service).
 *
 * Authentification : compte de service seo-lecture (même clé que la Search
 * Console), scope adwords, appel sur le compte administrateur. Pas de
 * developer token depuis le 09/09/2026 (l'accès se gère dans Google Cloud).
 */
const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const API = 'https://googleads.googleapis.com/v26';
const MCC = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '9896447862';
const DAILY_LIMIT = 15000;
const DAILY_CAP = Math.min(Number(process.env.GOOGLE_ADS_DAILY_CAP) || 10000, DAILY_LIMIT);
const CACHE_DAYS = 30;
const MIN_GAP_MS = 1100;

const LANG_FR = 'languageConstants/1002';
const GEO = { fr: 'geoTargetConstants/2250', be: 'geoTargetConstants/2056', ch: 'geoTargetConstants/2756' };

const isConfigured = () => Boolean(process.env.GSC_SERVICE_ACCOUNT_B64);

/* ─── Tables ─────────────────────────────────────────────── */

let tablesReady = false;
const ensureTables = async () => {
  if (tablesReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS google_ads_usage (
      day       date PRIMARY KEY,
      ops       integer NOT NULL DEFAULT 0,
      by_source jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE IF NOT EXISTS google_ads_cache (
      key        text PRIMARY KEY,
      method     text NOT NULL,
      body       jsonb NOT NULL,
      result     jsonb NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    );
  `);
  tablesReady = true;
};

// Jour du quota Google (minuit heure du Pacifique).
const DAY_SQL = `(now() AT TIME ZONE 'America/Los_Angeles')::date`;

/* Réserve une opération ; refuse si le plafond du jour est atteint. */
const reserve = async (source) => {
  await pool.query(`INSERT INTO google_ads_usage (day) VALUES (${DAY_SQL}) ON CONFLICT DO NOTHING`);
  const { rows } = await pool.query(
    `UPDATE google_ads_usage
        SET ops = ops + 1,
            by_source = jsonb_set(by_source, ARRAY[$2::text], to_jsonb(COALESCE((by_source->>$2)::int, 0) + 1))
      WHERE day = ${DAY_SQL} AND ops < $1
      RETURNING ops`,
    [DAILY_CAP, source]
  );
  if (!rows.length) {
    const err = new Error(`Quota Google Ads du jour atteint (${DAILY_CAP} recherches). Remise à zéro à 9 h (heure de Paris).`);
    err.status = 429;
    throw err;
  }
};

const getUsage = async () => {
  await ensureTables();
  const { rows } = await pool.query(`SELECT ops, by_source FROM google_ads_usage WHERE day = ${DAY_SQL}`);
  return { ops: rows[0]?.ops || 0, cap: DAILY_CAP, limit: DAILY_LIMIT, by_source: rows[0]?.by_source || {} };
};

/* ─── Authentification ───────────────────────────────────── */

let token = { value: null, exp: 0 };
const auth = async () => {
  if (token.value && Date.now() < token.exp - 60000) return token.value;
  const sa = JSON.parse(Buffer.from(process.env.GSC_SERVICE_ACCOUNT_B64, 'base64').toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/adwords', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 },
    sa.private_key, { algorithm: 'RS256' }
  );
  const res = await axios.post('https://oauth2.googleapis.com/token',
    new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 });
  token = { value: res.data.access_token, exp: Date.now() + (res.data.expires_in || 3600) * 1000 };
  return token.value;
};

/* ─── File d'appels : un à la fois, espacés ──────────────── */

let queue = Promise.resolve();
let lastCall = 0;
const serial = (fn) => {
  const next = queue.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try { return await fn(); } finally { lastCall = Date.now(); }
  });
  queue = next.catch(() => {});
  return next;
};

/**
 * Appel d'une méthode du Planificateur (generateKeywordIdeas,
 * generateKeywordHistoricalMetrics), langue française, réseau de recherche.
 * `source` sert au détail du compteur (recherche, fiche…).
 */
const call = async (method, body, { source = 'autre', geo = 'fr' } = {}) => {
  if (!isConfigured()) throw new Error('Google Ads non configuré (clé du compte de service absente)');
  await ensureTables();
  const full = { language: LANG_FR, geoTargetConstants: [GEO[geo] || GEO.fr], keywordPlanNetwork: 'GOOGLE_SEARCH', ...body };
  const key = crypto.createHash('sha256').update(`${method}|${JSON.stringify(full)}`).digest('hex');

  const cached = await pool.query(
    `SELECT result, created_at FROM google_ads_cache WHERE key = $1 AND created_at > now() - interval '${CACHE_DAYS} days'`,
    [key]
  );
  if (cached.rows.length) return { ...cached.rows[0].result, _cache: cached.rows[0].created_at };

  return serial(async () => {
    await reserve(source);
    let res;
    try {
      res = await axios.post(`${API}/customers/${MCC}:${method}`, full, {
        headers: { Authorization: `Bearer ${await auth()}`, 'login-customer-id': MCC },
        timeout: 60000,
      });
    } catch (error) {
      const status = error.response?.status;
      const msg = error.response?.data?.error?.message || error.message;
      const err = new Error(status === 429
        ? 'Google Ads limite les appels pour le moment : réessayez dans une minute.'
        : `Google Ads : ${msg}`);
      err.status = status === 429 ? 429 : 502;
      throw err;
    }
    await pool.query(
      `INSERT INTO google_ads_cache (key, method, body, result) VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET result = EXCLUDED.result, created_at = now()`,
      [key, method, JSON.stringify(full), JSON.stringify(res.data)]
    );
    return res.data;
  });
};

/* ─── Recherche de l'onglet « Mots clés » ────────────────── */

const COMPETITION = { LOW: 'faible', MEDIUM: 'moyenne', HIGH: 'forte' };
const MONTHS = ['', 'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

const metrics = (text, m = {}) => ({
  requete: text,
  volume: m.avgMonthlySearches !== undefined ? Number(m.avgMonthlySearches) : null,
  concurrence: COMPETITION[m.competition] || null,
  cpc_bas: m.lowTopOfPageBidMicros ? Number(m.lowTopOfPageBidMicros) / 1e6 : null,
  cpc_haut: m.highTopOfPageBidMicros ? Number(m.highTopOfPageBidMicros) / 1e6 : null,
  mois: (m.monthlySearchVolumes || []).map((v) => ({
    mois: `${v.year}-${String(MONTHS.indexOf(v.month)).padStart(2, '0')}`,
    volume: Number(v.monthlySearches || 0),
  })),
});

const MAX_KEYWORDS = 10;

/**
 * Volumes des mots clés saisis + idées voisines (2 opérations au plus,
 * 0 si la même recherche a été faite il y a moins de 30 jours).
 */
const research = async ({ keywords, geo = 'fr', withIdeas = true }) => {
  const list = [...new Set((Array.isArray(keywords) ? keywords : String(keywords || '').split(/[\n,;]/))
    .map((k) => String(k).trim().toLowerCase().replace(/\s+/g, ' '))
    .filter((k) => k && k.length <= 80))];
  if (!list.length) throw Object.assign(new Error('Saisissez au moins un mot clé'), { status: 400 });
  if (list.length > MAX_KEYWORDS) throw Object.assign(new Error(`${MAX_KEYWORDS} mots clés au plus par recherche`), { status: 400 });
  const opts = { source: 'recherche', geo };

  const hist = await call('generateKeywordHistoricalMetrics', { keywords: list }, opts);
  const volumes = (hist.results || []).map((r) => ({ ...metrics(r.text, r.keywordMetrics), variantes: r.closeVariants || [] }));

  let idees = [];
  let ideasCache = null;
  if (withIdeas) {
    const ideas = await call('generateKeywordIdeas', { keywordSeed: { keywords: list }, pageSize: 200 }, opts);
    ideasCache = ideas._cache || null;
    const seen = new Set(volumes.flatMap((v) => [v.requete, ...v.variantes]));
    idees = (ideas.results || [])
      .map((r) => metrics(r.text, r.keywordIdeaMetrics))
      .filter((r) => !seen.has(r.requete))
      .sort((a, b) => (b.volume || 0) - (a.volume || 0));
  }

  return { volumes, idees, cache: hist._cache || ideasCache || null, usage: await getUsage() };
};

module.exports = { call, research, getUsage, isConfigured, MAX_KEYWORDS };
