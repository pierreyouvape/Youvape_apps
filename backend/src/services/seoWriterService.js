/**
 * Suivi SEO — rédaction de pages (onglet « Rédaction SEO »)
 *
 * Une page = une URL du site qu'on réécrit pour mieux se classer. Pour chacune :
 *   1. relevé de la page en ligne (title, méta, robots, H1, intro, texte du
 *      bas, produits listés, lien de menu masqué) et des fiches produits ;
 *   2. requêtes Search Console du sujet (90 jours) avec la page que Google
 *      affiche, + volumes Google Ads importés (CSV du Planificateur) ;
 *   3. brief complet (méthode + données) et, si une clé d'API Claude est
 *      posée, proposition de texte en HTML prêt à coller ;
 *   4. contrôle de la proposition puis de la page publiée ;
 *   5. suivi des positions des requêtes visées, semaine par semaine, avec les
 *      dates de publication et de modification.
 *
 * La méthode (structure, code du thème, règles DNF) est celle validée sur
 * /etiquette-produit/e-liquides-jnr le 21/10/2026.
 *
 * ⚠️ Litige DNF : tout texte reste une vitrine neutre et passe par l'avocat.
 */

const axios = require('axios');
const pool = require('../config/database');
const { BANNED, QUESTION_RE, HEALTH_RE, MARKETING_RE, extractLinks } = require('./seoAdvisorService');

const SITE = 'https://www.youvape.fr';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const DATA_DAYS = 90;
const MAX_PRODUCTS = 12;
const MAX_TOPIC_QUERIES = 200;
const DEFAULT_TARGETS = 8;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.SEO_WRITER_MODEL || 'claude-opus-5-5';
const STATUSES = new Set(['analyse', 'redaction', 'avocat', 'publie', 'abandon']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const pathOf = (url) => (url || '').replace(/^https?:\/\/(www\.)?youvape\.fr/, '') || '/';
const decode = (s) => (s || '')
  .replace(/&amp;/g, '&').replace(/&#0?39;|&#8217;|&rsquo;/g, '’').replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&laquo;/g, '«').replace(/&raquo;/g, '»');
const textOf = (html) => decode((html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const round1 = (n) => (n === null || n === undefined ? null : Math.round(Number(n) * 10) / 10);

const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY;

/* ─── Tables ───────────────────────────────────────────── */

let tablesReady = false;
const ensureTables = async () => {
  if (tablesReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seo_pages (
      id             serial PRIMARY KEY,
      url            text UNIQUE NOT NULL,
      label          text,
      status         varchar(20) NOT NULL DEFAULT 'analyse',
      published_at   date,
      topic_terms    text,
      target_queries text[],
      page           jsonb,
      data           jsonb,
      analyzed_at    timestamp,
      ads            jsonb,
      ads_filename   text,
      ads_at         timestamp,
      draft          jsonb,
      gen_status     varchar(20),
      gen_error      text,
      gen_at         timestamp,
      live_check     jsonb,
      checked_at     timestamp,
      created_by     text,
      created_at     timestamp NOT NULL DEFAULT now(),
      updated_at     timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS seo_page_events (
      id         serial PRIMARY KEY,
      page_id    integer NOT NULL REFERENCES seo_pages(id) ON DELETE CASCADE,
      at         date NOT NULL,
      note       text NOT NULL,
      created_by text,
      created_at timestamp NOT NULL DEFAULT now()
    );
    ALTER TABLE seo_pages ADD COLUMN IF NOT EXISTS status_by text;
    ALTER TABLE seo_pages ADD COLUMN IF NOT EXISTS status_at timestamp;
  `);
  tablesReady = true;
};

/* ─── Relevé de la page ────────────────────────────────── */

const normalizeUrl = (input) => {
  let u = String(input || '').trim();
  if (!u) throw new Error('Adresse manquante');
  if (u.startsWith('/')) u = SITE + u;
  else if (/^(www\.)?youvape\.fr/i.test(u)) u = `https://${u}`;
  if (!/^https?:\/\//i.test(u)) u = `${SITE}/${u.replace(/^\/+/, '')}`;
  u = u.replace(/^http:\/\//i, 'https://').replace(/^https:\/\/youvape\.fr/i, SITE);
  if (!u.startsWith(SITE)) throw new Error('Seules les pages de www.youvape.fr sont prises en charge');
  return u.split(/[?#]/)[0].replace(/\/$/, '') || SITE;
};

const fetchHtml = async (url) => {
  // Paramètre jetable : on veut la version en ligne, pas celle du cache.
  const res = await axios.get(`${url}?v=${Date.now()}`, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'fr-FR,fr;q=0.9' },
    timeout: 30000,
    maxRedirects: 3,
    validateStatus: () => true,
    responseType: 'text',
    transformResponse: (d) => d,
  });
  return { status: res.status, html: typeof res.data === 'string' ? res.data : '' };
};

const pick = (html, re) => {
  const m = html.match(re);
  return m ? decode(m[1]).replace(/\s+/g, ' ').trim() : null;
};

// Contenu d'un <div> repéré par son ouverture, divs imbriqués compris (FAQ).
const innerDiv = (html, opening) => {
  const start = html.indexOf(opening);
  if (start < 0) return null;
  const from = start + opening.length;
  const re = /<div\b|<\/div>/gi;
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    depth += m[0].toLowerCase() === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(from, m.index).trim();
  }
  return null;
};

const pageTypeOf = (path) => {
  if (path.startsWith('/etiquette-produit/')) return 'étiquette produit';
  if (path.startsWith('/categorie-produit/')) return 'catégorie';
  if (path.startsWith('/marque/')) return 'page marque';
  if (path.startsWith('/produit/')) return 'fiche produit';
  return 'page';
};

const parsePage = (url, status, html) => {
  const path = pathOf(url);
  const h1Pos = html.search(/<h1[\s>]/i);
  const afterH1 = h1Pos >= 0 ? html.slice(h1Pos, h1Pos + 4000) : '';
  // Bannière = image de la médiathèque (pas une icône du thème, ex. close.svg).
  const banner = afterH1.match(/<img[^>]*src="([^"]*\/wp-content\/uploads\/[^"]+)"[^>]*alt="([^"]*)"/i);
  // L'intro (description du terme) s'arrête aux filtres du thème.
  const subtitle = innerDiv(html, '<div class="subtitle">');
  const intro = subtitle ? subtitle.split(/<div\b/i)[0].trim() : null;
  const seoText = innerDiv(html, '<div class="content-category-seo-text">');
  const products = [];
  const itemRe = /"url":\s*"([^"]+)",\s*"name":\s*"([^"]+)"/g;
  let m;
  while ((m = itemRe.exec(html)) && products.length < 60) {
    const u = JSON.parse(`"${m[1]}"`);
    if (!u.includes('/produit/')) continue;
    if (!products.some((p) => p.url === u)) products.push({ url: u, name: JSON.parse(`"${m[2]}"`) });
  }
  // Lien de menu masqué : le thème remplace <a href> par un <span data-obflink-url="base64">,
  // que Google ne suit pas.
  // Comparaison EXACTE sur le chemin décodé : le code de /puff-jnr est le début de
  // celui de /puff-jnr-sans-nicotine (faux « masqué » sur puff-jnr et e-liquides-jnr).
  // Masqué = au moins un lien masqué vers la page et aucun vrai lien <a href>.
  const samePath = (u) => decode(u).replace(/^https?:\/\/(www\.)?youvape\.fr/, '').split(/[?#]/)[0].replace(/\/$/, '') === path;
  const maskedLinks = [...html.matchAll(/data-obflink-url="([^"]+)"/g)]
    .map((x) => { try { return Buffer.from(x[1], 'base64').toString('utf8'); } catch { return ''; } })
    .filter(samePath).length;
  const plainLinks = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/gi)].filter((x) => samePath(x[1])).length;
  const masked = maskedLinks > 0 && plainLinks === 0;
  return {
    url,
    path,
    type: pageTypeOf(path),
    http_status: status,
    title: pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    meta_description: pick(html, /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i),
    robots: pick(html, /<meta\s+name=["']robots["']\s+content=["']([^"']*)["']/i),
    canonical: pick(html, /<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/i),
    h1: pick(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null,
    banner: banner ? { src: banner[1], alt: decode(banner[2]) } : null,
    intro_html: intro || null,
    seo_html: seoText || null,
    h2: seoText ? [...seoText.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((x) => textOf(x[1])) : [],
    has_faq: !!seoText && seoText.includes('faq-container'),
    faq_schema: html.includes('"FAQPage"'),
    products,
    menu_masked: masked,
    word_count: seoText ? textOf(seoText).split(' ').length : 0,
  };
};

// Caractéristiques lues sur une fiche produit : seule source des faits du texte.
const productFacts = async (url) => {
  const { status, html } = await fetchHtml(url);
  if (status !== 200) return { url, error: `HTTP ${status}` };
  const text = textOf(html);
  const title = pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const cut = (from, len) => {
    const i = text.indexOf(from);
    if (i < 0) return null;
    let s = text.slice(i, i + len);
    const stop = s.indexOf('Nos clients ont également');
    if (stop > 0) s = s.slice(0, stop);
    return s.trim();
  };
  return {
    url,
    title,
    caracteristiques: cut('Les Caractéristiques', 900),
    contenu: cut('Contenu du coffret', 220) || cut('Contenu du Coffret', 220),
    points_cles: cut('Les Points Clés', 600),
  };
};

/* ─── Données Search Console ───────────────────────────── */

const dataRange = async () => {
  const r = await pool.query("SELECT MAX(date) AS max FROM gsc_query_daily WHERE country = 'all'");
  if (!r.rows[0].max) return null;
  const to = ymd(new Date(r.rows[0].max));
  return { from: addDays(to, -DATA_DAYS + 1), to };
};

// « jnr + liquid|50ml » : chaque groupe (séparé par +) doit apparaître,
// un mot au choix dans le groupe (séparé par |), sans accents.
const parseTerms = (terms) => String(terms || '')
  .split('+').map((g) => g.split('|').map((w) => norm(w).trim()).filter(Boolean)).filter((g) => g.length);
const matchTerms = (groups, query) => {
  const q = norm(query);
  return groups.every((g) => g.some((w) => q.includes(w)));
};

const GENERIC_WORDS = new Set(['de', 'du', 'la', 'le', 'les', 'des', 'en', 'et', 'a', 'au', 'aux', 'un', 'une', 'pour', 'sur',
  'avec', 'sans', 'nicotine', 'e', 'puff', 'puffs', 'cigarette', 'cigarettes', 'electronique', 'electroniques', 'kit', 'kits', 'pod', 'pods']);
const stem = (t) => (t.includes('liquid') ? 'liquid' : t.replace(/s$/, ''));

// Termes par défaut : les mots du H1 présents dans au moins la moitié des
// impressions des requêtes qui montrent déjà la page.
const defaultTerms = (h1, pageQueries) => {
  const words = [...new Set(norm(h1).split(/[^a-z0-9]+/).filter((w) => w && !GENERIC_WORDS.has(w)).map(stem))];
  if (!words.length) return '';
  const total = pageQueries.reduce((s, q) => s + q.impressions, 0);
  if (!total) return words.slice(0, 2).join(' + ');
  const share = words.map((w) => ({
    w,
    s: pageQueries.filter((q) => norm(q.query).includes(w)).reduce((s, q) => s + q.impressions, 0) / total,
  })).sort((a, b) => b.s - a.s);
  const kept = share.filter((x) => x.s >= 0.5).map((x) => x.w);
  return (kept.length ? kept : [share[0].w]).join(' + ');
};

const loadPageQueries = async (url, range) => {
  const r = await pool.query(
    `SELECT query, SUM(clicks)::int AS clicks, SUM(impressions)::int AS impressions,
            SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
     FROM gsc_search_daily WHERE page = $1 AND date BETWEEN $2 AND $3
     GROUP BY query ORDER BY SUM(impressions) DESC LIMIT 300`,
    [url, range.from, range.to]
  );
  return r.rows.map((x) => ({ ...x, position: round1(x.position) }));
};

// « goût » : très recherché, permis de façon neutre (double goût, nombre de goûts)
// sans jamais décrire un goût — signalé, pas écarté.
// « saveur » aussi (décision du 22/10/2026 : mot générique, pas mélioratif).
const NEUTRAL_OK = new Set(['gout', 'gouts', 'saveur', 'saveurs']);
const cautionOf = (query) => (norm(query).split(/[^a-z0-9]+/).some((w) => NEUTRAL_OK.has(w)) ? 'goût / saveur : usage neutre seulement' : null);

const sensitiveReason = (query) => {
  const q = norm(query);
  const words = q.split(/[^a-z0-9]+/);
  const banned = words.find((w) => BANNED.has(w) && !NEUTRAL_OK.has(w));
  if (banned) return `mot « ${banned} »`;
  if (HEALTH_RE.test(q)) return 'santé';
  return null;
};

const loadTopicQueries = async (url, groups, range) => {
  if (!groups.length) return [];
  const first = groups[0].map((w) => `%${w}%`);
  const r = await pool.query(
    `SELECT query, SUM(clicks)::int AS clicks, SUM(impressions)::int AS impressions,
            SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
     FROM gsc_query_daily
     WHERE country = 'all' AND date BETWEEN $1 AND $2 AND query ILIKE ANY($3)
     GROUP BY query HAVING SUM(impressions) >= 3
     ORDER BY SUM(impressions) DESC LIMIT 4000`,
    [range.from, range.to, first]
  );
  const rows = r.rows.filter((x) => matchTerms(groups, x.query)).slice(0, MAX_TOPIC_QUERIES);
  if (!rows.length) return [];
  // Page que Google affiche pour chaque requête (la plus vue).
  const pages = await pool.query(
    `SELECT DISTINCT ON (query) query, page, SUM(impressions)::int AS impressions
     FROM gsc_search_daily WHERE date BETWEEN $1 AND $2 AND query = ANY($3)
     GROUP BY query, page ORDER BY query, SUM(impressions) DESC`,
    [range.from, range.to, rows.map((x) => x.query)]
  );
  const topPage = new Map(pages.rows.map((p) => [p.query, p.page]));
  return rows.map((x) => {
    const page = topPage.get(x.query) || null;
    return {
      query: x.query,
      clicks: x.clicks,
      impressions: x.impressions,
      per_month: Math.round((x.impressions * 30) / DATA_DAYS),
      position: round1(x.position),
      top_page: page,
      this_page: page === url,
      question: QUESTION_RE.test(norm(x.query)),
      excluded: sensitiveReason(x.query),
      caution: cautionOf(x.query),
    };
  });
};

// Indexabilité des pages liées : relevé des recommandations, et lecture en
// ligne pour les pages qu'il ne couvre pas (étiquettes en noindex surtout).
const robotsCache = new Map();
const ROBOTS_TTL_MS = 30 * 60 * 1000;
const loadIndexability = async (urls, { live = true, onEach } = {}) => {
  if (!urls.length) return new Map();
  const r = await pool.query('SELECT url, robots, http_status FROM seo_page_audit WHERE url = ANY($1)', [urls]);
  const out = new Map(r.rows.map((x) => [x.url, x]));
  if (!live) return out;
  const missing = urls.filter((u) => !out.has(u)).slice(0, 25);
  for (const [i, u] of missing.entries()) {
    if (onEach) onEach(i, missing.length, u);
    const c = robotsCache.get(u);
    if (c && Date.now() - c.at < ROBOTS_TTL_MS) { out.set(u, c.v); continue; }
    try {
      const { status, html } = await fetchHtml(u);
      const v = { url: u, http_status: status, robots: pick(html, /<meta\s+name=["']robots["']\s+content=["']([^"']*)["']/i) };
      robotsCache.set(u, { at: Date.now(), v });
      out.set(u, v);
    } catch { /* inconnue : signalée comme non vérifiée */ }
  }
  return out;
};
const hrefsOf = (html) => [...new Set([...(html || '').matchAll(/href="([^"]+)"/gi)].map((m) => m[1])
  .filter((h) => h.startsWith('/') || /youvape\.fr/.test(h))
  .map((h) => (h.startsWith('/') ? SITE + h : h).split(/[?#]/)[0].replace(/\/$/, '')))];

/* ─── Analyse ──────────────────────────────────────────── */

const getRow = async (id) => {
  const r = await pool.query('SELECT * FROM seo_pages WHERE id = $1', [id]);
  if (!r.rows[0]) throw new Error('Page inconnue');
  return r.rows[0];
};

// Fiches à lire : une par sous-catégorie d'abord (10 ml, 50 ml, sels…), puis
// réparties dans la liste, pour couvrir tous les formats de la page.
const sampleProducts = (products, max) => {
  const picked = [];
  const seen = new Set();
  for (const p of products) {
    const family = pathOf(p.url).split('/').slice(0, -1).join('/');
    if (!seen.has(family)) { seen.add(family); picked.push(p); }
  }
  const step = Math.max(1, Math.floor(products.length / max));
  for (let i = 0; i < products.length && picked.length < max; i += step) {
    if (!picked.includes(products[i])) picked.push(products[i]);
  }
  return picked.slice(0, max);
};

// Avancement des analyses en cours (en mémoire : une analyse dure 10 à 30 s).
// L'écran l'interroge pour afficher l'étape et repérer un blocage.
const progress = new Map();
const ANALYSIS_STEPS = 4;
const VERIFY_STEPS = 4;
const pkey = (id, kind = 'analyze') => `${kind}:${id}`;
const setProgress = (id, step, label, extra = {}, kind = 'analyze') => {
  const k = pkey(id, kind);
  const prev = progress.get(k) || { startedAt: Date.now() };
  progress.set(k, {
    ...prev, running: true, step, steps: kind === 'verify' ? VERIFY_STEPS : ANALYSIS_STEPS, label, done: null, total: null, current: null, ...extra, updatedAt: Date.now(),
  });
};
const getProgress = (id, kind = 'analyze') => {
  const p = progress.get(pkey(id, kind));
  if (!p) return { running: false };
  return { ...p, elapsed: Math.round((Date.now() - p.startedAt) / 1000), idle: Math.round((Date.now() - p.updatedAt) / 1000) };
};

const analyze = async (id) => {
  await ensureTables();
  const row = await getRow(id);
  setProgress(id, 1, 'Lecture de la page en ligne');
  const range = await dataRange();
  if (!range) throw new Error('Aucune donnée Search Console');
  const { status, html } = await fetchHtml(row.url);
  if (status !== 200) throw new Error(`La page répond ${status}`);
  const page = parsePage(row.url, status, html);

  const facts = [];
  const sample = sampleProducts(page.products, MAX_PRODUCTS);
  for (const [i, p] of sample.entries()) {
    setProgress(id, 2, 'Lecture des fiches produits', { done: i, total: sample.length, current: pathOf(p.url) });
    try {
      facts.push(await productFacts(p.url));
    } catch (error) {
      facts.push({ url: p.url, error: error.message });
    }
    await sleep(300);
  }

  setProgress(id, 3, 'Requêtes Search Console (90 jours)');
  const pageQueries = await loadPageQueries(row.url, range);
  const terms = row.topic_terms || defaultTerms(page.h1 || page.title || '', pageQueries);
  const topic = await loadTopicQueries(row.url, parseTerms(terms), range);
  setProgress(id, 4, 'Pages concurrentes et enregistrement');

  // Pages qui captent les requêtes du sujet : candidates pour un lien vers la page.
  const byPage = new Map();
  for (const q of topic) {
    if (!q.top_page || q.top_page === row.url) continue;
    const e = byPage.get(q.top_page) || { url: q.top_page, impressions: 0, queries: [] };
    e.impressions += q.impressions;
    if (e.queries.length < 5) e.queries.push(q.query);
    byPage.set(q.top_page, e);
  }
  const competitors = [...byPage.values()].sort((a, b) => b.impressions - a.impressions).slice(0, 10);
  const idx = await loadIndexability(competitors.map((c) => c.url), {
    onEach: (i, n, u) => setProgress(id, 4, 'Indexation des pages concurrentes', { done: i, total: n, current: pathOf(u) }),
  });
  for (const c of competitors) {
    const a = idx.get(c.url);
    c.robots = a?.robots || null;
  }

  // Liens du texte actuel, avec leur indexabilité : une étiquette en noindex
  // ne doit pas recevoir de lien (le brief la signale).
  const currentLinks = hrefsOf(`${page.intro_html || ''}${page.seo_html || ''}`);
  const linkIdx = await loadIndexability(currentLinks, {
    onEach: (i, n, u) => setProgress(id, 4, 'Indexation des pages liées par le texte actuel', { done: i, total: n, current: pathOf(u) }),
  });
  const links = currentLinks.map((u) => ({ url: u, robots: linkIdx.get(u)?.robots || null }));

  const targets = row.target_queries?.length
    ? row.target_queries
    : topic.filter((q) => !q.excluded).slice(0, DEFAULT_TARGETS).map((q) => q.query);

  const data = { range, page_queries: pageQueries.slice(0, 60), topic, competitors, facts, links };
  const r = await pool.query(
    `UPDATE seo_pages SET page = $2, data = $3, topic_terms = $4, target_queries = $5, analyzed_at = now(), updated_at = now(),
       label = COALESCE(label, $6)
     WHERE id = $1 RETURNING *`,
    [id, JSON.stringify(page), JSON.stringify(data), terms, targets, page.h1 || page.title]
  );
  return r.rows[0];
};

/* ─── Google Ads (CSV du Planificateur de mots-clés) ───── */

const parseAdsCsv = (buffer) => {
  let text;
  if (buffer[0] === 0xff && buffer[1] === 0xfe) text = buffer.slice(2).toString('utf16le');
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) throw new Error('Encodage UTF-16 BE non pris en charge');
  else text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /^(keyword|mot cl[ée])\t/i.test(l.trim()));
  if (headerIdx < 0) throw new Error('Colonne « Keyword » introuvable : est-ce bien un export du Planificateur de mots-clés ?');
  const header = lines[headerIdx].split('\t').map((h) => h.trim().toLowerCase());
  const col = (re) => header.findIndex((h) => re.test(h));
  const iKw = 0;
  const iVol = col(/avg\. monthly searches|nombre moyen de recherches/);
  const iComp = col(/^competition$|^concurrence$/);
  if (iVol < 0) throw new Error('Colonne des recherches mensuelles introuvable');
  const rows = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const cells = line.split('\t');
    const keyword = (cells[iKw] || '').trim().toLowerCase();
    if (!keyword) continue;
    const vol = parseInt(String(cells[iVol] || '').replace(/[\s\u202f]/g, ''), 10);
    rows.push({ keyword, volume: Number.isFinite(vol) ? vol : null, competition: iComp >= 0 ? (cells[iComp] || '').trim() || null : null });
  }
  if (!rows.length) throw new Error('Aucun mot-clé dans le fichier');
  return rows;
};

const saveAds = async (id, buffer, filename) => {
  await ensureTables();
  const row = await getRow(id);
  const fresh = parseAdsCsv(buffer);
  // Plusieurs exports s'additionnent : le dernier fait foi pour un même mot-clé.
  const byKw = new Map((row.ads || []).map((a) => [a.keyword, a]));
  for (const a of fresh) byKw.set(a.keyword, a);
  const ads = [...byKw.values()].sort((a, b) => (b.volume || 0) - (a.volume || 0));
  await pool.query('UPDATE seo_pages SET ads = $2, ads_filename = $3, ads_at = now(), updated_at = now() WHERE id = $1',
    [id, JSON.stringify(ads), filename || null]);
  return { added: fresh.length, total: ads.length };
};

// Volumes Ads croisés avec la Search Console : présent, absent, à quelle place.
const adsWithGsc = async (ads, range) => {
  if (!ads?.length || !range) return [];
  const r = await pool.query(
    `SELECT query, SUM(clicks)::int AS clicks, SUM(impressions)::int AS impressions,
            SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
     FROM gsc_query_daily WHERE country = 'all' AND date BETWEEN $1 AND $2 AND query = ANY($3)
     GROUP BY query`,
    [range.from, range.to, ads.map((a) => a.keyword)]
  );
  const g = new Map(r.rows.map((x) => [x.query, x]));
  return ads.map((a) => {
    const x = g.get(a.keyword);
    return {
      ...a,
      gsc_per_month: x ? Math.round((x.impressions * 30) / DATA_DAYS) : 0,
      position: x ? round1(x.position) : null,
      excluded: sensitiveReason(a.keyword),
    };
  });
};

/* ─── Méthode de rédaction et brief ────────────────────── */

const THEME_TABLE = `<table style="width: 100%;border-color: #135e84;border-style: solid;border-radius: 8px" border="2" width="100%" cellspacing="0" cellpadding="2">
<tbody>
<tr>
<td style="width: 25%;border-color: #135e84;border-radius: 6px 0 0 0;background-color: #ffffff;text-align: left !important;padding: 12px;color: #000000"><strong>Référence</strong></td>
<td style="width: 25%;border-color: #135e84;background-color: #005870;text-align: center !important;padding: 12px;color: #ffffff"><strong>Colonne</strong></td>
<td style="width: 25%;border-color: #135e84;background-color: #005870;text-align: center !important;padding: 12px;color: #ffffff"><strong>Colonne</strong></td>
<td style="width: 25%;border-color: #135e84;border-radius: 0 6px 0 0;background-color: #005870;text-align: center !important;padding: 12px;color: #ffffff"><strong>Colonne</strong></td>
</tr>
<tr>
<td style="width: 25%;vertical-align: middle;border-color: #135e84;background-color: #d98600;padding: 8px;color: #ffffff;text-align: left !important;letter-spacing: normal !important"><strong><a style="color: #ffffff;text-decoration: underline;text-align: left !important;letter-spacing: normal !important" href="/produit/...">Nom</a></strong></td>
<td style="width: 25%;vertical-align: middle;border-color: #135e84;background-color: #f2f2f2;padding: 8px;text-align: center !important;color: #000000">Valeur</td>
<td style="width: 25%;vertical-align: middle;border-color: #135e84;background-color: #f2f2f2;padding: 8px;text-align: center !important;color: #000000">Valeur</td>
<td style="width: 25%;vertical-align: middle;border-color: #135e84;background-color: #f2f2f2;padding: 8px;text-align: center !important;color: #000000">Valeur</td>
</tr>
</tbody>
</table>`;

const THEME_FAQ = `<div class="faq-container">
<div class="faq-block" id="faq-block-id">
    <h2 class="faq-question">Question ?</h2>
    <div class="faq-answer">
<p>Réponse.</p>
</div>
</div>
</div>`;

const WRITING_RULES = `Tu rédiges le texte SEO d'une page de youvape.fr (boutique française de cigarettes électroniques, WordPress/WooCommerce, Yoast).
Objectif : faire monter la page dans le top 3 Google sur les requêtes de son sujet, sans cannibaliser les autres pages du site.

MÉTHODE
1. Pars des données fournies : requêtes Search Console (impressions, position, page que Google affiche), questions des internautes, volumes Google Ads. Repère les requêtes que la page doit porter et celles qu'il faut laisser à une autre page (une fiche déjà dans le top 3 sur sa requête garde sa requête : on lui envoie seulement un lien).
2. N'utilise QUE les faits présents dans les caractéristiques des fiches produits fournies (contenance, taux de nicotine, ratio PG/VG, batterie, contenu du coffret, compatibilités). N'invente rien. Si un fait te manque, ne l'écris pas et signale-le dans "points_a_verifier". Ne mentionne pas le pays d'origine.
3. Reprends naturellement les requêtes visées dans le title, les H2, le gras et les questions de la FAQ (variantes d'écriture comprises : « e-liquide », « eliquide », « liquide »), sans bourrage.

LIVRABLE
- title Yoast : garde le terme du H1 et ajoute formats ou requête principale ; 70 caractères maximum.
- méta-description : 160 caractères maximum, factuelle.
- H1 : en général on garde celui en place.
- intro (champ « Description » du terme) : 2 à 3 phrases factuelles, en <p>.
- bas de page (bloc affiché dans content-category-seo-text), dans cet ordre : l'image bannière de la page reprise en tête dans un <p><img …></p> (l'équipe la veut en double) ; un H2 de présentation avec un tableau ; des sections H2 qui reprennent les requêtes, chacune avec ses liens ; une FAQ de 4 à 7 questions ; la phrase « Produits réservés aux adultes. Si vous ne fumez pas, ne vapotez pas. » si elle existait déjà.
- Le texte est complet, prêt à coller : jamais un morceau à insérer.
- liens à ajouter AILLEURS vers la page : depuis la page qui capte aujourd'hui la requête principale, et depuis la page marque ; ancre = requête visée.

CODE DU THÈME (obligatoire)
- Liens RELATIFS uniquement (href="/etiquette-produit/…"), jamais https://www.youvape.fr dans un href. Seule l'URL de l'image reste absolue.
- Tableau : reprendre exactement ce style (largeurs égales : 25 % × 4, 33/33/34 % × 3 ou 50 % × 2 ; première colonne orange avec lien blanc souligné) :
${THEME_TABLE}
- FAQ : reprendre exactement ce code (id répété tel quel, comme le thème) :
${THEME_FAQ}

RÈGLES DE FOND (litige en cours avec la DNF sur la publicité pour le vapotage : impératives)
- Rédaction neutre et factuelle : caractéristiques, compatibilités, mode d'emploi, conservation.
- JAMAIS : arôme décrit, fruit, fraîcheur, « ice », noms de recettes, prix, promo, « pas cher », gratuit, offert, avis, meilleur, superlatifs et adjectifs marketing, santé, danger, sevrage, comparaison avec le tabac. Écarte les requêtes qui contiennent ces mots.
- Les mots « goût » et « saveur » sont génériques et très recherchés (« gout jnr », « double gout », « puff 4 saveurs ») : ils sont permis, mais SEULEMENT de façon neutre — « double goût », « 4 saveurs » pour un modèle à plusieurs cartouches, nombre de goûts disponibles tiré des fiches, renvoi à la liste de la fiche. Ne jamais décrire un goût ni une saveur (fruit, fraîcheur, recette). Signale chaque emploi dans "points_a_verifier" pour l'avocat.
- Cartouche : n'écris « cartouche remplaçable » que pour les modèles dont la fiche le dit, et précise lesquels fonctionnent avec un réservoir. N'écris jamais « interchangeable » pour une cartouche (les cartouches ne passent pas d'un modèle à l'autre).
- Les puffs jetables sont interdites en France : décris les produits comme rechargeables à cartouche ou réservoir quand c'est le cas, et ne cible jamais un modèle jetable ou non vendu.
- JAMAIS de lien vers une page en noindex, même « pour la navigation » : une étiquette en noindex reste sans lien (le thème la masque, c'est voulu ; elle n'a pas de demande de recherche). Si une seule fiche produit la remplace, lier la fiche ; sinon citer les produits sans lien. Les pages marquées NOINDEX dans le brief ne doivent figurer dans aucun href.`;

const RESPONSE_FORMAT = `Réponds UNIQUEMENT par un objet JSON valide (sans texte autour, sans bloc de code), de cette forme :
{
  "analyse": "constat en français, 5 à 10 lignes : quelle page Google affiche aujourd'hui, requêtes visées, requêtes laissées à d'autres pages et pourquoi, requêtes écartées",
  "indexation": { "decision": "index" | "noindex" | "inchangé", "raison": "…" },
  "title": "…",
  "meta": "…",
  "h1": "…",
  "intro_html": "<p>…</p>",
  "body_html": "… bas de page complet …",
  "liens_a_ajouter": [ { "depuis": "/chemin-de-la-page-source", "ancre": "…", "html": "phrase complète avec le lien <a href=\\"/…\\">…</a>" } ],
  "requetes_visees": ["…"],
  "requetes_ecartees": [ { "requete": "…", "raison": "…" } ],
  "points_a_verifier": ["…"]
}`;

const mdTable = (head, rows) => [
  `| ${head.join(' | ')} |`,
  `| ${head.map(() => '---').join(' | ')} |`,
  ...rows.map((r) => `| ${r.map((c) => String(c ?? '—').replace(/\|/g, '/')).join(' | ')} |`),
].join('\n');

const buildBrief = async (row) => {
  if (!row.page || !row.data) throw new Error('Lancez d’abord l’analyse de la page');
  const p = row.page;
  const d = row.data;
  const ads = await adsWithGsc(row.ads, d.range);
  const parts = [];
  parts.push(`# Brief SEO — ${p.path}`);
  parts.push(`Type : ${p.type}. Données Search Console du ${d.range.from} au ${d.range.to} (${DATA_DAYS} jours, tous pays).`);
  parts.push(`## Page actuelle
- URL : ${p.url}
- Robots : ${p.robots || '—'}${p.menu_masked ? ' · lien de menu vers la page MASQUÉ (span obfusqué, non suivi par Google)' : ''}
- Title : ${p.title || '—'}
- Méta : ${p.meta_description || '—'}
- H1 : ${p.h1 || '—'}
- Image bannière : ${p.banner ? `${p.banner.src} (alt « ${p.banner.alt} »)` : 'aucune'}
- Intro actuelle : ${p.intro_html ? textOf(p.intro_html) : 'vide'}
- FAQ : ${p.has_faq ? 'oui' : 'non'} · ${p.word_count} mots dans le bas de page
- Produits listés (${p.products.length}) : ${p.products.map((x) => `${x.name} (${pathOf(x.url)})`).join(' ; ') || 'aucun'}

Texte actuel du bas de page (HTML) :
${p.seo_html ? p.seo_html.slice(0, 12000) : '(vide)'}`);
  parts.push(`## Requêtes du sujet (termes : ${row.topic_terms})
${mdTable(['Requête', 'Impr. 90 j', 'Clics', 'Pos.', 'Page affichée', 'Question', 'Écartée'],
    d.topic.slice(0, 120).map((q) => [q.query, q.impressions, q.clicks, q.position, q.this_page ? 'CETTE PAGE' : pathOf(q.top_page), q.question ? 'oui' : '', q.excluded || cautionOf(q.query) || '']))}`);
  parts.push(`## Requêtes où la page apparaît déjà
${mdTable(['Requête', 'Impr. 90 j', 'Clics', 'Pos.'], d.page_queries.slice(0, 40).map((q) => [q.query, q.impressions, q.clicks, q.position]))}`);
  if (d.links?.length) {
    parts.push(`## Liens du texte actuel
${mdTable(['Page liée', 'Robots'], d.links.map((l) => [pathOf(l.url), /noindex/.test(l.robots || '') ? 'NOINDEX : ne pas lier' : (l.robots || 'inconnu')]))}`);
  }
  parts.push(`## Pages du site qui captent ces requêtes (sources possibles de liens)
${mdTable(['Page', 'Impr.', 'Robots', 'Requêtes'], d.competitors.map((c) => [pathOf(c.url), c.impressions, c.robots || 'inconnu', c.queries.join(', ')]))}`);
  parts.push(ads.length
    ? `## Google Ads (Planificateur, recherches mensuelles ; paliers arrondis sans campagne active)
${mdTable(['Mot-clé', 'Rech./mois', 'Impr. GSC/mois', 'Pos. GSC', 'Écarté'], ads.slice(0, 120).map((a) => [a.keyword, a.volume, a.gsc_per_month || 'absent', a.position, a.excluded || '']))}`
    : '## Google Ads\nAucun export importé.');
  parts.push(`## Caractéristiques des fiches produits (seule source des faits)
${d.facts.map((f) => `### ${f.title || pathOf(f.url)} — ${pathOf(f.url)}
${f.error ? `(non lue : ${f.error})` : [f.points_cles, f.caracteristiques, f.contenu].filter(Boolean).join('\n')}`).join('\n\n') || 'Aucune fiche.'}`);
  if (row.target_queries?.length) parts.push(`## Requêtes que l'équipe veut suivre\n${row.target_queries.join(', ')}`);
  return parts.join('\n\n');
};

const getBrief = async (id) => {
  const row = await getRow(id);
  const brief = await buildBrief(row);
  return { text: `${WRITING_RULES}\n\n${RESPONSE_FORMAT}\n\n---\n\n${brief}` };
};

/* ─── Contrôle d'une proposition ───────────────────────── */

const HREF_RE = /href="([^"]+)"/gi;

const lintDraft = async (draft, page) => {
  if (!draft) return [];
  const out = [];
  const add = (level, text) => out.push({ level, text });
  const html = [draft.intro_html, draft.body_html].filter(Boolean).join('\n');
  const plain = norm(textOf(`${draft.title || ''} ${draft.meta || ''} ${html}`));
  if (draft.title && draft.title.length > 70) add('warn', `Title de ${draft.title.length} caractères (70 maximum conseillés).`);
  if (draft.meta && draft.meta.length > 160) add('warn', `Méta de ${draft.meta.length} caractères (160 maximum conseillés).`);
  const words = new Set(plain.split(/[^a-z0-9]+/));
  const banned = [...BANNED].filter((w) => words.has(w) && !NEUTRAL_OK.has(w));
  if (banned.length) add('error', `Mots interdits (DNF) : ${banned.join(', ')}.`);
  if ([...NEUTRAL_OK].some((w) => words.has(w))) add('warn', '« goût » ou « saveur » employé : vérifier qu’il reste neutre (double goût, 4 saveurs, nombre de goûts) et le faire valider par l’avocat.');
  if (/\binterchangeables?\b/.test(plain)) add('warn', '« interchangeable » : les cartouches ne passent pas d’un modèle à l’autre, préférer « remplaçable » et seulement si la fiche le dit.');
  if (HEALTH_RE.test(plain)) add('error', 'Vocabulaire santé détecté.');
  const mk = plain.match(new RegExp(MARKETING_RE.source, 'gi'));
  if (mk) add('warn', `Vocabulaire marketing : ${[...new Set(mk)].join(', ')}.`);
  if (/\b(ice|fraich|fruit)/.test(plain)) add('error', 'Description de goût (ice, fraîcheur, fruit).');
  const hrefs = [...html.matchAll(HREF_RE)].map((m) => m[1]);
  const absolute = hrefs.filter((h) => /youvape\.fr/.test(h));
  if (absolute.length) add('error', `${absolute.length} lien(s) absolu(s) : mettre des liens relatifs (${absolute.slice(0, 3).join(', ')}).`);
  const internal = [...new Set(hrefs.filter((h) => h.startsWith('/')).map((h) => SITE + h.split(/[?#]/)[0].replace(/\/$/, '')))];
  const idx = await loadIndexability(internal);
  const noindex = internal.filter((u) => /noindex/.test(idx.get(u)?.robots || ''));
  if (noindex.length) add('error', `Lien(s) vers une page en noindex : ${noindex.map(pathOf).join(', ')}. Une étiquette en noindex reste sans lien (masquée par le thème) : retirer le lien, ou lier la fiche produit qui la remplace.`);
  const unknown = internal.filter((u) => !idx.has(u));
  if (unknown.length) add('info', `Indexabilité non vérifiée (pages hors relevé) : ${unknown.map(pathOf).slice(0, 8).join(', ')}.`);
  if (html.includes('faq-question') && !html.includes('faq-container')) add('error', 'FAQ sans <div class="faq-container">.');
  if (/faq/i.test(html) && !html.includes('faq-question')) add('warn', 'FAQ sans le code du thème (faq-question).');
  if (page?.seo_html?.includes('réservés aux adultes') && !html.includes('réservés aux adultes')) add('warn', 'La mention « Produits réservés aux adultes » de l’ancien texte a disparu.');
  if (page?.banner && draft.body_html && !draft.body_html.includes(page.banner.src.split('/').pop().replace(/-\d+x\d+(?=\.)/, ''))) {
    add('info', 'L’image bannière n’est pas reprise en tête du bas de page.');
  }
  if (!out.some((x) => x.level === 'error')) add('ok', 'Aucun mot interdit, aucun lien absolu ni vers une page en noindex.');
  return out;
};

/* ─── Génération (API Claude) ──────────────────────────── */

const parseJsonReply = (text) => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Réponse sans JSON');
  return JSON.parse(text.slice(start, end + 1));
};

const runGeneration = async (id) => {
  try {
    const row = await getRow(id);
    const brief = await buildBrief(row);
    const res = await axios.post(ANTHROPIC_URL, {
      model: MODEL,
      max_tokens: 16000,
      system: WRITING_RULES,
      messages: [{ role: 'user', content: `${brief}\n\n${RESPONSE_FORMAT}` }],
    }, {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 600000,
    });
    const text = (res.data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    const j = parseJsonReply(text);
    const draft = {
      analyse: j.analyse || '',
      indexation: j.indexation || null,
      title: j.title || '',
      meta: j.meta || '',
      h1: j.h1 || '',
      intro_html: j.intro_html || '',
      body_html: j.body_html || '',
      liens_a_ajouter: Array.isArray(j.liens_a_ajouter) ? j.liens_a_ajouter : [],
      requetes_visees: Array.isArray(j.requetes_visees) ? j.requetes_visees : [],
      requetes_ecartees: Array.isArray(j.requetes_ecartees) ? j.requetes_ecartees : [],
      points_a_verifier: Array.isArray(j.points_a_verifier) ? j.points_a_verifier : [],
      model: MODEL,
      generated_at: new Date().toISOString(),
      source: 'api',
    };
    await pool.query(
      `UPDATE seo_pages SET draft = $2, gen_status = 'done', gen_error = NULL, gen_at = now(), updated_at = now(),
         status = CASE WHEN status = 'analyse' THEN 'redaction' ELSE status END
       WHERE id = $1`,
      [id, JSON.stringify(draft)]
    );
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message;
    console.error('[SEO rédaction]', msg);
    await pool.query("UPDATE seo_pages SET gen_status = 'error', gen_error = $2, gen_at = now() WHERE id = $1", [id, msg]);
  }
};

const startGeneration = async (id) => {
  await ensureTables();
  if (!aiConfigured()) throw new Error('Clé d’API Claude absente du serveur : utilisez « Copier le brief »');
  const row = await getRow(id);
  if (!row.data) throw new Error('Lancez d’abord l’analyse de la page');
  if (row.gen_status === 'running') return { started: false, running: true };
  await pool.query("UPDATE seo_pages SET gen_status = 'running', gen_error = NULL, gen_at = now() WHERE id = $1", [id]);
  runGeneration(id);
  return { started: true };
};

/* ─── Vérification de la page publiée ──────────────────── */

const sameText = (a, b) => norm(a).replace(/\s+/g, ' ').trim() === norm(b).replace(/\s+/g, ' ').trim();

const verifyLive = async (id) => {
  await ensureTables();
  const row = await getRow(id);
  setProgress(id, 1, 'Lecture de la page publiée', {}, 'verify');
  const { status, html } = await fetchHtml(row.url);
  const page = parsePage(row.url, status, html);
  const draft = row.draft || {};
  const checks = [];
  const add = (ok, label, detail) => checks.push({ ok, label, detail: detail || null });
  add(status === 200, 'La page répond', `HTTP ${status}`);
  add(/(^|,\s*)index/.test(page.robots || '') && !/noindex/.test(page.robots || ''), 'Indexable (robots)', page.robots || 'aucune balise');
  add(!!page.canonical && page.canonical.replace(/\/$/, '') === row.url, 'Canonical vers la page', page.canonical || 'absent');
  if (draft.title) add(sameText(page.title, draft.title), 'Title publié = proposé', page.title);
  if (draft.meta) add(sameText(page.meta_description, draft.meta), 'Méta publiée = proposée', page.meta_description);
  add(!!page.intro_html, 'Intro renseignée', page.intro_html ? textOf(page.intro_html).slice(0, 140) : 'vide');
  add(!!page.seo_html, 'Texte du bas de page présent', `${page.word_count} mots, ${page.h2.length} H2`);
  const seoPlain = norm(textOf(page.seo_html || ''));
  const words = new Set(seoPlain.split(/[^a-z0-9]+/));
  const banned = [...BANNED].filter((w) => words.has(w) && !NEUTRAL_OK.has(w));
  add(!banned.length, 'Aucun mot interdit (DNF)', banned.length ? banned.join(', ') : null);
  const hrefs = [...(page.seo_html || '').matchAll(HREF_RE)].map((m) => m[1]);
  const absolute = hrefs.filter((h) => /youvape\.fr/.test(h));
  add(!absolute.length, 'Liens relatifs', absolute.length ? `${absolute.length} lien(s) absolu(s)` : `${hrefs.length} lien(s)`);
  setProgress(id, 2, 'Indexation des pages liées', {}, 'verify');
  const liveIdx = await loadIndexability(hrefsOf(page.seo_html || ''), {
    onEach: (i, n, u) => setProgress(id, 2, 'Indexation des pages liées', { done: i, total: n, current: pathOf(u) }, 'verify'),
  });
  const toNoindex = [...liveIdx.values()].filter((x) => /noindex/.test(x.robots || '')).map((x) => pathOf(x.url));
  add(!toNoindex.length, 'Aucun lien vers une page en noindex', toNoindex.length ? toNoindex.join(', ') : null);
  add(!page.menu_masked, 'Lien du menu vers la page non masqué', page.menu_masked ? 'span data-obflink-url : Google ne le suit pas' : null);
  // Liens attendus depuis d'autres pages.
  const sources = (draft.liens_a_ajouter || []).filter((l) => l.depuis);
  for (const [i, l] of sources.entries()) {
    setProgress(id, 3, 'Liens attendus depuis les autres pages', { done: i, total: sources.length, current: l.depuis }, 'verify');
    try {
      const srcUrl = normalizeUrl(l.depuis);
      const src = await fetchHtml(srcUrl);
      const links = extractLinks(src.html).filter((x) => x.href === row.url);
      add(links.length > 0, `Lien depuis ${pathOf(srcUrl)}`, links.length ? `ancre « ${links.map((x) => x.text).filter(Boolean).join(' », « ') || '(vide)'} »` : 'introuvable dans le contenu');
    } catch (error) {
      add(false, `Lien depuis ${l.depuis}`, error.message);
    }
  }
  setProgress(id, 4, 'Enregistrement', {}, 'verify');
  const result = { checks, page: { title: page.title, robots: page.robots, h2: page.h2 } };
  await pool.query('UPDATE seo_pages SET live_check = $2, checked_at = now(), updated_at = now() WHERE id = $1', [id, JSON.stringify(result)]);
  return result;
};

/* ─── Suivi des positions ──────────────────────────────── */

const weekBuckets = (to, weeks) => {
  const out = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const end = addDays(to, -7 * i);
    out.push({ start: addDays(end, -6), end });
  }
  return out;
};

const getPositions = async (id, { weeks = 26 } = {}) => {
  await ensureTables();
  const row = await getRow(id);
  const n = Math.min(Math.max(parseInt(weeks, 10) || 26, 4), 70);
  const r = await pool.query("SELECT MAX(date) AS max FROM gsc_query_daily WHERE country = 'all'");
  if (!r.rows[0].max) return { weeks: [], queries: [], page: [], events: [] };
  const to = ymd(new Date(r.rows[0].max));
  const buckets = weekBuckets(to, n);
  const from = buckets[0].start;
  const queries = row.target_queries || [];
  const [q, pg, ev] = await Promise.all([
    queries.length ? pool.query(
      `SELECT query, date::text AS date, clicks, impressions, position
       FROM gsc_query_daily WHERE country = 'all' AND date BETWEEN $1 AND $2 AND query = ANY($3)`,
      [from, to, queries]
    ) : { rows: [] },
    pool.query(
      `SELECT date::text AS date, SUM(clicks)::int AS clicks, SUM(impressions)::int AS impressions,
              SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
       FROM gsc_search_daily WHERE page = $1 AND date BETWEEN $2 AND $3 GROUP BY date`,
      [row.url, from, to]
    ),
    pool.query('SELECT id, at::text AS at, note, created_by FROM seo_page_events WHERE page_id = $1 ORDER BY at, id', [id]),
  ]);
  const agg = (rows, b) => {
    const inB = rows.filter((x) => x.date >= b.start && x.date <= b.end);
    const impr = inB.reduce((s, x) => s + Number(x.impressions), 0);
    const clicks = inB.reduce((s, x) => s + Number(x.clicks), 0);
    const pos = impr ? inB.reduce((s, x) => s + Number(x.position) * Number(x.impressions), 0) / impr : null;
    return { clicks, impressions: impr, position: round1(pos) };
  };
  return {
    dataTo: to,
    weeks: buckets.map((b) => b.end),
    queries: queries.map((query) => ({
      query,
      series: buckets.map((b) => ({ week: b.end, ...agg(q.rows.filter((x) => x.query === query), b) })),
    })),
    page: buckets.map((b) => ({ week: b.end, ...agg(pg.rows, b) })),
    events: ev.rows,
    published_at: row.published_at ? ymd(new Date(row.published_at)) : null,
  };
};

/* ─── Liste et fiche ───────────────────────────────────── */

// Nom affiché d'un compte de l'app (repli : l'adresse).
const userNames = async (emails) => {
  const list = [...new Set(emails.filter(Boolean))];
  if (!list.length) return new Map();
  const r = await pool.query('SELECT email, name FROM users WHERE email = ANY($1)', [list]);
  return new Map(r.rows.map((x) => [x.email, x.name || x.email]));
};
const nameOf = (names, email) => (email ? names.get(email) || email : null);

// Mots de départ à saisir dans le Planificateur de mots-clés (10 au plus) :
// les requêtes cochées « Suivre » (choix de l'équipe) ; à défaut, les requêtes
// du sujet les plus vues. Une seule par formulation.
const GENERIC_STOP = new Set(['de', 'du', 'la', 'le', 'les', 'des', 'avec', 'pour', 'a', 'en', 'et', 'un', 'une']);
const adsSeeds = (topic, targets = []) => {
  const seen = new Set();
  const out = [];
  const byQuery = new Map((topic || []).map((q) => [q.query, q]));
  const list = targets.length ? targets.map((t) => byQuery.get(t) || { query: t }) : topic || [];
  for (const q of list) {
    if (q.excluded || q.question) continue;
    // Même formulation : pluriel, « 4in1 / 4 in 1 / 4 en 1 », e-liquide / eliquide, mots vides.
    const key = norm(q.query)
      .replace(/\be[\s-]?liquides?\b|\beliquides?\b/g, 'liquide')
      .replace(/\b(\d+)\s*(?:in|en)\s*1\b/g, '$1en1')
      .split(/[^a-z0-9]+/).filter((w) => w && !GENERIC_STOP.has(w)).map((w) => w.replace(/s$/, ''))
      .sort().join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q.query);
    if (out.length >= 10) break;
  }
  return out;
};

// Position d'une requête sur une fenêtre de jours (pondérée par les impressions).
const windowStats = async (queries, from, to) => {
  if (!queries.length) return new Map();
  const r = await pool.query(
    `SELECT query, SUM(clicks)::int AS clicks, SUM(impressions)::int AS impressions,
            SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
     FROM gsc_query_daily WHERE country = 'all' AND date BETWEEN $1 AND $2 AND query = ANY($3) GROUP BY query`,
    [from, to, queries]
  );
  return new Map(r.rows.map((x) => [x.query, { ...x, position: round1(x.position) }]));
};

const listPages = async () => {
  await ensureTables();
  const [rows, range] = await Promise.all([
    pool.query(`SELECT id, url, label, status, status_by, status_at, published_at::text AS published_at, target_queries, analyzed_at, gen_status,
                       checked_at, updated_at, (draft IS NOT NULL) AS has_draft, jsonb_array_length(COALESCE(ads, '[]'::jsonb)) AS ads_count
                FROM seo_pages ORDER BY updated_at DESC`),
    dataRange(),
  ]);
  if (!range) return { aiConfigured: aiConfigured(), pages: rows.rows };
  const to = range.to;
  const mains = [...new Set(rows.rows.map((p) => p.target_queries?.[0]).filter(Boolean))];
  const now = await windowStats(mains, addDays(to, -13), to);
  const urls = rows.rows.map((p) => p.url);
  const clicks = await pool.query(
    `SELECT page, SUM(clicks) FILTER (WHERE date > $2::date - 28)::int AS c28,
            SUM(clicks) FILTER (WHERE date <= $2::date - 28)::int AS cprev
     FROM gsc_search_daily WHERE page = ANY($1) AND date > $2::date - 56 AND date <= $2::date GROUP BY page`,
    [urls, to]
  );
  const cl = new Map(clicks.rows.map((x) => [x.page, x]));
  const names = await userNames(rows.rows.map((p) => p.status_by));
  const pages = [];
  for (const p of rows.rows) {
    const main = p.target_queries?.[0] || null;
    let before = null;
    if (main && p.published_at) {
      const b = await windowStats([main], addDays(p.published_at, -14), addDays(p.published_at, -1));
      before = b.get(main)?.position ?? null;
    }
    pages.push({
      ...p,
      status_by_name: nameOf(names, p.status_by),
      analyzing: !!progress.get(pkey(p.id))?.running,
      main_query: main,
      position_before: before,
      position_now: main ? now.get(main)?.position ?? null : null,
      clicks_28: cl.get(p.url)?.c28 || 0,
      clicks_prev_28: cl.get(p.url)?.cprev || 0,
    });
  }
  return { aiConfigured: aiConfigured(), dataTo: to, pages };
};

const getPage = async (id) => {
  await ensureTables();
  const row = await getRow(id);
  const range = row.data?.range || await dataRange();
  const [ads, lint, events] = await Promise.all([
    adsWithGsc(row.ads, range),
    lintDraft(row.draft, row.page),
    pool.query('SELECT id, at::text AS at, note, created_by FROM seo_page_events WHERE page_id = $1 ORDER BY at DESC, id DESC', [id]),
  ]);
  const names = await userNames([row.status_by, row.created_by, row.draft?.edited_by, ...events.rows.map((e) => e.created_by)]);
  return {
    ...row,
    published_at: row.published_at ? ymd(new Date(row.published_at)) : null,
    status_by_name: nameOf(names, row.status_by),
    created_by_name: nameOf(names, row.created_by),
    draft_edited_by_name: nameOf(names, row.draft?.edited_by),
    ads_view: ads,
    ads_seeds: adsSeeds(row.data?.topic, row.target_queries || []),
    ads_seeds_from: row.target_queries?.length ? 'suivies' : 'sujet',
    lint,
    events: events.rows.map((e) => ({ ...e, created_by_name: nameOf(names, e.created_by) })),
    progress: getProgress(id),
    verify_progress: getProgress(id, 'verify'),
    aiConfigured: aiConfigured(),
    model: MODEL,
  };
};

// Analyse en tâche de fond : l'écran suit l'avancement (getProgress).
const startAnalyze = async (id) => {
  await ensureTables();
  await getRow(id);
  return runJob(id, 'analyze', ANALYSIS_STEPS, () => analyze(id));
};

// Tâche de fond suivie par l'écran (une seule à la fois par page et par type).
const runJob = (id, kind, steps, fn) => {
  const k = pkey(id, kind);
  if (progress.get(k)?.running) return getProgress(id, kind);
  progress.set(k, { startedAt: Date.now(), updatedAt: Date.now(), running: true, step: 0, steps, label: 'Démarrage' });
  fn()
    .then(() => progress.set(k, { ...progress.get(k), running: false, finished: true, updatedAt: Date.now() }))
    .catch((error) => {
      console.error(`[SEO rédaction] ${kind}`, id, error.message);
      progress.set(k, { ...progress.get(k), running: false, error: error.message, updatedAt: Date.now() });
    });
  return getProgress(id, kind);
};

const startVerify = async (id) => {
  await ensureTables();
  await getRow(id);
  return runJob(id, 'verify', VERIFY_STEPS, () => verifyLive(id));
};

const createPage = async (url, user) => {
  await ensureTables();
  const u = normalizeUrl(url);
  const r = await pool.query(
    `INSERT INTO seo_pages (url, created_by, status_by, status_at) VALUES ($1, $2, $2, now())
     ON CONFLICT (url) DO UPDATE SET updated_at = now() RETURNING id`,
    [u, user || null]
  );
  const id = r.rows[0].id;
  await startAnalyze(id);
  return { id };
};

const DRAFT_FIELDS = ['title', 'meta', 'h1', 'intro_html', 'body_html', 'analyse'];

const updatePage = async (id, body, user) => {
  await ensureTables();
  const row = await getRow(id);
  const sets = [];
  const vals = [id];
  const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (body.label !== undefined) set('label', body.label || null);
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) throw new Error('Statut inconnu');
    set('status', body.status);
    if (body.status !== row.status) {
      set('status_by', user || null);
      sets.push('status_at = now()');
    }
  }
  if (body.published_at !== undefined) set('published_at', body.published_at || null);
  if (body.topic_terms !== undefined) set('topic_terms', String(body.topic_terms || '').trim() || null);
  if (body.target_queries !== undefined) {
    set('target_queries', (Array.isArray(body.target_queries) ? body.target_queries : []).map((q) => String(q).trim().toLowerCase()).filter(Boolean));
  }
  if (body.draft) {
    const draft = { ...(row.draft || {}) };
    for (const f of DRAFT_FIELDS) if (body.draft[f] !== undefined) draft[f] = String(body.draft[f]);
    if (Array.isArray(body.draft.liens_a_ajouter)) draft.liens_a_ajouter = body.draft.liens_a_ajouter;
    draft.edited_by = user || null;
    draft.edited_at = new Date().toISOString();
    if (!draft.source) draft.source = 'manuel';
    set('draft', JSON.stringify(draft));
  }
  if (!sets.length) return getPage(id);
  await pool.query(`UPDATE seo_pages SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
  // Passage à « Publié » : la date de publication devient un repère du suivi.
  if (body.status === 'publie' && !row.published_at && body.published_at === undefined) {
    await pool.query('UPDATE seo_pages SET published_at = CURRENT_DATE WHERE id = $1', [id]);
  }
  return getPage(id);
};

// Brouillon fourni hors API (réponse JSON collée depuis Claude).
const importDraft = async (id, text, user) => {
  const j = typeof text === 'string' ? parseJsonReply(text) : text;
  const row = await getRow(id);
  const draft = {
    ...(row.draft || {}),
    ...j,
    source: 'collé',
    generated_at: new Date().toISOString(),
    edited_by: user || null,
  };
  await pool.query(
    `UPDATE seo_pages SET draft = $2, updated_at = now(),
       status = CASE WHEN status = 'analyse' THEN 'redaction' ELSE status END WHERE id = $1`,
    [id, JSON.stringify(draft)]
  );
  return getPage(id);
};

const addEvent = async (id, { at, note }, user) => {
  await ensureTables();
  await getRow(id);
  if (!note || !String(note).trim()) throw new Error('Note manquante');
  await pool.query('INSERT INTO seo_page_events (page_id, at, note, created_by) VALUES ($1, $2, $3, $4)',
    [id, at || ymd(new Date()), String(note).trim(), user || null]);
  return getPage(id);
};

const deleteEvent = async (id, eventId) => {
  await pool.query('DELETE FROM seo_page_events WHERE id = $1 AND page_id = $2', [eventId, id]);
  return getPage(id);
};

const deletePage = async (id) => {
  await ensureTables();
  await pool.query('DELETE FROM seo_pages WHERE id = $1', [id]);
  return { deleted: true };
};

const clearAds = async (id) => {
  await pool.query('UPDATE seo_pages SET ads = NULL, ads_filename = NULL, ads_at = NULL, updated_at = now() WHERE id = $1', [id]);
  return getPage(id);
};

module.exports = {
  ensureTables, listPages, getPage, createPage, updatePage, analyze, startAnalyze, startVerify, getProgress, saveAds, clearAds, getBrief,
  startGeneration, importDraft, verifyLive, getPositions, addEvent, deleteEvent, deletePage, aiConfigured,
  // Tests
  parseAdsCsv, parseTerms, matchTerms, normalizeUrl, parsePage, dataRange, loadPageQueries, loadTopicQueries,
  defaultTerms, productFacts, sampleProducts, buildBrief, lintDraft, fetchHtml,
};
