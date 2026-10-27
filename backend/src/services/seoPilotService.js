/**
 * Suivi SEO — pilotage par page (27/10/2026)
 *
 * Trois outils pour ne plus revenir dix fois sur la même page :
 *
 *   1. Pages cibles (seo_targets) : UNE page cible par requête importante,
 *      décidée par l'équipe. Mesure de la part des impressions que Google
 *      donne à la cible (France) : au départ, sur les 28 derniers jours et
 *      depuis la décision. Gagnée au-delà de 80 %.
 *      La recommandation de cannibalisation se fonde sur cette décision,
 *      jamais sur « la page qui a le plus de clics » (qui aurait désigné le
 *      guide « arrêter de fumer » sur « cigarette électronique »).
 *
 *   2. Fiche page : tout ce qu'il faut faire sur UNE page, en une passe —
 *      contrôles (title, H1, méta, texte, FAQ, données produit, liens reçus,
 *      mots à éviter), requêtes qu'elle porte ou ne devrait pas porter,
 *      pages concurrentes, recommandations ouvertes, journal.
 *
 *   3. Journal + période de repos (seo_journal) : une page modifiée reste au
 *      repos REPOS_JOURS jours. Ses recommandations sont mises de côté pour ne
 *      pas brouiller la mesure (seules les erreurs bloquantes ressortent).
 *
 * Pièges de chiffres : voir gscService (country = 'fra' sur gsc_search_daily,
 * page × requête × pays ; la part de la cible = impressions de la cible /
 * impressions de toutes nos pages sur les requêtes du groupe).
 */

const axios = require('axios');
const pool = require('../config/database');
const advisor = require('./seoAdvisorService');

const SITE = 'https://www.youvape.fr';
const COUNTRY = 'fra';
const REPOS_JOURS = 28;
const PART_GAGNEE = 80;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };
const round1 = (n) => (n === null || n === undefined || Number.isNaN(n) ? null : Math.round(n * 10) / 10);
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'");

// Adresse canonique d'une page : absolue, sans paramètre, sans « / » final
// (l'accueil devient https://www.youvape.fr).
const normUrl = (u) => {
  let s = String(u || '').trim();
  if (!s) return '';
  if (s.startsWith('/')) s = SITE + s;
  if (!/^https?:\/\//.test(s)) s = `${SITE}/${s}`;
  s = s.replace(/^https?:\/\/(www\.)?youvape\.fr/, SITE);
  return s.split(/[?#]/)[0].replace(/\/+$/, '');
};
const pathOf = (u) => normUrl(u).slice(SITE.length) || '/';
// gsc_search_daily stocke l'adresse telle que Google la donne : l'accueil a son « / ».
const gscForms = (u) => { const n = normUrl(u); return [n, `${n}/`]; };

/* ─── Tables ───────────────────────────────────────────── */

const DOC_CANNIBALISATION = 'https://claude.ai/artifact/T6g2npCFGtjowVDR37BZHa';

// Décisions prises le 27/10/2026 (doc ci-dessus). Insérées une seule fois :
// ensuite, la table fait foi.
const DEFAULT_TARGETS = [
  ['cigarette électronique', '^(la |une |les )?(cigarettes? (é|e)lectroniques?|e-?cigarettes?|vapoteuses?)$', '/categorie-produit/e-cigarettes'],
  ['e-liquide, liquide cigarette électronique', '^(e[- ]?liquides?|eliquides?|liquides?( pour)? (cigarettes? (é|e)lectroniques?|ce|vape|vapoteuse))$', '/categorie-produit/eliquides'],
  ['goût cigarette électronique', '^go[uû]ts? (de )?(cigarettes? (é|e)lectroniques?|ce)$|^saveurs? (de )?cigarettes? (é|e)lectroniques?$', '/saveurs-eliquides'],
  ['puff, puff rechargeable', '^(les |la )?puffs?( rechargeables?| vape| cigarette)?$', '/categorie-produit/e-cigarettes/kits-ecigarettes/puffs'],
  ['puff sans nicotine', '^puffs? sans nicotine$', '/puff-sans-nicotine'],
  ['pod', '^(les )?pods?( cigarette (é|e)lectronique| vape| rechargeable)?$|^cigarette (é|e)lectronique pod$', '/categorie-produit/e-cigarettes/kits-ecigarettes/kits-format-pod'],
  ['box cigarette électronique', '^(la )?box( cigarette (é|e)lectronique| vape| e-?cig)?$|^box (é|e)lectronique$', '/categorie-produit/e-cigarettes/composants/box-batteries-electroniques'],
  ['résistance cigarette électronique', '^r(é|e)sistances?( (pour )?cigarette (é|e)lectronique| vape)?$', '/categorie-produit/e-cigarettes/composants/resistances'],
  ['clearomiseur', '^clearomiseurs?$', '/categorie-produit/e-cigarettes/composants/clearomiseurs'],
  ['booster de nicotine', '^boosters?( de)?( nicotine)?$', '/categorie-produit/eliquides/boosters-de-nicotine'],
  ['magasin cigarette électronique', '^(magasins? (de )?(cigarette (é|e)lectronique|vape)|boutique cigarette (é|e)lectronique)$', '/magasins-cigarette-electronique-montpellier-castelnau-le-lez'],
  ['vape, vape shop', '^(vapes?|vape ?shops?)$', '/'],
  ['aspire', '^aspire( cigarette (é|e)lectronique| pod| vape)?$', '/marque/aspire'],
  ['vaporesso', '^vaporesso( cigarette (é|e)lectronique| pod| vape)?$', '/marque/vaporesso'],
];
const DEFAULT_JOURNAL_PAGES = [
  '/', '/magasins-cigarette-electronique-montpellier-castelnau-le-lez', '/categorie-produit/e-cigarettes',
  '/choisir-cigarette-electronique-arretez-fumer', '/cigarette-electronique', '/nouveautes-cigarette-electronique',
  '/categorie-produit/eliquides', '/categorie-produit/eliquides/eliquides-grands-formats',
  '/categorie-produit/e-cigarettes/kits-ecigarettes/puffs', '/puff', '/categorie-produit/e-cigarettes/kits-ecigarettes/kits-format-pod',
  '/pod', '/cigarette-electronique-tirage-automatique', '/marque/aspire', '/cartouche-aspire',
  '/categorie-produit/e-cigarettes/composants/box-batteries-electroniques', '/nouveautes-box',
  '/categorie-produit/e-cigarettes/kits-ecigarettes/kits-format-box', '/box', '/categorie-produit/e-cigarettes/composants/resistances',
  '/blog/guides-et-conseils-de-vape/combien-de-temps-dure-une-resistance', '/cartouche-vaporesso',
  '/categorie-produit/eliquides/boosters-de-nicotine', '/categorie-produit/e-cigarettes/composants/clearomiseurs', '/clearomiseur',
];

let tablesReady = false;
const ensureTables = async () => {
  if (tablesReady) return;
  await advisor.ensureTables();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seo_targets (
      id            serial PRIMARY KEY,
      label         text NOT NULL,
      pattern       text NOT NULL,
      target_url    text NOT NULL,
      decided_at    date NOT NULL DEFAULT CURRENT_DATE,
      decided_by    text,
      note          text,
      baseline_from date,
      baseline_to   date,
      active        boolean NOT NULL DEFAULT true,
      stats         jsonb,
      computed_at   timestamp,
      created_at    timestamp NOT NULL DEFAULT now(),
      updated_at    timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS seo_journal (
      id          serial PRIMARY KEY,
      url         text NOT NULL,
      event_date  date NOT NULL,
      summary     text NOT NULL,
      created_by  text,
      created_at  timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS seo_journal_url_idx ON seo_journal (url);
  `);
  const t = await pool.query('SELECT COUNT(*)::int AS n FROM seo_targets');
  if (t.rows[0].n === 0) {
    for (const [label, pattern, url] of DEFAULT_TARGETS) {
      await pool.query(
        `INSERT INTO seo_targets (label, pattern, target_url, decided_at, decided_by, note, baseline_from, baseline_to)
         VALUES ($1, $2, $3, '2026-10-27', 'Maxime', $4, '2026-07-27', '2026-10-22')`,
        [label, pattern, normUrl(url), `Décision du plan de cannibalisation : ${DOC_CANNIBALISATION}`]
      );
    }
  }
  const j = await pool.query('SELECT COUNT(*)::int AS n FROM seo_journal');
  if (j.rows[0].n === 0) {
    for (const p of DEFAULT_JOURNAL_PAGES) {
      await pool.query(
        `INSERT INTO seo_journal (url, event_date, summary, created_by) VALUES ($1, '2026-10-27', $2, 'Jean-Baptiste')`,
        [normUrl(p), `Corrections de cannibalisation (title, H1, méta, intro, FAQ ou liens selon la page) : ${DOC_CANNIBALISATION}`]
      );
    }
  }
  tablesReady = true;
};

/* ─── Journal et repos ─────────────────────────────────── */

// Dernière modification connue de chaque page : journal + rédaction SEO.
const loadLastChanges = async () => {
  const r = await pool.query(`
    SELECT url, MAX(d)::text AS last FROM (
      SELECT url, event_date AS d FROM seo_journal
      UNION ALL
      SELECT p.url, e.at FROM seo_page_events e JOIN seo_pages p ON p.id = e.page_id
      UNION ALL
      SELECT url, published_at FROM seo_pages WHERE published_at IS NOT NULL
    ) x GROUP BY url`).catch(() => ({ rows: [] }));
  const map = new Map();
  for (const row of r.rows) {
    const u = normUrl(row.url);
    if (!map.has(u) || map.get(u) < row.last) map.set(u, row.last);
  }
  return map;
};

const reposJusquau = (last) => (last ? addDays(last, REPOS_JOURS) : null);
const enRepos = (last, today = ymd(new Date())) => !!last && reposJusquau(last) > today;

const listJournal = async (url) => {
  await ensureTables();
  const u = normUrl(url);
  const r = await pool.query(
    `SELECT id, url, event_date::text AS date, summary, created_by, 'journal' AS source FROM seo_journal WHERE url = $1
     UNION ALL
     SELECT e.id, p.url, e.at::text, e.note, e.created_by, 'redaction' FROM seo_page_events e JOIN seo_pages p ON p.id = e.page_id
     WHERE rtrim(p.url, '/') = $1
     ORDER BY 3 DESC, 1 DESC`,
    [u]
  ).catch(() => ({ rows: [] }));
  return r.rows;
};

const addJournal = async ({ url, date, summary }, user) => {
  await ensureTables();
  const u = normUrl(url);
  if (!u) throw new Error('Adresse manquante');
  if (!summary || !String(summary).trim()) throw new Error('Décrire la modification');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : ymd(new Date());
  const r = await pool.query(
    'INSERT INTO seo_journal (url, event_date, summary, created_by) VALUES ($1, $2, $3, $4) RETURNING id, url, event_date::text AS date, summary, created_by',
    [u, d, String(summary).trim(), user || null]
  );
  return r.rows[0];
};

const deleteJournal = async (id) => {
  await ensureTables();
  await pool.query('DELETE FROM seo_journal WHERE id = $1', [id]);
  return { deleted: true };
};

/* ─── Pages cibles : mesure ────────────────────────────── */

const dataTo = async () => {
  const r = await pool.query('SELECT MAX(date) AS max FROM gsc_search_daily WHERE country = $1', [COUNTRY]);
  return r.rows[0].max ? ymd(new Date(r.rows[0].max)) : null;
};

const compileRe = (pattern) => { try { return new RegExp(pattern, 'i'); } catch { return null; } };

// Agrège des lignes requête × page × jour sur une fenêtre.
const aggregate = (rows, from, to, target) => {
  const pages = new Map();
  let impr = 0; let clicks = 0; let posW = 0;
  for (const r of rows) {
    if (r.d < from || r.d > to) continue;
    const pg = normUrl(r.page);
    const o = pages.get(pg) || { page: pg, i: 0, c: 0, pw: 0 };
    o.i += r.i; o.c += r.c; o.pw += r.p * r.i;
    pages.set(pg, o);
    impr += r.i; clicks += r.c; posW += r.p * r.i;
  }
  const list = [...pages.values()].sort((a, b) => b.i - a.i)
    .map((o) => ({ page: o.page, impressions: o.i, clicks: o.c, position: round1(o.i ? o.pw / o.i : null), share: impr ? round1((100 * o.i) / impr) : 0 }));
  const t = pages.get(target);
  return {
    from, to, impressions: impr, clicks, pages_count: pages.size,
    position: round1(impr ? posW / impr : null),
    target_impressions: t ? t.i : 0,
    target_clicks: t ? t.c : 0,
    target_share: impr ? round1((100 * (t ? t.i : 0)) / impr) : null,
    target_position: round1(t && t.i ? t.pw / t.i : null),
    pages: list.slice(0, 10),
  };
};

const computeTargets = async ({ id } = {}) => {
  await ensureTables();
  const to = await dataTo();
  if (!to) return { computed: 0 };
  const targets = (await pool.query(`SELECT * FROM seo_targets WHERE active ${id ? 'AND id = $1' : ''}`, id ? [id] : [])).rows;
  if (!targets.length) return { computed: 0 };
  const fromAll = targets.reduce((m, t) => {
    const b = t.baseline_from ? ymd(new Date(t.baseline_from)) : addDays(to, -112);
    return b < m ? b : m;
  }, addDays(to, -112));
  // Requêtes vues sur la période (une fois), filtrées en JS : bien plus rapide
  // qu'une expression régulière par groupe sur gsc_search_daily.
  const qs = (await pool.query(
    'SELECT DISTINCT query FROM gsc_query_daily WHERE country = $1 AND date BETWEEN $2 AND $3',
    [COUNTRY, fromAll, to]
  )).rows.map((r) => r.query);

  for (const t of targets) {
    const re = compileRe(t.pattern);
    const matched = re ? qs.filter((q) => re.test(q)) : [];
    const target = normUrl(t.target_url);
    const bFrom = t.baseline_from ? ymd(new Date(t.baseline_from)) : addDays(ymd(new Date(t.decided_at)), -84);
    const bTo = t.baseline_to ? ymd(new Date(t.baseline_to)) : addDays(ymd(new Date(t.decided_at)), -1);
    const since = addDays(ymd(new Date(t.decided_at)), 2);
    let rows = [];
    if (matched.length) {
      rows = (await pool.query(
        `SELECT date, page, SUM(impressions)::int AS i, SUM(clicks)::int AS c,
                SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS p
         FROM gsc_search_daily WHERE country = $1 AND query = ANY($2) AND date BETWEEN $3 AND $4
         GROUP BY date, page`,
        [COUNTRY, matched, bFrom < addDays(to, -112) ? bFrom : addDays(to, -112), to]
      )).rows.map((r) => ({ d: ymd(new Date(r.date)), page: r.page, i: r.i, c: r.c, p: Number(r.p) || 0 }));
    }
    // Série hebdomadaire (16 semaines glissantes) de la part de la cible.
    const weeks = [];
    for (let k = 15; k >= 0; k -= 1) {
      const end = addDays(to, -7 * k);
      const a = aggregate(rows, addDays(end, -6), end, target);
      weeks.push({ end, impressions: a.impressions, target_share: a.target_share, target_position: a.target_position, position: a.position });
    }
    const queriesTop = new Map();
    for (const r of rows) {
      if (r.d < addDays(to, -27)) continue;
      queriesTop.set(r.page, (queriesTop.get(r.page) || 0) + r.i);
    }
    const stats = {
      dataTo: to,
      queries: matched.length,
      baseline: aggregate(rows, bFrom, bTo, target),
      last28: aggregate(rows, addDays(to, -27), to, target),
      since: since <= to ? aggregate(rows, since, to, target) : null,
      weeks,
    };
    await pool.query('UPDATE seo_targets SET stats = $2, computed_at = now() WHERE id = $1', [t.id, JSON.stringify(stats)]);
  }
  return { computed: targets.length, dataTo: to };
};

const verdictOf = (t, last) => {
  const s = t.stats?.last28;
  if (!s || !s.impressions) return { code: 'vide', label: 'Pas de données' };
  if (s.target_share >= PART_GAGNEE) return { code: 'gagnee', label: 'Gagnée' };
  const decided = ymd(new Date(t.decided_at));
  if (addDays(decided, REPOS_JOURS) > ymd(new Date()) || enRepos(last)) return { code: 'attente', label: 'En attente de mesure' };
  return { code: 'revoir', label: 'À revoir' };
};

const listTargets = async () => {
  await ensureTables();
  const [r, changes] = await Promise.all([
    pool.query('SELECT * FROM seo_targets WHERE active ORDER BY COALESCE((stats->\'last28\'->>\'impressions\')::int, 0) DESC, id'),
    loadLastChanges(),
  ]);
  return {
    seuil: PART_GAGNEE,
    repos: REPOS_JOURS,
    targets: r.rows.map((t) => {
      const last = changes.get(normUrl(t.target_url)) || null;
      return {
        ...t,
        decided_at: ymd(new Date(t.decided_at)),
        baseline_from: t.baseline_from ? ymd(new Date(t.baseline_from)) : null,
        baseline_to: t.baseline_to ? ymd(new Date(t.baseline_to)) : null,
        target_path: pathOf(t.target_url),
        last_change: last,
        repos_until: enRepos(last) ? reposJusquau(last) : null,
        verdict: verdictOf(t, last),
      };
    }),
  };
};

const saveTarget = async (id, body, user) => {
  await ensureTables();
  const label = String(body.label || '').trim();
  const pattern = String(body.pattern || '').trim();
  const url = normUrl(body.target_url);
  if (!label || !pattern || !url) throw new Error('Libellé, expression et page cible sont obligatoires');
  if (!compileRe(pattern)) throw new Error('Expression régulière invalide');
  const decided = /^\d{4}-\d{2}-\d{2}$/.test(body.decided_at || '') ? body.decided_at : ymd(new Date());
  let row;
  if (id) {
    const r = await pool.query(
      `UPDATE seo_targets SET label = $2, pattern = $3, target_url = $4, decided_at = $5, note = $6, updated_at = now(),
         decided_by = CASE WHEN target_url <> $4 THEN $7 ELSE decided_by END
       WHERE id = $1 RETURNING *`,
      [id, label, pattern, url, decided, body.note || null, user || null]
    );
    row = r.rows[0];
    if (!row) throw new Error('Cible introuvable');
  } else {
    const r = await pool.query(
      `INSERT INTO seo_targets (label, pattern, target_url, decided_at, decided_by, note, baseline_from, baseline_to)
       VALUES ($1, $2, $3, $4, $5, $6, ($4::date - 84), ($4::date - 1)) RETURNING *`,
      [label, pattern, url, decided, user || null, body.note || null]
    );
    row = r.rows[0];
  }
  await computeTargets({ id: row.id });
  return (await listTargets()).targets.find((t) => t.id === row.id);
};

const deleteTarget = async (id) => {
  await ensureTables();
  await pool.query('UPDATE seo_targets SET active = false, updated_at = now() WHERE id = $1', [id]);
  return { deleted: true };
};

/* ─── Fiche page ───────────────────────────────────────── */

const strip = (s) => (s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#0?39;|&#8217;|&rsquo;/g, '’').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const CHROME_RE = /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<header[\s\S]*?<\/header>|<footer[\s\S]*?<\/footer>|<nav[\s\S]*?<\/nav>/gi;

const inspectPage = async (url) => {
  // Pas de paramètre anti-cache dans l'adresse : une redirection Yoast ne se
  // déclenche pas sur une adresse à paramètre inconnu (faux 404, vu le 27/10/2026).
  const res = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'fr-FR,fr;q=0.9', 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    maxRedirects: 0, timeout: 30000, validateStatus: () => true, responseType: 'text', transformResponse: (d) => d,
  }).catch((e) => ({ status: null, headers: {}, data: '', error: e.message }));
  const html = typeof res.data === 'string' ? res.data : '';
  const pick = (re) => { const m = html.match(re); return m ? strip(m[1]) : null; };
  const body = html.replace(CHROME_RE, ' ');
  const jsonld = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      const walk = (x) => {
        if (!x || typeof x !== 'object') return;
        if (Array.isArray(x)) { x.forEach(walk); return; }
        if (x['@type']) jsonld.push({ type: [].concat(x['@type']).join(','), aggregateRating: !!x.aggregateRating, review: !!x.review });
        if (x['@graph']) walk(x['@graph']);
        if (x.hasVariant) walk(x.hasVariant);
      };
      walk(j);
    } catch { /* bloc JSON-LD illisible : ignoré */ }
  }
  const robots = pick(/<meta\s+name=["']robots["']\s+content=["']([^"']*)["']/i);
  return {
    http_status: res.status,
    location: res.headers?.location || null,
    title: pick(/<title[^>]*>([\s\S]*?)<\/title>/i),
    h1: pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i),
    meta: pick(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i),
    robots,
    noindex: /noindex/i.test(robots || ''),
    canonical: pick(/<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/i),
    h2: [...body.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => strip(m[1])).filter(Boolean).slice(0, 20),
    intro: pick(/<div[^>]+class="[^"]*subtitle[^"]*"[^>]*>([\s\S]*?)<\/div>/i),
    words: strip(body).split(' ').filter(Boolean).length,
    faq: (html.match(/class="faq-question"/g) || []).length,
    jsonld,
    links: advisor.extractLinks(html),
    error: res.error || null,
  };
};

const pageKind = (u) => {
  const p = pathOf(u);
  if (p === '/') return 'accueil';
  if (p.startsWith('/produit/')) return 'fiche produit';
  if (p.startsWith('/categorie-produit/')) return 'catégorie';
  if (p.startsWith('/marque/')) return 'marque';
  if (p.startsWith('/etiquette-produit/')) return 'étiquette';
  if (p.startsWith('/blog/') || p.startsWith('/avis-tests/')) return 'article';
  return 'page';
};

const containsQuery = (text, query) => {
  const t = norm(text);
  return norm(query).split(/[^a-z0-9]+/).filter((w) => w.length > 2).every((w) => t.includes(w.replace(/s$/, '')));
};

const BANNED_WORDS = [...advisor.BANNED].filter((w) => !['code', 'livraison', 'avis', 'cbd'].includes(w));
const bannedIn = (text) => {
  const words = new Set(norm(text).split(/[^a-z0-9]+/));
  return BANNED_WORDS.filter((w) => words.has(w));
};

const getPage = async (rawUrl) => {
  await ensureTables();
  const url = normUrl(rawUrl);
  if (!url) throw new Error('Adresse manquante');
  const to = await dataTo();
  const from = to ? addDays(to, -27) : null;
  const [page, qRows, targetsRes, recsRes, journal, changes, inbound] = await Promise.all([
    inspectPage(url),
    to ? pool.query(
      `SELECT s.query, SUM(s.impressions)::int AS i, SUM(s.clicks)::int AS c,
              SUM(s.position * s.impressions) / NULLIF(SUM(s.impressions), 0) AS p
       FROM gsc_search_daily s WHERE s.country = $1 AND s.page = ANY($2) AND s.date BETWEEN $3 AND $4
       GROUP BY s.query ORDER BY 2 DESC LIMIT 60`,
      [COUNTRY, gscForms(url), from, to]
    ) : { rows: [] },
    pool.query('SELECT * FROM seo_targets WHERE active'),
    pool.query(
      `SELECT id, type, title, action, status, est_clicks, urls FROM seo_recommendations
       WHERE active AND status IN ('todo', 'doing') AND (urls && $1::text[]) ORDER BY score DESC`,
      [gscForms(url)]
    ),
    listJournal(url),
    loadLastChanges(),
    pool.query('SELECT url, links FROM seo_page_audit WHERE links IS NOT NULL'),
  ]);

  // Part de la page sur chaque requête : il faut le total de nos pages.
  const qList = qRows.rows.map((r) => r.query);
  const totals = qList.length && to ? (await pool.query(
    `SELECT query, page, SUM(impressions)::int AS i, SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS p
     FROM gsc_search_daily WHERE country = $1 AND query = ANY($2) AND date BETWEEN $3 AND $4 GROUP BY query, page`,
    [COUNTRY, qList, from, to]
  )).rows : [];
  const byQ = new Map();
  for (const r of totals) {
    if (!byQ.has(r.query)) byQ.set(r.query, []);
    byQ.get(r.query).push({ page: normUrl(r.page), i: r.i, p: round1(Number(r.p)) });
  }
  const targets = targetsRes.rows.map((t) => ({ ...t, re: compileRe(t.pattern), url: normUrl(t.target_url) }));
  const queries = qRows.rows.map((r) => {
    const all = byQ.get(r.query) || [];
    const tot = all.reduce((s, x) => s + x.i, 0);
    const t = targets.find((x) => x.re && x.re.test(r.query));
    const rivals = all.filter((x) => x.page !== url).sort((a, b) => b.i - a.i).slice(0, 3)
      .map((x) => ({ page: pathOf(x.page), share: tot ? round1((100 * x.i) / tot) : 0, position: x.p }));
    return {
      query: r.query, impressions: r.i, clicks: r.c, position: round1(Number(r.p)),
      share: tot ? round1((100 * r.i) / tot) : null,
      target: t ? { id: t.id, label: t.label, path: pathOf(t.url), isThis: t.url === url } : null,
      rivals,
    };
  });

  const ownTargets = targets.filter((t) => t.url === url);
  // Requête principale : celle de la cible décidée ; à défaut, la requête libre
  // (non attribuée à une autre page) qui apporte le plus de clics, si elle pèse.
  const isTarget = ownTargets.length > 0;
  const free = queries.filter((q) => (!q.target || q.target.isThis) && q.impressions >= 50)
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
  const main = ownTargets[0]?.label.split(',')[0].trim() || free[0]?.query || null;
  // Sur une page qui n'est cible de rien, title et H1 ne sont que des suggestions.
  const sev = isTarget ? 'ko' : 'warn';
  const misplaced = queries.filter((q) => q.target && !q.target.isThis && q.impressions >= 20);

  const incoming = [];
  for (const a of inbound.rows) {
    if (normUrl(a.url) === url) continue;
    for (const l of a.links || []) {
      if (normUrl(l.href) === url) incoming.push({ from: pathOf(a.url), anchor: l.text || '' });
    }
  }

  // Contrôles : un statut, ce qu'on voit, ce qu'il faut faire.
  const kind = pageKind(url);
  const checks = [];
  // level = gravité quand le contrôle échoue (« ko » à corriger, « warn » à revoir).
  const add = (element, ok, actuel, action, level = 'ko') => checks.push({ element, status: ok ? 'ok' : level, actuel, action: ok ? '' : action });
  add('Réponse du serveur', page.http_status === 200, page.http_status ? `HTTP ${page.http_status}${page.location ? ` vers ${page.location}` : ''}` : (page.error || 'injoignable'),
    'La page doit répondre 200. Une redirection se met sur l\'ancienne adresse, pas sur une page à garder.');
  if (page.http_status === 200) {
    add('Indexation', !page.noindex, page.robots || 'index', 'La page est en noindex : Google ne la montrera pas. À ouvrir seulement si une requête la justifie.');
    const canonOk = !page.canonical || normUrl(page.canonical) === url;
    add('Adresse canonique', canonOk, page.canonical || 'absente', `La canonique pointe ailleurs (${page.canonical}) : Google classera l'autre adresse.`);
    add('Title', !!page.title && page.title.length <= 70 && (!main || containsQuery(page.title, main)),
      page.title ? `« ${page.title} » (${page.title.length} car.)` : 'absent',
      main ? `Mettre « ${main} » en tête du title, 60 à 70 caractères en tout.` : 'Rédiger un title de 60 à 70 caractères.',
      page.title && (!main || containsQuery(page.title, main)) ? 'warn' : sev);
    add('H1', !!page.h1 && (!main || containsQuery(page.h1, main)), page.h1 ? `« ${page.h1} »` : 'absent',
      main ? `Le H1 doit contenir « ${main} ».` : 'Ajouter un H1.', page.h1 ? sev : 'ko');
    const metaOk = !!page.meta && page.meta.length >= 70 && page.meta.length <= 160;
    add('Méta description', metaOk && (!main || containsQuery(page.meta, main)), page.meta ? `« ${page.meta} » (${page.meta.length} car.)` : 'absente',
      `Méta de 120 à 160 caractères${main ? `, qui commence par « ${main} »` : ''}.`, metaOk ? 'warn' : 'ko');
    if (['catégorie', 'marque', 'étiquette'].includes(kind)) {
      add('Intro', !!page.intro && (!main || containsQuery(page.intro, main)), page.intro ? `« ${page.intro.slice(0, 160)}${page.intro.length > 160 ? '…' : ''} »` : 'absente',
        main ? `La première phrase de l'intro doit contenir « ${main} ».` : 'Ajouter une intro de 2 à 3 phrases.', page.intro ? 'warn' : 'ko');
      add('Texte du bas de page', page.h2.length >= 3, `${page.h2.length} H2 : ${page.h2.slice(0, 6).join(' · ') || '—'}`,
        'Ajouter le bloc de texte du bas (H2 sur les requêtes, sections, FAQ), sur le modèle des catégories déjà rédigées.', 'warn');
    }
    if (['catégorie', 'marque', 'page'].includes(kind)) {
      const faqQ = queries.filter((q) => advisor.QUESTION_RE.test(q.query) && q.impressions >= 20);
      add('FAQ', page.faq > 0 || faqQ.length === 0, page.faq ? `${page.faq} question(s)` : 'aucune',
        faqQ.length ? `Ajouter une FAQ qui répond à : ${faqQ.slice(0, 4).map((q) => `« ${q.query} »`).join(', ')}.` : 'Ajouter une FAQ.', 'warn');
    }
    if (kind === 'fiche produit') {
      const product = page.jsonld.find((j) => /Product/.test(j.type));
      add('Données produit', !!product, product ? product.type : 'absentes', 'Les données structurées Product / ProductGroup manquent.');
      add('Note et avis dans Google', !!product && page.jsonld.some((j) => j.aggregateRating),
        product && page.jsonld.some((j) => j.aggregateRating) ? 'présents' : 'absents (pas d\'étoiles dans les résultats)',
        'Ajouter aggregateRating aux données produit (demande en cours chez Viking).', 'warn');
    }
    const hits = [...new Set([page.title, page.h1, page.meta, ...page.h2].flatMap(bannedIn))];
    add('Mots à éviter', hits.length === 0, hits.length ? hits.join(', ') : 'aucun',
      `Retirer de title, H1, méta et intertitres : ${hits.join(', ')} (règles de rédaction).`, 'warn');
  }
  const anchorOk = main ? incoming.filter((l) => containsQuery(l.anchor, main)) : incoming;
  add('Liens reçus avec la bonne ancre', !main || anchorOk.length >= 3,
    `${incoming.length} lien(s) relevé(s) dans le contenu, dont ${anchorOk.length} avec l'ancre « ${main || '—'} »`,
    `Ajouter des liens vers cette page avec l'ancre « ${main} » depuis les pages qui portent la requête à sa place${misplaced.length ? '' : ' ou depuis les pages proches'}.`, 'warn');
  for (const q of misplaced.slice(0, 8)) {
    add(`Cannibalisation « ${q.query} »`, false, `${q.share} % des impressions de la requête arrivent ici (position ${q.position ?? '—'})`,
      `La cible décidée est ${q.target.path} : retirer « ${q.target.label.split(',')[0].trim()} » du title, du H1 et des intertitres de cette page, et ajouter un lien vers ${q.target.path} avec cette ancre.`, 'ko');
  }

  const last = changes.get(url) || null;
  return {
    url, path: pathOf(url), kind, dataTo: to, period: { from, to },
    main_query: main,
    own_targets: ownTargets.map((t) => ({ id: t.id, label: t.label, share: t.stats?.last28?.target_share ?? null, position: t.stats?.last28?.target_position ?? null })),
    page: { ...page, links: undefined, jsonld: page.jsonld.slice(0, 12) },
    checks,
    queries,
    incoming: incoming.slice(0, 40),
    recommendations: recsRes.rows,
    journal,
    last_change: last,
    repos_until: enRepos(last) ? reposJusquau(last) : null,
  };
};

/* ─── Branché sur les recommandations ──────────────────── */

// Cartes de cannibalisation fondées sur les décisions (une par cible qui ne
// capte pas encore PART_GAGNEE %). Les requêtes couvertes par une cible ne
// passent plus par la détection automatique « page qui a le plus de clics ».
const targetRecommendations = async () => {
  await ensureTables();
  const { targets } = await listTargets();
  const recs = [];
  for (const t of targets) {
    const s = t.stats?.last28;
    if (!s || s.impressions < 100 || s.target_share >= PART_GAGNEE) continue;
    const rivals = s.pages.filter((p) => p.page !== normUrl(t.target_url) && p.share >= 10);
    if (!rivals.length) continue;
    const head = t.label.split(',')[0].trim();
    const steps = [
      `Page cible décidée le ${t.decided_at.split('-').reverse().join('/')} : ${t.target_path}. Elle reçoit ${s.target_share} % des impressions (position ${s.target_position ?? '—'}).`,
      ...rivals.map((p) => `${pathOf(p.page)} reçoit ${p.share} % (position ${p.position ?? '—'}) : retirer « ${head} » de son title, de son H1 et de ses intertitres, puis y ajouter un lien vers ${t.target_path} avec l'ancre « ${head} ».`),
      `Enfin, sur ${t.target_path} : « ${head} » en tête du title et dans le H1, une fois dans l'intro. Ouvrir sa fiche page pour le reste des contrôles.`,
    ];
    recs.push({
      rec_key: `cible:${t.id}`,
      type: 'cannibalisation',
      effort: 'faible',
      est_clicks: Math.max(0, (s.impressions * (100 - s.target_share)) / 100 * 0.03 * (30 / 28)),
      title: `« ${head} » : la page cible n'a que ${s.target_share} % des impressions`,
      reason: `Sur les requêtes « ${t.label} » (${s.impressions} impressions en 28 jours, France), Google montre surtout d'autres pages que la cible décidée.`,
      action: steps.map((x, n) => `${n + 1}. ${x}`).join('\n\n'),
      urls: [normUrl(t.target_url), ...rivals.map((p) => p.page)],
      queries: [],
      targetRe: compileRe(t.pattern),
    });
  }
  return recs;
};

module.exports = {
  ensureTables, normUrl, pathOf,
  listTargets, saveTarget, deleteTarget, computeTargets, targetRecommendations,
  getPage, listJournal, addJournal, deleteJournal, loadLastChanges, enRepos, reposJusquau, REPOS_JOURS, PART_GAGNEE,
};
