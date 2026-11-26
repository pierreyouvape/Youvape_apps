/**
 * Visibilité dans les réponses des IA (Google AI Mode, Perplexity, ChatGPT, Gemini).
 *
 * Reprend l'historique de l'outil « LLM Ranking » d'Eskimoz (export « prompt-responses_*.csv »,
 * une ligne par prompt × IA × jour) et sert l'onglet « IA » de l'app SEO.
 * Les relevés faits par nos soins plus tard iront dans les mêmes tables avec une autre `origin`.
 *
 * Tables :
 *  - llm_prompts   : questions suivies (+ note d'action libre)
 *  - llm_responses : une réponse d'une IA à un prompt, un jour donné
 */
const axios = require('axios');
const pool = require('../config/database');

const PROVIDERS = [
  { key: 'ai-mode', label: 'Google AI Mode' },
  { key: 'perplexity', label: 'Perplexity' },
  { key: 'chatgpt', label: 'ChatGPT' },
  { key: 'gemini', label: 'Gemini' },
  // Relevé fait par nos soins (origin 'youvape'), pas par Eskimoz.
  { key: 'claude', label: 'Claude' },
];

const normProvider = (s) => {
  const v = String(s || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (v === 'openai' || v === 'chat-gpt') return 'chatgpt';
  if (v === 'aimode' || v === 'google-ai-mode') return 'ai-mode';
  return v;
};

// Domaine sans « www. » ; « mapquest.com/fr/youvape-… » reste mapquest.com.
const domainOf = (u) => String(u || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0].toLowerCase();
const isYouvape = (u) => domainOf(u) === 'youvape.fr';
const normUrl = (u) => String(u || '').trim().replace(/^http:\/\//i, 'https://').replace(/^https:\/\/www\./i, 'https://');

// Où en est l'action décidée pour un prompt.
const PROMPT_STATUSES = ['todo', 'doing', 'done', 'none'];

let tablesReady = false;
const ensureTables = async () => {
  if (tablesReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS llm_prompts (
      id          serial PRIMARY KEY,
      prompt      text NOT NULL UNIQUE,
      language    text,
      country     text,
      tags        text,
      note        text,
      active      boolean NOT NULL DEFAULT true,
      created_at  timestamp NOT NULL DEFAULT now(),
      updated_at  timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS llm_responses (
      id           serial PRIMARY KEY,
      prompt_id    integer NOT NULL REFERENCES llm_prompts(id) ON DELETE CASCADE,
      provider     text NOT NULL,
      run_date     date NOT NULL,
      mention      boolean NOT NULL DEFAULT false,
      position     integer,
      citation     boolean NOT NULL DEFAULT false,
      sentiment    integer,
      competitors  text[] NOT NULL DEFAULT '{}',
      response     text,
      sources      text[] NOT NULL DEFAULT '{}',
      origin       text NOT NULL DEFAULT 'eskimoz',
      imported_at  timestamp NOT NULL DEFAULT now(),
      UNIQUE (prompt_id, provider, run_date, origin)
    );
    CREATE INDEX IF NOT EXISTS llm_responses_date_idx ON llm_responses (run_date);
    -- Suivi de l'action par prompt (26/11/2026).
    ALTER TABLE llm_prompts ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'todo';
    ALTER TABLE llm_prompts ADD COLUMN IF NOT EXISTS status_at timestamp;
    ALTER TABLE llm_prompts ADD COLUMN IF NOT EXISTS status_by text;
    -- Modèle qui a réellement répondu (relevés faits par nos soins).
    ALTER TABLE llm_responses ADD COLUMN IF NOT EXISTS model text;
    CREATE TABLE IF NOT EXISTS llm_runs (
      id             serial PRIMARY KEY,
      provider       text NOT NULL,
      started_at     timestamp NOT NULL DEFAULT now(),
      finished_at    timestamp,
      started_by     text,
      prompts        integer NOT NULL DEFAULT 0,
      ok             integer NOT NULL DEFAULT 0,
      errors         jsonb NOT NULL DEFAULT '[]',
      input_tokens   bigint NOT NULL DEFAULT 0,
      output_tokens  bigint NOT NULL DEFAULT 0,
      searches       integer NOT NULL DEFAULT 0,
      cost_usd       numeric(10,4)
    );
  `);
  tablesReady = true;
};

/* ─── Import CSV ─────────────────────────────────────────── */

// CSV RFC 4180 : guillemets doublés, retours à la ligne dans les champs, BOM.
const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
};

const REQUIRED = ['prompt', 'provider', 'date', 'mention', 'citation', 'response', 'sources'];
const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
const intOrNull = (v) => (v === '' || v === undefined || v === null || Number.isNaN(Number(v)) ? null : Math.round(Number(v)));

/**
 * Importe l'export Eskimoz « prompt-responses_*.csv ». Ré-importer le même fichier
 * ne crée aucun doublon (clé prompt × IA × jour × origine).
 */
const importEskimozCsv = async (buffer) => {
  await ensureTables();
  const rows = parseCsv(buffer.toString('utf8'));
  if (rows.length < 2) throw new Error('Fichier vide');
  const head = rows[0].map((h) => h.trim());
  const missing = REQUIRED.filter((h) => !head.includes(h));
  if (missing.length) {
    throw new Error(`Ce n'est pas l'export « prompt-responses » d'Eskimoz (colonnes manquantes : ${missing.join(', ')})`);
  }
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  const get = (r, k) => (col[k] === undefined ? '' : (r[col[k]] ?? ''));

  const client = await pool.connect();
  let inserted = 0;
  let skipped = 0;
  let promptsCreated = 0;
  try {
    await client.query('BEGIN');
    const promptIds = new Map();
    for (const r of rows.slice(1)) {
      const prompt = get(r, 'prompt').trim();
      const date = get(r, 'date').slice(0, 10);
      if (!prompt || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; continue; }
      if (!promptIds.has(prompt)) {
        const p = await client.query(
          `INSERT INTO llm_prompts (prompt, language, country) VALUES ($1, $2, $3)
           ON CONFLICT (prompt) DO NOTHING RETURNING id`,
          [prompt, get(r, 'language') || null, get(r, 'country') || null]
        );
        if (p.rows[0]) { promptsCreated++; promptIds.set(prompt, p.rows[0].id); } else {
          const e = await client.query('SELECT id FROM llm_prompts WHERE prompt = $1', [prompt]);
          promptIds.set(prompt, e.rows[0].id);
        }
      }
      const res = await client.query(
        `INSERT INTO llm_responses (prompt_id, provider, run_date, mention, position, citation, sentiment, competitors, response, sources, origin)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'eskimoz')
         ON CONFLICT (prompt_id, provider, run_date, origin) DO NOTHING`,
        [
          promptIds.get(prompt), normProvider(get(r, 'provider')), date,
          get(r, 'mention') === 'yes', intOrNull(get(r, 'position')),
          get(r, 'citation') === 'yes', intOrNull(get(r, 'sentiment')),
          list(get(r, 'competitors')), get(r, 'response'), list(get(r, 'sources')).map(normUrl),
        ]
      );
      if (res.rowCount) inserted++; else skipped++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { rows: rows.length - 1, inserted, skipped, promptsCreated };
};

/* ─── Lecture ────────────────────────────────────────────── */

const pct = (a, n) => (n ? Math.round((1000 * a) / n) / 10 : null);
// Lundi de la semaine (dates texte AAAA-MM-JJ).
const weekStart = (ymd) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

const loadRows = async ({ provider, from, to } = {}) => {
  const where = [];
  const args = [];
  if (provider && provider !== 'all') { args.push(provider); where.push(`provider = $${args.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from || '')) { args.push(from); where.push(`run_date >= $${args.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to || '')) { args.push(to); where.push(`run_date <= $${args.length}`); }
  const r = await pool.query(
    `SELECT id, prompt_id, provider, run_date::text AS date, mention, position, citation, sentiment, competitors, sources
     FROM llm_responses ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
    args
  );
  return r.rows;
};

const count = (map, key, inc = 1) => map.set(key, (map.get(key) || 0) + inc);
const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

const stats = (rows) => {
  const n = rows.length;
  const m = rows.filter((x) => x.mention).length;
  const c = rows.filter((x) => x.citation).length;
  const pos = rows.filter((x) => x.position);
  const sen = rows.filter((x) => x.sentiment !== null);
  return {
    n,
    mentions: m,
    citations: c,
    mentionRate: pct(m, n),
    citationRate: pct(c, n),
    avgPosition: pos.length ? Math.round((10 * pos.reduce((s, x) => s + x.position, 0)) / pos.length) / 10 : null,
    avgSentiment: sen.length ? Math.round(sen.reduce((s, x) => s + x.sentiment, 0) / sen.length) : null,
  };
};

const byProvider = (rows) => Object.fromEntries(PROVIDERS.map((p) => [p.key, stats(rows.filter((x) => x.provider === p.key))]));

const getOverview = async (filters = {}) => {
  await ensureTables();
  const rows = await loadRows(filters);
  const prompts = (await pool.query('SELECT id, prompt, note, tags, active, status, status_at, status_by FROM llm_prompts ORDER BY id')).rows;
  const dates = rows.map((x) => x.date).sort();

  // Semaine par semaine, taux par IA.
  const weeks = new Map();
  for (const x of rows) {
    const w = weekStart(x.date);
    if (!weeks.has(w)) weeks.set(w, []);
    weeks.get(w).push(x);
  }
  const series = [...weeks.keys()].sort().map((w) => {
    const wr = weeks.get(w);
    const point = { week: w, all: stats(wr) };
    for (const p of PROVIDERS) point[p.key] = stats(wr.filter((x) => x.provider === p.key));
    return point;
  });

  const competitors = new Map();
  const domains = new Map();
  const yvUrls = new Map();
  const yvUrlPrompts = new Map();
  for (const x of rows) {
    for (const c of new Set(x.competitors)) count(competitors, c);
    for (const d of new Set(x.sources.map(domainOf))) count(domains, d);
    for (const u of new Set(x.sources.filter(isYouvape))) {
      count(yvUrls, u);
      if (!yvUrlPrompts.has(u)) yvUrlPrompts.set(u, new Set());
      yvUrlPrompts.get(u).add(x.prompt_id);
    }
  }

  const byPrompt = new Map();
  for (const x of rows) {
    if (!byPrompt.has(x.prompt_id)) byPrompt.set(x.prompt_id, []);
    byPrompt.get(x.prompt_id).push(x);
  }
  const promptRows = prompts.map((p) => {
    const pr = byPrompt.get(p.id) || [];
    const comp = new Map();
    for (const x of pr) for (const c of new Set(x.competitors)) count(comp, c);
    return {
      ...p,
      ...stats(pr),
      providers: byProvider(pr),
      lastDate: pr.length ? pr.map((x) => x.date).sort().pop() : null,
      competitors: top(comp, 3).map(([name, k]) => ({ name, count: k })),
    };
  }).filter((p) => p.n > 0);

  return {
    providers: PROVIDERS,
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
    total: stats(rows),
    byProvider: byProvider(rows),
    series,
    prompts: promptRows,
    competitors: [{ name: 'YouVape', count: rows.filter((x) => x.mention).length, self: true },
      ...top(competitors, 20).map(([name, k]) => ({ name, count: k }))].sort((a, b) => b.count - a.count),
    domains: top(domains, 40).map(([domain, k]) => ({ domain, count: k, self: domain === 'youvape.fr' })),
    youvapeUrls: top(yvUrls, 100).map(([url, k]) => ({ url, count: k, prompts: yvUrlPrompts.get(url).size })),
  };
};

const getPrompt = async (id, filters = {}) => {
  await ensureTables();
  const p = (await pool.query('SELECT id, prompt, note, tags, language, country, active, status, status_at, status_by FROM llm_prompts WHERE id = $1', [id])).rows[0];
  if (!p) return null;
  const rows = (await loadRows(filters)).filter((x) => x.prompt_id === id);
  const urls = new Map();
  const comp = new Map();
  for (const x of rows) {
    for (const u of new Set(x.sources)) count(urls, u);
    for (const c of new Set(x.competitors)) count(comp, c);
  }
  return {
    ...p,
    providers: PROVIDERS,
    total: stats(rows),
    byProvider: byProvider(rows),
    sources: top(urls, 25).map(([url, k]) => ({ url, count: k, self: isYouvape(url) })),
    competitors: top(comp, 15).map(([name, k]) => ({ name, count: k })),
    responses: rows
      .sort((a, b) => (a.date === b.date ? a.provider.localeCompare(b.provider) : b.date.localeCompare(a.date)))
      .map(({ sources, prompt_id: _p, ...x }) => ({ ...x, sourcesCount: sources.length })),
  };
};

const getResponse = async (id) => {
  await ensureTables();
  const r = await pool.query(
    `SELECT r.id, r.provider, r.run_date::text AS date, r.mention, r.position, r.citation, r.sentiment,
            r.competitors, r.response, r.sources, r.origin, p.prompt
     FROM llm_responses r JOIN llm_prompts p ON p.id = r.prompt_id WHERE r.id = $1`,
    [id]
  );
  return r.rows[0] || null;
};

// Note et/ou statut : seul ce qui est envoyé change.
const updatePrompt = async (id, body, user) => {
  await ensureTables();
  const sets = [];
  const args = [id];
  if (body.note !== undefined) {
    args.push(body.note === null ? null : String(body.note));
    sets.push(`note = $${args.length}`);
  }
  if (body.status !== undefined) {
    if (!PROMPT_STATUSES.includes(body.status)) throw new Error('Statut inconnu');
    args.push(body.status);
    sets.push(`status = $${args.length}`, 'status_at = now()');
    args.push(user || null);
    sets.push(`status_by = $${args.length}`);
  }
  if (!sets.length) throw new Error('Rien à modifier');
  const r = await pool.query(
    `UPDATE llm_prompts SET ${sets.join(', ')}, updated_at = now() WHERE id = $1
     RETURNING id, note, status, status_at, status_by`,
    args
  );
  return r.rows[0] || null;
};

/* ─── Relevé Claude (fait par nos soins) ─────────────────── */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = process.env.LLM_VISIBILITY_MODEL || 'claude-opus-5-5';
// Tarifs Claude Opus 5.5 (USD) : 4 $ / 20 $ par million de jetons, 10 $ les 1 000 recherches.
const PRICE = { input: 4 / 1e6, output: 20 / 1e6, search: 10 / 1000 };

// Concurrents reconnus dans le texte : les mêmes noms qu'Eskimoz, pour comparer les deux sources.
const COMPETITORS = [
  ['Le Vapoteur Discount', /vapoteur[\s-]?discount|\blvd\b/i],
  ['Cigarette Elec', /cigarette[\s-]?elec\b|cigaretteelec/i],
  ['Kumulus Vape', /kumulus/i],
  ['lepetitvapoteur.com', /petit[\s-]?vapoteur/i],
  ['Taffe Elec', /taffe[\s-]?elec/i],
  ['Nicovip', /nicovip/i],
  ['Arômes & Liquides', /ar[oô]mes?\s*(&|et)\s*liquides/i],
  ['ecigplanete.com', /ecig[\s-]?plan[eè]te/i],
  ['lepetitfumeur.fr', /petit[\s-]?fumeur/i],
];
const YOUVAPE_RE = /you[\s-]?vape/i;

// Lit la réponse comme Eskimoz : mention, rang parmi les marques nommées, concurrents, sources citées.
const analyzeAnswer = (text, sources) => {
  const found = [];
  const m = text.search(YOUVAPE_RE);
  if (m >= 0) found.push({ name: 'YouVape', at: m });
  for (const [name, re] of COMPETITORS) {
    const i = text.search(re);
    if (i >= 0) found.push({ name, at: i });
  }
  found.sort((a, b) => a.at - b.at);
  const rank = found.findIndex((f) => f.name === 'YouVape');
  return {
    mention: m >= 0,
    position: rank >= 0 ? rank + 1 : null,
    citation: sources.some(isYouvape),
    competitors: found.filter((f) => f.name !== 'YouVape').map((f) => f.name),
  };
};

// Une question posée comme un internaute : pas de consigne, recherche web activée, depuis la France.
const askClaude = async (prompt) => {
  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    // Si Claude refusait, le serveur répond avec un autre modèle (noté dans `model`).
    fallbacks: 'default',
    // Outil de recherche STANDARD, pas web_search_20260209 : celui-ci passe par du code
    // (filtrage dynamique) et la réponse ne porte plus de citations, donc aucune source
    // à relever ; il épuisait aussi sa limite de recherches (essais du 26/11/2026).
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5, user_location: { type: 'approximate', country: 'FR', city: 'Paris', timezone: 'Europe/Paris' } }],
  };
  const usage = { input: 0, output: 0, searches: 0 };
  let messages = [{ role: 'user', content: prompt }];
  let data;
  for (let i = 0; i < 4; i++) {
    const res = await axios.post(ANTHROPIC_URL, { ...body, messages }, {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'content-type': 'application/json',
      },
      timeout: 600000,
    });
    data = res.data;
    const u = data.usage || {};
    usage.input += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    usage.output += u.output_tokens || 0;
    usage.searches += u.server_tool_use?.web_search_requests || 0;
    if (data.stop_reason !== 'pause_turn') break;
    // Recherche longue : on renvoie la réponse partielle, le serveur reprend.
    messages = [{ role: 'user', content: prompt }, { role: 'assistant', content: data.content }];
  }
  if (data.stop_reason === 'refusal') throw new Error('Claude a refusé de répondre');
  // Texte affiché à l'internaute ; les sources sont celles qu'il cite (pas tout ce qu'il a lu).
  const blocks = (data.content || []).filter((c) => c.type === 'text');
  const text = blocks.map((c) => c.text).join('').trim();
  const cited = [];
  for (const b of blocks) {
    for (const c of b.citations || []) if (c.url) cited.push(normUrl(c.url));
  }
  return { text, sources: [...new Set(cited)], model: data.model || CLAUDE_MODEL, usage, truncated: data.stop_reason === 'max_tokens' };
};

const runState = { running: false, provider: 'claude', done: 0, total: 0, errors: [], runId: null, startedAt: null };

const getRunStatus = async () => {
  await ensureTables();
  const last = (await pool.query(
    `SELECT id, provider, started_at, finished_at, started_by, prompts, ok, errors, searches, cost_usd
     FROM llm_runs ORDER BY id DESC LIMIT 5`
  )).rows;
  return { configured: !!process.env.ANTHROPIC_API_KEY, model: CLAUDE_MODEL, state: runState, lastRuns: last };
};

/**
 * Pose les prompts actifs à Claude et enregistre les réponses (origin 'youvape').
 * Un prompt déjà relevé aujourd'hui n'est pas reposé. En tâche de fond : l'écran suit /run-status.
 */
const startClaudeRun = async ({ promptIds, user } = {}) => {
  await ensureTables();
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Clé API Claude absente du serveur');
  if (runState.running) throw new Error('Un relevé est déjà en cours');
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const args = [today];
  let filter = '';
  if (Array.isArray(promptIds) && promptIds.length) { args.push(promptIds.map(Number)); filter = 'AND p.id = ANY($2)'; }
  const prompts = (await pool.query(
    `SELECT p.id, p.prompt FROM llm_prompts p
     WHERE p.active ${filter}
       AND NOT EXISTS (SELECT 1 FROM llm_responses r WHERE r.prompt_id = p.id AND r.provider = 'claude' AND r.run_date = $1)
     ORDER BY p.id`,
    args
  )).rows;
  if (!prompts.length) return { started: false, message: 'Tous les prompts ont déjà été posés à Claude aujourd’hui.' };

  const run = (await pool.query(
    'INSERT INTO llm_runs (provider, started_by, prompts) VALUES ($1, $2, $3) RETURNING id',
    ['claude', user || null, prompts.length]
  )).rows[0];
  Object.assign(runState, { running: true, done: 0, total: prompts.length, errors: [], runId: run.id, startedAt: new Date() });

  (async () => {
    const tot = { input: 0, output: 0, searches: 0 };
    let ok = 0;
    for (const p of prompts) {
      try {
        const a = await askClaude(p.prompt);
        tot.input += a.usage.input; tot.output += a.usage.output; tot.searches += a.usage.searches;
        if (!a.text) throw new Error('Réponse vide');
        const r = analyzeAnswer(a.text, a.sources);
        await pool.query(
          `INSERT INTO llm_responses (prompt_id, provider, run_date, mention, position, citation, sentiment, competitors, response, sources, origin, model)
           VALUES ($1, 'claude', $2, $3, $4, $5, NULL, $6, $7, $8, 'youvape', $9)
           ON CONFLICT (prompt_id, provider, run_date, origin) DO NOTHING`,
          [p.id, today, r.mention, r.position, r.citation, r.competitors,
            a.truncated ? `${a.text}\n\n[réponse coupée : limite de longueur atteinte]` : a.text, a.sources, a.model]
        );
        ok++;
      } catch (e) {
        const msg = e.response?.data?.error?.message || e.message;
        runState.errors.push({ promptId: p.id, error: msg });
        console.error('[SEO] Relevé Claude, prompt', p.id, ':', msg);
      }
      runState.done++;
    }
    const cost = tot.input * PRICE.input + tot.output * PRICE.output + tot.searches * PRICE.search;
    await pool.query(
      `UPDATE llm_runs SET finished_at = now(), ok = $2, errors = $3, input_tokens = $4, output_tokens = $5, searches = $6, cost_usd = $7
       WHERE id = $1`,
      [run.id, ok, JSON.stringify(runState.errors), tot.input, tot.output, tot.searches, cost.toFixed(4)]
    ).catch((e) => console.error('[SEO] Relevé Claude, clôture :', e.message));
    runState.running = false;
  })().catch((e) => { runState.running = false; console.error('[SEO] Relevé Claude :', e.message); });

  return { started: true, runId: run.id, prompts: prompts.length };
};

module.exports = {
  analyzeAnswer, askClaude, startClaudeRun, getRunStatus,
  PROVIDERS, PROMPT_STATUSES, ensureTables, parseCsv, importEskimozCsv, getOverview, getPrompt, getResponse, updatePrompt,
};
