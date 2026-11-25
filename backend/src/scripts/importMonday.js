/**
 * Import du tableau Monday « Tâches » dans l'app Tâches.
 *
 *   MONDAY_TOKEN=… node src/scripts/importMonday.js --board=<id du tableau>          (simulation)
 *   MONDAY_TOKEN=… node src/scripts/importMonday.js --board=<id du tableau> --apply  (écrit)
 *
 * Le jeton : Monday → avatar → Développeurs → « Mes jetons d'accès ». L'id du
 * tableau est dans son adresse (…/boards/<id>).
 *
 * Rejouable : chaque élément garde son `monday_id`, un second passage met à
 * jour au lieu de dupliquer (utile pour reprendre l'état du jour de la bascule).
 * Les commentaires (« updates ») déjà importés (même tâche, même date, même
 * texte) ne sont pas recopiés.
 *
 * Correspondance des personnes : e-mail Monday = e-mail du compte, sinon même
 * prénom. La simulation affiche le résultat ; une personne non reconnue est
 * simplement laissée de côté (à réattribuer dans l'app).
 */

const pool = require('../config/database');

const API = 'https://api.monday.com/v2';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const APPLY = Boolean(args.apply);
const BOARD = args.board;
const TOKEN = process.env.MONDAY_TOKEN;

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function gql(query, variables = {}) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: TOKEN, 'API-Version': '2024-10' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.errors || json.error_message) {
    throw new Error(`Monday : ${res.status} ${JSON.stringify(json?.errors || json?.error_message || json).slice(0, 400)}`);
  }
  return json.data;
}

const COLS = 'column_values { id type text value column { title } }';
const ITEM = `id name ${COLS}
  subitems { id name ${COLS} }
  updates(limit: 100) { text_body created_at creator { name email } }`;

async function fetchItems() {
  const first = await gql(
    `query ($b: [ID!]) { boards(ids: $b) { name items_page(limit: 50) { cursor items { ${ITEM} } } } }`,
    { b: [BOARD] },
  );
  const board = first.boards[0];
  if (!board) throw new Error('Tableau introuvable (id ou droits du jeton)');
  const items = [...board.items_page.items];
  let cursor = board.items_page.cursor;
  while (cursor) {
    const page = await gql(
      `query ($c: String!) { next_items_page(limit: 50, cursor: $c) { cursor items { ${ITEM} } } }`,
      { c: cursor },
    );
    items.push(...page.next_items_page.items);
    cursor = page.next_items_page.cursor;
  }
  return { name: board.name, items };
}

/** Colonne par son titre affiché (insensible aux accents et à la casse). */
const col = (item, ...titles) => item.column_values.find((c) => titles.map(norm).includes(norm(c.column?.title)));
const parse = (v) => { try { return JSON.parse(v); } catch { return null; } };

const STEP_STATUS = { fait: 'fait', 'a faire': 'a_faire', bloque: 'bloque', 'en cours': 'en_cours', termine: 'fait', terminee: 'fait' };
const PRIORITY = [['critique', 'critique'], ['principal', 'haute'], ['haute', 'haute'], ['moyen', 'moyenne'], ['bass', 'basse'], ['faible', 'basse']];

const priorityOf = (text) => {
  const n = norm(text);
  return n ? (PRIORITY.find(([k]) => n.includes(k)) || [])[1] || null : null;
};

async function main() {
  if (!TOKEN || !BOARD) {
    console.error('Usage : MONDAY_TOKEN=… node src/scripts/importMonday.js --board=<id> [--apply]');
    process.exit(1);
  }

  // Personnes Monday → comptes
  const { users: mUsers } = await gql('{ users(limit: 200) { id name email } }');
  const { rows: ours } = await pool.query('SELECT id, email, name FROM users WHERE disabled_at IS NULL');
  const byEmail = new Map(ours.map((u) => [norm(u.email), u.id]));
  const byFirst = new Map(ours.filter((u) => u.name).map((u) => [norm(u.name).split(/\s+/)[0], u.id]));
  const userMap = new Map();
  console.log('\nPersonnes :');
  mUsers.forEach((m) => {
    const id = byEmail.get(norm(m.email)) || byFirst.get(norm(m.name).split(/\s+/)[0]) || null;
    userMap.set(String(m.id), id);
    const who = id ? ours.find((u) => u.id === id) : null;
    console.log(`  ${m.name} <${m.email}> → ${who ? `${who.name} (#${who.id})` : 'NON RECONNU'}`);
  });
  const emailToUser = new Map(mUsers.map((m) => [norm(m.email), userMap.get(String(m.id))]));
  const peopleOf = (c) => (parse(c?.value)?.personsAndTeams || [])
    .filter((p) => p.kind === 'person').map((p) => userMap.get(String(p.id))).filter(Boolean);

  const { name, items } = await fetchItems();
  console.log(`\nTableau « ${name} » : ${items.length} tâches, ${items.reduce((n, i) => n + (i.subitems || []).length, 0)} sous-éléments`);

  const unknownStatus = new Map();
  const tasks = items.map((item, idx) => {
    const link = col(item, 'Lien produit', 'Lien');
    const linkUrl = parse(link?.value)?.url || (/^https?:\/\//.test(link?.text || '') ? link.text : null);
    const status = norm(col(item, 'Statut', 'Status')?.text);
    return {
      monday_id: Number(item.id),
      title: item.name.trim(),
      link_url: linkUrl,
      label: (col(item, 'Étiquettes', 'Etiquette', 'Tags')?.text || '').split(',')[0].trim() || null,
      priority: priorityOf(col(item, 'Priority', 'Priorité')?.text),
      manual_status: status === 'fait' || status === 'termine' ? 'fait' : status === 'en cours' ? 'en_cours' : 'a_faire',
      position: idx,
      steps: (item.subitems || []).map((s, pos) => {
        const st = norm(col(s, 'Statut', 'Status')?.text);
        if (st && !STEP_STATUS[st]) unknownStatus.set(st, (unknownStatus.get(st) || 0) + 1);
        return {
          monday_id: Number(s.id),
          name: s.name.trim(),
          position: pos,
          status: STEP_STATUS[st] || 'a_faire',
          due_date: parse(col(s, 'Échéances', 'Échéance', 'Date')?.value)?.date || null,
          note: col(s, 'Texte', 'Notes')?.text || '',
          owners: peopleOf(col(s, 'Owner', 'Propriétaire')),
          notify: peopleOf(col(s, 'Personnes', 'People')),
        };
      }),
      comments: (item.updates || []).filter((u) => (u.text_body || '').trim()).map((u) => ({
        body: u.text_body.trim(),
        created_at: u.created_at,
        user_id: emailToUser.get(norm(u.creator?.email)) || null,
      })),
    };
  });

  if (unknownStatus.size) console.log('Statuts d\'étape inconnus (importés « à faire ») :', Object.fromEntries(unknownStatus));
  const sample = tasks.find((t) => t.steps.length > 3) || tasks[0];
  if (sample) console.log('\nExemple :', JSON.stringify({ ...sample, comments: sample.comments.length }, null, 2));

  if (!APPLY) {
    console.log('\nSimulation seulement. Relancer avec --apply pour écrire.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  let created = 0;
  let updated = 0;
  let comments = 0;
  try {
    await client.query('BEGIN');
    for (const t of tasks) {
      const { rows: [row] } = await client.query(
        `INSERT INTO taches_tasks (monday_id, title, link_url, label, priority, manual_status, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (monday_id) DO UPDATE SET title = EXCLUDED.title, link_url = EXCLUDED.link_url,
           label = EXCLUDED.label, priority = EXCLUDED.priority, manual_status = EXCLUDED.manual_status,
           position = EXCLUDED.position
         RETURNING id, (xmax = 0) AS inserted`,
        [t.monday_id, t.title, t.link_url, t.label, t.priority, t.manual_status, t.position],
      );
      if (row.inserted) created += 1; else updated += 1;
      for (const s of t.steps) {
        const { rows: [step] } = await client.query(
          `INSERT INTO taches_steps (monday_id, task_id, position, name, status, due_date, note, done_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $5 = 'fait' THEN (NOW() AT TIME ZONE 'Europe/Paris') END)
           ON CONFLICT (monday_id) DO UPDATE SET task_id = EXCLUDED.task_id, position = EXCLUDED.position,
             name = EXCLUDED.name, status = EXCLUDED.status, due_date = EXCLUDED.due_date, note = EXCLUDED.note
           RETURNING id`,
          [s.monday_id, row.id, s.position, s.name, s.status, s.due_date, s.note],
        );
        await client.query('DELETE FROM taches_step_people WHERE step_id = $1', [step.id]);
        for (const [role, ids] of [['owner', s.owners], ['notify', s.notify]]) {
          for (const uid of new Set(ids)) {
            await client.query('INSERT INTO taches_step_people (step_id, user_id, role) VALUES ($1, $2, $3)', [step.id, uid, role]);
          }
        }
      }
      for (const c of t.comments) {
        const { rowCount } = await client.query(
          `INSERT INTO taches_comments (task_id, user_id, body, created_at)
           SELECT $1, $2, $3, ($4::timestamptz AT TIME ZONE 'Europe/Paris')
            WHERE NOT EXISTS (SELECT 1 FROM taches_comments
                               WHERE task_id = $1 AND body = $3
                                 AND created_at = ($4::timestamptz AT TIME ZONE 'Europe/Paris'))`,
          [row.id, c.user_id, c.body, c.created_at],
        );
        comments += rowCount;
      }
    }
    await client.query('COMMIT');
    console.log(`\nImport : ${created} tâches créées, ${updated} mises à jour, ${comments} commentaires ajoutés.`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
