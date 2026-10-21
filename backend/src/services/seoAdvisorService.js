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
const SENSITIVE = new Set(['prix', 'pas', 'cher', 'promo', 'promotion', 'solde', 'soldes', 'meilleur', 'meilleure', 'meilleurs',
  'gout', 'gouts', 'saveur', 'saveurs', 'avis', 'trouver', 'acheter', 'achat', 'vente', 'magasin', 'cbd', 'thc', 'ou', 'quoi',
  'comment', 'combien', 'pourquoi', 'quel', 'quelle', 'quels', 'est', 'peut', 'faut', 'interdit', 'interdite', 'legal', 'legale', 'danger',
  // Puffs jetables interdites en France (loi du 24/02/2025) ; « gratuit » et « offert » sont des arguments commerciaux.
  'jetable', 'jetables', 'gratuit', 'gratuite', 'gratuits', 'offert', 'offerte', 'livraison', 'reduction', 'code']);
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
      meta_description: pick(html, /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i),
      robots: pick(html, /<meta\s+name=["']robots["']\s+content=["']([^"']*)["']/i),
      canonical: pick(html, /<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/i),
      word_count: res.status === 200 ? body.split(/\s+/).filter(Boolean).length : null,
      links: res.status === 200 ? extractLinks(html) : null,
      error: null,
    };
  } catch (error) {
    return { url, http_status: null, error: error.message };
  }
};

const saveAudit = async (a) => {
  await pool.query(
    `INSERT INTO seo_page_audit (url, fetched_at, http_status, location, title, h1, meta_description, robots, canonical, word_count, links, error)
     VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (url) DO UPDATE SET fetched_at = now(), http_status = $2, location = $3, title = $4, h1 = $5,
       meta_description = $6, robots = $7, canonical = $8, word_count = $9, links = $10, error = $11`,
    [a.url, a.http_status, a.location || null, a.title || null, a.h1 || null, a.meta_description || null,
      a.robots || null, a.canonical || null, a.word_count || null, a.links ? JSON.stringify(a.links) : null, a.error || null]
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
  const [queries, qp, pages] = await Promise.all([
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
  ]);
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
  return { q, byQuery, pageStats };
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
  if (p.startsWith('/blog/')) return 'article';
  if (p === '/') return 'accueil';
  return 'page';
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
const hasSensitive = (q) => tokens(q).some((t) => SENSITIVE.has(t));

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
const relatedSources = ({ byQuery }, query, exclude) => {
  const core = coreTokens(query);
  const minShared = Math.min(2, core.length);
  if (!minShared) return [];
  const score = new Map();
  for (const [q2, rows] of byQuery) {
    const tk = tokens(q2);
    if (core.filter((t) => tk.includes(t)).length < minShared) continue;
    for (const r of rows) {
      if (isParamUrl(r.page) || pathOf(r.page) === '/' || normUrl(r.page) === normUrl(exclude)) continue;
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
const linkPlan = async ({ target, anchors, sources, data, audits, max = 5 }) => {
  const t = normUrl(target);
  const clean = anchors.filter((a) => a && !tokens(a).some((x) => SENSITIVE.has(x)));
  if (!clean.length) return [];
  const lines = [];
  const seen = new Set();
  let k = 0;
  for (const src of sources) {
    if (lines.length >= max) break;
    const s = normUrl(src);
    if (!s || s === t || seen.has(s) || isParamUrl(s)) continue;
    seen.add(s);
    let a = audits.get(src) || audits.get(s);
    if (!a || !Array.isArray(a.links)) {
      a = await auditUrl(s);
      if (a.http_status) { await saveAudit(a); audits.set(s, a); }
    }
    if (!a || a.http_status !== 200 || !Array.isArray(a.links)) continue;
    const st = data.pageStats.get(src) || data.pageStats.get(s);
    const vu = st?.i ? ` (${fmtInt(st.i)} impressions en 28 j)` : '';
    const existing = a.links.find((l) => l.href === t);
    if (existing) {
      const good = existing.text && clean.some((x) => compact(existing.text).includes(compact(x)));
      lines.push(good
        ? `- ${pathOf(s)}${vu} : lien déjà en place (ancre « ${existing.text} »). Rien à faire.`
        : `- ${pathOf(s)}${vu} : le lien existe mais son ancre est « ${existing.text || 'vide (image ?)'} ». La remplacer par « ${cap(clean[0])} ».`);
    } else {
      lines.push(`- Depuis ${pathOf(s)}${vu} : ajouter un lien vers ${pathOf(t)} avec l'ancre « ${cap(clean[k % clean.length])} », ${placementFor(s)}.`);
      k += 1;
    }
  }
  return lines;
};

// 1. Cannibalisation : deux de nos pages se partagent une même requête.
const detectCannibalisation = ({ q, byQuery }) => {
  const pairs = new Map();
  for (const [query, rows] of byQuery) {
    const qs = q.get(query);
    if (!qs || qs.i < 150) continue;
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
    for (const qq of v.queries) for (const s of qq.split) { const t = totals.get(s.page); if (t) { t.c += s.c; t.i += s.i; } }
    const [main, second] = [...totals.entries()].sort((x, y) => y[1].c - x[1].c || y[1].i - x[1].i).map(([pg]) => pg);
    const est = v.queries.reduce((s, qq) => s + 0.5 * gainTo(qq.i, qq.c, qq.p, Math.max(1, qq.p - 1.5)), 0);
    const top = v.queries.sort((x, y) => y.i - x.i);
    const secondKind = pageKind(second);
    const weakSecond = ['étiquette', 'catégorie', 'page'].includes(secondKind);
    recs.push({
      rec_key: `cannibalisation:${key}`,
      type: 'cannibalisation',
      effort: 'moyen',
      est_clicks: monthly(est),
      title: `Deux pages se partagent ${top.length} requête${top.length > 1 ? 's' : ''} (« ${top[0].query} »)`,
      reason: `Sur ${top.length > 1 ? 'ces requêtes' : 'cette requête'}, Google hésite entre ${pathOf(main)} (${pageKind(main)}) et ${pathOf(second)} (${secondKind}). Aucune des deux ne s'installe : « ${top[0].query} » est en position ${fmt1(top[0].p)} pour ${fmtInt(top[0].i)} impressions en 28 jours.`,
      action: [
        `Page de référence proposée : ${pathOf(main)} (celle qui reçoit le plus de clics).`,
        weakSecond
          ? `Sur ${pathOf(second)} : retirer ces mots du title et du H1, et ajouter un lien vers ${pathOf(main)}. Si la page n'a pas d'autre rôle, la passer en noindex (garder « follow »).`
          : `Sur ${pathOf(second)} : différencier le title et le H1 (une intention différente, par exemple avec / sans nicotine, ou modèle / cartouche) et ajouter un lien vers ${pathOf(main)} avec ces mots.`,
        'Si les deux pages répondent à deux intentions différentes, les différencier plutôt que d’en retirer une.',
      ].join('\n'),
      urls: [main, second],
      queries: top.slice(0, 10).map((x) => ({ query: x.query, i: x.i, c: x.c, p: Number(x.p.toFixed(1)) })),
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
    const headTk = canonTokens(head.query);
    const variants = owned.filter((x) => x !== head && headTk.every((t) => canonTokens(x.query).includes(t)));
    const otherIntent = owned.filter((x) => x !== head && !variants.includes(x));
    const audit = audits.get(normUrl(page));
    const titleNow = audit?.title || '(title non relevé)';
    const where = compact(`${audit?.title || ''} ${audit?.h1 || ''}`);
    const headCovered = tokens(head.query).every((t) => where.includes(t));
    const missing = [];
    for (const v of variants) {
      for (const t of canonTokens(v.query)) {
        if (headTk.includes(t) || t.length < 3 || SENSITIVE.has(t) || where.includes(t) || missing.some((m) => m.t === t)) continue;
        missing.push({ t, from: v });
      }
    }
    const scope = [head, ...variants];
    const est = scope.reduce((s, x) => s + gainTo(x.i, x.c, x.p, Math.max(1, x.p - 2)), 0);
    if (monthly(est) < 15) continue;

    const blocks = [];
    blocks.push(`Requête principale : « ${head.query} » (${fmtInt(head.i)} impressions en 28 j, position ${fmt1(head.p)}).`);
    // 1. Title / H1
    if (!headCovered) {
      blocks.push(`1. Title et H1 : ils ne contiennent pas tous les mots de « ${head.query} ». Title actuel : « ${titleNow} ». Le commencer par « ${cap(head.query)} », 60 caractères maximum.`);
    } else if (missing.length) {
      blocks.push(`1. Title : il couvre déjà « ${head.query} » (« ${titleNow} »). Variante à ajouter si la place le permet : ${missing.slice(0, 3).map((m) => `« ${m.t} » (requête « ${m.from.query} », ${fmtInt(m.from.i)} impressions)`).join(', ')}.`);
    } else {
      blocks.push(`1. Title : ne pas le modifier, il couvre déjà « ${head.query} » (« ${titleNow} »).`);
    }
    // 2. Texte
    const h2 = variants.filter((v) => !tokens(v.query).some((t) => SENSITIVE.has(t))).slice(0, 3);
    const words = audit?.word_count || 0;
    blocks.push(`2. Texte : ${words && words < 400 ? `la page est courte (environ ${words} mots hors menus) ; ajouter un paragraphe factuel qui emploie « ${head.query} »` : `vérifier que « ${head.query} » apparaît dans le premier paragraphe`}${h2.length ? `, et des intertitres (H2) sur : ${h2.map((v) => `« ${cap(v.query)} »`).join(', ')}` : ''}.`);
    // 3. Liens internes
    const links = await linkPlan({
      target: page,
      anchors: [head.query, ...h2.map((v) => v.query)],
      sources: relatedSources(data, head.query, page).slice(0, 10),
      data, audits,
    });
    blocks.push(links.length ? `3. Liens internes :\n${links.join('\n')}` : '3. Liens internes : aucune page proche relevée qui pourrait en faire.');
    // 4. Ce qu'il ne faut pas viser ici
    if (elsewhere.length) {
      const byTarget = new Map();
      for (const x of elsewhere) {
        const tgt = pathOf(claimed.get(x.query));
        if (!byTarget.has(tgt)) byTarget.set(tgt, []);
        byTarget.get(tgt).push(x.query);
      }
      blocks.push(`4. Requêtes à laisser à leur page dédiée (ne pas les ajouter ici) : ${[...byTarget.entries()].map(([tgt, qs]) => `${qs.slice(0, 4).map((x) => `« ${x} »`).join(', ')} → ${tgt}`).join(' ; ')}.`);
    }
    if (otherIntent.length) {
      blocks.push(`${elsewhere.length ? '5' : '4'}. Autres requêtes qui atterrissent ici sans être le sujet de la page (ne pas les viser dans le title) : ${otherIntent.slice(0, 5).map((x) => `« ${x.query} »`).join(', ')}.`);
    }
    const editorial = pageKind(page) === 'article' || pathOf(page).startsWith('/avis-tests/');
    if (editorial) blocks.push('Contenu éditorial : sujet sensible dans le litige DNF (un blog est présenté comme publicitaire). À arbitrer avec l’avocat avant toute retouche.');
    blocks.push(LEGAL_NOTE);
    recs.push({
      editorial,
      rec_key: `texte:${page}`,
      type: 'texte',
      effort: 'faible',
      est_clicks: monthly(est),
      title: `${cap(pageKind(page))} à retravailler sur « ${head.query} » : ${pathOf(page)}`,
      reason: `« ${head.query} » est en position ${fmt1(head.p)}${variants.length ? `, avec ${variants.length} variante${variants.length > 1 ? 's' : ''}` : ''}. Gagner deux places la fait passer dans le haut de la première page.`,
      action: blocks.join('\n'),
      urls: [page],
      queries: scope.slice(0, 12).map((x) => ({ query: x.query, i: x.i, c: x.c, p: Number(x.p.toFixed(1)) })),
    });
  }
  return recs;
};

// 3. Résultat peu cliqué : bien placé mais taux de clic très bas.
const detectSnippet = ({ q, byQuery }, audits) => {
  const perPage = new Map();
  for (const [query, qs] of q) {
    if (qs.i < 200 || qs.p > 6) continue;
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
        LEGAL_NOTE,
      ].join('\n'),
      urls: [page],
      queries: list.slice(0, 8).map((x) => ({ query: x.query, i: x.i, c: x.c, p: Number(x.p.toFixed(1)) })),
    };
  });
};

// 4. FAQ : questions tapées par les clients.
const detectFaq = ({ q, byQuery }) => {
  const perPage = new Map();
  for (const [query, qs] of q) {
    if (qs.i < 20 || !QUESTION_RE.test(norm(query))) continue;
    const page = byQuery.get(query)?.[0]?.page;
    if (!page || isParamUrl(page)) continue;
    if (!perPage.has(page)) perPage.set(page, []);
    perPage.get(page).push({ query, ...qs });
  }
  return [...perPage.entries()]
    .filter(([, list]) => list.reduce((s, x) => s + x.i, 0) >= 100)
    .map(([page, list]) => {
      list.sort((a, b) => b.i - a.i);
      const est = list.reduce((s, x) => s + gainTo(x.i, x.c, x.p, Math.max(1, x.p - 2)), 0);
      return {
        rec_key: `faq:${page}`,
        type: 'faq',
        effort: 'faible',
        est_clicks: monthly(est),
        title: `Questions de clients à traiter en FAQ : ${pathOf(page)}`,
        reason: `${list.length} question${list.length > 1 ? 's' : ''} tapée${list.length > 1 ? 's' : ''} dans Google mènent à cette page sans y trouver de réponse dédiée (${fmtInt(list.reduce((s, x) => s + x.i, 0))} impressions en 28 jours).`,
        action: `Ajouter une FAQ avec une réponse courte et factuelle à chacune de ces questions (données structurées FAQPage).\n${LEGAL_NOTE}`,
        proposal: list.slice(0, 10).map((x) => `- ${cap(x.query)} ?`).join('\n'),
        urls: [page],
        queries: list.slice(0, 10).map((x) => ({ query: x.query, i: x.i, c: x.c, p: Number(x.p.toFixed(1)) })),
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
    if (slugMatch) {
      // Toujours relu : ces pages changent souvent de statut (ouvertures du 19 au 21/10).
      const a = await auditUrl(slugMatch[0]);
      if (a.http_status) { await saveAudit(a); audits.set(normUrl(slugMatch[0]), a); }
      dedicatedNoindex = /noindex/i.test(a?.robots || '');
      if (!dedicatedNoindex) {
        dedicatedOf.set(g.slug, slugMatch[0]);
        for (const x of list) claimed.set(x.query, slugMatch[0]);
      }
    }
    if (impr < 800 || pos <= 4) continue;
    const generic = !topPage || share < 0.4 || pageKind(topPage) === 'accueil';
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
    if (isProductType && target) {
      const base = pathOf(target).split('/').pop();
      for (const sp of sitePages.filter((x) => x.slug.startsWith(`${base}-`))) {
        labels.push({ label: sp.slug.slice(base.length + 1).replace(/-/g, ' ').replace(/(\d+)ml/, '$1 ml'), url: sp.url });
      }
    } else {
      for (const u of fiches) {
        let a = audits.get(u) || audits.get(normUrl(u));
        if (!a) { a = await auditUrl(u); if (a.http_status) await saveAudit(a); }
        const label = modelLabel(a);
        if (label && !labels.some((l) => compact(l.label) === compact(label))) labels.push({ label, url: u });
      }
    }
    const hasNico = fiches.some((u) => !/sans-nicotine|0mg/.test(u));
    const hasZero = fiches.some((u) => /sans-nicotine|0mg/.test(u));
    const facets = labels.length >= 2 ? labels.map((l) => l.label) : [
      ...(labels.length ? [labels[0].label] : []),
      ...(hasNico && hasZero ? ['avec ou sans nicotine'] : []),
      ...(ranked.some(([u]) => /cartouche/.test(u)) ? ['cartouches'] : []),
    ];
    let title = cap(titleHead.query);
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
    const rechargeUrl = liquidZero?.url || routedTarget;
    const questions = list.filter((x) => QUESTION_RE.test(norm(x.query))).slice(0, 6).map((x) => x.query);
    const plan = [
      `Title : « ${title} »`,
      `H1 : « ${cap(titleHead.query)} »`,
      `Meta description : « ${cap(titleHead.query)}${labels.length ? ` : ${labels.slice(0, 4).map((l) => l.label).join(', ')}` : ''}. Capacité, autonomie, recharge et compatibilités de chaque modèle. »`,
      `Introduction : 2 à 3 phrases factuelles sur ce que regroupe la page${labels.length ? ` (${labels.map((l) => l.label).join(', ')})` : ''}.`,
      'Grille des produits, puis un tableau comparatif : capacité, bouffées annoncées, batterie, recharge, taux de nicotine.',
      ...labels.slice(0, 5).map((l) => `H2 : ${l.label} : caractéristiques, recharge, compatibilités ; lien vers ${pathOf(l.url)}`),
      ...(rechargeUrl && !isProductType ? [`H2 : Recharger : e-liquides compatibles ; lien vers ${pathOf(rechargeUrl)}`] : []),
      questions.length
        ? `FAQ (questions réellement tapées) :\n${questions.map((x) => `  - ${cap(x)} ?`).join('\n')}`
        : 'FAQ : 3 à 5 questions factuelles (fonctionnement, recharge, compatibilité, légalité).',
      `Requêtes à employer dans le texte : ${list.filter((x) => !hasSensitive(x.query)).slice(0, 12).map((x) => x.query).join(', ')}`,
      ...(routed.length ? [`Requêtes à NE PAS viser ici (elles relèvent ${(liquidZero?.url || routedTarget) ? `de ${pathOf(liquidZero?.url || routedTarget)}` : 'des e-liquides'}) : ${routed.slice(0, 6).map((x) => x.query).join(', ')}`] : []),
      LEGAL_NOTE,
    ];
    const queriesOut = list.slice(0, 12).map((x) => ({ query: x.query, i: x.i, c: x.c, p: Number(x.p.toFixed(1)) }));

    if (slugMatch && dedicatedNoindex) {
      recs.push({
        rec_key: `noindex-dedie:${g.slug}`,
        type: 'indexation',
        effort: 'faible',
        est_clicks: monthly(est * 0.5),
        title: `Page dédiée « ${g.name} » en noindex : ${pathOf(slugMatch[0])}`,
        reason: `Le groupe fait ${fmtInt(impr)} impressions en 28 jours en position ${fmt1(pos)}, porté surtout par ${pathOf(topPage)}. Une page dédiée existe mais Google n'a pas le droit de l'afficher.`,
        action: `Décider : soit passer ${pathOf(slugMatch[0])} en index (réglage Yoast) et la construire selon le plan ci-dessous, soit la laisser fermée et retravailler ${pathOf(topPage)} (carte « texte »). Ne pas laisser deux pages viser ces requêtes.`,
        proposal: plan.join('\n'),
        urls: [slugMatch[0], topPage],
        queries: queriesOut,
      });
      continue;
    }
    if (slugMatch && normUrl(slugMatch[0]) !== normUrl(topPage)) {
      const links = await linkPlan({
        target: slugMatch[0],
        anchors: [titleHead.query, head.query, ...list.slice(1, 3).map((x) => x.query)],
        sources: [topPage, ...fiches, ...relatedSources(data, titleHead.query, slugMatch[0])].filter(Boolean),
        data, audits, max: 6,
      });
      recs.push({
        rec_key: `renfort:${g.slug}`,
        type: 'creation',
        effort: 'moyen',
        est_clicks: monthly(est * 0.7),
        title: `Faire monter la page dédiée « ${g.name} » : ${pathOf(slugMatch[0])}`,
        reason: `Le groupe fait ${fmtInt(impr)} impressions en 28 jours en position ${fmt1(pos)}. Google montre surtout ${pathOf(topPage)} (${pageKind(topPage)}), alors que la page dédiée existe${slugMatch[1] ? '' : ' et n’a encore aucune impression : elle manque de liens'}.`,
        action: [
          `1. Contenu de ${pathOf(slugMatch[0])} : suivre le plan ci-dessous (title, H1, texte, FAQ).`,
          links.length ? `2. Liens internes vers ${pathOf(slugMatch[0])} :\n${links.join('\n')}` : '2. Liens internes : aucune page source relevée.',
          `3. Ne pas modifier le title de ${pathOf(topPage)} pour ces requêtes : c'est la page dédiée qui doit les porter.`,
        ].join('\n'),
        proposal: plan.join('\n'),
        urls: [slugMatch[0], topPage],
        queries: queriesOut,
      });
    } else if (!slugMatch && generic) {
      recs.push({
        rec_key: `creation:${g.slug}`,
        type: 'creation',
        effort: 'élevé',
        est_clicks: monthly(est * 0.7),
        title: `Créer une page dédiée « ${g.name} »`,
        reason: `${fmtInt(impr)} impressions en 28 jours en position ${fmt1(pos)}, sans page dédiée : Google utilise ${topPage ? `${pathOf(topPage)} (${pageKind(topPage)}, ces requêtes n'y pèsent que ${Math.round(share * 100)} %)` : 'des pages diverses'}.`,
        action: 'Créer la page (format étiquette, comme le reste de la grappe JNR) selon le plan ci-dessous, puis la relier depuis la page marque et les fiches listées dans le plan.',
        proposal: plan.join('\n'),
        urls: topPage ? [topPage] : [],
        queries: queriesOut,
      });
    }
  }
  return recs;
};

// 7. Baisses : pages qui perdent des clics et des places.
const detectBaisse = ({ pageStats, byQuery }) => {
  const recs = [];
  for (const [url, s] of pageStats) {
    if (isParamUrl(url) || s.pc < 30 || s.p === null || s.pp === null) continue;
    const drop = (s.pc - s.c) / s.pc;
    if (drop < 0.3 || s.p - s.pp < 1) continue;
    const lost = [];
    for (const [query, rows] of byQuery) {
      const r = rows.find((x) => x.page === url);
      if (r && r.i >= 30) lost.push({ query, i: r.i, c: r.c, p: Number(r.p.toFixed(1)) });
    }
    lost.sort((a, b) => b.i - a.i);
    recs.push({
      rec_key: `baisse:${url}`,
      type: 'baisse',
      effort: 'moyen',
      est_clicks: monthly(s.pc - s.c),
      title: `En baisse : ${pathOf(url)}`,
      reason: `${fmtInt(s.c)} clics sur les 28 derniers jours contre ${fmtInt(s.pc)} les 28 jours d'avant (-${Math.round(drop * 100)} %), position ${fmt1(s.pp)} → ${fmt1(s.p)}.`,
      action: 'Vérifier dans le journal des modifications ce qui a changé sur la page ou ses liens, regarder les résultats Google sur ses requêtes principales (nouveau concurrent ?) et comparer avec les semaines de promotion.',
      urls: [url],
      queries: lost.slice(0, 8),
    });
  }
  return recs;
};

/* ─── Calcul ───────────────────────────────────────────── */

const TYPE_WEIGHT = { redirection: 1.5, cannibalisation: 1.1, creation: 1, texte: 1, snippet: 1, faq: 0.9, baisse: 0.8, indexation: 0.8 };

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
    const claimed = new Map();
    const creation = await detectCreation(data, audits, sitePages, claimed);
    const recs = [
      ...detectCannibalisation(data).filter((r) => r.est_clicks >= 10),
      ...(await detectTexte(data, audits, claimed)),
      ...detectSnippet(data, audits),
      ...detectFaq(data),
      ...detectIndexation(data, audits),
      ...creation,
      ...detectBaisse(data),
    ].map((r) => ({
      ...r,
      score: Number(((r.est_clicks || 0) * (TYPE_WEIGHT[r.type] || 1) * (r.editorial ? 0.3 : 1)).toFixed(1)),
    }));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE seo_recommendations SET active = false');
      for (const r of recs) {
        await client.query(
          `INSERT INTO seo_recommendations (rec_key, type, score, est_clicks, effort, title, reason, action, proposal, urls, queries, active, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, now())
           ON CONFLICT (rec_key) DO UPDATE SET type = $2, score = $3, est_clicks = $4, effort = $5, title = $6, reason = $7,
             action = $8, proposal = $9, urls = $10, queries = $11, active = true, updated_at = now()`,
          [r.rec_key, r.type, r.score, Number((r.est_clicks || 0).toFixed(1)), r.effort, r.title, r.reason || null,
            r.action || null, r.proposal || null, r.urls || [], JSON.stringify(r.queries || [])]
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
      `SELECT * FROM seo_recommendations WHERE active AND status = ANY($1) ORDER BY score DESC, id`,
      [statuses]
    ),
    pool.query('SELECT * FROM seo_advisor_runs ORDER BY id DESC LIMIT 1'),
  ]);
  const counts = await pool.query('SELECT status, COUNT(*)::int AS n FROM seo_recommendations WHERE active GROUP BY status');
  return {
    lastRun: run.rows[0] || null,
    running,
    counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
    recommendations: recs.rows,
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

module.exports = { ensureTables, computeRecommendations, listRecommendations, updateRecommendation, ctrAt };
