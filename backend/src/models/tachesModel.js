const pool = require('../config/database');
const userPermissionsModel = require('./userPermissionsModel');
const { nextStepPlan, taskStatus, STEP_STATUSES, TASK_STATUSES } = require('../services/tachesRules');
const tachesSlack = require('../services/tachesSlack');

/**
 * App Tâches : tableaux d'équipe (remplace Monday + Make).
 *
 * Tableau → groupes → tâches → étapes. Tout est COMMUN : chacun voit et modifie
 * toutes les tâches. « Mes tâches » n'est qu'un filtre (étapes dont on est
 * responsable, ou tâches sans étape dont on est la personne).
 *
 * La règle métier (étape suivante à débloquer, statut de la tâche) est dans
 * services/tachesRules.js, pure et testée. Ici : SQL, transactions, Slack.
 *
 * Dates sorties en texte (to_char) : node-pg convertirait DATE en objet Date
 * au fuseau du serveur (UTC), l'échéance du 22 deviendrait le 21 au navigateur.
 */

const PARIS_NOW = "(NOW() AT TIME ZONE 'Europe/Paris')";
const USER_NAME = (alias) => `COALESCE(NULLIF(${alias}.name, ''), split_part(${alias}.email, '@', 1))`;
const PRIORITIES = ['critique', 'haute', 'moyenne', 'basse'];
const GROUP_COLORS = ['#579BFC', '#00C875', '#FDAB3D', '#A25DDC', '#E2445C', '#037F4C', '#C4C4C4', '#FF158A'];

const httpError = (status, message) => {
  const e = new Error(message);
  e.statusCode = status;
  return e;
};

const cleanText = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const nullableText = (v, max = 500) => cleanText(v, max) || null;
const toIds = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
const toLabels = (v) => [...new Set((Array.isArray(v) ? v : [v]).map((l) => cleanText(l, 60)).filter(Boolean))].slice(0, 10);
const validDate = (v) => {
  if (v === null || v === '' || v === undefined) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw httpError(400, 'Date invalide');
  return String(v);
};
const validUrl = (v) => {
  const s = nullableText(v, 1000);
  if (s && !/^https?:\/\//i.test(s)) throw httpError(400, 'Le lien doit commencer par http:// ou https://');
  return s;
};
const validPriority = (v) => (PRIORITIES.includes(v) ? v : null);
const checkDates = (start, due) => {
  if (start && due && start > due) throw httpError(400, 'La date de début est après la date de fin');
};

async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/* ─── Membres ───────────────────────────────────────────── */

/** Comptes actifs, avec `has_app` = droit coché ou super admin. */
async function getMembers() {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, ${USER_NAME('u')} AS name,
            EXISTS (SELECT 1 FROM user_permissions p
                     WHERE p.user_id = u.id AND p.app_name = 'taches' AND p.can_read) AS has_app
       FROM users u
      WHERE u.disabled_at IS NULL
      ORDER BY 3`,
  );
  // Tous les comptes actifs : un ancien responsable doit garder son nom à l'écran,
  // même si on lui retire l'app. On ne peut CHOISIR que ceux qui ont l'app (has_app).
  return rows.map(({ id, name, email, has_app: hasApp }) => ({
    id, name, has_app: hasApp || userPermissionsModel.isSuperAdmin(email),
  }));
}

async function checkMembers(ids) {
  if (!ids.length) return;
  const members = new Set((await getMembers()).filter((m) => m.has_app).map((m) => m.id));
  if (ids.some((id) => !members.has(id))) throw httpError(400, "Une des personnes choisies n'a pas accès à l'app Tâches");
}

/* ─── Tableaux et groupes ───────────────────────────────── */

async function getBoards() {
  const { rows: boards } = await pool.query('SELECT id, name, position FROM taches_boards ORDER BY position, id');
  const { rows: groups } = await pool.query('SELECT id, board_id, name, color, position FROM taches_groups ORDER BY position, id');
  return boards.map((b) => ({ ...b, groups: groups.filter((g) => g.board_id === b.id) }));
}

async function createBoard(body) {
  const name = cleanText(body.name, 100);
  if (!name) throw httpError(400, 'Le nom du tableau est obligatoire');
  await withTx(async (db) => {
    const { rows: [b] } = await db.query(
      `INSERT INTO taches_boards (name, position)
       VALUES ($1, COALESCE((SELECT max(position) + 1 FROM taches_boards), 0)) RETURNING id`,
      [name],
    );
    await db.query("INSERT INTO taches_groups (board_id, name, position) VALUES ($1, 'Liste des tâches', 0)", [b.id]);
  });
  return getBoards();
}

async function updateBoard(id, body) {
  const name = cleanText(body.name, 100);
  if (!name) throw httpError(400, 'Le nom du tableau est obligatoire');
  const { rowCount } = await pool.query('UPDATE taches_boards SET name = $2 WHERE id = $1', [id, name]);
  if (!rowCount) throw httpError(404, 'Tableau introuvable');
  return getBoards();
}

/** Un tableau ne se supprime que vide (les tâches se déplacent ou s'effacent d'abord). */
async function deleteBoard(id) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM taches_tasks WHERE board_id = $1', [id]);
  if (rows[0].n) throw httpError(409, `Ce tableau contient encore ${rows[0].n} tâche(s)`);
  const { rows: [left] } = await pool.query('SELECT count(*)::int AS n FROM taches_boards');
  if (left.n <= 1) throw httpError(409, 'Il faut garder au moins un tableau');
  await pool.query('DELETE FROM taches_boards WHERE id = $1', [id]);
  return getBoards();
}

async function createGroup(boardId, body) {
  const name = cleanText(body.name, 100);
  if (!name) throw httpError(400, 'Le nom du groupe est obligatoire');
  const { rows: b } = await pool.query('SELECT 1 FROM taches_boards WHERE id = $1', [boardId]);
  if (!b.length) throw httpError(404, 'Tableau introuvable');
  const { rows: [n] } = await pool.query('SELECT count(*)::int AS n FROM taches_groups WHERE board_id = $1', [boardId]);
  await pool.query(
    `INSERT INTO taches_groups (board_id, name, color, position)
     VALUES ($1, $2, $3, COALESCE((SELECT max(position) + 1 FROM taches_groups WHERE board_id = $1), 0))`,
    [boardId, name, GROUP_COLORS[n.n % GROUP_COLORS.length]],
  );
  return getBoards();
}

async function updateGroup(id, body) {
  const sets = [];
  const params = [id];
  if ('name' in body) {
    const name = cleanText(body.name, 100);
    if (!name) throw httpError(400, 'Le nom du groupe est obligatoire');
    params.push(name);
    sets.push(`name = $${params.length}`);
  }
  if ('color' in body) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(String(body.color))) throw httpError(400, 'Couleur invalide');
    params.push(body.color);
    sets.push(`color = $${params.length}`);
  }
  if (sets.length) {
    const { rowCount } = await pool.query(`UPDATE taches_groups SET ${sets.join(', ')} WHERE id = $1`, params);
    if (!rowCount) throw httpError(404, 'Groupe introuvable');
  }
  if (body.direction === 'up' || body.direction === 'down') {
    await withTx(async (db) => {
      const { rows: [g] } = await db.query('SELECT board_id FROM taches_groups WHERE id = $1', [id]);
      if (!g) throw httpError(404, 'Groupe introuvable');
      const { rows: list } = await db.query(
        'SELECT id FROM taches_groups WHERE board_id = $1 ORDER BY position, id FOR UPDATE', [g.board_id],
      );
      const i = list.findIndex((x) => x.id === id);
      const j = body.direction === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      for (let k = 0; k < list.length; k += 1) {
        await db.query('UPDATE taches_groups SET position = $2 WHERE id = $1', [list[k].id, k]);
      }
    });
  }
  return getBoards();
}

/** Supprimer un groupe : ses tâches passent dans le premier autre groupe du tableau. */
async function deleteGroup(id) {
  await withTx(async (db) => {
    const { rows: [g] } = await db.query('SELECT board_id FROM taches_groups WHERE id = $1', [id]);
    if (!g) throw httpError(404, 'Groupe introuvable');
    const { rows: [other] } = await db.query(
      'SELECT id FROM taches_groups WHERE board_id = $1 AND id <> $2 ORDER BY position, id LIMIT 1', [g.board_id, id],
    );
    if (!other) throw httpError(409, 'Il faut garder au moins un groupe');
    await db.query('UPDATE taches_tasks SET group_id = $2 WHERE group_id = $1', [id, other.id]);
    await db.query('DELETE FROM taches_groups WHERE id = $1', [id]);
  });
  return getBoards();
}

/* ─── Lecture ───────────────────────────────────────────── */

const TASK_COLS = `
  t.id, t.board_id, t.group_id, t.title, t.link_url, t.labels, t.priority, t.manual_status,
  t.description, t.position, t.created_by, t.updated_by, ${USER_NAME('uu')} AS updated_by_name,
  to_char(t.start_date, 'YYYY-MM-DD') AS start_date,
  to_char(t.due_date, 'YYYY-MM-DD') AS due_date,
  to_char(t.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS created_at,
  to_char(t.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS updated_at,
  to_char(t.archived_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS archived_at,
  COALESCE((SELECT array_agg(p.user_id ORDER BY p.user_id) FROM taches_task_people p WHERE p.task_id = t.id), '{}') AS people,
  (SELECT count(*)::int FROM taches_comments c WHERE c.task_id = t.id) AS comment_count`;

const STEP_COLS = `
  s.id, s.task_id, s.position, s.name, s.status, s.priority, s.note,
  to_char(s.start_date, 'YYYY-MM-DD') AS start_date,
  to_char(s.due_date, 'YYYY-MM-DD') AS due_date,
  to_char(s.done_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS done_at,
  s.done_by, ${USER_NAME('ud')} AS done_by_name,
  to_char(s.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS updated_at,
  COALESCE((SELECT array_agg(p.user_id ORDER BY p.user_id) FROM taches_step_people p
             WHERE p.step_id = s.id AND p.role = 'owner'), '{}') AS owners,
  COALESCE((SELECT array_agg(p.user_id ORDER BY p.user_id) FROM taches_step_people p
             WHERE p.step_id = s.id AND p.role = 'notify'), '{}') AS notify`;

/** Assemble tâches + étapes, statut calculé et compteurs pour la barre. */
async function loadTasks(db, where, params) {
  const { rows: tasks } = await db.query(
    `SELECT ${TASK_COLS}
       FROM taches_tasks t
       LEFT JOIN users uu ON uu.id = t.updated_by
      WHERE ${where}
      ORDER BY t.position, t.id DESC`,
    params,
  );
  if (!tasks.length) return [];
  const { rows: steps } = await db.query(
    `SELECT ${STEP_COLS}
       FROM taches_steps s
       LEFT JOIN users ud ON ud.id = s.done_by
      WHERE s.task_id = ANY($1)
      ORDER BY s.task_id, s.position, s.id`,
    [tasks.map((t) => t.id)],
  );
  const byTask = new Map(tasks.map((t) => [t.id, []]));
  steps.forEach((s) => byTask.get(s.task_id).push(s));
  return tasks.map((t) => {
    const list = byTask.get(t.id);
    const counts = Object.fromEntries(STEP_STATUSES.map((k) => [k, 0]));
    list.forEach((s) => { counts[s.status] += 1; });
    return { ...t, status: taskStatus(list, t.manual_status), counts, steps: list };
  });
}

/** Toutes les tâches d'un tableau (ou de tous), archivées à part. */
async function getBoard({ boardId = null, archived = false } = {}) {
  const params = [];
  let where = archived ? 't.archived_at IS NOT NULL' : 't.archived_at IS NULL';
  if (boardId) {
    params.push(boardId);
    where += ` AND t.board_id = $${params.length}`;
  }
  return loadTasks(pool, where, params);
}

/**
 * Mes tâches : une étape non faite dont je suis responsable, ou une tâche SANS
 * étape dont je suis la personne et qui n'est pas finie. Toutes les étapes
 * viennent avec (les précédentes s'affichent grisées).
 */
async function getMine(userId) {
  return loadTasks(
    pool,
    `t.archived_at IS NULL AND (
       EXISTS (SELECT 1 FROM taches_steps s JOIN taches_step_people p ON p.step_id = s.id
                WHERE s.task_id = t.id AND p.user_id = $1 AND p.role = 'owner' AND s.status <> 'fait')
       OR (t.manual_status <> 'fait'
           AND NOT EXISTS (SELECT 1 FROM taches_steps s WHERE s.task_id = t.id)
           AND EXISTS (SELECT 1 FROM taches_task_people p WHERE p.task_id = t.id AND p.user_id = $1)))`,
    [userId],
  );
}

async function getTask(id) {
  const [task] = await loadTasks(pool, 't.id = $1', [id]);
  if (!task) throw httpError(404, 'Tâche introuvable');
  const { rows: comments } = await pool.query(
    `SELECT c.id, c.user_id, ${USER_NAME('u')} AS user_name, c.body, c.mentions,
            to_char(c.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS created_at
       FROM taches_comments c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.task_id = $1 ORDER BY c.created_at, c.id`,
    [id],
  );
  const { rows: events } = await pool.query(
    `SELECT e.id, e.step_id, e.kind, e.detail, ${USER_NAME('u')} AS user_name,
            to_char(e.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS created_at
       FROM taches_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.task_id = $1 ORDER BY e.created_at DESC, e.id DESC LIMIT 100`,
    [id],
  );
  return { ...task, comments, events };
}

/* ─── Recherche ─────────────────────────────────────────── */

// Sans accents ni casse, sans dépendre de l'extension unaccent.
const FOLD = (expr) => `translate(lower(${expr}), 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ', 'aaaaaaceeeeiiiinooooouuuuyyoa')`;
const foldJs = (s) => String(s || '').toLowerCase()
  .replace(/[àâäáãå]/g, 'a').replace(/ç/g, 'c').replace(/[éèêë]/g, 'e').replace(/[íìîï]/g, 'i')
  .replace(/ñ/g, 'n').replace(/[óòôöõ]/g, 'o').replace(/[úùûü]/g, 'u').replace(/[ýÿ]/g, 'y')
  .replace(/œ/g, 'o').replace(/æ/g, 'a');

/** Extrait de ~140 caractères autour du mot trouvé. */
function snippet(text, q) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const i = foldJs(t).indexOf(foldJs(q));
  if (i < 0) return t.slice(0, 140);
  const start = Math.max(0, i - 60);
  return `${start ? '…' : ''}${t.slice(start, i + q.length + 80)}${i + q.length + 80 < t.length ? '…' : ''}`;
}

/**
 * Cherche un mot partout : titre, lien, étiquettes, description, étapes (nom,
 * note) et commentaires, archives comprises. Une ligne par endroit trouvé.
 */
async function search(q) {
  const term = cleanText(q, 100);
  // « 123 » ou « #123 » : la tâche de ce numéro, en tête.
  const idMatch = /^#?(\d+)$/.exec(term);
  let byId = [];
  if (idMatch) {
    const { rows: found } = await pool.query(
      `SELECT t.id AS task_id, t.title, t.board_id, b.name AS board_name, (t.archived_at IS NOT NULL) AS archived
         FROM taches_tasks t JOIN taches_boards b ON b.id = t.board_id WHERE t.id = $1`, [Number(idMatch[1])],
    );
    byId = found.map((x) => ({ ...x, field: 'numéro', by: null, at: null, snippet: `#${x.task_id}` }));
  }
  if (term.length < 2) return byId;
  const like = `%${foldJs(term).replace(/[\\%_]/g, '\\$&')}%`;
  const { rows } = await pool.query(
    `WITH hits AS (
       SELECT t.id AS task_id, 'titre' AS field, t.title AS text, NULL::int AS user_id, NULL::timestamp AS at
         FROM taches_tasks t WHERE ${FOLD('t.title')} LIKE $1
       UNION ALL
       SELECT t.id, 'lien', t.link_url, NULL, NULL FROM taches_tasks t WHERE ${FOLD("COALESCE(t.link_url, '')")} LIKE $1
       UNION ALL
       SELECT t.id, 'étiquette', array_to_string(t.labels, ', '), NULL, NULL
         FROM taches_tasks t WHERE ${FOLD("array_to_string(t.labels, ' ')")} LIKE $1
       UNION ALL
       SELECT t.id, 'description', t.description, NULL, NULL FROM taches_tasks t WHERE ${FOLD('t.description')} LIKE $1
       UNION ALL
       SELECT s.task_id, 'étape', s.name, NULL, NULL FROM taches_steps s WHERE ${FOLD('s.name')} LIKE $1
       UNION ALL
       SELECT s.task_id, 'note d''étape', s.name || ' : ' || s.note, NULL, NULL FROM taches_steps s WHERE ${FOLD('s.note')} LIKE $1
       UNION ALL
       SELECT c.task_id, 'commentaire', c.body, c.user_id, c.created_at FROM taches_comments c WHERE ${FOLD('c.body')} LIKE $1
     )
     SELECT h.task_id, h.field, h.text, ${USER_NAME('u')} AS user_name,
            to_char(h.at, 'YYYY-MM-DD"T"HH24:MI:SS') AS at,
            t.title, t.board_id, b.name AS board_name, (t.archived_at IS NOT NULL) AS archived,
            to_char(t.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS updated_at
       FROM hits h
       JOIN taches_tasks t ON t.id = h.task_id
       JOIN taches_boards b ON b.id = t.board_id
       LEFT JOIN users u ON u.id = h.user_id
      ORDER BY t.updated_at DESC, h.task_id
      LIMIT 300`,
    [like],
  );
  return [...byId, ...rows.map((r) => ({
    task_id: r.task_id,
    title: r.title,
    board_id: r.board_id,
    board_name: r.board_name,
    archived: r.archived,
    field: r.field,
    by: r.field === 'commentaire' ? r.user_name : null,
    at: r.at,
    snippet: snippet(r.text, term),
  }))];
}

/* ─── Écriture : tâches ─────────────────────────────────── */

const touch = (db, taskId, userId) => db.query(
  `UPDATE taches_tasks SET updated_at = ${PARIS_NOW}, updated_by = $2 WHERE id = $1`,
  [taskId, userId],
);

const logEvent = (db, { taskId, stepId = null, userId = null, kind, detail = {} }) => db.query(
  'INSERT INTO taches_events (task_id, step_id, user_id, kind, detail) VALUES ($1, $2, $3, $4, $5)',
  [taskId, stepId, userId, kind, JSON.stringify(detail)],
);

/**
 * Notification dans l'app (cloche). Jamais à soi-même : l'auteur du geste
 * (`actorId`) est retiré des destinataires.
 */
async function notify(db, { userIds, kind, taskId, stepId = null, actorId, body = '' }) {
  const ids = [...new Set((userIds || []).map(Number))].filter((id) => id && id !== Number(actorId));
  if (!ids.length) return;
  await db.query(
    `INSERT INTO taches_notifications (user_id, kind, task_id, step_id, actor_id, body)
     SELECT unnest($1::int[]), $2, $3, $4, $5, $6`,
    [ids, kind, taskId, stepId, actorId || null, String(body || '').slice(0, 500)],
  );
}

const stepOwners = async (db, stepId) => (await db.query(
  "SELECT user_id FROM taches_step_people WHERE step_id = $1 AND role = 'owner'", [stepId],
)).rows.map((r) => r.user_id);

async function setStepPeople(db, stepId, role, ids) {
  await db.query('DELETE FROM taches_step_people WHERE step_id = $1 AND role = $2', [stepId, role]);
  if (ids.length) {
    await db.query('INSERT INTO taches_step_people (step_id, user_id, role) SELECT $1, unnest($2::int[]), $3', [stepId, ids, role]);
  }
}

async function setTaskPeople(db, taskId, ids) {
  await db.query('DELETE FROM taches_task_people WHERE task_id = $1', [taskId]);
  if (ids.length) {
    await db.query('INSERT INTO taches_task_people (task_id, user_id) SELECT $1, unnest($2::int[])', [taskId, ids]);
  }
}

/** Le groupe doit appartenir au tableau ; sans groupe, le premier du tableau. */
async function resolveGroup(db, boardId, groupId) {
  if (groupId) {
    const { rows } = await db.query('SELECT id FROM taches_groups WHERE id = $1 AND board_id = $2', [groupId, boardId]);
    if (!rows.length) throw httpError(400, "Ce groupe n'est pas dans ce tableau");
    return rows[0].id;
  }
  const { rows } = await db.query('SELECT id FROM taches_groups WHERE board_id = $1 ORDER BY position, id LIMIT 1', [boardId]);
  return rows[0]?.id || null;
}

/** Étapes d'un modèle, ou celles envoyées. La 1re est « à faire », les autres « bloqué ». */
async function initialSteps(db, body) {
  let steps = Array.isArray(body.steps) ? body.steps : null;
  if (!steps && body.template_id) {
    const { rows } = await db.query('SELECT steps FROM taches_templates WHERE id = $1', [Number(body.template_id)]);
    if (!rows.length) throw httpError(400, 'Modèle introuvable');
    steps = rows[0].steps;
  }
  return (steps || [])
    .map((s) => ({ name: cleanText(s.name, 200), owners: toIds(s.owners), notify: toIds(s.notify) }))
    .filter((s) => s.name);
}

async function createTask(userId, body) {
  const title = cleanText(body.title, 300);
  if (!title) throw httpError(400, 'Le titre est obligatoire');
  const startDate = validDate(body.start_date);
  const dueDate = validDate(body.due_date);
  checkDates(startDate, dueDate);
  const people = toIds(body.people);
  const manual = TASK_STATUSES.includes(body.manual_status) ? body.manual_status : 'a_faire';
  const id = await withTx(async (db) => {
    let boardId = Number(body.board_id) || null;
    if (!boardId) {
      const { rows } = await db.query('SELECT id FROM taches_boards ORDER BY position, id LIMIT 1');
      boardId = rows[0]?.id;
    } else {
      const { rows } = await db.query('SELECT id FROM taches_boards WHERE id = $1', [boardId]);
      if (!rows.length) throw httpError(400, 'Tableau introuvable');
    }
    const groupId = await resolveGroup(db, boardId, Number(body.group_id) || null);
    const steps = await initialSteps(db, body);
    await checkMembers([...new Set([...people, ...steps.flatMap((s) => [...s.owners, ...s.notify])])]);
    const { rows: [task] } = await db.query(
      `INSERT INTO taches_tasks (board_id, group_id, title, link_url, labels, priority, manual_status,
                                 start_date, due_date, description, created_by, updated_by, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11,
               COALESCE((SELECT min(position) - 1 FROM taches_tasks WHERE group_id IS NOT DISTINCT FROM $2), 0))
       RETURNING id`,
      [boardId, groupId, title, validUrl(body.link_url), toLabels(body.labels || []), validPriority(body.priority),
        manual, startDate, dueDate, cleanText(body.description, 5000), userId],
    );
    await setTaskPeople(db, task.id, people);
    await notify(db, { userIds: people, kind: 'assigned', taskId: task.id, actorId: userId, body: title });
    for (let i = 0; i < steps.length; i += 1) {
      const { rows: [step] } = await db.query(
        'INSERT INTO taches_steps (task_id, position, name, status) VALUES ($1, $2, $3, $4) RETURNING id',
        [task.id, i, steps[i].name, i === 0 ? 'a_faire' : 'bloque'],
      );
      await setStepPeople(db, step.id, 'owner', steps[i].owners);
      await setStepPeople(db, step.id, 'notify', steps[i].notify);
      await notify(db, { userIds: steps[i].owners, kind: 'assigned', taskId: task.id, stepId: step.id, actorId: userId, body: steps[i].name });
    }
    await logEvent(db, { taskId: task.id, userId, kind: 'created', detail: { title } });
    return task.id;
  });
  return getTask(id);
}

async function updateTask(userId, id, body) {
  let notice = null;
  await withTx(async (db) => {
    const { rows: [cur] } = await db.query('SELECT * FROM taches_tasks WHERE id = $1 FOR UPDATE', [id]);
    if (!cur) throw httpError(404, 'Tâche introuvable');
    const sets = [];
    const params = [id];
    const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if ('title' in body) {
      const title = cleanText(body.title, 300);
      if (!title) throw httpError(400, 'Le titre est obligatoire');
      set('title', title);
    }
    if ('link_url' in body) set('link_url', validUrl(body.link_url));
    if ('labels' in body) set('labels', toLabels(body.labels || []));
    if ('priority' in body) set('priority', validPriority(body.priority));
    if ('description' in body) set('description', cleanText(body.description, 5000));
    if ('start_date' in body || 'due_date' in body) {
      const startVal = 'start_date' in body ? validDate(body.start_date) : undefined;
      const dueVal = 'due_date' in body ? validDate(body.due_date) : undefined;
      const { rows: [d] } = await db.query(
        "SELECT to_char(start_date, 'YYYY-MM-DD') AS s, to_char(due_date, 'YYYY-MM-DD') AS d FROM taches_tasks WHERE id = $1", [id],
      );
      checkDates(startVal !== undefined ? startVal : d.s, dueVal !== undefined ? dueVal : d.d);
      if (startVal !== undefined) set('start_date', startVal);
      if (dueVal !== undefined) set('due_date', dueVal);
    }
    let boardId = cur.board_id;
    if ('board_id' in body && Number(body.board_id) !== cur.board_id) {
      const { rows } = await db.query('SELECT id FROM taches_boards WHERE id = $1', [Number(body.board_id)]);
      if (!rows.length) throw httpError(400, 'Tableau introuvable');
      boardId = rows[0].id;
      set('board_id', boardId);
      set('group_id', await resolveGroup(db, boardId, Number(body.group_id) || null));
    } else if ('group_id' in body) {
      set('group_id', await resolveGroup(db, boardId, Number(body.group_id) || null));
    }
    if ('manual_status' in body && body.manual_status !== cur.manual_status) {
      if (!TASK_STATUSES.includes(body.manual_status)) throw httpError(400, 'Statut invalide');
      set('manual_status', body.manual_status);
      await logEvent(db, { taskId: id, userId, kind: 'task_status', detail: { from: cur.manual_status, to: body.manual_status } });
      if (body.manual_status === 'fait') {
        const { rows } = await db.query('SELECT 1 FROM taches_steps WHERE task_id = $1 LIMIT 1', [id]);
        if (!rows.length) notice = { taskId: id, userId };
      }
    }
    if ('archived' in body) sets.push(body.archived ? `archived_at = COALESCE(archived_at, ${PARIS_NOW})` : 'archived_at = NULL');
    if ('people' in body) {
      const people = toIds(body.people);
      await checkMembers(people);
      const before = (await db.query('SELECT user_id FROM taches_task_people WHERE task_id = $1', [id])).rows.map((r) => r.user_id);
      await setTaskPeople(db, id, people);
      await notify(db, { userIds: people.filter((u) => !before.includes(u)), kind: 'assigned', taskId: id, actorId: userId, body: cur.title });
    }
    params.push(userId);
    await db.query(
      `UPDATE taches_tasks SET ${[...sets, `updated_at = ${PARIS_NOW}`, `updated_by = $${params.length}`].join(', ')}
        WHERE id = $1`,
      params,
    );
  });
  if (notice) sendTaskDoneNotice(notice).catch((e) => console.error('[Tâches] Slack :', e.message));
  return getTask(id);
}

async function deleteTask(id) {
  const { rowCount } = await pool.query('DELETE FROM taches_tasks WHERE id = $1', [id]);
  if (!rowCount) throw httpError(404, 'Tâche introuvable');
}

/** Actions sur plusieurs tâches : archive | unarchive | delete | move ({ group_id }). */
async function bulk(userId, body, { canDelete }) {
  const ids = toIds(body.ids);
  if (!ids.length) throw httpError(400, 'Aucune tâche choisie');
  const { action } = body;
  if (action === 'archive' || action === 'unarchive') {
    await pool.query(
      `UPDATE taches_tasks SET archived_at = ${action === 'archive' ? `COALESCE(archived_at, ${PARIS_NOW})` : 'NULL'},
              updated_at = ${PARIS_NOW}, updated_by = $2
        WHERE id = ANY($1)`,
      [ids, userId],
    );
  } else if (action === 'delete') {
    if (!canDelete) throw httpError(403, "Supprimer des tâches demande le droit d'écriture sur l'app Tâches");
    await pool.query('DELETE FROM taches_tasks WHERE id = ANY($1)', [ids]);
  } else if (action === 'move') {
    const { rows: [g] } = await pool.query('SELECT id, board_id FROM taches_groups WHERE id = $1', [Number(body.group_id)]);
    if (!g) throw httpError(400, 'Groupe introuvable');
    await pool.query(
      `UPDATE taches_tasks SET board_id = $2, group_id = $3, updated_at = ${PARIS_NOW}, updated_by = $4 WHERE id = ANY($1)`,
      [ids, g.board_id, g.id, userId],
    );
  } else {
    throw httpError(400, 'Action inconnue');
  }
  return { success: true, count: ids.length };
}

/* ─── Écriture : étapes ─────────────────────────────────── */

async function lockTaskOfStep(db, stepId) {
  const { rows } = await db.query(
    'SELECT t.id FROM taches_tasks t JOIN taches_steps s ON s.task_id = t.id WHERE s.id = $1 FOR UPDATE OF t',
    [stepId],
  );
  if (!rows.length) throw httpError(404, 'Étape introuvable');
  return rows[0].id;
}

async function addStep(userId, taskId, body) {
  const name = cleanText(body.name, 200);
  if (!name) throw httpError(400, "Le nom de l'étape est obligatoire");
  const owners = toIds(body.owners);
  const notifyIds = toIds(body.notify);
  await checkMembers([...owners, ...notifyIds]);
  await withTx(async (db) => {
    const { rows: t } = await db.query('SELECT id FROM taches_tasks WHERE id = $1 FOR UPDATE', [taskId]);
    if (!t.length) throw httpError(404, 'Tâche introuvable');
    // Ajoutée en fin : « à faire » si tout ce qui précède est fait (ou s'il n'y a rien), sinon bloquée.
    const { rows: [agg] } = await db.query(
      `SELECT COALESCE(max(position) + 1, 0) AS pos, count(*) FILTER (WHERE status <> 'fait')::int AS open
         FROM taches_steps WHERE task_id = $1`,
      [taskId],
    );
    const status = STEP_STATUSES.includes(body.status) ? body.status : (agg.open === 0 ? 'a_faire' : 'bloque');
    const { rows: [step] } = await db.query(
      'INSERT INTO taches_steps (task_id, position, name, status, due_date) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [taskId, agg.pos, name, status, validDate(body.due_date)],
    );
    await setStepPeople(db, step.id, 'owner', owners);
    await setStepPeople(db, step.id, 'notify', notifyIds);
    await notify(db, { userIds: owners, kind: 'assigned', taskId, stepId: step.id, actorId: userId, body: name });
    await touch(db, taskId, userId);
  });
  return getTask(taskId);
}

/**
 * Modifie une étape. Un passage à « fait » débloque l'étape suivante et
 * prévient Slack (après validation de la transaction : un message ne doit
 * jamais annoncer un changement annulé).
 */
async function updateStep(userId, stepId, body) {
  let notice = null;
  const taskId = await withTx(async (db) => {
    const tid = await lockTaskOfStep(db, stepId);
    const { rows: [step] } = await db.query(
      `SELECT *, to_char(start_date, 'YYYY-MM-DD') AS s_txt, to_char(due_date, 'YYYY-MM-DD') AS d_txt
         FROM taches_steps WHERE id = $1`,
      [stepId],
    );

    const sets = [];
    const params = [stepId];
    const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if ('name' in body) {
      const name = cleanText(body.name, 200);
      if (!name) throw httpError(400, "Le nom de l'étape est obligatoire");
      set('name', name);
    }
    if ('start_date' in body || 'due_date' in body) {
      const s = 'start_date' in body ? validDate(body.start_date) : step.s_txt;
      const d = 'due_date' in body ? validDate(body.due_date) : step.d_txt;
      checkDates(s, d);
      if ('start_date' in body) set('start_date', s);
      if ('due_date' in body) set('due_date', d);
    }
    if ('note' in body) set('note', cleanText(body.note, 2000));
    if ('priority' in body) set('priority', validPriority(body.priority));

    const newStatus = body.status;
    if (newStatus !== undefined && !STEP_STATUSES.includes(newStatus)) throw httpError(400, 'Statut invalide');
    const statusChanged = newStatus !== undefined && newStatus !== step.status;
    if (statusChanged) {
      set('status', newStatus);
      if (newStatus === 'fait') {
        sets.push(`done_at = ${PARIS_NOW}`);
        set('done_by', userId);
      } else {
        sets.push('done_at = NULL', 'done_by = NULL');
      }
    }
    if (sets.length) {
      await db.query(`UPDATE taches_steps SET ${sets.join(', ')}, updated_at = ${PARIS_NOW} WHERE id = $1`, params);
    }
    if ('owners' in body || 'notify' in body) {
      await checkMembers([...('owners' in body ? toIds(body.owners) : []), ...('notify' in body ? toIds(body.notify) : [])]);
      if ('owners' in body) {
        const before = await stepOwners(db, stepId);
        const owners = toIds(body.owners);
        await setStepPeople(db, stepId, 'owner', owners);
        await notify(db, { userIds: owners.filter((u) => !before.includes(u)), kind: 'assigned', taskId: tid, stepId, actorId: userId, body: step.name });
      }
      if ('notify' in body) await setStepPeople(db, stepId, 'notify', toIds(body.notify));
    }

    if (statusChanged) {
      await logEvent(db, { taskId: tid, stepId, userId, kind: 'status', detail: { from: step.status, to: newStatus, name: step.name } });
      if (newStatus === 'fait') {
        const { rows: steps } = await db.query(
          `SELECT s.id, s.position, s.name, s.status,
                  COALESCE((SELECT array_agg(p.user_id) FROM taches_step_people p
                             WHERE p.step_id = s.id AND p.role = 'owner'), '{}') AS owners,
                  COALESCE((SELECT array_agg(p.user_id) FROM taches_step_people p
                             WHERE p.step_id = s.id AND p.role = 'notify'), '{}') AS notify
             FROM taches_steps s WHERE s.task_id = $1 ORDER BY s.position, s.id`,
          [tid],
        );
        const plan = nextStepPlan(steps, stepId);
        if (plan.unblock) {
          await db.query(`UPDATE taches_steps SET status = 'a_faire', updated_at = ${PARIS_NOW} WHERE id = $1`, [plan.unblock.id]);
          await logEvent(db, {
            taskId: tid, stepId: plan.unblock.id, userId, kind: 'status',
            detail: { from: 'bloque', to: 'a_faire', name: plan.unblock.name, auto: true },
          });
          await notify(db, {
            userIds: await stepOwners(db, plan.unblock.id), kind: 'unblocked', taskId: tid,
            stepId: plan.unblock.id, actorId: userId, body: plan.unblock.name,
          });
        }
        if (plan.recipients.length) notice = { taskId: tid, stepId, plan, userId };
      }
    }
    await touch(db, tid, userId);
    return tid;
  });

  // Slack en dehors de la transaction, sans faire échouer la mise à jour.
  if (notice) sendDoneNotice(notice).catch((e) => console.error('[Tâches] Slack :', e.message));
  return getTask(taskId);
}

const namesMap = async () => new Map(
  (await pool.query(`SELECT id, ${USER_NAME('u')} AS name FROM users u`)).rows.map((r) => [r.id, r.name]),
);

async function sendDoneNotice({ taskId, stepId, plan, userId }) {
  const { rows: [task] } = await pool.query('SELECT id, title FROM taches_tasks WHERE id = $1', [taskId]);
  const names = await namesMap();
  const result = await tachesSlack.sendDoneNotice({
    task,
    doneStep: plan.done,
    nextStep: plan.next,
    unblocked: Boolean(plan.unblock),
    finished: plan.finished,
    doneBy: names.get(userId),
    recipients: plan.recipients,
    names,
  });
  await logEvent(pool, {
    taskId, stepId, userId,
    kind: result.ok ? 'slack' : 'slack_error',
    detail: result.ok ? { to: plan.recipients } : { error: result.error },
  });
}

/** Tâche sans étape passée « fait » (suivi quotidien) : message dans le canal, comme Make. */
async function sendTaskDoneNotice({ taskId, userId }) {
  const { rows: [task] } = await pool.query(
    `SELECT t.id, t.title, b.name AS board_name,
            COALESCE((SELECT array_agg(p.user_id) FROM taches_task_people p WHERE p.task_id = t.id), '{}') AS people
       FROM taches_tasks t JOIN taches_boards b ON b.id = t.board_id WHERE t.id = $1`,
    [taskId],
  );
  const names = await namesMap();
  const result = await tachesSlack.sendTaskDoneNotice({ task, doneBy: names.get(userId), names });
  await logEvent(pool, {
    taskId, userId,
    kind: result.ok ? 'slack' : 'slack_error',
    detail: result.ok ? { to: task.people } : { error: result.error },
  });
}

async function moveStep(userId, stepId, direction) {
  if (!['up', 'down'].includes(direction)) throw httpError(400, 'Direction invalide');
  const taskId = await withTx(async (db) => {
    const tid = await lockTaskOfStep(db, stepId);
    const { rows: steps } = await db.query('SELECT id FROM taches_steps WHERE task_id = $1 ORDER BY position, id', [tid]);
    const i = steps.findIndex((s) => s.id === stepId);
    const j = direction === 'up' ? i - 1 : i + 1;
    if (j >= 0 && j < steps.length) {
      [steps[i], steps[j]] = [steps[j], steps[i]];
      for (let k = 0; k < steps.length; k += 1) {
        await db.query('UPDATE taches_steps SET position = $2 WHERE id = $1', [steps[k].id, k]);
      }
      await touch(db, tid, userId);
    }
    return tid;
  });
  return getTask(taskId);
}

async function deleteStep(userId, stepId) {
  const { rows } = await pool.query('DELETE FROM taches_steps WHERE id = $1 RETURNING task_id, name', [stepId]);
  if (!rows.length) throw httpError(404, 'Étape introuvable');
  await touch(pool, rows[0].task_id, userId);
  await logEvent(pool, { taskId: rows[0].task_id, userId, kind: 'step_deleted', detail: { name: rows[0].name } });
  return getTask(rows[0].task_id);
}

/* ─── Commentaires ──────────────────────────────────────── */

/**
 * Commentaire, avec mentions @ (`mentions` = ids choisis dans la liste).
 * Mentionnés : notification « mention » + message Slack. Les autres personnes
 * qui suivent la tâche (personnes, responsables, à prévenir, auteur, anciens
 * commentateurs) : notification « comment », sans Slack.
 */
async function addComment(userId, taskId, body) {
  const text = cleanText(body.body, 5000);
  if (!text) throw httpError(400, 'Commentaire vide');
  const { rows } = await pool.query('SELECT id, title, created_by FROM taches_tasks WHERE id = $1', [taskId]);
  if (!rows.length) throw httpError(404, 'Tâche introuvable');
  const active = new Set((await getMembers()).map((m) => m.id));
  const mentions = toIds(body.mentions).filter((id) => active.has(id) && id !== userId);
  await withTx(async (db) => {
    await db.query('INSERT INTO taches_comments (task_id, user_id, body, mentions) VALUES ($1, $2, $3, $4)', [taskId, userId, text, mentions]);
    await notify(db, { userIds: mentions, kind: 'mention', taskId, actorId: userId, body: text });
    const { rows: subs } = await db.query(
      `SELECT user_id FROM taches_task_people WHERE task_id = $1
       UNION SELECT p.user_id FROM taches_step_people p JOIN taches_steps s ON s.id = p.step_id WHERE s.task_id = $1
       UNION SELECT user_id FROM taches_comments WHERE task_id = $1 AND user_id IS NOT NULL
       UNION SELECT created_by FROM taches_tasks WHERE id = $1 AND created_by IS NOT NULL`,
      [taskId],
    );
    await notify(db, {
      userIds: subs.map((x) => x.user_id).filter((id) => active.has(id) && !mentions.includes(id)),
      kind: 'comment', taskId, actorId: userId, body: text,
    });
    await touch(db, taskId, userId);
  });
  if (mentions.length) {
    sendMentionNotice({ task: rows[0], userId, text, mentions }).catch((e) => console.error('[Tâches] Slack mention :', e.message));
  }
  return getTask(taskId);
}

async function sendMentionNotice({ task, userId, text, mentions }) {
  const names = await namesMap();
  const result = await tachesSlack.sendMentionNotice({ task, author: names.get(userId), text, recipients: mentions, names });
  await logEvent(pool, {
    taskId: task.id, userId, kind: result.ok ? 'slack' : 'slack_error',
    detail: result.ok ? { to: mentions, mention: true } : { error: result.error },
  });
}

/* ─── Cloche : notifications de l'utilisateur ───────────── */

/** `tab` : all | mention | assigned ; `unread` ; `q` cherche dans tâche, texte, auteur. */
async function getNotifications(userId, { tab = 'all', unread = false, q = '' } = {}) {
  const params = [userId];
  let where = 'n.user_id = $1';
  if (tab === 'mention') where += " AND n.kind = 'mention'";
  if (tab === 'assigned') where += " AND n.kind IN ('assigned', 'unblocked')";
  if (unread) where += ' AND n.read_at IS NULL';
  const term = cleanText(q, 100);
  if (term) {
    params.push(`%${foldJs(term).replace(/[\\%_]/g, '\\$&')}%`);
    where += ` AND ${FOLD(`coalesce(t.title, '') || ' ' || n.body || ' ' || coalesce(${USER_NAME('a')}, '')`)} LIKE $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT n.id, n.kind, n.task_id, n.step_id, n.body, n.actor_id, ${USER_NAME('a')} AS actor_name,
            t.title AS task_title, s.name AS step_name,
            to_char(n.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS created_at,
            (n.read_at IS NOT NULL) AS read
       FROM taches_notifications n
       LEFT JOIN users a ON a.id = n.actor_id
       LEFT JOIN taches_tasks t ON t.id = n.task_id
       LEFT JOIN taches_steps s ON s.id = n.step_id
      WHERE ${where}
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT 200`,
    params,
  );
  return { items: rows, unread: await countUnread(userId) };
}

async function countUnread(userId) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM taches_notifications WHERE user_id = $1 AND read_at IS NULL', [userId]);
  return rows[0].n;
}

/** Lue (ou non lue avec `read: false`). Bornée à l'utilisateur. */
async function markNotification(userId, id, read = true) {
  await pool.query(
    `UPDATE taches_notifications SET read_at = ${read ? PARIS_NOW : 'NULL'} WHERE id = $1 AND user_id = $2`, [id, userId],
  );
  return { unread: await countUnread(userId) };
}

async function markAllNotifications(userId) {
  await pool.query(`UPDATE taches_notifications SET read_at = ${PARIS_NOW} WHERE user_id = $1 AND read_at IS NULL`, [userId]);
  return { unread: 0 };
}

/* ─── Ordre (glisser-déposer) ────────────────────────────── */

/**
 * Nouvel ordre d'un groupe après un glisser-déposer : `ids` = toutes les tâches
 * du groupe, dans l'ordre affiché. Une tâche venue d'un autre groupe (ou
 * tableau) y est rangée au passage.
 */
async function reorderTasks(userId, body) {
  const ids = toIds(body.ids);
  const { rows: [g] } = await pool.query('SELECT id, board_id FROM taches_groups WHERE id = $1', [Number(body.group_id)]);
  if (!g) throw httpError(400, 'Groupe introuvable');
  await withTx(async (db) => {
    for (let i = 0; i < ids.length; i += 1) {
      await db.query(
        `UPDATE taches_tasks SET position = $2, group_id = $3, board_id = $4,
                updated_at = CASE WHEN group_id IS DISTINCT FROM $3 THEN ${PARIS_NOW} ELSE updated_at END,
                updated_by = CASE WHEN group_id IS DISTINCT FROM $3 THEN $5 ELSE updated_by END
          WHERE id = $1`,
        [ids[i], i, g.id, g.board_id, userId],
      );
    }
  });
  return { success: true };
}

/** Nouvel ordre des étapes d'une tâche : `ids` = toutes ses étapes. */
async function reorderSteps(userId, taskId, body) {
  const ids = toIds(body.ids);
  await withTx(async (db) => {
    const { rows } = await db.query('SELECT id FROM taches_steps WHERE task_id = $1 FOR UPDATE', [taskId]);
    const own = new Set(rows.map((x) => x.id));
    if (ids.length !== own.size || ids.some((id) => !own.has(id))) throw httpError(400, "Liste d'étapes incomplète");
    for (let i = 0; i < ids.length; i += 1) {
      await db.query('UPDATE taches_steps SET position = $2 WHERE id = $1', [ids[i], i]);
    }
    await touch(db, taskId, userId);
  });
  return getTask(taskId);
}

/** Seul l'auteur supprime son commentaire. */
async function deleteComment(userId, commentId) {
  const { rows } = await pool.query('DELETE FROM taches_comments WHERE id = $1 AND user_id = $2 RETURNING task_id', [commentId, userId]);
  if (!rows.length) throw httpError(404, 'Commentaire introuvable');
  return getTask(rows[0].task_id);
}

/* ─── Modèles ───────────────────────────────────────────── */

async function getTemplates() {
  const { rows } = await pool.query('SELECT id, name, labels, steps, position FROM taches_templates ORDER BY position, id');
  return rows;
}

async function saveTemplate(id, body) {
  const name = cleanText(body.name, 100);
  if (!name) throw httpError(400, 'Le nom du modèle est obligatoire');
  const steps = (Array.isArray(body.steps) ? body.steps : [])
    .map((s) => ({ name: cleanText(s.name, 200), owners: toIds(s.owners), notify: toIds(s.notify) }))
    .filter((s) => s.name);
  await checkMembers([...new Set(steps.flatMap((s) => [...s.owners, ...s.notify]))]);
  const labels = toLabels(body.labels || []);
  if (id) {
    const { rowCount } = await pool.query(
      `UPDATE taches_templates SET name = $2, labels = $3, steps = $4, updated_at = ${PARIS_NOW} WHERE id = $1`,
      [id, name, labels, JSON.stringify(steps)],
    );
    if (!rowCount) throw httpError(404, 'Modèle introuvable');
  } else {
    await pool.query(
      `INSERT INTO taches_templates (name, labels, steps, position)
       VALUES ($1, $2, $3, COALESCE((SELECT max(position) + 1 FROM taches_templates), 0))`,
      [name, labels, JSON.stringify(steps)],
    );
  }
  return getTemplates();
}

async function deleteTemplate(id) {
  await pool.query('DELETE FROM taches_templates WHERE id = $1', [id]);
  return getTemplates();
}

/** Étiquettes déjà utilisées, les plus fréquentes d'abord (suggestions). */
async function getLabels() {
  const { rows } = await pool.query(
    `SELECT l FROM (
       SELECT unnest(labels) AS l FROM taches_tasks
       UNION ALL SELECT unnest(labels) FROM taches_templates) x
     GROUP BY l ORDER BY count(*) DESC, l`,
  );
  return rows.map((r) => r.l);
}

module.exports = {
  getMembers,
  getBoards,
  createBoard,
  updateBoard,
  deleteBoard,
  createGroup,
  updateGroup,
  deleteGroup,
  getBoard,
  getMine,
  getTask,
  search,
  createTask,
  updateTask,
  deleteTask,
  bulk,
  addStep,
  updateStep,
  moveStep,
  deleteStep,
  addComment,
  deleteComment,
  getNotifications,
  countUnread,
  markNotification,
  markAllNotifications,
  reorderTasks,
  reorderSteps,
  getTemplates,
  saveTemplate,
  deleteTemplate,
  getLabels,
};
