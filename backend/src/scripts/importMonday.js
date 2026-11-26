/**
 * Import des tableaux Monday dans l'app Tâches.
 *
 *   MONDAY_TOKEN=… node src/scripts/importMonday.js --boards=5097034926,5103927835          (simulation)
 *   MONDAY_TOKEN=… node src/scripts/importMonday.js --boards=5097034926,5103927835 --apply  (écrit)
 *
 * Le jeton : Monday → avatar → Développeurs → « Mes jetons d'accès ». L'id d'un
 * tableau est dans son adresse (…/boards/<id>).
 *
 * Ce qui est repris : tableaux, groupes (ordre et couleur), tâches (lien,
 * étiquettes, priorité, statut, personne, dates, dernière mise à jour),
 * sous-éléments → étapes (Owner → responsables, Personnes → à prévenir,
 * statut, priorité, échéances début → fin, texte → note), « updates » et leurs
 * réponses → commentaires. Le groupe « Modèles » devient des modèles d'étapes.
 *
 * Rejouable : chaque élément garde son identifiant Monday, un second passage met
 * à jour au lieu de dupliquer (reprendre l'état du jour de la bascule). Attention,
 * il réécrit alors ce qui a été modifié dans l'app sur ces mêmes éléments.
 * Les commentaires déjà importés (même tâche, même date, même texte) ne sont pas
 * recopiés.
 *
 * Personnes : e-mail Monday = e-mail du compte, sinon même prénom. La simulation
 * affiche le résultat ; une personne non reconnue est laissée de côté.
 */

const pool = require('../config/database');

const API = 'https://api.monday.com/v2';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const APPLY = Boolean(args.apply);
const BOARDS = String(args.boards || args.board || '').split(',').map((s) => s.trim()).filter(Boolean);
const TOKEN = process.env.MONDAY_TOKEN;

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const parse = (v) => { try { return JSON.parse(v); } catch { return null; } };

async function gql(query, variables = {}, attempt = 1) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: TOKEN, 'API-Version': '2024-10' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => null);
  const err = json?.errors || json?.error_message;
  // Budget de complexité dépassé : Monday demande d'attendre quelques secondes.
  if (err && attempt < 5 && /complexity|rate|minute/i.test(JSON.stringify(err))) {
    await new Promise((r) => setTimeout(r, 15000 * attempt));
    return gql(query, variables, attempt + 1);
  }
  if (!res.ok || !json || err) throw new Error(`Monday : ${res.status} ${JSON.stringify(err || json).slice(0, 400)}`);
  return json.data;
}

const COLS = 'column_values { text value column { title } }';
const UPDATES = `updates(limit: 100) { text_body created_at creator { email }
  replies { text_body created_at creator { email } } }`;
const ITEM = `id name created_at updated_at group { id } ${COLS} ${UPDATES}
  subitems { id name ${COLS} }`;

async function fetchBoard(boardId) {
  const first = await gql(
    `query ($b: [ID!]) { boards(ids: $b) { id name groups { id title color position }
       items_page(limit: 25) { cursor items { ${ITEM} } } } }`,
    { b: [boardId] },
  );
  const board = first.boards[0];
  if (!board) throw new Error(`Tableau ${boardId} introuvable (id ou droits du jeton)`);
  const items = [...board.items_page.items];
  let cursor = board.items_page.cursor;
  while (cursor) {
    const page = await gql(
      `query ($c: String!) { next_items_page(limit: 25, cursor: $c) { cursor items { ${ITEM} } } }`,
      { c: cursor },
    );
    items.push(...page.next_items_page.items);
    cursor = page.next_items_page.cursor;
  }
  return { ...board, items };
}

/** Colonne par son titre affiché (insensible aux accents et à la casse). */
const col = (item, ...titles) => item.column_values.find((c) => titles.map(norm).includes(norm(c.column?.title)));

const TASK_STATUS = { 'en cours': 'en_cours', fait: 'fait', terminee: 'fait', bloque: 'bloque', longue: 'longue', 'a faire': 'a_faire' };
const STEP_STATUS = {
  'a faire': 'a_faire', 'en cours': 'en_cours', bloque: 'bloque', fait: 'fait', terminee: 'fait',
  'attente correction': 'attente_correction', 'suivi google': 'suivi_google',
};
const PRIORITY = [['critique', 'critique'], ['critical', 'critique'], ['principal', 'haute'], ['high', 'haute'],
  ['moyen', 'moyenne'], ['medium', 'moyenne'], ['bass', 'basse'], ['low', 'basse']];
const priorityOf = (text) => {
  const n = norm(text);
  return n ? (PRIORITY.find(([k]) => n.includes(k)) || [])[1] || null : null;
};

async function main() {
  if (!TOKEN || !BOARDS.length) {
    console.error('Usage : MONDAY_TOKEN=… node src/scripts/importMonday.js --boards=<id>[,<id>] [--apply]');
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
  const peopleOf = (c) => [...new Set((parse(c?.value)?.personsAndTeams || [])
    .filter((p) => p.kind === 'person').map((p) => userMap.get(String(p.id))).filter(Boolean))];
  const unknown = new Map();
  const note = (k) => unknown.set(k, (unknown.get(k) || 0) + 1);

  const plans = [];
  for (const boardId of BOARDS) {
    const b = await fetchBoard(boardId);
    const groups = [...b.groups].sort((x, y) => Number(x.position) - Number(y.position));
    const templateGroups = new Set(groups.filter((g) => norm(g.title) === 'modeles').map((g) => g.id));

    const toStep = (s, pos) => {
      const st = norm(col(s, 'Statut', 'Status')?.text);
      if (st && !STEP_STATUS[st]) note(`étape « ${st} »`);
      const range = parse(col(s, 'Échéances', 'Échéance', 'Timeline')?.value);
      const date = parse(col(s, 'Date')?.value)?.date || null;
      return {
        monday_id: Number(s.id),
        name: s.name.trim(),
        position: pos,
        status: STEP_STATUS[st] || 'a_faire',
        // Monday garde la date du dernier changement de statut (« changed_at ») :
        // pour une étape faite, c'est la date où elle a été faite.
        done_at: STEP_STATUS[st] === 'fait' ? parse(col(s, 'Statut', 'Status')?.value)?.changed_at || null : null,
        priority: priorityOf(col(s, 'Priority', 'Priorité')?.text),
        start_date: range?.from || null,
        due_date: range?.to || date,
        note: col(s, 'Texte', 'Notes')?.text || '',
        owners: peopleOf(col(s, 'Owner', 'Propriétaire')),
        notify: peopleOf(col(s, 'Personnes', 'People')),
      };
    };
    const comments = (item) => (item.updates || []).flatMap((u) => [u, ...(u.replies || [])])
      .filter((u) => (u.text_body || '').trim())
      .map((u) => ({ body: u.text_body.trim(), created_at: u.created_at, user_id: emailToUser.get(norm(u.creator?.email)) || null }));

    const tasks = [];
    const templates = [];
    const perGroup = new Map();
    b.items.forEach((item) => {
      const labels = (col(item, 'Étiquettes', 'Etiquettes', 'Tags')?.text || '').split(',').map((s) => s.trim()).filter(Boolean);
      const steps = (item.subitems || []).map(toStep);
      if (templateGroups.has(item.group.id)) {
        templates.push({ monday_id: Number(item.id), name: item.name.trim(), labels, steps });
        return;
      }
      const st = norm(col(item, 'Statut', 'Status')?.text);
      if (st && !TASK_STATUS[st]) note(`tâche « ${st} »`);
      const link = col(item, 'Lien produit', 'Lien');
      const linkUrl = parse(link?.value)?.url || (typeof parse(link?.value) === 'string' ? parse(link.value) : null) || link?.text || null;
      const updater = parse(col(item, 'Dernière mise à jour', 'Last updated')?.value)?.updater_id;
      const pos = perGroup.get(item.group.id) || 0;
      perGroup.set(item.group.id, pos + 1);
      tasks.push({
        monday_id: Number(item.id),
        group_key: `${b.id}:${item.group.id}`,
        title: item.name.trim(),
        link_url: linkUrl && /^https?:\/\//i.test(linkUrl) ? linkUrl : null,
        link_text: linkUrl && !/^https?:\/\//i.test(linkUrl) ? linkUrl : null,
        labels,
        priority: priorityOf(col(item, 'Priority', 'Priorité')?.text),
        manual_status: TASK_STATUS[st] || 'a_faire',
        people: peopleOf(col(item, 'Person', 'Personne', 'Personnes')),
        start_date: parse(col(item, 'Date début', 'Date de début')?.value)?.date || null,
        due_date: parse(col(item, 'Date fin', 'Date de fin')?.value)?.date || null,
        created_at: item.created_at,
        updated_at: item.updated_at,
        updated_by: updater ? userMap.get(String(updater)) || null : null,
        position: pos,
        steps,
        comments: comments(item),
      });
    });
    plans.push({ board: b, groups: groups.filter((g) => !templateGroups.has(g.id)), tasks, templates });
    console.log(`\nTableau « ${b.name} » : ${tasks.length} tâches, ${tasks.reduce((n, t) => n + t.steps.length, 0)} étapes, `
      + `${tasks.reduce((n, t) => n + t.comments.length, 0)} commentaires, ${templates.length} modèles`);
    console.log(`  Groupes : ${groups.map((g) => `${g.title}${templateGroups.has(g.id) ? ' (→ modèles)' : ''}`).join(', ')}`);
  }
  if (unknown.size) console.log('\nStatuts inconnus (importés « à faire ») :', Object.fromEntries(unknown));
  const sample = plans[0]?.tasks.find((t) => t.steps.length > 3 && t.comments.length) || plans[0]?.tasks[0];
  if (sample) console.log('\nExemple :', JSON.stringify({ ...sample, comments: sample.comments.length }, null, 1));
  const textLinks = plans.flatMap((p) => p.tasks).filter((t) => t.link_text);
  if (textLinks.length) console.log(`\n${textLinks.length} « liens » qui ne sont pas des adresses : recopiés dans la description.`);

  // Ce que l'app a encore mais que Monday n'a plus (supprimé dans Monday) : listé, jamais supprimé ici.
  const seenTasks = plans.flatMap((p) => [...p.tasks.map((t) => t.monday_id), ...p.templates.map((t) => t.monday_id)]);
  const seenSteps = plans.flatMap((p) => p.tasks.flatMap((t) => t.steps.map((s) => s.monday_id)));
  const { rows: goneTasks } = await pool.query(
    `SELECT t.id, t.title FROM taches_tasks t JOIN taches_boards b ON b.id = t.board_id
      WHERE t.monday_id IS NOT NULL AND NOT (t.monday_id = ANY($1)) AND b.monday_id = ANY($2) ORDER BY t.id`,
    [seenTasks, BOARDS.map(Number)],
  );
  const { rows: goneSteps } = await pool.query(
    `SELECT s.id, s.name, s.status, t.id AS task_id, t.title FROM taches_steps s JOIN taches_tasks t ON t.id = s.task_id
      JOIN taches_boards b ON b.id = t.board_id
      WHERE s.monday_id IS NOT NULL AND NOT (s.monday_id = ANY($1)) AND b.monday_id = ANY($2) ORDER BY t.id, s.position`,
    [seenSteps, BOARDS.map(Number)],
  );
  console.log(`\nPlus dans Monday (gardés dans l'app) : ${goneTasks.length} tâches, ${goneSteps.length} étapes.`);
  goneTasks.forEach((t) => console.log(`  tâche #${t.id} ${t.title}`));
  goneSteps.forEach((s) => console.log(`  étape #${s.id} « ${s.name} » (${s.status}) — tâche #${s.task_id} ${s.title}`));

  if (!APPLY) {
    console.log('\nSimulation seulement. Relancer avec --apply pour écrire.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  const stats = { tasks: 0, steps: 0, comments: 0, templates: 0 };
  try {
    await client.query('BEGIN');
    for (const [bi, p] of plans.entries()) {
      const { rows: [board] } = await client.query(
        `INSERT INTO taches_boards (monday_id, name, position) VALUES ($1, $2, $3)
         ON CONFLICT (monday_id) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [Number(p.board.id), p.board.name, bi],
      );
      const groupIds = new Map();
      for (const [gi, g] of p.groups.entries()) {
        const { rows: [row] } = await client.query(
          `INSERT INTO taches_groups (monday_key, board_id, name, color, position) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (monday_key) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color, position = EXCLUDED.position
           RETURNING id`,
          [`${p.board.id}:${g.id}`, board.id, g.title, /^#[0-9a-f]{6}$/i.test(g.color) ? g.color : '#579BFC', gi],
        );
        groupIds.set(`${p.board.id}:${g.id}`, row.id);
      }
      for (const t of p.tasks) {
        const description = t.link_text ? `Lien : ${t.link_text}` : '';
        const { rows: [row] } = await client.query(
          `INSERT INTO taches_tasks (monday_id, board_id, group_id, title, link_url, labels, priority, manual_status,
                                     start_date, due_date, description, position, created_at, updated_at, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                   ($13::timestamptz AT TIME ZONE 'Europe/Paris'), ($14::timestamptz AT TIME ZONE 'Europe/Paris'), $15)
           ON CONFLICT (monday_id) DO UPDATE SET board_id = EXCLUDED.board_id, group_id = EXCLUDED.group_id,
             title = EXCLUDED.title, link_url = EXCLUDED.link_url, labels = EXCLUDED.labels, priority = EXCLUDED.priority,
             manual_status = EXCLUDED.manual_status, start_date = EXCLUDED.start_date, due_date = EXCLUDED.due_date,
             position = EXCLUDED.position, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
           RETURNING id`,
          [t.monday_id, board.id, groupIds.get(t.group_key) || null, t.title, t.link_url, t.labels, t.priority,
            t.manual_status, t.start_date, t.due_date, description, t.position, t.created_at, t.updated_at, t.updated_by],
        );
        stats.tasks += 1;
        await client.query('DELETE FROM taches_task_people WHERE task_id = $1', [row.id]);
        for (const uid of t.people) {
          await client.query('INSERT INTO taches_task_people (task_id, user_id) VALUES ($1, $2)', [row.id, uid]);
        }
        for (const s of t.steps) {
          const { rows: [step] } = await client.query(
            `INSERT INTO taches_steps (monday_id, task_id, position, name, status, priority, start_date, due_date, note, done_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ($10::timestamptz AT TIME ZONE 'Europe/Paris'))
             ON CONFLICT (monday_id) DO UPDATE SET task_id = EXCLUDED.task_id, position = EXCLUDED.position,
               name = EXCLUDED.name, status = EXCLUDED.status, priority = EXCLUDED.priority,
               start_date = EXCLUDED.start_date, due_date = EXCLUDED.due_date, note = EXCLUDED.note,
               done_at = EXCLUDED.done_at
             RETURNING id`,
            [s.monday_id, row.id, s.position, s.name, s.status, s.priority, s.start_date, s.due_date, s.note, s.done_at],
          );
          stats.steps += 1;
          await client.query('DELETE FROM taches_step_people WHERE step_id = $1', [step.id]);
          for (const [role, ids] of [['owner', s.owners], ['notify', s.notify]]) {
            for (const uid of ids) {
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
          stats.comments += rowCount;
        }
      }
      for (const [i, tpl] of p.templates.entries()) {
        await client.query(
          `INSERT INTO taches_templates (monday_id, name, labels, steps, position) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (monday_id) DO UPDATE SET name = EXCLUDED.name, labels = EXCLUDED.labels, steps = EXCLUDED.steps`,
          [tpl.monday_id, tpl.name, tpl.labels,
            JSON.stringify(tpl.steps.map((s) => ({ name: s.name, owners: s.owners, notify: s.notify }))), i],
        );
        stats.templates += 1;
      }
    }
    // Le tableau vide créé par la migration n'a plus lieu d'être s'il n'a servi à rien.
    await client.query(
      `DELETE FROM taches_boards b WHERE b.monday_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM taches_tasks t WHERE t.board_id = b.id)
          AND EXISTS (SELECT 1 FROM taches_boards o WHERE o.monday_id IS NOT NULL)`,
    );
    await client.query('COMMIT');
    console.log(`\nImport : ${stats.tasks} tâches, ${stats.steps} étapes, ${stats.comments} commentaires ajoutés, ${stats.templates} modèles.`);
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
