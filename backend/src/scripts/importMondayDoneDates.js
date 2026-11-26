/**
 * Reprend de Monday la date (et l'auteur) du passage à « Fait » des étapes
 * importées, pour la colonne « Fait le » des sous-éléments.
 *
 *   MONDAY_TOKEN=… node src/scripts/importMondayDoneDates.js --boards=5097034926,5103927835          (simulation)
 *   MONDAY_TOKEN=… node src/scripts/importMondayDoneDates.js --boards=5097034926,5103927835 --apply  (écrit)
 *
 * N'écrit QUE dans les cases vides : étapes `fait`, importées (monday_id),
 * `done_at` NULL. Une étape cochée dans l'app garde sa date et son auteur.
 *
 * Sources Monday :
 *  - date : `changed_at` de la colonne Statut (date du dernier changement de
 *    statut, donc du passage à « Fait » pour une étape faite) ;
 *  - auteur : journal d'activité du tableau des sous-éléments (dernier passage
 *    à « Fait » de l'élément). Le journal n'est pas conservé indéfiniment par
 *    Monday : sans trace, l'auteur reste vide et seule la date est reprise.
 */

const pool = require('../config/database');

const API = 'https://api.monday.com/v2';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const APPLY = Boolean(args.apply);
const BOARDS = String(args.boards || '').split(',').map((s) => s.trim()).filter(Boolean);
const TOKEN = process.env.MONDAY_TOKEN;

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const parse = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };

async function gql(query, variables = {}, attempt = 1) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: TOKEN, 'API-Version': '2024-10' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => null);
  const err = json?.errors || json?.error_message;
  if (err && attempt < 5 && /complexity|rate|minute/i.test(JSON.stringify(err))) {
    await new Promise((r) => setTimeout(r, 15000 * attempt));
    return gql(query, variables, attempt + 1);
  }
  if (!res.ok || !json || err) throw new Error(`Monday : ${res.status} ${JSON.stringify(err || json).slice(0, 400)}`);
  return json.data;
}

const SUB = 'subitems { id board { id } column_values { text value column { title } } }';

async function subitemsOf(boardId) {
  const first = await gql(`query ($b: [ID!]) { boards(ids: $b) { items_page(limit: 50) { cursor items { ${SUB} } } } }`, { b: [boardId] });
  const page0 = first.boards[0]?.items_page;
  if (!page0) throw new Error(`Tableau ${boardId} introuvable`);
  const items = [...page0.items];
  let cursor = page0.cursor;
  while (cursor) {
    const p = await gql(`query ($c: String!) { next_items_page(limit: 50, cursor: $c) { cursor items { ${SUB} } } }`, { c: cursor });
    items.push(...p.next_items_page.items);
    cursor = p.next_items_page.cursor;
  }
  return items.flatMap((i) => i.subitems || []);
}

/** Dernier passage à « Fait » par élément, d'après le journal d'activité : { pulseId: { userId, at } }. */
async function doneAuthors(subBoardId) {
  const out = {};
  for (let page = 1; page <= 60; page += 1) {
    const d = await gql(
      `query ($b: [ID!], $p: Int) { boards(ids: $b) { activity_logs(limit: 1000, page: $p) { event data user_id created_at } } }`,
      { b: [subBoardId], p: page },
    );
    const logs = d.boards[0]?.activity_logs || [];
    if (!logs.length) break;
    logs.forEach((l) => {
      const data = parse(l.data);
      const isStatus = norm(data?.column_title) === 'statut' || data?.column_id === 'status';
      if (!data?.pulse_id || !isStatus) return;
      const label = data.value?.label?.text ?? data.value?.label;
      if (!['fait', 'terminee'].includes(norm(label))) return;
      const at = Number(l.created_at) / 1e4; // Monday : dizaines de microsecondes depuis 1970
      const prev = out[data.pulse_id];
      if (!prev || at > prev.at) out[data.pulse_id] = { userId: String(l.user_id), at };
    });
  }
  return out;
}

async function main() {
  if (!TOKEN || !BOARDS.length) {
    console.error('Usage : MONDAY_TOKEN=… node src/scripts/importMondayDoneDates.js --boards=<id>[,<id>] [--apply]');
    process.exit(1);
  }
  // Personnes Monday → comptes (même règle que l'import : e-mail, sinon prénom)
  const { users: mUsers } = await gql('{ users(limit: 200) { id name email } }');
  const { rows: ours } = await pool.query('SELECT id, email, name FROM users WHERE disabled_at IS NULL');
  const byEmail = new Map(ours.map((u) => [norm(u.email), u.id]));
  const byFirst = new Map(ours.filter((u) => u.name).map((u) => [norm(u.name).split(/\s+/)[0], u.id]));
  const userMap = new Map(mUsers.map((m) => [String(m.id), byEmail.get(norm(m.email)) || byFirst.get(norm(m.name).split(/\s+/)[0]) || null]));

  const found = [];
  for (const b of BOARDS) {
    const subs = await subitemsOf(b);
    const subBoards = [...new Set(subs.map((s) => s.board?.id).filter(Boolean))];
    const authors = {};
    for (const sb of subBoards) {
      try {
        Object.assign(authors, await doneAuthors(sb));
      } catch (e) {
        console.log(`Journal d'activité du tableau ${sb} illisible (${e.message.slice(0, 120)}) : dates seules.`);
      }
    }
    subs.forEach((s) => {
      const st = s.column_values.find((c) => ['statut', 'status'].includes(norm(c.column?.title)));
      if (!['fait', 'terminee'].includes(norm(st?.text))) return;
      const changed = parse(st.value)?.changed_at;
      const a = authors[s.id];
      const at = changed || (a ? new Date(a.at).toISOString() : null);
      if (!at) return;
      found.push({ mondayId: Number(s.id), at, by: a ? userMap.get(a.userId) || null : null });
    });
  }

  const ids = found.map((f) => f.mondayId);
  const { rows: blank } = await pool.query(
    "SELECT monday_id FROM taches_steps WHERE monday_id = ANY($1) AND status = 'fait' AND done_at IS NULL", [ids],
  );
  const todo = found.filter((f) => blank.some((r) => Number(r.monday_id) === f.mondayId));
  console.log(`Étapes faites chez Monday avec une date : ${found.length}, dont ${found.filter((f) => f.by).length} avec l'auteur.`);
  console.log(`À remplir chez nous (faites, sans date) : ${todo.length}.`);
  todo.slice(0, 5).forEach((f) => console.log('  ex.', f));

  if (!APPLY) {
    console.log('\nSimulation seulement. Relancer avec --apply pour écrire.');
    await pool.end();
    return;
  }
  let n = 0;
  for (const f of todo) {
    const { rowCount } = await pool.query(
      `UPDATE taches_steps SET done_at = ($2::timestamptz AT TIME ZONE 'Europe/Paris'), done_by = COALESCE(done_by, $3)
        WHERE monday_id = $1 AND status = 'fait' AND done_at IS NULL`,
      [f.mondayId, f.at, f.by],
    );
    n += rowCount;
  }
  console.log(`\n${n} étapes complétées.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
