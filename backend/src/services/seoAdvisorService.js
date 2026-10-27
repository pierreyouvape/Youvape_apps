/**
 * Suivi SEO — recommandations
 *
 * Transforme les données Search Console (gscService) en actions classées par
 * gain de clics estimé : modifier un texte, régler une cannibalisation,
 * ouvrir ou fermer l'indexation, rediriger, créer une page (avec un plan de
 * contenu tiré des vraies requêtes).
 *
 * Deux sources :
 *   - gsc_query_daily / gsc_search_daily (France, 28 derniers jours) ;
 *   - seo_page_audit : relevé des pages en ligne (code HTTP, title, H1,
 *     robots, canonical, longueur du texte), refait à chaque calcul.
 *
 * Les recommandations sont conservées dans seo_recommendations avec une clé
 * stable (type + cible) : le statut posé par l'équipe (à faire, en cours,
 * fait, ignoré) survit aux recalculs.
 *
 * ⚠️ Litige DNF : toute proposition de texte reste une vitrine neutre
 * (caractéristiques, compatibilités, mode d'emploi). Jamais de superlatif,
 * de prix, de promo ni de description de goût. Rappelé dans chaque carte.
 */

const axios = require('axios');
const pool = require('../config/database');

const SITE = 'https://www.youvape.fr';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const PERIOD_DAYS = 28;
const COUNTRY = 'fra';
const AUDIT_MAX_PAGES = 150;
const AUDIT_DELAY_MS = 400;
const LEGAL_NOTE = 'Rédaction neutre et factuelle (caractéristiques, compatibilités, mode d’emploi) : pas de superlatif, de prix, de promotion ni de description de goût. Faire valider par l’avocat avant mise en ligne.';

// Groupes du plan qui ne doivent pas produire de recommandation de création.
// « marque-jnr » : la page marque et l'étiquette puff-jnr sont déjà décidées
// (19/10/2026), les cartes « texte » suffisent.
const GROUPS_WITHOUT_PAGE = new Set(['jnr', 'garde-fou-puff-sans-nicotine', 'marque-jnr']);

// Mots à ne jamais reprendre dans un title, un intertitre ou un mot manquant :
// arguments de prix, de goût, d'avis (griefs DNF) ou mots sans contenu.
// Mots INTERDITS dans ce qu'on propose (griefs DNF : prix, goût, avis,
// superlatif, santé ; puffs jetables interdites en France depuis la loi du
// 24/02/2025 ; « gratuit », « offert » = arguments commerciaux). Une requête qui
// en contient un n'est jamais proposée à l'emploi.
const BANNED = new Set(['prix', 'cher', 'promo', 'promotion', 'solde', 'soldes', 'meilleur', 'meilleure', 'meilleurs', 'meilleures',
  'gout', 'gouts', 'saveur', 'saveurs', 'avis', 'cbd', 'thc', 'danger', 'dangereux', 'dangereuse',
  'jetable', 'jetables', 'gratuit', 'gratuite', 'gratuits', 'offert', 'offerte', 'livraison', 'reduction', 'code']);
// Mots SANS CONTENU : jamais proposés comme mot à ajouter dans un title ou un
// intertitre, mais une requête qui les contient reste utilisable.
const NOISE = new Set(['pas', 'trouver', 'acheter', 'achat', 'vente', 'magasin', 'ou', 'quoi', 'comment', 'combien', 'pourquoi',
  'quel', 'quelle', 'quels', 'est', 'peut', 'faut', 'interdit', 'interdite', 'legal', 'legale']);
const SENSITIVE = new Set([...BANNED, ...NOISE]);
const ACRONYMS = ['jnr', 'mtl', 'dl', 'pg', 'vg'];
const STOPWORDS = new Set(['de', 'du', 'la', 'le', 'les', 'des', 'en', 'et', 'a', 'au', 'aux', 'un', 'une', 'pour', 'sur', 'avec', 'd', 'l']);
const QUESTION_RE = /^(comment|combien|pourquoi|quel|quelle|quels|quelles|est[- ]ce|peut[- ]on|ou |où |c'?est quoi|que |qu'|faut[- ]il|y a[- ]t)|(\?| ou pas$| legal| légal| interdit| danger)/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const compact = (s) => norm(s).replace(/[^a-z0-9]/g, '');
const tokens = (q) => norm(q).split(/[^a-z0-9%]+/).filter((t) => t && !STOPWORDS.has(t));
const cap = (s) => {
  if (!s) return s;
  let out = s.charAt(0).toUpperCase() + s.slice(1);
  for (const a of ACRONYMS) out = out.replace(new RegExp(`\\b${a}\\b`, 'gi'), a.toUpperCase());
  return out;
};
const pathOf = (url) => (url || '').replace(/^https?:\/\/(www\.)?youvape\.fr/, '') || '/';
const fmt1 = (n) => (n === null || n === undefined ? '—' : Number(n).toFixed(1).replace('.', ','));
const fmtInt = (n) => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0));
const monthly = (v) => (v * 30) / PERIOD_DAYS;

/**
 * Taux de clic attendu selon la position (courbe moyenne e-commerce, prudente).
 * Sert à estimer le gain d'une remontée, pas à prédire au clic près.
 */
const CURVE = [0.28, 0.28, 0.15, 0.11, 0.08, 0.065, 0.05, 0.04, 0.032, 0.026, 0.022];
const ctrAt = (p) => {
  if (!p || p <= 1) return CURVE[1];
  if (p >= 20) return 0.004;
  if (p > 10) return 0.022 - ((p - 10) / 10) * (0.022 - 0.006);
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  if (lo === hi) return CURVE[lo];
  return CURVE[lo] + (p - lo) * (CURVE[hi] - CURVE[lo]);
};
const gainTo = (impr, clicks, fromPos, toPos) => Math.max(0, impr * ctrAt(toPos) - clicks);

/* ─── Tables ───────────────────────────────────────────── */

const ensureTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seo_page_audit (
      url          text PRIMARY KEY,
      fetched_at   timestamp NOT NULL DEFAULT now(),
      http_status  integer,
      location     text,
      title        text,
      h1           text,
      meta_description text,
      robots       text,
      canonical    text,
      word_count   integer,
      error        text
    );
    ALTER TABLE seo_page_audit ADD COLUMN IF NOT EXISTS links jsonb;
    CREATE TABLE IF NOT EXISTS seo_recommendations (
      id           serial PRIMARY KEY,
      rec_key      text UNIQUE NOT NULL,
      type         varchar(30) NOT NULL,
      score        numeric(10,1) NOT NULL DEFAULT 0,
      est_clicks   numeric(10,1),
      effort       varchar(10),
      title        text NOT NULL,
      reason       text,
      action       text,
      proposal     text,
      urls         text[],
      queries      jsonb,
      active       boolean NOT NULL DEFAULT true,
      status       varchar(20) NOT NULL DEFAULT 'todo',
      status_by    text,
      status_at    timestamp,
      note         text,
      created_at   timestamp NOT NULL DEFAULT now(),
      updated_at   timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS seo_advisor_runs (
      id          serial PRIMARY KEY,
      started_at  timestamp NOT NULL DEFAULT now(),
      finished_at timestamp,
      pages_audited integer,
      recs        integer,
      status      varchar(20) NOT NULL DEFAULT 'running',
      error       text
    );
    ALTER TABLE seo_recommendations ADD COLUMN IF NOT EXISTS delay text;
    ALTER TABLE seo_page_audit ADD COLUMN IF NOT EXISTS availability text;
    ALTER TABLE seo_page_audit ADD COLUMN IF NOT EXISTS brand text;
  `);
};

/* ─── Relevé des pages ─────────────────────────────────── */

const pick = (html, re) => {
  const m = html.match(re);
  return m ? m[1].replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&#8217;/g, '’').replace(/&nbsp;/g, ' ').trim() : null;
};

const CHROME_RE = /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<header[\s\S]*?<\/header>|<footer[\s\S]*?<\/footer>|<nav[\s\S]*?<\/nav>/gi;
const normUrl = (u) => (u || '').split(/[?#]/)[0].replace(/\/$/, '');

// Liens internes du CONTENU de la page (en-tête, menus et pied de page retirés) :
// c'est là qu'un lien ajouté par l'équipe se trouvera.
const extractLinks = (html) => {
  const body = html.replace(CHROME_RE, ' ');
  const out = new Map();
  const re = /<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(body)) && out.size < 500) {
    let href = m[1].trim();
    if (href.startsWith('/')) href = SITE + href;
    if (!href.startsWith(SITE)) continue;
    href = normUrl(href);
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!out.has(href) || (!out.get(href) && text)) out.set(href, text);
  }
  return [...out.entries()].map(([href, text]) => ({ href, text }));
};

// Marque déclarée dans les données structurées d'une fiche (Product.brand).
// L'adresse ne la donne pas toujours : puff-elfa-pro-0mg finit par le taux,
// kit-elfx-mega-elbar par une faute de frappe.
const brandFromJsonLd = (html) => {
  for (const m of (html || '').matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let found = null;
    const walk = (x) => {
      if (found || !x || typeof x !== 'object') return;
      if (Array.isArray(x)) { x.forEach(walk); return; }
      if (/Product/.test([].concat(x['@type'] || '').join(',')) && x.brand) {
        const b = [].concat(x.brand)[0];
        found = (typeof b === 'string' ? b : b?.name) || null;
        return;
      }
      if (x['@graph']) walk(x['@graph']);
    };
    try {
      walk(JSON.parse(m[1]));
    } catch {
      // Bloc illisible (retour à la ligne brut dans une description) : la marque
      // se lit quand même.
      found = (m[1].match(/"brand"\s*:\s*\{[^}]*?"name"\s*:\s*"([^"]+)"/) || m[1].match(/"brand"\s*:\s*"([^"]+)"/) || [])[1] || null;
    }
    if (found) return String(found).trim();
  }
  return null;
};

const auditUrl = async (url) => {
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'fr-FR,fr;q=0.9' },
      maxRedirects: 0,
      timeout: 30000,
      validateStatus: () => true,
      responseType: 'text',
      transformResponse: (d) => d,
    });
    const html = typeof res.data === 'string' ? res.data : '';
    const body = html.replace(CHROME_RE, ' ').replace(/<[^>]+>/g, ' ');
    return {
      url,
      http_status: res.status,
      location: res.headers.location || null,
      title: pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
      h1: pick(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null,
      meta_description: pick(html, /<meta\s+name=["']description["']\s+content="([^"]*)"/i) || pick(html, /<meta\s+name=["']description["']\s+content='([^']*)'/i),
      robots: pick(html, /<meta\s+name=["']robots["']\s+content=["']([^"']*)["']/i),
      canonical: pick(html, /<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/i),
      word_count: res.status === 200 ? body.split(/\s+/).filter(Boolean).length : null,
      links: res.status === 200 ? extractLinks(html) : null,
      // Disponibilité déclarée dans les données structurées (fiches produit).
      availability: (html.match(/"availability"\s*:\s*"(?:https?:\/\/schema\.org\/)?([A-Za-z]+)"/) || [])[1] || null,
      brand: brandFromJsonLd(html),
      error: null,
    };
  } catch (error) {
    return { url, http_status: null, error: error.message };
  }
};

const saveAudit = async (a) => {
  await pool.query(
    `INSERT INTO seo_page_audit (url, fetched_at, http_status, location, title, h1, meta_description, robots, canonical, word_count, links, error, availability, brand)
     VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (url) DO UPDATE SET fetched_at = now(), http_status = $2, location = $3, title = $4, h1 = $5,
       meta_description = $6, robots = $7, canonical = $8, word_count = $9, links = $10, error = $11, availability = $12, brand = $13`,
    [a.url, a.http_status, a.location || null, a.title || null, a.h1 || null, a.meta_description || null,
      a.robots || null, a.canonical || null, a.word_count || null, a.links ? JSON.stringify(a.links) : null, a.error || null,
      a.availability || null, a.brand || null]
  );
};

/* ─── Données ──────────────────────────────────────────── */

const loadPeriod = async () => {
  const r = await pool.query("SELECT MAX(date) AS max FROM gsc_query_daily WHERE country = 'all'");
  if (!r.rows[0].max) return null;
  const to = ymd(new Date(r.rows[0].max));
  const from = addDays(to, -PERIOD_DAYS + 1);
  const prevFrom = addDays(from, -PERIOD_DAYS);
  return { from, to, prevFrom };
};

const loadData = async ({ from, to, prevFrom }) => {
  const [queries, qp, pages, prevQ, prevQp, firstSeen] = await Promise.all([
    pool.query(
      `SELECT query, SUM(clicks)::int AS c, SUM(impressions)::int AS i,
              SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS p
       FROM gsc_query_daily WHERE country = $3 AND date BETWEEN $1 AND $2
       GROUP BY query HAVING SUM(impressions) >= 20`,
      [from, to, COUNTRY]
    ),
    pool.query(
      `SELECT query, page, SUM(clicks)::int AS c, SUM(impressions)::int AS i,
              SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS p
       FROM gsc_search_daily WHERE country = $3 AND date BETWEEN $1 AND $2
       GROUP BY query, page HAVING SUM(impressions) >= 5`,
      [from, to, COUNTRY]
    ),
    pool.query(
      `SELECT page,
              SUM(clicks) FILTER (WHERE date >= $2)::int AS c,
              SUM(impressions) FILTER (WHERE date >= $2)::int AS i,
              SUM(position * impressions) FILTER (WHERE date >= $2) / NULLIF(SUM(impressions) FILTER (WHERE date >= $2), 0) AS p,
              SUM(clicks) FILTER (WHERE date < $2)::int AS pc,
              SUM(impressions) FILTER (WHERE date < $2)::int AS pi,
              SUM(position * impressions) FILTER (WHERE date < $2) / NULLIF(SUM(impressions) FILTER (WHERE date < $2), 0) AS pp
       FROM gsc_search_daily WHERE country = $4 AND date BETWEEN $1 AND $3
       GROUP BY page`,
      [prevFrom, from, to, COUNTRY]
    ),
    pool.query(
      `SELECT query, SUM(clicks)::int AS c, SUM(impressions)::int AS i,
              SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS p
       FROM gsc_query_daily WHERE country = $3 AND date >= $1 AND date < $2
       GROUP BY query HAVING SUM(impressions) >= 20`,
      [prevFrom, from, COUNTRY]
    ),
    pool.query(
      `SELECT query, page, SUM(clicks)::int AS c, SUM(impressions)::int AS i
       FROM gsc_search_daily WHERE country = $3 AND date >= $1 AND date < $2
       GROUP BY query, page HAVING SUM(impressions) >= 5`,
      [prevFrom, from, COUNTRY]
    ),
    pool.query(
      `SELECT page, MIN(date) AS first FROM gsc_search_daily WHERE country = $1 AND impressions > 0 GROUP BY page`,
      [COUNTRY]
    ),
  ]);
  const qPrev = new Map(prevQ.rows.map((r) => [r.query, { ...r, p: Number(r.p) }]));
  const byQueryPrev = new Map();
  for (const r of prevQp.rows) {
    if (!byQueryPrev.has(r.query)) byQueryPrev.set(r.query, []);
    byQueryPrev.get(r.query).push(r);
  }
  const pageFirstSeen = new Map(firstSeen.rows.map((r) => [r.page, ymd(new Date(r.first))]));
  const q = new Map(queries.rows.map((r) => [r.query, { ...r, p: Number(r.p) }]));
  const byQuery = new Map();
  for (const r of qp.rows) {
    const row = { ...r, p: Number(r.p) };
    if (!byQuery.has(r.query)) byQuery.set(r.query, []);
    byQuery.get(r.query).push(row);
  }
  for (const list of byQuery.values()) list.sort((a, b) => b.i - a.i);
  const pageStats = new Map(pages.rows.map((r) => [r.page, {
    ...r, p: r.p === null ? null : Number(r.p), pp: r.pp === null ? null : Number(r.pp),
    c: r.c || 0, i: r.i || 0, pc: r.pc || 0, pi: r.pi || 0,
  }]));
  return { q, byQuery, pageStats, qPrev, byQueryPrev, pageFirstSeen, period: { from, to, prevFrom } };
};

const loadAudits = async () => {
  const r = await pool.query('SELECT * FROM seo_page_audit');
  return new Map(r.rows.map((a) => [normUrl(a.url), a]));
};

/* ─── Détecteurs ───────────────────────────────────────── */

const isParamUrl = (u) => /[?#]/.test(u) || /\/filters\//.test(u) || /\/page\/\d+/.test(u) || /\/feed\/?$/.test(u);
const pageKind = (u) => {
  const p = pathOf(u);
  if (p.startsWith('/produit/')) return 'fiche produit';
  if (p.startsWith('/etiquette-produit/')) return 'étiquette';
  if (p.startsWith('/marque/')) return 'page marque';
  if (p.startsWith('/categorie-produit/')) return 'catégorie';
  if (p.startsWith('/blog/') || p.startsWith('/avis-tests/')) return 'article';
  if (p === '/') return 'accueil';
  return 'landing page';
};

// Mots génériques : ne comptent pas pour dire que deux requêtes parlent du même sujet.
const GENERIC = new Set(['puff', 'puffs', 'cigarette', 'electronique', 'vape', 'vapoteuse', 'e', 'pod']);
const coreTokens = (q) => tokens(q).filter((t) => !GENERIC.has(t));
// « 0 nicotine », « 0mg », « zero nicotine » = « sans nicotine » pour juger qu'une requête est une variante.
const canon = (q) => norm(q)
  .replace(/\b(0 ?mg|0|zero|z[eé]ro)( de)? nicotine\b/g, 'sans nicotine')
  .replace(/\b0 ?mg\b/g, 'sans nicotine')
  .replace(/\b0 ?%/g, 'sans nicotine');
const canonTokens = (q) => tokens(canon(q));
const hasSensitive = (q) => tokens(q).some((t) => BANNED.has(t));
// Santé : argument jugé publicitaire (DNF), jamais proposé en FAQ.
const HEALTH_RE = /danger|cancer|sant[eé]|risque|nocif|toxique|mortel|poumon|maladie/;
// Question de FAQ à ne pas reprendre : superlatif, prix, goût, avis, jetable (DNF).
// Pas SENSITIVE : il contient « comment », « combien »… qui font les questions.
const FAQ_BANNED_RE = /meilleu|\bprix\b|\bcher\b|promo|gratuit|\bgouts?\b|saveur|\bavis\b|jetable|offert/;
// Ligne du tableau d'une carte : toute requête citée dans la carte y figure, avec son rôle.
const qRow = (x, role) => ({ query: x.query, i: x.i, c: x.c, p: Number(Number(x.p).toFixed(1)), role });


const placementFor = (u) => {
  switch (pageKind(u)) {
    case 'fiche produit': return 'dans la description du produit, une phrase qui renvoie vers la page';
    case 'page marque': return 'dans le texte de présentation, à l’endroit où la gamme est citée';
    case 'étiquette':
    case 'catégorie': return 'dans le texte d’introduction, au-dessus de la grille de produits';
    case 'article': return 'dans le paragraphe qui traite du sujet';
    default: return 'dans le premier paragraphe du texte';
  }
};

// Pages qui se classent sur des requêtes proches : les meilleures sources de liens.
const relatedSources = ({ byQuery }, query, exclude, audits) => {
  const core = coreTokens(query);
  const minShared = Math.min(2, core.length);
  if (!minShared) return [];
  // Un seul mot de sujet (« menthol ») : la page source doit en parler elle-même,
  // dans son adresse ou son title. Sinon toute page vue sur « elfbar menthol »
  // devenait source d'un lien vers l'article sur les cigarettes mentholées.
  const onTopic = (u) => core.length > 1
    || compact(`${pathOf(u)} ${audits?.get(normUrl(u))?.title || ''}`).includes(singular(core[0]));
  const score = new Map();
  for (const [q2, rows] of byQuery) {
    const tk = tokens(q2);
    if (core.filter((t) => tk.includes(t)).length < minShared) continue;
    for (const r of rows) {
      if (isParamUrl(r.page) || pathOf(r.page) === '/' || normUrl(r.page) === normUrl(exclude) || !onTopic(r.page)) continue;
      score.set(r.page, (score.get(r.page) || 0) + r.i);
    }
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
};

/**
 * Plan de liens internes : pour chaque page source, l'ancre exacte et
 * l'endroit où la placer, ou « déjà fait » si le lien existe (relevé du
 * contenu de la page, menus exclus).
 */
// Marque d'une fiche produit, sous la forme de son adresse /marque/… : celle des
// données structurées (relevé de la page), à défaut le dernier mot de l'adresse
// (pod-vprime-2-oxva → oxva) s'il n'est pas un taux ou un format
// (puff-elfa-pro-0mg ne dit pas sa marque).
const brandSlug = (name) => norm(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const brandOf = (u, audits) => {
  if (pageKind(u) !== 'fiche produit') return null;
  const a = audits?.get(normUrl(u));
  if (a?.brand) return brandSlug(a.brand);
  const last = pathOf(u).split('/').pop().split('-').pop() || '';
  return last && !/\d/.test(last) ? last : null;
};

// Mots qui, accolés à une marque, ne désignent encore que la marque :
// « puff elfbar », « elfbar rechargeable », « recharge elfbar », « elfbar france ».
const BRAND_LEVEL_RE = /^(puffs?|pods?|kits?|vapes?|vapoteuses?|cigarettes?|electroniques?|e|recharges?|rechargeables?|cartouches?|france|officiel|site|marque)$/;
const isBrandQuery = (query, slug) => {
  const words = tokens(canon(query)).filter((t) => !BRAND_LEVEL_RE.test(t));
  return words.length > 0 && !!slug && compact(words.join(' ')) === compact(slug);
};

// Une requête faite des mots qu'une fiche produit porte EN PROPRE : sa marque,
// son nom de modèle, son type de produit (« puff elfbar » sur la Puff 4in1
// Elfbar, « elfa pro » sur la Puff Elfa Pro 20mg). C'est le sujet même de la
// fiche : on ne demande jamais de les retirer de son title, la cannibalisation
// se règle par la page de référence et un lien.
const TYPE_WORD_RE = /^(puffs?|pods?|kits?|packs?|cartouches?|recharges?|rechargeables?|batteries?|batterie|box|clearomiseurs?|resistances?|e?liquides?|boosters?)$/;
// Mots de sujet d'une requête : sans les génériques ni les lettres isolées, mais
// avec les chiffres (« 4 in 1 », « gen 3 » : le numéro fait le modèle).
const subjectWords = (query) => coreTokens(canon(query)).filter((t) => t.length > 1 || /\d/.test(t));
const ownsQuery = (query, a) => {
  if (!a?.url || pageKind(a.url) !== 'fiche produit') return false;
  const core = subjectWords(query);
  if (!core.length) return false;
  const name = `${a.h1 || ''} ${(a.title || '').replace(/\s*[-–|]\s*YouVape.*$/i, '')}`;
  const types = tokens(name).filter((t) => TYPE_WORD_RE.test(t));
  // « recharge » et « cartouche » désignent la même chose : un pack de cartouches
  // porte « recharge elfbar 4 in 1 ».
  const refill = types.some((t) => /^(cartouches?|recharges?)$/.test(t)) ? 'recharge cartouche' : '';
  const own = compact(`${a.brand || brandOf(a.url) || ''} ${modelLabel(a)} ${types.join(' ')} ${refill}`);
  return core.every((t) => own.includes(t));
};

/* ─── Rôle de chaque type de page ──────────────────────── */
// Chaque type de page porte en propre un type de recherche :
//   fiche produit → son modèle (« elfbar 4 in 1 », « elfa pro ») ;
//   page marque   → la marque, seule ou avec puff, pod, recharge (« puff elfbar ») ;
//   catégorie     → un type de produit (« puff », « pod », « e-liquide ») ;
//   landing page  → le thème de son adresse (« puff sans nicotine ») ;
//   lexique       → la définition (« qu'est-ce qu'une puff ») ;
//   article       → une question ; étiquette → une famille (souvent en noindex) ;
//   accueil       → la boutique, jamais touchée par une carte automatique.
// Quand une page en gêne une autre, son title ne change que s'il ne parle QUE
// de la recherche (« Cigarette électronique - YouVape » sur le lexique), et
// jamais celui d'une fiche, d'une page marque ou de l'accueil : c'est leur nom.
// Sinon, seul le lien vers la page de référence compte.
const isLexique = (a) => /lexique|d[ée]finition/i.test(`${a?.title || ''} ${a?.h1 || ''}`) || /^qu.est[- ]ce/.test(norm(a?.h1 || ''));
const roleOf = (u, a) => (pageKind(u) === 'landing page' && isLexique(a) ? 'lexique' : pageKind(u));
const auditOf = (u, audits) => ({ ...(audits?.get(normUrl(u)) || {}), url: u });
const marqueSlug = (u) => (pageKind(u) === 'page marque' ? pathOf(u).split('/')[2] || null : null);

// Mots de sujet d'un title ou d'une recherche, au singulier, sans « YouVape »
// ni mots de remplissage.
const TITLE_FILLER = new Set([...STOPWORDS, ...NOISE, 'youvape', 'toutes', 'tous', 'toute', 'tout', 'nos', 'notre', 'votre', 'vos',
  'decouvrez', 'selection', 'marque', 'gamme', 'chez', 'boutique', 'ligne', 'par', 'pour', 'avec']);
const subjectSet = (txt) => new Set(tokens(canon(String(txt || '').replace(/\s*[-–|]\s*YouVape.*$/i, '')))
  .filter((t) => !TITLE_FILLER.has(t)).map(singular));
// Le title ne parle que de la recherche : mêmes mots de sujet, ni plus ni moins.
const centeredOn = (title, query) => {
  const s = subjectSet(title);
  const w = subjectSet(query);
  return s.size > 0 && s.size === w.size && [...s].every((x) => w.has(x));
};
// L'adresse d'une page reprend exactement la recherche (/puff-sans-nicotine).
const slugIs = (u, query) => centeredOn((pathOf(u).split('/').filter(Boolean).pop() || '').replace(/-/g, ' '), query);

// Intention d'une recherche : quel type de page doit la porter.
const TYPE_ONLY_RE = /^(rechargeables?|electroniques?|cigarettes?|vapoteuses?|vapes?|liquides?|eliquides?)$/;
const isTypeQuery = (query) => {
  const w = tokens(canon(query));
  return w.length > 0 && w.every((t) => GENERIC.has(t) || TYPE_WORD_RE.test(t) || TYPE_ONLY_RE.test(t));
};
const intentOf = (query, pages, audits) => {
  if (QUESTION_RE.test(norm(query))) return 'question';
  const brands = pages.map((u) => marqueSlug(u) || brandOf(u, audits)).filter(Boolean);
  if (brands.some((b) => isBrandQuery(query, b))) return 'marque';
  if (pages.some((u) => ownsQuery(query, auditOf(u, audits)))) return 'modele';
  if (isTypeQuery(query)) return 'type';
  return 'theme';
};
// Types de page préférés selon l'intention, du premier au dernier.
const PREFERENCE = {
  question: ['lexique', 'article', 'landing page', 'catégorie', 'étiquette', 'page marque', 'fiche produit'],
  marque: ['page marque', 'landing page', 'fiche produit', 'catégorie', 'étiquette', 'lexique', 'article'],
  modele: ['fiche produit', 'étiquette', 'page marque', 'landing page', 'catégorie', 'lexique', 'article'],
  type: ['catégorie', 'landing page', 'étiquette', 'lexique', 'page marque', 'fiche produit', 'article'],
};
// Pourquoi cette page fait référence : elle porte la recherche en propre…
const WHY_OWN = {
  marque: (q) => `« ${q} » ne désigne que la marque`,
  modele: (q) => `« ${q} » nomme ce produit`,
  theme: (q) => `son adresse reprend « ${q} »`,
};
// … ou son type de page est celui qui convient à l'intention.
const WHY_ROLE = {
  question: 'les questions reviennent au lexique ou à l’article',
  marque: 'les recherches de marque reviennent à la page marque',
  modele: 'les recherches de modèle reviennent à la fiche produit',
  type: 'les types de produit reviennent à la catégorie',
};

// Page de référence d'une recherche partagée entre plusieurs de nos pages :
// celle qui la porte en propre (la marque, le modèle, l'adresse), puis le type
// de page qui convient à l'intention, puis celle dont le title reprend le plus
// de mots de la recherche, enfin l'ordre reçu (le plus de clics d'abord).
const chooseReference = (query, pages, audits) => {
  const intent = intentOf(query, pages, audits);
  const words = subjectWords(query);
  const owns = (u) => {
    const a = auditOf(u, audits);
    if (intent === 'marque') return isBrandQuery(query, marqueSlug(u));
    if (intent === 'modele') return ownsQuery(query, a);
    if (intent === 'theme') return slugIs(u, query);
    return false;
  };
  const pref = PREFERENCE[intent] || [];
  const ranked = pages.map((u, i) => {
    const a = auditOf(u, audits);
    const at = pref.indexOf(roleOf(u, a));
    const text = compact(`${a.title || ''} ${a.h1 || ''}`);
    return { u, i, own: owns(u), rank: at < 0 ? pref.length : at, cover: words.filter((w) => text.includes(w)).length };
  }).sort((x, y) => (y.own - x.own) || (x.rank - y.rank) || (y.cover - x.cover) || (x.i - y.i));
  const [best, next] = ranked;
  let why = 'celle qui reçoit le plus de clics';
  if (next && best.own !== next.own) why = WHY_OWN[intent](query);
  else if (next && best.rank !== next.rank) why = WHY_ROLE[intent];
  else if (next && best.cover !== next.cover) why = `son title reprend le plus de mots de « ${query} »`;
  return { main: best.u, intent, why };
};

// Ancre d'un lien : la recherche telle quelle, marque en capitale.
const anchorFor = (query, pages, audits) => {
  const brands = new Set(pages.map((u) => marqueSlug(u) || brandOf(u, audits)).filter(Boolean).map(compact));
  return query.split(/\s+/).map((w) => (brands.has(compact(w)) ? cap(w) : w)).join(' ');
};
// Phrase à coller, avec son lien relatif, selon le type de la page visée.
const linkSentence = (main, anchor, role) => {
  const a = `<a href="${pathOf(main)}">${anchor}</a>`;
  switch (role) {
    case 'catégorie': return `<p>Tous les modèles sont regroupés dans notre rayon ${a}.</p>`;
    case 'lexique': return `<p>Définition : ${a}.</p>`;
    case 'article': return `<p>À lire : ${a}.</p>`;
    default: return `<p>Voir aussi : ${a}.</p>`;
  }
};
// Où coller cette phrase, selon le type de la page qui la reçoit.
const LINK_WHERE = {
  'fiche produit': 'à la fin de la description du produit',
  'page marque': 'à la fin du texte de présentation',
  'catégorie': 'à la fin du texte d’introduction',
  'étiquette': 'à la fin du texte d’introduction',
  'article': 'à la fin du paragraphe qui traite du sujet',
  'lexique': 'à la fin du premier paragraphe',
  'accueil': 'dans le bloc de texte du bas de l’accueil',
};
// Le lien existant nomme-t-il le sujet de la recherche ?
const anchorNames = (text, query) => {
  const words = subjectWords(query).length ? subjectWords(query) : tokens(canon(query));
  return words.some((w) => compact(text || '').includes(singular(w)));
};

// Ce que doit faire une page qui gêne la page de référence sur une recherche :
// des consignes complètes, prêtes à appliquer, et rien quand il n'y a rien à
// faire. Une page cible décidée (protectedUrls) n'est jamais modifiée.
const rivalSteps = ({ query, main, page, audits, protectedUrls }) => {
  if (protectedUrls?.has(normUrl(page))) return [];
  const a = auditOf(page, audits);
  const role = roleOf(page, a);
  const mainRole = roleOf(main, auditOf(main, audits));
  const steps = [];
  if (a.title && centeredOn(a.title, query) && !['fiche produit', 'page marque', 'accueil'].includes(role)) {
    if (role === 'étiquette') {
      // Une étiquette fermée n'a pas besoin de lien.
      return [`Yoast > réglages de l'étiquette ${pathOf(page)} : passer en noindex, follow. Son title, « ${a.title} », ne parle que de « ${query} », que porte ${pathOf(main)}.`];
    }
    if (role === 'lexique' && /\?\s*$/.test(a.h1 || '')) {
      steps.push(`Title de ${pathOf(page)} : remplacer « ${a.title} » par « ${a.h1.trim()} Définition - Lexique YouVape ».`);
    } else {
      steps.push(`Title de ${pathOf(page)} : « ${a.title} » ne parle que de « ${query} », que porte ${pathOf(main)}. Le réécrire dans l'onglet Rédaction SEO, sur ${role === 'lexique' ? 'la définition' : role === 'article' ? 'la question que traite l’article' : role === 'catégorie' ? 'son rayon' : 'le thème de son adresse'}.`);
    }
  }
  const anchor = anchorFor(query, [main, page], audits);
  const existing = (a.links || []).find((l) => normUrl(l.href) === normUrl(main));
  if (existing && !anchorNames(existing.text, query)) {
    steps.push(`Sur ${pathOf(page)} : remplacer l'ancre du lien vers ${pathOf(main)} (« ${existing.text || 'image sans texte'} ») par « ${anchor} ».`);
  } else if (!existing) {
    steps.push(`Sur ${pathOf(page)}, ${LINK_WHERE[role] || 'à la fin du premier paragraphe'}, ajouter : ${linkSentence(main, anchor, mainRole)}`);
  }
  return steps;
};

const linkPlan = async ({ target, anchors, sources, data, audits, max = 5 }) => {
  const t = normUrl(target);
  // Vers une fiche produit, on ne propose que des pages de la même marque (et la
  // page marque) : un lien vers une Aspire depuis une fiche Vaporesso n'a pas de sens.
  const brand = brandOf(t, audits);
  if (brand) {
    sources = [`${SITE}/marque/${brand}`, ...sources.filter((u) => pageKind(u) !== 'fiche produit' || brandOf(u, audits) === brand)];
  }
  const clean = anchors.filter((a) => a && !tokens(a).some((x) => SENSITIVE.has(x)));
  if (!clean.length) return { lines: [], checked: 0 };
  const lines = [];
  const seen = new Set();
  let k = 0;
  let checked = 0;
  for (const src of sources) {
    if (lines.length >= max) break;
    const s = normUrl(src);
    // Pas de lien depuis une page CBD, « jetable », prix ou superlatif : autre sujet ou sensible (DNF).
    if (!s || s === t || seen.has(s) || isParamUrl(s) || /cbd|thc|jetable|pas-cher|prix|promo|meilleu/.test(pathOf(s))) continue;
    seen.add(s);
    let a = audits.get(src) || audits.get(s);
    if (!a || !Array.isArray(a.links)) {
      a = await auditUrl(s);
      if (a.http_status) { await saveAudit(a); audits.set(s, a); }
    }
    if (!a || a.http_status !== 200 || !Array.isArray(a.links)) continue;
    checked += 1;
    const st = data.pageStats.get(src) || data.pageStats.get(s);
    const vu = st?.i ? ` (${fmtInt(st.i)} impressions en 28 j)` : '';
    const existing = a.links.find((l) => l.href === t);
    if (existing) {
      // Lien déjà bon : on n'en parle pas (une ligne « rien à faire » encombre la carte).
      // Une ancre qui nomme déjà le sujet (« Voopoo », « vapoter sans nicotine ») est
      // bonne : on ne signale que les ancres sans aucun mot du sujet (« en savoir
      // plus »). Un lien image (sans texte) compte aussi.
      const sing = (txt) => canonTokens(txt).filter((w) => !GENERIC.has(w)).map((w) => w.replace(/s$/, ''));
      const tAudit = audits.get(t);
      const subject = new Set([
        ...clean.flatMap((x) => sing(x)),
        ...sing(pathOf(t).split('/').pop().replace(/-/g, ' ')),
        ...sing(tAudit?.title || ''),
      ]);
      const good = !existing.text || sing(existing.text).some((w) => subject.has(w));
      if (!good) lines.push(`- ${pathOf(s)}${vu} : le lien existe mais son ancre est « ${existing.text || 'vide (image ?)'} ». La remplacer par « ${cap(clean[0])} ».`);
    } else {
      lines.push(`- Depuis ${pathOf(s)}${vu} : ajouter un lien vers ${pathOf(t)} avec l'ancre « ${cap(clean[k % clean.length])} », ${placementFor(s)}.`);
      k += 1;
    }
  }
  return { lines, checked };
};

// 1. Cannibalisation : deux de nos pages se partagent une même requête.
// skipRes : requêtes déjà couvertes par une page cible décidée (seoPilotService),
// traitées par les cartes « cible » et jamais par la règle « plus de clics ».
// protectedUrls : pages cibles décidées, jamais modifiées par une carte automatique.
const detectCannibalisation = ({ q, byQuery }, audits, skipRes = [], protectedUrls = new Set()) => {
  const pairs = new Map();
  for (const [query, rows] of byQuery) {
    if (skipRes.some((re) => re.test(query))) continue;
    const qs = q.get(query);
    // Déjà dans le top 3 : le partage ne coûte rien, on n'y touche pas.
    if (!qs || qs.i < 150 || qs.p <= 3 || hasSensitive(query)) continue;
    const total = rows.reduce((s, r) => s + r.i, 0);
    const strong = rows.filter((r) => r.i >= 30 && r.i / total >= 0.15 && !isParamUrl(r.page));
    if (strong.length < 2) continue;
    const [a, b] = strong;
    if (pathOf(a.page) === '/' || pathOf(b.page) === '/') continue;
    const key = [a.page, b.page].sort().join('|');
    if (!pairs.has(key)) pairs.set(key, { pages: [a.page, b.page].sort(), queries: [] });
    pairs.get(key).queries.push({ query, i: qs.i, c: qs.c, p: qs.p, split: strong.slice(0, 2).map((r) => ({ page: r.page, i: r.i, c: r.c, p: r.p })) });
  }
  const recs = [];
  for (const [key, v] of pairs) {
    const totals = new Map(v.pages.map((pg) => [pg, { c: 0, i: 0 }]));
    for (const qq of v.queries) for (const sp of qq.split) { const t = totals.get(sp.page); if (t) { t.c += sp.c; t.i += sp.i; } }
    const byClicks = [...totals.entries()].sort((x, y) => y[1].c - x[1].c || y[1].i - x[1].i).map(([pg]) => pg);
    const est = v.queries.reduce((sum, qq) => sum + 0.5 * gainTo(qq.i, qq.c, qq.p, Math.max(1, qq.p - 1.5)), 0);
    const top = v.queries.sort((x, y) => y.i - x.i);
    const head = top[0];
    // La référence se choisit sur le rôle de chaque page (voir chooseReference),
    // pas sur les clics : « puff elfbar » → page marque, « elfbar 4 in 1 » → fiche.
    const { main, why } = chooseReference(head.query, byClicks, audits);
    const second = byClicks.find((u) => u !== main);
    // Jamais de lien vers une page en noindex.
    if (/noindex/i.test(audits.get(normUrl(main))?.robots || '')) continue;
    const steps = rivalSteps({ query: head.query, main, page: second, audits, protectedUrls });
    // Rien à faire (fiche qui garde son nom, lien déjà en place…) : pas de carte.
    if (!steps.length) continue;
    steps.unshift(`Page de référence : ${pathOf(main)} (${roleOf(main, audits.get(normUrl(main)))}, ${why}).`);
    recs.push({
      rec_key: `cannibalisation:${key}`,
      type: 'cannibalisation',
      effort: 'faible',
      est_clicks: monthly(est),
      title: `Deux pages se partagent « ${head.query} »${top.length > 1 ? ` (+ ${top.length - 1} requête${top.length > 2 ? 's' : ''})` : ''}`,
      reason: `Google montre tantôt ${pathOf(main)}, tantôt ${pathOf(second)}. « ${head.query} » reste en position ${fmt1(head.p)} (${fmtInt(head.i)} impressions en 28 jours).`,
      action: steps.map((t, n) => `${n + 1}. ${t}`).join('\n\n'),
      urls: [main, second],
      queries: top.slice(0, 10).map((x) => qRow(x, 'Partagée entre les deux pages')),
    });
  }
  return recs;
};

// 2. Texte : la page qui porte une requête entre la 4e et la 20e place.
// On juge le title sur la REQUÊTE PRINCIPALE et ses variantes directes (qui
// en contiennent tous les mots) ; les requêtes d'une autre intention sont
// listées à part, jamais transformées en mots à ajouter.
const detectTexte = async (data, audits, claimed = new Map()) => {
  const { q, byQuery } = data;
  const perPage = new Map();
  for (const [query, qs] of q) {
    if (qs.i < 150 || qs.p < 3.5 || qs.p > 20) continue;
    const rows = byQuery.get(query);
    if (!rows || !rows.length) continue;
    const page = rows[0].page;
    if (isParamUrl(page) || pathOf(page) === '/') continue;
    if (!perPage.has(page)) perPage.set(page, []);
    perPage.get(page).push({ query, ...qs });
  }
  const recs = [];
  for (const [page, all] of perPage) {
    all.sort((a, b) => b.i - a.i);
    const elsewhere = all.filter((x) => claimed.has(x.query) && normUrl(claimed.get(x.query)) !== normUrl(page));
    const owned = all.filter((x) => !elsewhere.includes(x));
    if (!owned.length) continue;
    const head = owned[0];
    // Requête principale sur le goût, le prix… : on ne pousse pas la page dessus (DNF).
    if (hasSensitive(head.query)) continue;
    const headTk = canonTokens(head.query);
    const variants = owned.filter((x) => x !== head && headTk.every((t) => canonTokens(x.query).includes(t)));
    const audit = audits.get(normUrl(page));
    const titleNow = audit?.title || '(title non relevé)';
    const where = compact(`${audit?.title || ''} ${audit?.h1 || ''}`);
    const headCovered = tokens(head.query).every((t) => where.includes(t));
    const missing = [];
    for (const v of variants.slice(0, 8)) {
      for (const t of canonTokens(v.query)) {
        if (headTk.includes(t) || t.length < 3 || SENSITIVE.has(t) || GENERIC.has(t) || where.includes(t) || missing.some((m) => m.t === t)) continue;
        missing.push({ t, from: v });
      }
    }
    const scope = [head, ...variants];
    const est = scope.reduce((s, x) => s + gainTo(x.i, x.c, x.p, Math.max(1, x.p - 2)), 0);
    if (monthly(est) < 15) continue;

    const intro = [];
    const blocks = [];
    intro.push(`Requête principale : « ${head.query} » (${fmtInt(head.i)} impressions en 28 j, position ${fmt1(head.p)}).`);
    // 1. Title / H1
    if (!headCovered) {
      blocks.push(`Title et H1 : ils ne contiennent pas tous les mots de « ${head.query} ». Title actuel : « ${titleNow} ». Le commencer par « ${cap(head.query)} », 60 caractères maximum.`);
    } else if (missing.length) {
      blocks.push(`Title : il couvre déjà « ${head.query} » (« ${titleNow} »). Variante à ajouter si la place le permet : ${missing.slice(0, 3).map((m) => `« ${m.t} » (requête « ${m.from.query} », ${fmtInt(m.from.i)} impressions)`).join(', ')}.`);
    }
    // 2. Texte
    // Intertitre utile = une variante qui apporte un vrai mot en plus (pas une
    // simple permutation : « vprime 2 oxva » n'ajoute rien à « oxva vprime 2 »),
    // et un seul intertitre par mot apporté (« elfbar recharge » et « recharge
    // elfbar » sont le même H2).
    const h2Seen = new Set();
    const h2 = variants.filter((v) => {
      if (hasSensitive(v.query)) return false;
      const extra = canonTokens(v.query).filter((t) => !headTk.includes(t) && !GENERIC.has(t) && t.length > 2);
      const key = [...new Set(extra.map(singular))].sort().join(' ');
      if (!key || h2Seen.has(key)) return false;
      h2Seen.add(key);
      return true;
    }).slice(0, 3);
    const words = audit?.word_count || 0;
    blocks.push(`Texte : ${words && words < 400 ? `la page est courte (environ ${words} mots hors menus) ; ajouter un paragraphe factuel qui emploie « ${head.query} »` : `vérifier que « ${head.query} » apparaît dans le premier paragraphe`}${h2.length ? `, et des intertitres (H2) sur : ${h2.map((v) => `« ${cap(v.query)} »`).join(', ')}` : ''}.`);
    // 3. Liens internes
    const links = await linkPlan({
      target: page,
      anchors: [head.query, ...h2.map((v) => v.query)],
      sources: relatedSources(data, head.query, page, audits).slice(0, 10),
      data, audits,
    });
    if (links.lines.length) blocks.push(`Liens internes :\n${links.lines.join('\n')}`);
    // 4. Ce qu'il ne faut pas viser ici
    if (elsewhere.length) {
      const byTarget = new Map();
      for (const x of elsewhere.slice(0, 6)) {
        const tgt = pathOf(claimed.get(x.query));
        if (!byTarget.has(tgt)) byTarget.set(tgt, []);
        byTarget.get(tgt).push(x.query);
      }
      blocks.push(`Ne pas viser ici ${[...byTarget.entries()].map(([tgt, qs]) => `${qs.slice(0, 6).map((x) => `« ${x} »`).join(', ')} : elles relèvent de ${tgt}`).join(' ; ')} (voir le tableau).`);
    }
    const editorial = pageKind(page) === 'article' || pathOf(page).startsWith('/avis-tests/');
    const notes = [];
    if (editorial) notes.push('Contenu éditorial : sujet sensible dans le litige DNF (un blog est présenté comme publicitaire). À arbitrer avec l’avocat avant toute retouche.');
    notes.push(LEGAL_NOTE);
    const numbered = [...intro, ...blocks.map((b, n) => `${n + 1}. ${b}`), ...notes];
    recs.push({
      editorial,
      rec_key: `texte:${page}`,
      type: 'texte',
      effort: 'faible',
      est_clicks: monthly(est),
      title: `${cap(pageKind(page))} à retravailler sur « ${head.query} » : ${pathOf(page)}`,
      reason: `« ${head.query} » est en position ${fmt1(head.p)}${variants.length ? `, avec ${variants.length} variante${variants.length > 1 ? 's' : ''}` : ''}. Gagner deux places la fait passer dans le haut de la première page.`,
      action: numbered.join('\n\n'),
      urls: [page],
      queries: [
        qRow(head, 'Requête principale'),
        ...variants.slice(0, 8).map((x) => qRow(x, hasSensitive(x.query) ? 'Variante (mot sensible : ne pas employer)' : 'Variante')),
        ...elsewhere.slice(0, 6).map((x) => qRow(x, `À laisser à ${pathOf(claimed.get(x.query))}`)),
      ],
    });
  }
  return recs;
};

// 3. Résultat peu cliqué : bien placé mais taux de clic très bas.
const detectSnippet = ({ q, byQuery }, audits) => {
  const perPage = new Map();
  for (const [query, qs] of q) {
    if (qs.i < 200 || qs.p > 6 || hasSensitive(query)) continue;
    const ctr = qs.c / qs.i;
    if (ctr >= 0.5 * ctrAt(qs.p)) continue;
    const page = byQuery.get(query)?.[0]?.page;
    if (!page || isParamUrl(page)) continue;
    if (!perPage.has(page)) perPage.set(page, []);
    perPage.get(page).push({ query, ...qs, ctr });
  }
  return [...perPage.entries()].map(([page, list]) => {
    list.sort((a, b) => b.i - a.i);
    const est = list.reduce((s, x) => s + Math.max(0, x.i * 0.8 * ctrAt(x.p) - x.c), 0);
    const a = audits.get(normUrl(page));
    const h = list[0];
    return {
      rec_key: `snippet:${page}`,
      type: 'snippet',
      effort: 'faible',
      est_clicks: monthly(est),
      title: `Bien placé mais peu cliqué : ${pathOf(page)}`,
      reason: `« ${h.query} » : position ${fmt1(h.p)} mais ${(h.ctr * 100).toFixed(1).replace('.', ',')} % de clics, contre environ ${(ctrAt(h.p) * 100).toFixed(0)} % attendus à cette place.`,
      action: [
        'Regarder la page de résultats Google (mobile, navigation privée) : un concurrent, un bloc de réponse IA ou des encarts au-dessus de nous ?',
        `Réécrire le title (« ${a?.title || '—'} ») et la meta description (« ${a?.meta_description || 'absente'} ») pour qu'ils reprennent exactement la requête et disent ce que la page contient (modèles, formats).`,
        ...(() => {
          const found = [...new Set(tokens(`${a?.title || ''} ${a?.meta_description || ''}`).filter((t) => BANNED.has(t)))];
          return found.length ? [`Le title ou la meta actuels contiennent ${found.map((t) => `« ${t} »`).join(', ')} : à retirer (litige DNF).`] : [];
        })(),
        LEGAL_NOTE,
      ].join('\n\n'),
      urls: [page],
      queries: list.slice(0, 8).map((x) => qRow(x, `Peu cliquée : ${(x.ctr * 100).toFixed(1).replace('.', ',')} % de clics`)),
    };
  });
};

// 4. FAQ : questions tapées par les clients.
const detectFaq = ({ q, byQuery }) => {
  const perPage = new Map();
  for (const [query, qs] of q) {
    if (qs.i < 20 || !QUESTION_RE.test(norm(query)) || HEALTH_RE.test(norm(query)) || FAQ_BANNED_RE.test(norm(query))) continue;
    const page = byQuery.get(query)?.[0]?.page;
    if (!page || isParamUrl(page)) continue;
    if (!perPage.has(page)) perPage.set(page, []);
    perPage.get(page).push({ query, ...qs });
  }
  return [...perPage.entries()]
    .filter(([, list]) => list.reduce((s, x) => s + x.i, 0) >= 100)
    .map(([page, all]) => {
      all.sort((a, b) => b.i - a.i);
      // Une même question tapée de dix façons = une seule entrée de FAQ.
      const keyOf = (txt) => tokens(txt.replace(/\b(mg|milligrammes?|grammes?|il y a|y a[- ]t[- ]il|1|une?)\b/g, ' '))
        .filter((t) => !['combien', 'quel', 'quelle', 'est', 'ce', 'que', 'qu'].includes(t)).sort().join(' ');
      const groups = new Map();
      for (const x of all) {
        const k = keyOf(norm(x.query));
        if (!groups.has(k)) groups.set(k, { ...x, variants: [] });
        else groups.get(k).variants.push(x);
      }
      const list = [...groups.values()];
      const est = all.reduce((s, x) => s + gainTo(x.i, x.c, x.p, Math.max(1, x.p - 2)), 0);
      return {
        rec_key: `faq:${page}`,
        type: 'faq',
        effort: 'faible',
        est_clicks: monthly(est),
        title: `Questions de clients à traiter en FAQ : ${pathOf(page)}`,
        reason: `${list.length} question${list.length > 1 ? 's' : ''} distincte${list.length > 1 ? 's' : ''} (${all.length} formulations) mène${list.length > 1 ? 'nt' : ''} à cette page sans réponse dédiée : ${fmtInt(all.reduce((s, x) => s + x.i, 0))} impressions en 28 jours.`,
        action: `Ajouter une FAQ avec une réponse courte et factuelle à chacune de ces questions (données structurées FAQPage).\n${LEGAL_NOTE}`,
        proposal: list.slice(0, 8).map((x) => `- ${cap(x.query)} ?${x.variants.length ? ` (aussi tapée de ${x.variants.length} autre${x.variants.length > 1 ? 's' : ''} façon${x.variants.length > 1 ? 's' : ''})` : ''}`).join('\n'),
        urls: [page],
        queries: list.slice(0, 8).flatMap((x) => [qRow(x, 'Question à traiter'), ...x.variants.slice(0, 2).map((v) => qRow(v, `Même question que « ${x.query} »`))]),
      };
    });
};

// 5. Indexation : URL parasites, pages en erreur, redirigées ou en noindex.
const detectIndexation = ({ pageStats }, audits) => {
  const recs = [];
  const families = [
    { key: 'attribute', re: /\?attribute_pa_/, label: 'URL de déclinaison (?attribute_pa_…)',
      action: 'Ces URL ont une canonical vers la fiche, mais robots.txt (`Disallow: /*?attribute_pa_*`) empêche Google de la lire : il les indexe sans contenu. Retirer cette ligne de robots.txt pour que la canonical fasse son travail (les impressions reviendront sur la fiche).' },
    { key: 'filters', re: /\/filters\//, label: 'Pages de filtre (/filters/…)',
      action: 'Bloquées par robots.txt (`Disallow: /*/filters/*`), elles sont indexées sans contenu. Mettre une balise noindex, follow sur les pages de filtre, PUIS retirer la ligne du robots.txt pour que Google la lise. Sans ces deux étapes dans cet ordre, ne rien changer (impact faible).' },
    { key: 'cart', re: /add-to-cart=|is_modal=|controller=cart|remove_from_wishlist/, label: 'URL d’ajout au panier ou de fenêtre',
      action: 'Ajouter `Disallow: /*?add-to-cart=*` et `Disallow: /*?is_modal=*` dans robots.txt, et vérifier qu’aucun lien du site ne pointe vers ces URL.' },
    { key: 'pagination', re: /\/page\/\d+/, label: 'Pages 2, 3… des listes',
      action: 'Donner à chaque page de pagination sa propre canonical (aujourd’hui la page 2 pointe vers la page 1), pour que Google découvre les produits listés plus loin.' },
  ];
  for (const f of families) {
    const pages = [...pageStats.entries()].filter(([u, s]) => f.re.test(u) && s.i > 0);
    const impr = pages.reduce((s, [, x]) => s + x.i, 0);
    if (impr < 30) continue;
    recs.push({
      rec_key: `indexation:${f.key}`,
      type: 'indexation',
      effort: 'faible',
      est_clicks: monthly(impr * 0.01),
      title: `${f.label} : ${pages.length} URL visibles dans Google`,
      reason: `${fmtInt(impr)} impressions en 28 jours sur des URL qui ne devraient pas apparaître : elles diluent les pages qui comptent.`,
      action: f.action,
      urls: pages.sort((a, b) => b[1].i - a[1].i).slice(0, 10).map(([u]) => u),
    });
  }
  for (const [url, a] of audits) {
    const s = pageStats.get(url);
    if (!s || s.i < 20) continue;
    if (a.http_status >= 400) {
      recs.push({
        rec_key: `redirection:${url}`,
        type: 'redirection',
        effort: 'faible',
        est_clicks: monthly(s.c * 1.5 + s.i * 0.01),
        title: `Page en erreur ${a.http_status} encore affichée par Google : ${pathOf(url)}`,
        reason: `${fmtInt(s.i)} impressions et ${fmtInt(s.c)} clics en 28 jours mènent à une page qui n'existe plus.`,
        action: 'Créer une redirection 301 (Yoast > Redirections) vers la page la plus proche : la fiche du successeur, sinon la page du modèle ou de la marque. Jamais vers l’accueil.',
        urls: [url],
      });
    } else if (a.http_status === 301 || a.http_status === 302) {
      recs.push({
        rec_key: `redirection:${url}`,
        type: 'redirection',
        effort: 'faible',
        est_clicks: monthly(s.i * 0.005),
        title: `Google affiche une URL redirigée : ${pathOf(url)}`,
        reason: `Elle redirige (${a.http_status}) vers ${pathOf(a.location)} mais reçoit encore ${fmtInt(s.i)} impressions.`,
        action: `${a.http_status === 302 ? 'Passer la redirection en 301 (permanente). ' : ''}Vérifier que la destination est la bonne et remplacer les liens internes qui pointent encore vers l’ancienne URL.`,
        urls: [url, a.location].filter(Boolean),
      });
    } else if (a.http_status === 200 && /noindex/i.test(a.robots || '') && s.i >= 50) {
      recs.push({
        rec_key: `noindex:${url}`,
        type: 'indexation',
        effort: 'faible',
        est_clicks: monthly(s.c),
        title: `Page en noindex encore visible : ${pathOf(url)}`,
        reason: `Elle est en noindex mais a encore ${fmtInt(s.i)} impressions (Google la retire en quelques semaines).`,
        action: 'Si cette page doit se classer, la repasser en index (réglage Yoast de la page). Sinon, ne rien faire : elle va sortir de Google.',
        urls: [url],
      });
    }
  }
  return recs;
};

// Étiquettes et pages WordPress existantes (même sans impression : une page
// ouverte la veille n'a encore aucune donnée Search Console).
const loadSitePages = async () => {
  const out = [];
  const fetchAll = async (endpoint, toUrl) => {
    for (let page = 1; page <= 20; page += 1) {
      const res = await axios.get(`${SITE}/wp-json/wp/v2/${endpoint}`, {
        params: { per_page: 100, page, _fields: 'slug,link' },
        headers: { 'User-Agent': USER_AGENT }, timeout: 30000, validateStatus: () => true,
      });
      if (res.status !== 200 || !Array.isArray(res.data) || !res.data.length) break;
      res.data.forEach((x) => out.push({ slug: x.slug, url: toUrl(x) }));
      if (res.data.length < 100) break;
    }
  };
  try {
    await fetchAll('product_tag', (x) => x.link || `${SITE}/etiquette-produit/${x.slug}`);
    await fetchAll('pages', (x) => x.link);
  } catch (error) {
    console.error('[SEO] Liste des pages WordPress :', error.message);
  }
  return out.map((x) => ({ ...x, url: (x.url || '').replace(/\/$/, '') }));
};

// Vocabulaire du plan de page selon ce que vend la page : on ne parle pas de
// bouffées ni de batterie pour des e-liquides.
// Formules promotionnelles ou mélioratives à retirer d'un title (DNF).
const MARKETING_RE = /abondant|intense|id[eé]al|parfait|unique|exceptionnel|incroyable|r[eé]volution|ultime|g[eé]nial|meilleu|premium|luxe|nuages?|plaisir|durable|lumineuse|puissant/i;
// Les mots de B sont-ils tous dans A (ordre et capacité indifférents) ?
const coveredBy = (a, b) => { const ta = new Set(tokens(a)); return tokens(b).every((t) => ta.has(t)); };

const PROFILES = {
  puff: {
    comparatif: 'capacité, bouffées annoncées, batterie, recharge, taux de nicotine',
    meta: 'Capacité, autonomie, recharge et compatibilités de chaque modèle.',
    h2: 'caractéristiques, recharge, compatibilités',
    faq: 'fonctionnement, recharge, compatibilité, légalité',
  },
  liquide: {
    comparatif: 'format (10 ml, 50 ml), taux de nicotine, type de nicotine (sels ou classique), ratio PG/VG',
    meta: 'Formats, taux de nicotine, ratio PG/VG et compatibilités.',
    h2: 'formats, taux de nicotine, ratio PG/VG, compatibilités',
    faq: 'compatibilité avec les puffs rechargeables et les pods, sels de nicotine, formats, conservation',
  },
};

// Décision d'indexation des sous-étiquettes (e-liquides-jnr-50ml-sans-nicotine
// sous e-liquides-jnr…) : faut-il l'ouvrir à Google ou la laisser fermée ?
// Critères : nombre de produits listés, demande de recherche qui lui revient en
// propre, page qui reçoit aujourd'hui cette demande.
const INDEX_DEMAND_MIN = 100; // impressions sur 28 jours
const singular = (w) => w.replace(/s$/, '');
const productLinks = (a) => [...new Set((a?.links || []).map((l) => l.href).filter((h) => /\/produit\//.test(h)))];

const indexDecisions = new Map(); // url → { decision, demand, products, top }

const detectIndexDecisions = async (data, audits, sitePages) => {
  indexDecisions.clear();
  const tags = sitePages.filter((x) => /\/etiquette-produit\//.test(x.url));
  const recs = [];
  for (const child of tags) {
    const parent = tags.filter((p) => child.slug.startsWith(`${p.slug}-`)).sort((a, b) => b.slug.length - a.slug.length)[0];
    if (!parent) continue;
    const parentCore = coreTokens(parent.slug.replace(/-/g, ' ')).map(singular).filter((t) => t.length > 1);
    // La marque/le modèle de la page mère est obligatoire (« jnr ») : sans elle,
    // « e liquide 50ml » (toutes marques) gonflerait la demande.
    const mustHave = parentCore.filter((t) => !['liquide', 'eliquide', 'puff'].includes(t));
    const suffix = child.slug.slice(parent.slug.length + 1).split('-');
    const strong = suffix.filter((t) => !['sans', 'avec', 'nicotine', 'de', 'sel', 'sels'].includes(t));
    const wantSans = suffix.includes('sans');
    const wantAvec = suffix.includes('avec') || suffix.includes('sel') || suffix.includes('sels');
    // Requêtes qui reviennent EN PROPRE à cette sous-page.
    const matches = [];
    for (const [query, qs] of data.q) {
      const c = compact(canon(query));
      const hasCore = parentCore.filter((t) => c.includes(t));
      let ok;
      if (strong.length) ok = mustHave.every((t) => c.includes(t)) && hasCore.length >= 1 && strong.every((t) => c.includes(compact(t)));
      else ok = hasCore.length === parentCore.length
        && (wantSans ? c.includes('sansnicotine') : true)
        && (wantAvec ? (c.includes('nicotine') || c.includes('sel')) && !c.includes('sansnicotine') : true);
      if (ok) matches.push({ query, ...qs });
    }
    const demand = matches.reduce((x, m) => x + m.i, 0);
    let a = audits.get(normUrl(child.url));
    if (!a || !Array.isArray(a.links)) {
      a = await auditUrl(child.url);
      if (a.http_status) { await saveAudit(a); audits.set(normUrl(child.url), a); }
    }
    if (!a || a.http_status !== 200) continue;
    const products = productLinks(a);
    const noindex = /noindex/i.test(a.robots || '');
    matches.sort((x, y) => y.i - x.i);
    const owner = new Map();
    for (const m of matches) for (const r of data.byQuery.get(m.query) || []) owner.set(r.page, (owner.get(r.page) || 0) + r.i);
    const topOwner = [...owner.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || null;
    // Une fiche porte-t-elle déjà la recherche ? Si oui, ouvrir l'étiquette la
    // concurrencerait. On n'ouvre que pour une vraie FAMILLE (≥ 3 fiches sur la
    // même recherche, ex. les 16 e-liquides JNR 50 ml) qu'aucune fiche ne porte.
    const headCore = matches[0] ? coreTokens(canon(matches[0].query)).filter((t) => t.length > 1) : [];
    const slugOf = (u) => canon(pathOf(u).split('/').pop().replace(/-/g, ' '));
    const covering = products.filter((u) => headCore.length && headCore.every((t) => compact(slugOf(u)).includes(t)));
    // Modèles distincts parmi ces fiches : ce qui reste de l'adresse une fois
    // retirés les mots de la recherche, la marque (dernier mot) et les mots de
    // conditionnement (kit, pack, recharges, 12mg…). Kit et packs Nexi One Dual
    // = un modèle ; Gorilla X, Z Pluse, Meteorite sans nicotine = trois.
    const SLUG_NOISE = /^(puff|puffs|kit|pack|pod|pen|duo|recharges?|cartouches?|\d+[a-z]*|x\d+|sans|nicotine|avec)$/;
    const models = new Set(covering.map((u) => {
      const words = slugOf(u).split(' ');
      return words.slice(0, -1).filter((w) => !headCore.includes(w) && !SLUG_NOISE.test(w)).join(' ');
    }));
    const ownerIsFiche = topOwner && pageKind(topOwner) === 'fiche produit';
    let decision;
    if (products.length <= 1) decision = 'noindex-fiche';
    else if (demand < INDEX_DEMAND_MIN) decision = 'noindex-faible';
    else if (ownerIsFiche || models.size <= 1) decision = 'noindex-fiche-porte';
    else decision = 'index';
    indexDecisions.set(normUrl(child.url), { decision, demand, products: products.length, product: products[0] || null, top: matches[0]?.query || null });

    const qRows = matches.slice(0, 10).map((m) => qRow(m, 'Recherche qui revient à cette page'));
    if (noindex && decision === 'index') {
      const head = matches[0];
      const links = await linkPlan({
        target: child.url,
        anchors: matches.filter((m) => !hasSensitive(m.query)).slice(0, 3).map((m) => m.query),
        sources: [parent.url, ...(topOwner ? [topOwner] : []), ...products.slice(0, 4)],
        data, audits, max: 5,
      });
      recs.push({
        rec_key: `index-ouvrir:${child.url}`,
        type: 'indexation',
        effort: 'faible',
        est_clicks: monthly(gainTo(demand, matches.reduce((x, m) => x + m.c, 0), null, 5)),
        title: `Passer en index : ${pathOf(child.url)}`,
        reason: `Page en noindex alors qu'elle liste ${products.length} produits et que ses recherches font ${fmtInt(demand)} impressions en 28 jours (« ${head.query} » en tête)${topOwner ? `, servies aujourd'hui par ${pathOf(topOwner)}` : ''}.`,
        action: [
          `Yoast > réglages de l'étiquette : passer ${pathOf(child.url)} en index, follow.`,
          tokens(head.query).every((t) => compact(a.title || '').includes(t))
            ? 'Ajouter un court texte factuel au-dessus de la grille.'
            : `Title et H1 : reprendre « ${cap(head.query)} » (title actuel : « ${a.title || '—'} »). Ajouter un court texte factuel au-dessus de la grille.`,
          ...(links.lines.length ? [`Liens internes :\n${links.lines.join('\n')}`] : []),
          'Search Console > Inspection de l’URL > Demander l’indexation.',
        ].map((t, n) => `${n + 1}. ${t}`).join('\n\n'),
        urls: [child.url, parent.url],
        queries: qRows,
      });
    } else if (!noindex && decision === 'noindex-fiche') {
      recs.push({
        rec_key: `index-fermer:${child.url}`,
        type: 'indexation',
        effort: 'faible',
        est_clicks: monthly(demand * 0.005),
        title: `Passer en noindex : ${pathOf(child.url)} (doublon de sa fiche)`,
        reason: `Elle ne liste ${products.length ? 'qu’un produit' : 'aucun produit'} : Google voit deux pages pour la même chose${products[0] ? ` (avec ${pathOf(products[0])})` : ''}.`,
        action: [
          `1. Yoast : passer ${pathOf(child.url)} en noindex, follow.`,
          products[0] ? `2. Faire pointer les liens vers ${pathOf(products[0])} plutôt que vers l'étiquette.` : '2. Retirer les liens qui pointent vers elle.',
        ].join('\n\n'),
        urls: [child.url, ...(products[0] ? [products[0]] : [])],
        queries: qRows,
      });
    }
  }
  return recs;
};

// Vers quelle adresse faire un lien ? Une page en noindex qui ne contient
// qu'un produit (étiquette e-liquides JNR 10 ml sans nicotine) renvoie vers la
// fiche de ce produit : Google ne classe pas l'étiquette, le lien ne lui sert à
// rien. Avec plusieurs produits, on garde l'étiquette mais on le signale.
const resolveLinkTarget = async (url, audits) => {
  if (!url) return { url: null, note: '' };
  let a = audits.get(normUrl(url));
  if (!a || !Array.isArray(a.links)) {
    a = await auditUrl(url);
    if (a.http_status) { await saveAudit(a); audits.set(normUrl(url), a); }
  }
  if (!/noindex/i.test(a?.robots || '')) return { url, note: '' };
  const products = productLinks(a);
  const d = indexDecisions.get(normUrl(url));
  if (products.length === 1) return { url: products[0], note: ' (fiche produit : la page qui la liste est en noindex avec un seul produit)' };
  if (d?.decision === 'index') return { url, note: ' (page à passer en index : voir la carte « Passer en index »)' };
  if (d?.decision === 'noindex-fiche-porte') return { url, note: ' (page à laisser en noindex : une fiche porte déjà ses recherches ; lien pour la navigation seulement)' };
  if (d) return { url, note: ` (page à laisser en noindex : ${fmtInt(d.demand)} impressions en 28 jours sur ses recherches ; lien pour la navigation seulement)` };
  return { url, note: ' (page en noindex : lien pour la navigation seulement)' };
};

// Groupes « type de produit » : une requête qui les touche leur revient en
// priorité (« liquide jnr sans nicotine » → e-liquides, pas les puffs).
const PRODUCT_TYPE_GROUPS = ['eliquide-jnr'];

// Nom de modèle tiré du title d'une fiche : « Puff JNR Gorilla X 43k sans Nicotine JNR - YouVape » → « Gorilla X 43k ».
const modelLabel = (a) => {
  const raw = (a?.h1 || a?.title || '').replace(/\s*[-–|]\s*YouVape.*$/i, '');
  return raw
    .replace(/\bpuffs?\b|\bjnr\b|\bsans nicotine\b|\bavec nicotine\b|\b\d+\s?mg\b|\bpar\b|&|fighter fuel|\bcartouches?\b/gi, ' ')
    .replace(/[,:–-]/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').slice(0, 3).join(' ');
};

// 6. Création / renforcement d'une page pour un groupe de requêtes.
const detectCreation = async (data, audits, sitePages, claimed) => {
  const { q, byQuery, pageStats } = data;
  const groups = (await pool.query('SELECT slug, name, pattern, sort FROM gsc_query_groups WHERE active ORDER BY sort, id')).rows;
  const regex = new Map();
  for (const g of groups) { try { regex.set(g.slug, new RegExp(g.pattern, 'i')); } catch { /* motif invalide */ } }
  // Les groupes « type de produit » d'abord : leur page dédiée sert de renvoi aux autres.
  const ordered = [...groups.filter((g) => PRODUCT_TYPE_GROUPS.includes(g.slug)), ...groups.filter((g) => !PRODUCT_TYPE_GROUPS.includes(g.slug))];
  const dedicatedOf = new Map();
  const recs = [];
  for (const g of ordered) {
    if (GROUPS_WITHOUT_PAGE.has(g.slug) || !regex.has(g.slug)) continue;
    const re = regex.get(g.slug);
    const isProductType = PRODUCT_TYPE_GROUPS.includes(g.slug);
    const all = [...q.entries()].filter(([query]) => re.test(query)).map(([query, s]) => ({ query, ...s }));
    const routed = isProductType ? [] : all.filter((x) => PRODUCT_TYPE_GROUPS.some((pt) => regex.get(pt)?.test(x.query)));
    const list = all.filter((x) => !routed.includes(x)).sort((a, b) => b.i - a.i);
    const impr = list.reduce((s, x) => s + x.i, 0);
    const clicks = list.reduce((s, x) => s + x.c, 0);
    if (!list.length) continue;
    const pos = list.reduce((s, x) => s + x.p * x.i, 0) / (impr || 1);
    const head = list[0];
    const headTokens = tokens(head.query);
    const pageImpr = new Map();
    for (const x of list) for (const r of byQuery.get(x.query) || []) {
      if (isParamUrl(r.page)) continue;
      pageImpr.set(r.page, (pageImpr.get(r.page) || 0) + r.i);
    }
    const ranked = [...pageImpr.entries()].sort((a, b) => b[1] - a[1]);
    const topPage = ranked[0]?.[0];
    const share = topPage && pageStats.get(topPage)?.i ? ranked[0][1] / pageStats.get(topPage).i : 0;
    const okSlug = (slug) => headTokens.every((t) => compact(slug).includes(t)) && (isProductType || !/liquid/.test(slug));
    let slugMatch = ranked.find(([u]) => okSlug(pathOf(u)) && pageKind(u) !== 'fiche produit');
    if (!slugMatch) {
      const site = sitePages.filter((x) => okSlug(x.slug)).sort((a, b) => a.slug.length - b.slug.length)[0];
      if (site) slugMatch = [site.url, 0];
    }
    let dedicatedNoindex = false;
    let dedAudit = null;
    if (slugMatch) {
      // Toujours relu : ces pages changent souvent de statut (ouvertures du 19 au 21/10).
      const a = await auditUrl(slugMatch[0]);
      dedAudit = a;
      if (a.http_status) { await saveAudit(a); audits.set(normUrl(slugMatch[0]), a); }
      dedicatedNoindex = /noindex/i.test(a?.robots || '');
      if (!dedicatedNoindex) {
        dedicatedOf.set(g.slug, slugMatch[0]);
        for (const x of list) claimed.set(x.query, slugMatch[0]);
      }
    }
    if (impr < 800 || pos <= 4) continue;
    const generic = !topPage || share < 0.4 || pageKind(topPage) === 'accueil';
    // Une fiche produit dont le title porte déjà le modèle EST la page dédiée
    // (Z Pulse : « Puff JNR Z Pluse 42k - 2 en 1 - Double Saveur ») : pas de création.
    const topTitle = compact(audits.get(normUrl(topPage || ''))?.title || '');
    const core = coreTokens(head.query);
    const ficheDedicated = topPage && pageKind(topPage) === 'fiche produit'
      && core.filter((t) => topTitle.includes(t)).length >= Math.min(2, core.length);
    const est = gainTo(impr, clicks, pos, 3);

    // Requête du title : celle dont tous les mots sont dans l'adresse de la page dédiée.
    const target = slugMatch ? slugMatch[0] : null;
    const slugTk = target ? tokens(pathOf(target).split('/').pop().replace(/-/g, ' ')) : [];
    const titleHead = (target && list
      .filter((x) => tokens(x.query).every((t) => slugTk.includes(t)))
      .sort((a, b) => tokens(b.query).length - tokens(a.query).length || b.i - a.i)[0]) || head;

    // Modèles (fiches qui se classent déjà) ou sous-pages (e-liquides).
    const fiches = ranked
      .filter(([u]) => pageKind(u) === 'fiche produit' && (isProductType || !/\/eliquides\//.test(u)))
      .slice(0, 8).map(([u]) => u);
    const labels = [];
    const cartouches = [];
    if (isProductType && target) {
      const base = pathOf(target).split('/').pop();
      // Intitulé = le vrai title de la sous-page (« E-Liquides JNR 10ml Sel de Nicotine »),
      // sans les mots déjà dans la requête : « 10ml Sel de Nicotine ».
      for (const sp of sitePages.filter((x) => x.slug.startsWith(`${base}-`))) {
        let a = audits.get(normUrl(sp.url));
        if (!a) { a = await auditUrl(sp.url); if (a.http_status) { await saveAudit(a); audits.set(normUrl(sp.url), a); } }
        const full = (a?.h1 || a?.title || '').replace(/\s*[-–|]\s*YouVape.*$/i, '').replace(/\s*[-–]\s*Page \d+$/i, '').trim();
        const headTk = tokens(head.query).map((w) => w.replace(/s$/, ''));
        const label = full.split(/\s+/).filter((w) => !['e', 'eliquide', 'liquide', 'jnr'].includes(norm(w).replace(/[^a-z0-9]/g, '').replace(/s$/, '')) && !headTk.includes(norm(w).replace(/s$/, ''))).join(' ').trim()
          || sp.slug.slice(base.length + 1).replace(/-/g, ' ');
        const dest = await resolveLinkTarget(sp.url, audits);
        labels.push({ label, url: dest.url, note: dest.note, title: full });
      }
    } else {
      // Seuls les modèles de LA page dédiée : l'étiquette jnr-falcon-28k ne porte
      // ni la Nexus 40K ni la Mini 20K, même si le groupe de requêtes les mélange.
      const slugCore = target
        ? coreTokens(pathOf(target).split('/').pop().replace(/-/g, ' ')).filter((t) => t !== 'jnr' && t.length > 1)
        : [];
      const nicOf = (u, title) => (/sans-nicotine|0mg/.test(u) || /sans nicotine|\b0 ?mg\b/i.test(title) ? 'sans nicotine' : 'avec nicotine');
      for (const u of fiches) {
        let a = audits.get(u) || audits.get(normUrl(u));
        if (!a) { a = await auditUrl(u); if (a.http_status) await saveAudit(a); }
        const title = a?.title || '';
        const isCart = /cartouche/.test(u);
        // Une cartouche sert souvent plusieurs capacités : on ne lui demande que le nom du modèle.
        const need = isCart ? slugCore.filter((t) => !/\d/.test(t)) : slugCore;
        if (need.length && !need.every((t) => compact(`${pathOf(u)} ${title}`).includes(t))) continue;
        if (isCart) {
          // Une cartouche n'est pas un modèle : intertitre à part.
          // Nom seul : « Cartouche Gorilla X JNR - Vapotez le liquide de votre choix » → « Cartouche Gorilla X JNR ».
          cartouches.push({ url: u, title: title.replace(/\s*[-–|]\s*YouVape.*$/i, '').split(/\s+[-–|:]\s+/)[0] });
          continue;
        }
        const label = modelLabel(a);
        if (!label) continue;
        const nic = nicOf(u, title);
        const twin = labels.find((l) => compact(l.base) === compact(label));
        if (twin) {
          // Même modèle avec et sans nicotine : deux fiches, deux intertitres.
          if (!twin.label.endsWith(twin.nic)) twin.label = `${twin.base} ${twin.nic}`;
          if (twin.nic !== nic) labels.push({ label: `${label} ${nic}`, base: label, nic, url: u, title });
          continue;
        }
        labels.push({ label, base: label, nic, url: u, title });
      }
    }
    const hasNico = fiches.some((u) => !/sans-nicotine|0mg/.test(u));
    const hasZero = fiches.some((u) => /sans-nicotine|0mg/.test(u));
    // Un modèle qui ne fait que répéter la requête n'apporte rien au title.
    const headCompact = compact(titleHead.query);
    const bases = [...new Set(labels.map((l) => l.base || l.label))];
    const informative = bases.filter((b) => !headCompact.includes(compact(b)) && !coveredBy(titleHead.query, b));
    const facets = informative.length >= 2 ? informative : [
      ...informative,
      ...(hasNico && hasZero ? ['avec ou sans nicotine'] : []),
      ...(cartouches.length ? ['cartouches'] : []),
    ];
    // Casse des noms propres reprise des titles des fiches (« Meteorite 100K », « Gorilla X »).
    const casing = new Map();
    for (const l of labels) for (const w of `${l.title} ${l.label}`.split(/\s+/)) if (/[A-Z]/.test(w)) casing.set(norm(w), w);
    const nice = (txt) => cap(txt.split(' ').map((w) => casing.get(norm(w)) || w).join(' '));
    let title = nice(titleHead.query);
    for (const f of facets) {
      const next = `${title}${title.includes(':') ? ', ' : ' : '}${f}`;
      if (next.length > 60) break;
      title = next;
    }
    const routedTarget = routed.length ? (dedicatedOf.get(PRODUCT_TYPE_GROUPS.find((pt) => regex.get(pt)?.test(routed[0].query))) || null) : null;
    // Pour le sans nicotine, la recharge renvoie vers l'étiquette e-liquides 0 mg si elle existe.
    const liquidZero = /sans|0/.test(titleHead.query)
      ? sitePages.filter((x) => /liquid/.test(x.slug) && headTokens.filter((t) => !GENERIC.has(t)).every((t) => compact(x.slug).includes(t))).sort((a, b) => a.slug.length - b.slug.length)[0]
      : null;
    const recharge = await resolveLinkTarget(liquidZero?.url || routedTarget, audits);
    const rechargeUrl = recharge.url;
    const questions = list.filter((x) => QUESTION_RE.test(norm(x.query)) && !HEALTH_RE.test(norm(x.query)) && !FAQ_BANNED_RE.test(norm(x.query))).slice(0, 6).map((x) => x.query);
    const employ = list.filter((x) => !hasSensitive(x.query)).slice(0, 12);
    // Page existante : on montre l'actuel à côté du proposé (on MODIFIE, on ne crée pas).
    const curTitle = dedAudit?.title ? dedAudit.title.replace(/\s*[-–|]\s*YouVape\s*$/i, '') : null;
    const curH1 = dedAudit?.h1 || null;
    const same = (x, y) => x && compact(x) === compact(y);
    const profile = isProductType || /liquid/.test(pathOf(target || '')) ? PROFILES.liquide : PROFILES.puff;
    // Un title ou un H1 actuel qui contient déjà la requête se garde : on ne fait
    // que compléter le title avec ce qui manque (« E-liquides JNR » couvre
    // « liquide jnr » et garde la forme « e-liquide », très recherchée).
    const covers = (txt) => txt && tokens(titleHead.query).every((t) => compact(txt).includes(t));
    // Segments promotionnels du title actuel (« Vapeur abondante en tirage aérien ») : retirés.
    const marketing = curTitle ? curTitle.split(/\s+[-–|:]\s+/).filter((seg) => MARKETING_RE.test(seg)) : [];
    // Sans formule à retirer, le title garde ses séparateurs d'origine.
    const cleanTitle = !curTitle ? null
      : (marketing.length ? curTitle.split(/\s+[-–|:]\s+/).filter((seg) => !MARKETING_RE.test(seg)).join(' - ') : curTitle);
    let proposedTitle = title;
    if (covers(cleanTitle)) {
      proposedTitle = cleanTitle;
      for (const f of facets) {
        if (compact(proposedTitle).includes(compact(f)) || coveredBy(proposedTitle, f)) continue;
        const next = `${proposedTitle}${proposedTitle.includes(':') ? ', ' : ' : '}${f}`;
        if (next.length > 60) break;
        proposedTitle = next;
      }
    }
    const h1Keep = covers(curH1);
    const metaHead = h1Keep ? curH1.replace(/\s+-\s+/g, ' ') : nice(titleHead.query);
    // Ce que le nom de la page dit déjà ne se répète pas (« JNR Falcon X 28K : 28k Falcon X »).
    const metaFacets = facets.filter((f) => !coveredBy(metaHead, f));
    // Un title ou un H1 déjà bon n'apparaît pas dans le plan.
    const plan = [
      curTitle
        ? (same(curTitle, proposedTitle) ? null : `Title : remplacer « ${curTitle} » par « ${proposedTitle} »${marketing.length ? ` (retirer ${marketing.map((m) => `« ${m} »`).join(', ')} : formule promotionnelle, litige DNF)` : ''}`)
        : `Title : « ${proposedTitle} »`,
      curH1
        ? (h1Keep ? null : `H1 : remplacer « ${curH1} » par « ${nice(titleHead.query)} »`)
        : `H1 : « ${nice(titleHead.query)} »`,
      `Meta description : « ${metaHead}${metaFacets.length ? ` : ${metaFacets.slice(0, 4).join(', ')}` : ''}. ${profile.meta} »`,
      `Introduction : 2 à 3 phrases factuelles sur ce que regroupe la page${metaFacets.length ? ` (${metaFacets.join(', ')})` : ''}.`,
      `Grille des produits, puis un tableau comparatif : ${profile.comparatif}.`,
      ...labels.slice(0, 5).map((l) => `H2 : ${profile === PROFILES.liquide ? (l.title || l.label) : l.label} : ${profile.h2} ; lien vers ${pathOf(l.url)}${l.note || ''}`),
      ...cartouches.slice(0, 2).map((c) => `H2 : ${c.title} : compatibilité, contenance, résistance ; lien vers ${pathOf(c.url)}`),
      ...(rechargeUrl && !isProductType ? [`H2 : Recharger : e-liquides compatibles ; lien vers ${pathOf(rechargeUrl)}${recharge.note}`] : []),
      questions.length
        ? `FAQ (questions réellement tapées) :\n${questions.map((x) => `  - ${cap(x)} ?`).join('\n')}`
        : `FAQ : 3 à 5 questions factuelles (${profile.faq}).`,
      `Requêtes à employer dans le texte : ${employ.map((x) => x.query).join(', ')}`,
      ...(routed.length ? [`Requêtes à NE PAS viser ici (elles relèvent ${rechargeUrl ? `de ${pathOf(rechargeUrl)}` : 'des e-liquides'}) : ${routed.slice(0, 6).map((x) => x.query).join(', ')}`] : []),
      LEGAL_NOTE,
    ].filter(Boolean);
    const routedPath = rechargeUrl ? pathOf(rechargeUrl) : 'les e-liquides';
    const queriesOut = [
      ...employ.map((x) => qRow(x, x === titleHead ? 'Requête du title' : 'À employer dans le texte')),
      ...list.filter((x) => questions.includes(x.query) && !employ.includes(x)).map((x) => qRow(x, 'Question pour la FAQ')),
      ...list.filter((x) => hasSensitive(x.query)).slice(0, 4).map((x) => qRow(x, 'Mot sensible : ne pas employer')),
      ...routed.slice(0, 6).map((x) => qRow(x, `Renvoyée vers ${routedPath}`)),
    ];

    // Étiquette de modèle en noindex : si une ou deux fiches portent déjà la
    // recherche (Meteorite avec / sans nicotine), on la laisse fermée — pas de
    // carte, la carte « texte » de la fiche suffit. Sinon, on propose de l'ouvrir.
    const coveringFiches = fiches.filter((u) => !/cartouche/.test(u)
      && coreTokens(titleHead.query).every((t) => compact(`${pathOf(u)} ${(audits.get(normUrl(u)) || {}).title || ''}`).includes(t)));
    if (slugMatch && dedicatedNoindex && coveringFiches.length <= 2) continue;
    if (slugMatch && dedicatedNoindex) {
      recs.push({
        rec_key: `noindex-dedie:${g.slug}`,
        type: 'indexation',
        effort: 'faible',
        est_clicks: monthly(est * 0.5),
        title: `Passer en index : ${pathOf(slugMatch[0])} (« ${g.name} »)`,
        reason: `Le groupe fait ${fmtInt(impr)} impressions en 28 jours en position ${fmt1(pos)}, réparties sur ${coveringFiches.length} fiches. Une page qui les regroupe existe mais est en noindex.`,
        action: `1. Yoast : passer ${pathOf(slugMatch[0])} en index, follow.\n\n2. La construire selon le plan ci-dessous et la relier depuis les fiches.\n\n3. Search Console > Inspection de l\u2019URL > Demander l\u2019indexation.`,
        proposal: plan.join('\n\n'),
        urls: [slugMatch[0], topPage],
        queries: queriesOut,
      });
      continue;
    }
    if (slugMatch && normUrl(slugMatch[0]) !== normUrl(topPage)) {
      const links = await linkPlan({
        target: slugMatch[0],
        anchors: [titleHead.query, head.query, ...list.slice(1, 3).map((x) => x.query)],
        sources: [topPage, ...fiches, ...relatedSources(data, titleHead.query, slugMatch[0], audits)].filter(Boolean),
        data, audits, max: 6,
      });
      recs.push({
        rec_key: `renfort:${g.slug}`,
        type: 'modification',
        effort: 'moyen',
        est_clicks: monthly(est * 0.7),
        title: `Modifier la page existante ${pathOf(slugMatch[0])} pour qu'elle porte « ${titleHead.query} »`,
        reason: `Le groupe fait ${fmtInt(impr)} impressions en 28 jours en position ${fmt1(pos)}. Google montre surtout ${pathOf(topPage)} (${pageKind(topPage)}), alors que la page dédiée existe${slugMatch[1] ? '' : ' et n’a encore aucune impression : elle manque de liens'}.`,
        action: [
          `Modifier ${pathOf(slugMatch[0])}, qui existe déjà (ne pas créer d'autre page : ce serait de la cannibalisation). Title, H1 et texte selon le plan ci-dessous${dedAudit?.word_count ? ` ; la page fait aujourd'hui environ ${dedAudit.word_count} mots hors menus` : ''}.`,
          ...(links.lines.length ? [`Liens internes vers ${pathOf(slugMatch[0])} :\n${links.lines.join('\n')}`] : []),
        ].map((t, n) => `${n + 1}. ${t}`).join('\n\n'),
        proposal: plan.join('\n\n'),
        urls: [slugMatch[0], topPage],
        queries: queriesOut,
      });
    } else if (!slugMatch && generic && !ficheDedicated) {
      recs.push({
        rec_key: `creation:${g.slug}`,
        type: 'creation',
        effort: 'élevé',
        est_clicks: monthly(est * 0.7),
        title: `Créer une page dédiée « ${g.name} »`,
        reason: `${fmtInt(impr)} impressions en 28 jours en position ${fmt1(pos)}, sans page dédiée : Google utilise ${topPage ? `${pathOf(topPage)} (${pageKind(topPage)}, ces requêtes n'y pèsent que ${Math.round(share * 100)} %)` : 'des pages diverses'}.`,
        action: 'Créer la page (format étiquette, comme le reste de la grappe JNR) selon le plan ci-dessous, puis la relier depuis la page marque et les fiches listées dans le plan.',
        proposal: plan.join('\n\n'),
        urls: topPage ? [topPage] : [],
        queries: queriesOut,
      });
    }
  }
  return recs;
};

// 7. Baisses : pages qui perdent des clics. On cherche POURQUOI, et chaque
// cause donne ses actions : demande en baisse (le marché, pas la page), places
// perdues (contenu, liens), clics repris par une autre de nos pages
// (cannibalisation), rupture de stock, effet lancement qui retombe.
const detectBaisse = async (data, audits, protectedUrls = new Set()) => {
  const { pageStats, byQuery, q, qPrev, byQueryPrev, pageFirstSeen, period } = data;
  const recs = [];
  for (const [url, st] of pageStats) {
    if (isParamUrl(url) || st.pc < 30 || st.p === null || st.pp === null) continue;
    const drop = (st.pc - st.c) / st.pc;
    if (drop < 0.3) continue;

    // Requêtes qui ont amené des clics à la page sur la période d'avant.
    const rows = [];
    for (const [query, list] of byQueryPrev) {
      const before = list.find((x) => x.page === url);
      if (!before || before.c < 3) continue;
      const now = (byQuery.get(query) || []).find((x) => x.page === url) || { c: 0, i: 0 };
      const qa = q.get(query) || { c: 0, i: 0, p: null };
      const qb = qPrev.get(query) || { c: 0, i: 0, p: null };
      const others = (byQuery.get(query) || []).filter((x) => x.page !== url && !isParamUrl(x.page));
      const othersBefore = list.filter((x) => x.page !== url);
      const gain = others.map((o) => ({ page: o.page, c: o.c, cb: othersBefore.find((b) => b.page === o.page)?.c || 0 }))
        .filter((o) => o.c - o.cb >= 3).sort((a, b) => (b.c - b.cb) - (a.c - a.cb))[0];
      rows.push({ query, c: now.c, pc: before.c, i: qa.i, pi: qb.i, p: qa.p, pp: qb.p, lost: before.c - now.c, gain });
    }
    rows.sort((a, b) => b.lost - a.lost);
    const top = rows.slice(0, 8);
    if (!top.length) continue;
    const sum = (k) => top.reduce((x, r) => x + (r[k] || 0), 0);
    const demand = sum('pi') ? (sum('i') - sum('pi')) / sum('pi') : 0;
    const withPos = top.filter((r) => r.p !== null && r.pp !== null);
    const posDelta = withPos.length ? withPos.reduce((x, r) => x + (r.p - r.pp) * (r.i || 1), 0) / withPos.reduce((x, r) => x + (r.i || 1), 0) : 0;
    const shifted = top.filter((r) => r.gain);
    const first = pageFirstSeen.get(url);
    const launch = first && first >= addDays(period.prevFrom, -7);

    // Relu à chaque calcul : le stock change d'un jour à l'autre.
    const a = await auditUrl(url);
    if (a.http_status) { await saveAudit(a); audits.set(normUrl(url), a); }
    const outOfStock = /OutOfStock|SoldOut|Discontinued/i.test(a?.availability || '');

    const causes = [];
    const steps = [];
    if (outOfStock) {
      causes.push('la page est déclarée en rupture de stock (données structurées)');
      steps.push('Rupture de stock : Google fait reculer les fiches indisponibles. Remettre en stock, ou indiquer une date de retour et proposer le modèle de remplacement en lien depuis la fiche.');
    }
    // Même règle que la cannibalisation (chooseReference) : une requête partie
    // vers la page qui doit la porter n'est pas une perte (« elfbar 4 in 1
    // recharge » quitte la fiche du kit pour le pack de cartouches).
    const better = shifted.filter((r) => normUrl(chooseReference(r.query, [url, r.gain.page], audits).main) !== normUrl(url));
    const stolen = shifted.filter((r) => !better.includes(r));
    if (stolen.length) {
      const g = stolen[0].gain;
      causes.push(`une autre de nos pages reprend les clics (${pathOf(g.page)} sur « ${stolen[0].query} »)`);
      steps.push(...rivalSteps({ query: stolen[0].query, main: url, page: g.page, audits, protectedUrls }));
    }
    if (better.length) {
      const g = better[0].gain;
      causes.push(`des recherches passent à la page qui leur correspond (${pathOf(g.page)} sur « ${better[0].query} »)`);
      steps.push(...rivalSteps({ query: better[0].query, main: g.page, page: url, audits, protectedUrls }));
    }
    if (demand <= -0.25) {
      causes.push(`la demande baisse (${Math.round(demand * 100)} % d'impressions sur ces requêtes, toutes pages confondues)`);
    }
    if (posDelta >= 8) {
      causes.push(`chute brutale de ${fmt1(posDelta)} places en moyenne : ce n'est pas une question de contenu`);
      steps.push(`Search Console > Inspection de l'URL sur ${pathOf(url)} : vérifier que la page est indexée et que Google ne retient pas une autre adresse comme page canonique.`);
      const prevModel = [...(byQuery.get(top[0].query) || [])].find((x) => x.page !== url && pageKind(x.page) === 'fiche produit' && brandOf(x.page, audits) === brandOf(url, audits));
      if (prevModel) steps.push(`Google affiche aussi ${pathOf(prevModel.page)} sur « ${top[0].query} » : s'il alterne entre les deux fiches, différencier leurs titles (numéro de version) et lier l'ancienne vers la nouvelle avec l'ancre « ${cap(top[0].query)} ».`);
    }
    if (posDelta >= 1) {
      if (posDelta < 8) causes.push(`la page perd ${fmt1(posDelta)} place${posDelta >= 2 ? 's' : ''} en moyenne sur ses requêtes principales`);
      const head = top[0];
      const titleOk = a?.title && tokens(head.query).every((t) => compact(a.title).includes(t));
      if (!titleOk && a?.title) steps.push(`Title : « ${a.title} » ne contient pas « ${head.query} », la requête qui a perdu le plus de clics. L'y ajouter.`);
      const words = a?.word_count || 0;
      const versions = top.some((r) => !/\d/.test(r.query)) && top.some((r) => /\d/.test(r.query));
      // Le contenu n'est un levier que si la page est courte (ou si des requêtes
      // sur la gamme sans numéro de version arrivent ici).
      if (posDelta < 8 && words && words < 600) {
        steps.push(`Contenu : la page est courte (environ ${words} mots hors menus). Ajouter une fiche technique complète (autonomie, capacité, puissance, résistances ou cartouches compatibles) et une FAQ factuelle.`);
      }
      if (versions) {
        steps.push('Ajouter un paragraphe qui situe ce modèle par rapport aux autres versions de la gamme : des requêtes sans numéro de version arrivent sur cette page.');
      }
      const links = await linkPlan({
        target: url,
        anchors: top.filter((r) => !hasSensitive(r.query)).slice(0, 3).map((r) => r.query),
        sources: relatedSources(data, head.query, url, audits).slice(0, 8),
        data, audits, max: 4,
      });
      if (links.lines.length) steps.push(`Liens internes :\n${links.lines.join('\n')}`);
    }
    if (launch) {
      causes.push(`le produit est récent (premières impressions le ${first.split('-').reverse().join('/')}) : l'intérêt du lancement retombe`);
    }
    if (!steps.length) {
      // Baisse expliquée par la demande ou par une requête partie vers la bonne
      // page : rien à faire, donc pas de carte.
      if (demand <= -0.25 || (better.length && !stolen.length)) continue;
      steps.push('Regarder la page de résultats Google sur ces requêtes (mobile, navigation privée) : un concurrent ou un bloc nouveau au-dessus de nous peut expliquer la baisse de clics.');
    }
    // Une baisse due seulement à la demande ne se récupère pas par le SEO.
    const recoverable = st.pc - st.c;
    const est = demand <= -0.25 && posDelta < 1 && !stolen.length && !outOfStock ? recoverable * 0.1 : recoverable * 0.6;
    recs.push({
      rec_key: `baisse:${url}`,
      type: 'baisse',
      effort: posDelta >= 1 ? 'moyen' : 'faible',
      est_clicks: monthly(est),
      title: `En baisse : ${pathOf(url)}`,
      reason: `${fmtInt(st.c)} clics sur les 28 derniers jours contre ${fmtInt(st.pc)} les 28 jours d'avant (-${Math.round(drop * 100)} %). Causes relevées : ${causes.length ? causes.join(' ; ') : 'aucune cause nette dans les données'}.`,
      action: steps.map((t, n) => `${n + 1}. ${t}`).join('\n\n'),
      urls: [url],
      queries: top.map((r) => ({
        query: r.query, i: r.i, c: r.c, p: r.p === null ? null : Number(r.p.toFixed(1)),
        role: `Avant : ${fmtInt(r.pc)} clics, position ${fmt1(r.pp)}, ${fmtInt(r.pi)} impressions${r.gain ? ` ; reprise par ${pathOf(r.gain.page)}` : ''}`,
      })),
    });
  }
  return recs;
};

/* ─── Calcul ───────────────────────────────────────────── */

// Délai avant d'en voir l'effet dans Google : le temps qu'il repasse sur la
// page (vite pour une page très vue) puis qu'il réévalue son classement.
const DELAYS = {
  snippet: [1, 3, 'semaines'], redirection: [1, 3, 'semaines'], texte: [3, 6, 'semaines'],
  faq: [3, 6, 'semaines'], indexation: [2, 6, 'semaines'], cannibalisation: [4, 8, 'semaines'],
  modification: [4, 8, 'semaines'], creation: [2, 4, 'mois'],
};
const delayFor = (r, pageStats) => {
  if (r.type === 'baisse') return 'à analyser d\u2019abord';
  const d = DELAYS[r.type];
  if (!d) return null;
  const busy = (r.urls || []).some((u) => (pageStats.get(u)?.i || 0) > 5000);
  const lo = busy && d[2] === 'semaines' ? Math.max(1, d[0] - 1) : d[0];
  return `${lo} à ${d[1]} ${d[2]}`;
};

const TYPE_WEIGHT = { redirection: 1.5, cannibalisation: 1.1, creation: 1, modification: 1, texte: 1, snippet: 1, faq: 0.9, baisse: 0.8, indexation: 0.8 };

let running = false;

const computeRecommendations = async ({ audit = true } = {}) => {
  if (running) throw new Error('Calcul des recommandations déjà en cours');
  running = true;
  await ensureTables();
  const run = await pool.query('INSERT INTO seo_advisor_runs DEFAULT VALUES RETURNING id');
  const runId = run.rows[0].id;
  try {
    const period = await loadPeriod();
    if (!period) throw new Error('Aucune donnée Search Console');
    const data = await loadData(period);

    let audited = 0;
    if (audit) {
      const urls = [...data.pageStats.entries()]
        .filter(([u]) => u.startsWith(SITE) && !/[?#]/.test(u))
        .sort((a, b) => b[1].i - a[1].i)
        .slice(0, AUDIT_MAX_PAGES)
        .map(([u]) => u);
      for (const u of urls) {
        await saveAudit(await auditUrl(u));
        audited += 1;
        await sleep(AUDIT_DELAY_MS);
      }
    }
    const audits = await loadAudits();

    const sitePages = await loadSitePages();
    // Pages cibles décidées par l'équipe : mesurées, puis transformées en cartes.
    // Chargé ici (et pas en tête) : seoPilotService dépend de ce module.
    const pilot = require('./seoPilotService');
    let targetRecs = [];
    try {
      await pilot.computeTargets();
      targetRecs = await pilot.targetRecommendations();
    } catch (error) {
      console.error('[SEO] Pages cibles :', error.message);
    }
    const decided = (await pool.query('SELECT pattern, target_url FROM seo_targets WHERE active').catch(() => ({ rows: [] }))).rows;
    const skipRes = decided
      .map((r) => { try { return new RegExp(r.pattern, 'i'); } catch { return null; } }).filter(Boolean);
    // Pages cibles décidées : une carte automatique ne les modifie jamais.
    const protectedUrls = new Set(decided.map((r) => normUrl(r.target_url)));
    const indexRecs = await detectIndexDecisions(data, audits, sitePages);
    const claimed = new Map();
    const creation = await detectCreation(data, audits, sitePages, claimed);
    const recs = [
      ...targetRecs.map(({ targetRe, ...r }) => r),
      ...detectCannibalisation(data, audits, skipRes, protectedUrls).filter((r) => r.est_clicks >= 10),
      ...(await detectTexte(data, audits, claimed)),
      ...detectSnippet(data, audits),
      ...detectFaq(data),
      ...detectIndexation(data, audits),
      ...creation,
      ...indexRecs,
      ...(await detectBaisse(data, audits, protectedUrls)),
    ].map((r) => ({
      ...r,
      delay: delayFor(r, data.pageStats),
      score: Number(((r.est_clicks || 0) * (TYPE_WEIGHT[r.type] || 1) * (r.editorial ? 0.3 : 1)).toFixed(1)),
    }));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE seo_recommendations SET active = false');
      for (const r of recs) {
        await client.query(
          `INSERT INTO seo_recommendations (rec_key, type, score, est_clicks, effort, title, reason, action, proposal, urls, queries, delay, active, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, now())
           ON CONFLICT (rec_key) DO UPDATE SET type = $2, score = $3, est_clicks = $4, effort = $5, title = $6, reason = $7,
             action = $8, proposal = $9, urls = $10, queries = $11, delay = $12, active = true, updated_at = now()`,
          [r.rec_key, r.type, r.score, Number((r.est_clicks || 0).toFixed(1)), r.effort, r.title, r.reason || null,
            r.action || null, r.proposal || null, r.urls || [], JSON.stringify(r.queries || []), r.delay || null]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await pool.query(
      "UPDATE seo_advisor_runs SET finished_at = now(), status = 'done', pages_audited = $2, recs = $3 WHERE id = $1",
      [runId, audited, recs.length]
    );
    return { period, audited, recs: recs.length };
  } catch (error) {
    await pool.query("UPDATE seo_advisor_runs SET finished_at = now(), status = 'error', error = $2 WHERE id = $1", [runId, error.message]);
    throw error;
  } finally {
    running = false;
  }
};

const listRecommendations = async ({ status } = {}) => {
  await ensureTables();
  const statuses = status ? String(status).split(',') : ['todo', 'doing'];
  const [recs, run] = await Promise.all([
    pool.query(
      `SELECT r.*, u.name AS status_by_name
       FROM seo_recommendations r LEFT JOIN users u ON u.email = r.status_by
       WHERE r.active AND r.status = ANY($1) ORDER BY r.score DESC, r.id`,
      [statuses]
    ),
    pool.query('SELECT * FROM seo_advisor_runs ORDER BY id DESC LIMIT 1'),
  ]);
  const counts = await pool.query('SELECT status, COUNT(*)::int AS n FROM seo_recommendations WHERE active GROUP BY status');
  // Période de repos : une page modifiée depuis moins de 4 semaines ne reçoit
  // pas de nouvelle carte (sauf erreur bloquante : redirection, indexation).
  const pilot = require('./seoPilotService');
  const changes = await pilot.loadLastChanges();
  const BLOQUANT = new Set(['redirection', 'indexation']);
  const recommendations = recs.rows.map((r) => {
    if (BLOQUANT.has(r.type)) return r;
    const reposts = (r.urls || []).map((u) => changes.get(pilot.normUrl(u))).filter((d) => pilot.enRepos(d));
    if (!reposts.length) return r;
    const last = reposts.sort().pop();
    return { ...r, repos_until: pilot.reposJusquau(last), last_change: last };
  });
  return {
    lastRun: run.rows[0] || null,
    running,
    counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
    recommendations,
  };
};

const STATUSES = new Set(['todo', 'doing', 'done', 'ignored']);

const updateRecommendation = async (id, { status, note }, user) => {
  if (status && !STATUSES.has(status)) throw new Error('Statut inconnu');
  const r = await pool.query(
    `UPDATE seo_recommendations
     SET status = COALESCE($2, status),
         note = COALESCE($3, note),
         status_by = CASE WHEN $2 IS NULL THEN status_by ELSE $4 END,
         status_at = CASE WHEN $2 IS NULL THEN status_at ELSE now() END
     WHERE id = $1 RETURNING *`,
    [id, status || null, note === undefined ? null : note, user || null]
  );
  return r.rows[0] || null;
};

// Décisions d'indexation du dernier calcul (url → décision), pour contrôle.
const getIndexDecisions = () => Object.fromEntries(indexDecisions);

module.exports = {
  ensureTables, computeRecommendations, listRecommendations, updateRecommendation, ctrAt, getIndexDecisions,
  // Vocabulaire partagé avec la rédaction SEO (seoWriterService).
  BANNED, QUESTION_RE, HEALTH_RE, MARKETING_RE, extractLinks,
  // Partagés avec les pages cibles (seoPilotService).
  brandFromJsonLd, rivalSteps,
  // Banc d'essai (tests/seoAdvisor.test.js) : détecteurs sans réseau ni base.
  ownsQuery, isBrandQuery, brandOf, roleOf, centeredOn, chooseReference, relatedSources, detectCannibalisation, detectTexte,
};
