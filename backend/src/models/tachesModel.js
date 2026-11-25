const pool = require('../config/database');
const userPermissionsModel = require('./userPermissionsModel');
const { nextStepPlan, taskStatus, STEP_STATUSES } = require('../services/tachesRules');
const tachesSlack = require('../services/tachesSlack');

/**
 * App Tâches : tâches partagées par toute l'équipe, découpées en étapes
 * enchaînées (remplace Monday + Make).
 *
 * Contrairement au Tableau (personnel), tout est COMMUN : chacun voit et
 * modifie toutes les tâches. « Mes tâches » n'est qu'un filtre sur les étapes
 * dont on est responsable (owner).
 *
 * La règle métier (étape suivante à débloquer, statut de la tâche) est dans
 * services/tachesRules.js, pure et testée. Ici : SQL, transaction, Slack.
 *
 * Dates sorties en texte (to_char) : node-pg convertirait DATE en objet Date
 * au fuseau du serveur (UTC), l'échéance du 22 deviendrait le 21 au navigateur.
 */

const PARIS_NOW = "(NOW() AT TIME ZONE 'Europe/Paris')";
const USER_NAME = (alias) => `COALESCE(NULLIF(${alias}.name, ''), split_part(${alias}.email, '@', 1))`;
const LABEL_MAX = 60;
const PRIORITIES = ['critique', 'haute', 'moyenne', 'basse'];

const httpError = (status, message) => {
  const e = new Error(message);
  e.statusCode = status;
  return e;
};

const cleanText = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const nullableText = (v, max = 500) => {
  const s = cleanText(v, max);
  return s || null;
};
const toIds = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
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

/* ─── Membres ───────────────────────────────────────────── */

/** Comptes actifs qui ont l'app (droit coché, ou super admin). */
async function getMembers() {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, ${USER_NAME('u')} AS name,
            EXISTS (SELECT 1 FROM user_permissions p
                     WHERE p.user_id = u.id AND p.app_name = 'taches' AND p.can_read) AS has_app
       FROM users u
      WHERE u.disabled_at IS NULL
      ORDER BY 3`,
  );
  return rows
    .filter((r) => r.has_app || userPermissionsModel.isSuperAdmin(r.email))
    .map(({ id, name }) => ({ id, name }));
}

/** Vérifie que chaque personne est bien un membre de l'app. */
async function checkMembers(ids) {
  if (!ids.length) return;
  const members = new Set((await getMembers()).map((m) => m.id));
  const unknown = ids.filter((id) => !members.has(id));
  if (unknown.length) throw httpError(400, "Une des personnes choisies n'a pas accès à l'app Tâches");
}

/* ─── Lecture ───────────────────────────────────────────── */

const TASK_COLS = `
  t.id, t.title, t.link_url, t.label, t.priority, t.manual_status, t.description, t.position,
  t.created_by, t.updated_by, ${USER_NAME('uu')} AS updated_by_name,
  to_char(t.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS created_at,
  to_char(t.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS updated_at,
  to_char(t.archived_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS archived_at,
  (SELECT count(*)::int FROM taches_comments c WHERE c.task_id = t.id) AS comment_count`;

const STEP_COLS = `
  s.id, s.task_id, s.position, s.name, s.status, s.note,
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

/**
 * Vue générale. `done` : inclure les tâches terminées (toutes étapes faites),
 * masquées par défaut. Les tâches archivées ne sortent que sur `archived`.
 */
async function getBoard({ done = false, archived = false } = {}) {
  const tasks = await loadTasks(pool, archived ? 't.archived_at IS NOT NULL' : 't.archived_at IS NULL', []);
  return done || archived ? tasks : tasks.filter((t) => t.status !== 'fait');
}

/**
 * Mes tâches : toute tâche où je suis responsable d'une étape pas encore faite,
 * AVEC toutes ses étapes (les précédentes s'affichent grisées côté écran).
 */
async function getMine(userId) {
  return loadTasks(
    pool,
    `t.archived_at IS NULL AND EXISTS (
       SELECT 1 FROM taches_steps s JOIN taches_step_people p ON p.step_id = s.id
        WHERE s.task_id = t.id AND p.user_id = $1 AND p.role = 'owner' AND s.status <> 'fait')`,
    [userId],
  );
}

async function getTask(id) {
  const [task] = await loadTasks(pool, 't.id = $1', [id]);
  if (!task) throw httpError(404, 'Tâche introuvable');
  const { rows: comments } = await pool.query(
    `SELECT c.id, c.user_id, ${USER_NAME('u')} AS user_name, c.body,
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

/* ─── Écriture : tâches ─────────────────────────────────── */

const touch = (db, taskId, userId) => db.query(
  `UPDATE taches_tasks SET updated_at = ${PARIS_NOW}, updated_by = $2 WHERE id = $1`,
  [taskId, userId],
);

const logEvent = (db, { taskId, stepId = null, userId = null, kind, detail = {} }) => db.query(
  'INSERT INTO taches_events (task_id, step_id, user_id, kind, detail) VALUES ($1, $2, $3, $4, $5)',
  [taskId, stepId, userId, kind, JSON.stringify(detail)],
);

async function setPeople(db, stepId, role, ids) {
  await db.query('DELETE FROM taches_step_people WHERE step_id = $1 AND role = $2', [stepId, role]);
  if (ids.length) {
    await db.query(
      `INSERT INTO taches_step_people (step_id, user_id, role)
       SELECT $1, unnest($2::int[]), $3`,
      [stepId, ids, role],
    );
  }
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
  const priority = body.priority && PRIORITIES.includes(body.priority) ? body.priority : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const steps = await initialSteps(client, body);
    await checkMembers([...new Set(steps.flatMap((s) => [...s.owners, ...s.notify]))]);
    const { rows: [task] } = await client.query(
      `INSERT INTO taches_tasks (title, link_url, label, priority, description, created_by, updated_by, position)
       VALUES ($1, $2, $3, $4, $5, $6, $6,
               COALESCE((SELECT min(position) - 1 FROM taches_tasks), 0))
       RETURNING id`,
      [title, validUrl(body.link_url), nullableText(body.label, LABEL_MAX), priority,
        cleanText(body.description, 5000), userId],
    );
    for (let i = 0; i < steps.length; i += 1) {
      const { rows: [step] } = await client.query(
        'INSERT INTO taches_steps (task_id, position, name, status) VALUES ($1, $2, $3, $4) RETURNING id',
        [task.id, i, steps[i].name, i === 0 ? 'a_faire' : 'bloque'],
      );
      await setPeople(client, step.id, 'owner', steps[i].owners);
      await setPeople(client, step.id, 'notify', steps[i].notify);
    }
    await logEvent(client, { taskId: task.id, userId, kind: 'created', detail: { title } });
    await client.query('COMMIT');
    return getTask(task.id);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function updateTask(userId, id, body) {
  const sets = [];
  const params = [id];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if ('title' in body) {
    const title = cleanText(body.title, 300);
    if (!title) throw httpError(400, 'Le titre est obligatoire');
    set('title', title);
  }
  if ('link_url' in body) set('link_url', validUrl(body.link_url));
  if ('label' in body) set('label', nullableText(body.label, LABEL_MAX));
  if ('priority' in body) set('priority', PRIORITIES.includes(body.priority) ? body.priority : null);
  if ('description' in body) set('description', cleanText(body.description, 5000));
  if ('manual_status' in body) {
    if (!['a_faire', 'en_cours', 'fait'].includes(body.manual_status)) throw httpError(400, 'Statut invalide');
    set('manual_status', body.manual_status);
  }
  if ('archived' in body) sets.push(body.archived ? `archived_at = ${PARIS_NOW}` : 'archived_at = NULL');
  if (!sets.length) return getTask(id);
  params.push(userId);
  const { rowCount } = await pool.query(
    `UPDATE taches_tasks SET ${sets.join(', ')}, updated_at = ${PARIS_NOW}, updated_by = $${params.length}
      WHERE id = $1`,
    params,
  );
  if (!rowCount) throw httpError(404, 'Tâche introuvable');
  return getTask(id);
}

async function deleteTask(id) {
  const { rowCount } = await pool.query('DELETE FROM taches_tasks WHERE id = $1', [id]);
  if (!rowCount) throw httpError(404, 'Tâche introuvable');
}

/* ─── Écriture : étapes ─────────────────────────────────── */

async function lockTaskOfStep(db, stepId) {
  const { rows } = await db.query(
    `SELECT t.id FROM taches_tasks t JOIN taches_steps s ON s.task_id = t.id
      WHERE s.id = $1 FOR UPDATE OF t`,
    [stepId],
  );
  if (!rows.length) throw httpError(404, 'Étape introuvable');
  return rows[0].id;
}

async function addStep(userId, taskId, body) {
  const name = cleanText(body.name, 200);
  if (!name) throw httpError(400, "Le nom de l'étape est obligatoire");
  const owners = toIds(body.owners);
  const notify = toIds(body.notify);
  await checkMembers([...owners, ...notify]);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: t } = await client.query('SELECT id FROM taches_tasks WHERE id = $1 FOR UPDATE', [taskId]);
    if (!t.length) throw httpError(404, 'Tâche introuvable');
    // Étape ajoutée en fin : « à faire » si tout ce qui précède est fait (ou s'il n'y a rien), sinon bloquée.
    const { rows: [agg] } = await client.query(
      `SELECT COALESCE(max(position) + 1, 0) AS pos, count(*) FILTER (WHERE status <> 'fait')::int AS open
         FROM taches_steps WHERE task_id = $1`,
      [taskId],
    );
    const status = STEP_STATUSES.includes(body.status) ? body.status : (agg.open === 0 ? 'a_faire' : 'bloque');
    const { rows: [step] } = await client.query(
      'INSERT INTO taches_steps (task_id, position, name, status, due_date) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [taskId, agg.pos, name, status, validDate(body.due_date)],
    );
    await setPeople(client, step.id, 'owner', owners);
    await setPeople(client, step.id, 'notify', notify);
    await touch(client, taskId, userId);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return getTask(taskId);
}

/**
 * Modifie une étape. Un passage à « fait » débloque l'étape suivante et
 * prévient Slack (après validation de la transaction : un message ne doit
 * jamais annoncer un changement annulé).
 */
async function updateStep(userId, stepId, body) {
  const client = await pool.connect();
  let notice = null;
  let taskId;
  try {
    await client.query('BEGIN');
    taskId = await lockTaskOfStep(client, stepId);
    const { rows: [step] } = await client.query('SELECT * FROM taches_steps WHERE id = $1', [stepId]);

    const sets = [];
    const params = [stepId];
    const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if ('name' in body) {
      const name = cleanText(body.name, 200);
      if (!name) throw httpError(400, "Le nom de l'étape est obligatoire");
      set('name', name);
    }
    if ('due_date' in body) set('due_date', validDate(body.due_date));
    if ('note' in body) set('note', cleanText(body.note, 2000));

    const newStatus = body.status;
    const statusChanged = newStatus !== undefined && newStatus !== step.status;
    if (newStatus !== undefined && !STEP_STATUSES.includes(newStatus)) throw httpError(400, 'Statut invalide');
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
      await client.query(`UPDATE taches_steps SET ${sets.join(', ')}, updated_at = ${PARIS_NOW} WHERE id = $1`, params);
    }
    if ('owners' in body || 'notify' in body) {
      const owners = toIds(body.owners);
      const notify = toIds(body.notify);
      await checkMembers([...('owners' in body ? owners : []), ...('notify' in body ? notify : [])]);
      if ('owners' in body) await setPeople(client, stepId, 'owner', owners);
      if ('notify' in body) await setPeople(client, stepId, 'notify', notify);
    }

    if (statusChanged) {
      await logEvent(client, { taskId, stepId, userId, kind: 'status', detail: { from: step.status, to: newStatus, name: step.name } });
      if (newStatus === 'fait') {
        const { rows: steps } = await client.query(
          `SELECT s.id, s.position, s.name, s.status,
                  COALESCE((SELECT array_agg(p.user_id) FROM taches_step_people p
                             WHERE p.step_id = s.id AND p.role = 'owner'), '{}') AS owners,
                  COALESCE((SELECT array_agg(p.user_id) FROM taches_step_people p
                             WHERE p.step_id = s.id AND p.role = 'notify'), '{}') AS notify
             FROM taches_steps s WHERE s.task_id = $1 ORDER BY s.position, s.id`,
          [taskId],
        );
        const plan = nextStepPlan(steps, stepId);
        if (plan.unblock) {
          await client.query(
            `UPDATE taches_steps SET status = 'a_faire', updated_at = ${PARIS_NOW} WHERE id = $1`,
            [plan.unblock.id],
          );
          await logEvent(client, {
            taskId, stepId: plan.unblock.id, userId, kind: 'status',
            detail: { from: 'bloque', to: 'a_faire', name: plan.unblock.name, auto: true },
          });
        }
        if (plan.recipients.length) notice = { taskId, stepId, plan, userId };
      }
    }
    await touch(client, taskId, userId);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // Slack en dehors de la transaction, sans faire échouer la mise à jour.
  if (notice) {
    sendDoneNotice(notice).catch((e) => console.error('[Tâches] Slack :', e.message));
  }
  return getTask(taskId);
}

async function sendDoneNotice({ taskId, stepId, plan, userId }) {
  const { rows: [task] } = await pool.query('SELECT id, title FROM taches_tasks WHERE id = $1', [taskId]);
  const names = new Map((await pool.query(`SELECT id, ${USER_NAME('u')} AS name FROM users u`)).rows.map((r) => [r.id, r.name]));
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

async function moveStep(userId, stepId, direction) {
  if (!['up', 'down'].includes(direction)) throw httpError(400, 'Direction invalide');
  const client = await pool.connect();
  let taskId;
  try {
    await client.query('BEGIN');
    taskId = await lockTaskOfStep(client, stepId);
    const { rows: steps } = await client.query(
      'SELECT id FROM taches_steps WHERE task_id = $1 ORDER BY position, id', [taskId],
    );
    const i = steps.findIndex((s) => s.id === stepId);
    const j = direction === 'up' ? i - 1 : i + 1;
    if (j >= 0 && j < steps.length) {
      [steps[i], steps[j]] = [steps[j], steps[i]];
      for (let k = 0; k < steps.length; k += 1) {
        await client.query('UPDATE taches_steps SET position = $2 WHERE id = $1', [steps[k].id, k]);
      }
      await touch(client, taskId, userId);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return getTask(taskId);
}

async function deleteStep(userId, stepId) {
  const { rows } = await pool.query('DELETE FROM taches_steps WHERE id = $1 RETURNING task_id', [stepId]);
  if (!rows.length) throw httpError(404, 'Étape introuvable');
  await touch(pool, rows[0].task_id, userId);
  return getTask(rows[0].task_id);
}

/* ─── Commentaires ──────────────────────────────────────── */

async function addComment(userId, taskId, body) {
  const text = cleanText(body.body, 5000);
  if (!text) throw httpError(400, 'Commentaire vide');
  const { rows } = await pool.query('SELECT 1 FROM taches_tasks WHERE id = $1', [taskId]);
  if (!rows.length) throw httpError(404, 'Tâche introuvable');
  await pool.query('INSERT INTO taches_comments (task_id, user_id, body) VALUES ($1, $2, $3)', [taskId, userId, text]);
  await touch(pool, taskId, userId);
  return getTask(taskId);
}

/** Seul l'auteur supprime son commentaire. */
async function deleteComment(userId, commentId) {
  const { rows } = await pool.query(
    'DELETE FROM taches_comments WHERE id = $1 AND user_id = $2 RETURNING task_id', [commentId, userId],
  );
  if (!rows.length) throw httpError(404, 'Commentaire introuvable');
  return getTask(rows[0].task_id);
}

/* ─── Modèles ───────────────────────────────────────────── */

async function getTemplates() {
  const { rows } = await pool.query('SELECT id, name, label, steps, position FROM taches_templates ORDER BY position, id');
  return rows;
}

async function saveTemplate(id, body) {
  const name = cleanText(body.name, 100);
  if (!name) throw httpError(400, 'Le nom du modèle est obligatoire');
  const steps = (Array.isArray(body.steps) ? body.steps : [])
    .map((s) => ({ name: cleanText(s.name, 200), owners: toIds(s.owners), notify: toIds(s.notify) }))
    .filter((s) => s.name);
  await checkMembers([...new Set(steps.flatMap((s) => [...s.owners, ...s.notify]))]);
  const label = nullableText(body.label, LABEL_MAX);
  if (id) {
    const { rowCount } = await pool.query(
      `UPDATE taches_templates SET name = $2, label = $3, steps = $4, updated_at = ${PARIS_NOW} WHERE id = $1`,
      [id, name, label, JSON.stringify(steps)],
    );
    if (!rowCount) throw httpError(404, 'Modèle introuvable');
  } else {
    await pool.query(
      `INSERT INTO taches_templates (name, label, steps, position)
       VALUES ($1, $2, $3, COALESCE((SELECT max(position) + 1 FROM taches_templates), 0))`,
      [name, label, JSON.stringify(steps)],
    );
  }
  return getTemplates();
}

async function deleteTemplate(id) {
  await pool.query('DELETE FROM taches_templates WHERE id = $1', [id]);
  return getTemplates();
}

/** Étiquettes déjà utilisées (suggestions du champ). */
async function getLabels() {
  const { rows } = await pool.query(
    `SELECT label FROM (
       SELECT label FROM taches_tasks WHERE label IS NOT NULL
       UNION ALL SELECT label FROM taches_templates WHERE label IS NOT NULL) x
     GROUP BY label ORDER BY count(*) DESC, label`,
  );
  return rows.map((r) => r.label);
}

module.exports = {
  getMembers,
  getBoard,
  getMine,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  addStep,
  updateStep,
  moveStep,
  deleteStep,
  addComment,
  deleteComment,
  getTemplates,
  saveTemplate,
  deleteTemplate,
  getLabels,
};
