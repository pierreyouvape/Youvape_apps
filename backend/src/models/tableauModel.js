const pool = require('../config/database');
const userPermissionsModel = require('./userPermissionsModel');
const { normalizeRule, nextOccurrence, parisToday, addDays } = require('../services/tableauRecurrence');
const { notify } = require('../services/tableauEvents');

/**
 * App Tableau : post-its, envois entre collègues, tâches récurrentes.
 *
 * TOUT est personnel : chaque requête est bornée à `userId` (le compte connecté),
 * y compris pour un admin. Un post-it ou une tâche d'un autre renvoie 404, comme
 * s'il n'existait pas.
 *
 * Les dates sortent en texte (to_char) : node-pg convertirait DATE et TIMESTAMP
 * en objets Date au fuseau du serveur (UTC), et l'échéance du 22 deviendrait le 21
 * à 22 h côté navigateur.
 */

const COLORS = ['jaune', 'rose', 'bleu', 'vert', 'violet', 'orange'];
const PARIS_NOW = "(NOW() AT TIME ZONE 'Europe/Paris')";
const USER_NAME = (alias) => `COALESCE(NULLIF(${alias}.name, ''), split_part(${alias}.email, '@', 1))`;

const httpError = (status, message) => {
  const e = new Error(message);
  e.statusCode = status;
  return e;
};

const clampInt = (v, min, max) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)));

/* ─── Destinataires ─────────────────────────────────────── */

/** Comptes actifs qui ont l'app Tableau (droit coché, ou super admin), hors soi. */
async function getRecipients(userId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, ${USER_NAME('u')} AS name,
            EXISTS (SELECT 1 FROM user_permissions p
                     WHERE p.user_id = u.id AND p.app_name = 'tableau' AND p.can_read) AS has_app
       FROM users u
      WHERE u.disabled_at IS NULL AND u.id <> $1
      ORDER BY 3`,
    [userId],
  );
  return rows
    .filter((r) => r.has_app || userPermissionsModel.isSuperAdmin(r.email))
    .map(({ id, name }) => ({ id, name }));
}

/* ─── Post-its ──────────────────────────────────────────── */

const NOTE_COLUMNS = `n.id, n.content, n.color, n.x, n.y, n.width, n.height, n.z,
  ${USER_NAME('rf')} AS received_from_name`;

async function getNotes(userId) {
  const { rows } = await pool.query(
    `SELECT ${NOTE_COLUMNS}
       FROM tableau_notes n
       LEFT JOIN users rf ON rf.id = n.received_from
      WHERE n.owner_id = $1 AND NOT n.in_transit
      ORDER BY n.z, n.id`,
    [userId],
  );
  return rows;
}

async function getNote(userId, id) {
  const { rows } = await pool.query(
    `SELECT ${NOTE_COLUMNS}
       FROM tableau_notes n
       LEFT JOIN users rf ON rf.id = n.received_from
      WHERE n.id = $1 AND n.owner_id = $2 AND NOT n.in_transit`,
    [id, userId],
  );
  if (!rows[0]) throw httpError(404, 'Post-it introuvable');
  return rows[0];
}

/** Plan au-dessus de tous les post-its du compte. */
async function topZ(client, userId) {
  const { rows } = await client.query(
    'SELECT COALESCE(MAX(z), 0) + 1 AS z FROM tableau_notes WHERE owner_id = $1',
    [userId],
  );
  return rows[0].z;
}

async function createNote(userId, input) {
  const color = COLORS.includes(input.color) ? input.color : 'jaune';
  const z = await topZ(pool, userId);
  const { rows } = await pool.query(
    `INSERT INTO tableau_notes (owner_id, content, color, x, y, z)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [userId, String(input.content || ''), color, clampInt(input.x, 0, 20000), clampInt(input.y, 0, 20000), z],
  );
  return getNote(userId, rows[0].id);
}

/** Mise à jour partielle : seuls les champs fournis sont écrits. */
async function updateNote(userId, id, input) {
  const sets = [];
  const params = [id, userId];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

  if (input.content !== undefined) set('content', String(input.content));
  if (input.color !== undefined) {
    if (!COLORS.includes(input.color)) throw httpError(400, 'Couleur inconnue');
    set('color', input.color);
  }
  if (input.x !== undefined) set('x', clampInt(input.x, 0, 20000));
  if (input.y !== undefined) set('y', clampInt(input.y, 0, 20000));
  if (input.width !== undefined) set('width', clampInt(input.width, 140, 1200));
  if (input.height !== undefined) set('height', clampInt(input.height, 100, 1200));
  if (input.z !== undefined) set('z', clampInt(input.z, 0, 1000000));
  if (!sets.length) return getNote(userId, id);

  const { rowCount } = await pool.query(
    `UPDATE tableau_notes SET ${sets.join(', ')}, updated_at = ${PARIS_NOW}
      WHERE id = $1 AND owner_id = $2 AND NOT in_transit`,
    params,
  );
  if (!rowCount) throw httpError(404, 'Post-it introuvable');
  return getNote(userId, id);
}

async function deleteNote(userId, id) {
  const { rowCount } = await pool.query(
    'DELETE FROM tableau_notes WHERE id = $1 AND owner_id = $2 AND NOT in_transit',
    [id, userId],
  );
  if (!rowCount) throw httpError(404, 'Post-it introuvable');
}

/* ─── Envois ────────────────────────────────────────────── */

async function sendNote(userId, { note_id: noteId, to_user_id: toUserId, mode }) {
  if (!['move', 'copy'].includes(mode)) throw httpError(400, 'Mode d\'envoi inconnu');
  const recipients = await getRecipients(userId);
  if (!recipients.some((r) => r.id === Number(toUserId))) {
    throw httpError(400, 'Destinataire inconnu ou sans accès à l\'app Tableau');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, content, color FROM tableau_notes
        WHERE id = $1 AND owner_id = $2 AND NOT in_transit FOR UPDATE`,
      [noteId, userId],
    );
    const note = rows[0];
    if (!note) throw httpError(404, 'Post-it introuvable');

    if (mode === 'move') {
      await client.query('UPDATE tableau_notes SET in_transit = true WHERE id = $1', [note.id]);
    }
    await client.query(
      `INSERT INTO tableau_note_transfers (note_id, mode, from_user_id, to_user_id, content, color)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [note.id, mode, userId, Number(toUserId), note.content, note.color],
    );
    await client.query('COMMIT');
    notify([userId, toUserId], 'transfer');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Réponse du destinataire. Verrou sur l'envoi : un double clic (ou deux onglets)
 * ne crée pas deux copies, et un envoi annulé entre-temps ne s'accepte plus.
 */
async function answerTransfer(userId, transferId, accept) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM tableau_note_transfers
        WHERE id = $1 AND to_user_id = $2 AND status = 'pending' FOR UPDATE`,
      [transferId, userId],
    );
    const t = rows[0];
    if (!t) throw httpError(404, 'Envoi introuvable, déjà traité ou annulé');

    if (accept) {
      const z = await topZ(client, userId);
      if (t.mode === 'move' && t.note_id) {
        // Le post-it change de tableau et se pose en haut à gauche, au premier plan
        await client.query(
          `UPDATE tableau_notes
              SET owner_id = $2, in_transit = false, received_from = $3, x = 40, y = 40, z = $4,
                  updated_at = ${PARIS_NOW}
            WHERE id = $1`,
          [t.note_id, userId, t.from_user_id, z],
        );
      } else {
        await client.query(
          `INSERT INTO tableau_notes (owner_id, content, color, x, y, z, received_from)
           VALUES ($1, $2, $3, 40, 40, $4, $5)`,
          [userId, t.content, t.color, z, t.from_user_id],
        );
      }
    } else if (t.mode === 'move' && t.note_id) {
      // Refus : le post-it réapparaît chez l'expéditeur, à sa place d'origine
      await client.query('UPDATE tableau_notes SET in_transit = false WHERE id = $1', [t.note_id]);
    }

    await client.query(
      `UPDATE tableau_note_transfers SET status = $2, answered_at = ${PARIS_NOW} WHERE id = $1`,
      [t.id, accept ? 'accepted' : 'refused'],
    );
    await client.query('COMMIT');
    notify([userId, t.from_user_id], 'transfer');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** L'expéditeur reprend un envoi resté sans réponse. */
async function cancelTransfer(userId, transferId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE tableau_note_transfers
          SET status = 'cancelled', answered_at = ${PARIS_NOW}, sender_seen_at = ${PARIS_NOW}
        WHERE id = $1 AND from_user_id = $2 AND status = 'pending'
        RETURNING note_id, mode, to_user_id`,
      [transferId, userId],
    );
    if (!rows[0]) throw httpError(404, 'Envoi introuvable ou déjà traité');
    if (rows[0].mode === 'move' && rows[0].note_id) {
      await client.query('UPDATE tableau_notes SET in_transit = false WHERE id = $1', [rows[0].note_id]);
    }
    await client.query('COMMIT');
    notify([userId, rows[0].to_user_id], 'transfer');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** L'expéditeur a lu la réponse (acceptée ou refusée). */
async function markTransferSeen(userId, transferId) {
  await pool.query(
    `UPDATE tableau_note_transfers SET sender_seen_at = ${PARIS_NOW}
      WHERE id = $1 AND from_user_id = $2 AND status IN ('accepted', 'refused')`,
    [transferId, userId],
  );
  notify([userId], 'transfer');
}

/* ─── Tâches récurrentes ────────────────────────────────── */

const TASK_COLUMNS = `t.id, t.title, t.notes, t.unit, t.every, t.weekdays, t.month_day,
  to_char(t.start_date, 'YYYY-MM-DD') AS start_date,
  to_char(t.due_time, 'HH24:MI') AS due_time,
  t.remind_minutes, t.email_remind_minutes,
  to_char(t.next_due, 'YYYY-MM-DD') AS next_due`;

/** Moment du rappel de l'échéance courante, en heure Paris. */
const REMINDER_AT = "(t.next_due + t.due_time - make_interval(mins => t.remind_minutes))";

async function getTasks(userId) {
  const { rows } = await pool.query(
    `SELECT ${TASK_COLUMNS},
            to_char(c.done_at, 'YYYY-MM-DD HH24:MI') AS last_done_at
       FROM tableau_tasks t
       LEFT JOIN LATERAL (
         SELECT done_at FROM tableau_task_completions
          WHERE task_id = t.id ORDER BY done_at DESC, id DESC LIMIT 1
       ) c ON true
      WHERE t.owner_id = $1
      ORDER BY t.next_due, t.due_time NULLS LAST, t.id`,
    [userId],
  );
  return { today: parisToday(), tasks: rows };
}

function normalizeTask(input) {
  const title = String(input.title || '').trim();
  if (!title) throw httpError(400, 'Le titre est obligatoire');
  let rule;
  try {
    rule = normalizeRule(input);
  } catch (e) {
    throw httpError(400, e.message);
  }
  const dueTime = /^\d{2}:\d{2}$/.test(input.due_time || '') ? input.due_time : null;
  // Un rappel se cale sur l'heure de la tâche : sans heure, pas de rappel
  const minutesBefore = (v) => {
    if (!dueTime || v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 60 * 24 * 60) throw httpError(400, 'Rappel invalide');
    return n;
  };
  return {
    title,
    notes: String(input.notes || '').trim() || null,
    rule,
    dueTime,
    remind: minutesBefore(input.remind_minutes),
    emailRemind: minutesBefore(input.email_remind_minutes),
  };
}

async function createTask(userId, input) {
  const { title, notes, rule, dueTime, remind, emailRemind } = normalizeTask(input);
  const nextDue = nextOccurrence(rule, addDays(rule.start_date, -1));
  const { rows } = await pool.query(
    `INSERT INTO tableau_tasks
       (owner_id, title, notes, unit, every, weekdays, month_day, start_date, due_time, remind_minutes,
        email_remind_minutes, next_due)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [userId, title, notes, rule.unit, rule.every, rule.weekdays, rule.month_day, rule.start_date,
      dueTime, remind, emailRemind, nextDue],
  );
  notify([userId], 'task');
  return rows[0].id;
}

/**
 * Modifier le titre, la note, l'heure ou le rappel ne touche pas à l'échéance en
 * cours (une tâche en retard le reste). Seul un changement de RÈGLE la recalcule,
 * à partir d'aujourd'hui.
 */
async function updateTask(userId, id, input) {
  const { title, notes, rule, dueTime, remind, emailRemind } = normalizeTask(input);
  const { rows } = await pool.query(
    `SELECT unit, every, weekdays, month_day, to_char(start_date, 'YYYY-MM-DD') AS start_date,
            to_char(next_due, 'YYYY-MM-DD') AS next_due
       FROM tableau_tasks WHERE id = $1 AND owner_id = $2`,
    [id, userId],
  );
  const cur = rows[0];
  if (!cur) throw httpError(404, 'Tâche introuvable');

  const sameRule = cur.unit === rule.unit && cur.every === rule.every
    && JSON.stringify(cur.weekdays || null) === JSON.stringify(rule.weekdays)
    && (cur.month_day || null) === rule.month_day && cur.start_date === rule.start_date;
  const from = rule.start_date > parisToday() ? rule.start_date : parisToday();
  const nextDue = sameRule ? cur.next_due : nextOccurrence(rule, addDays(from, -1));

  await pool.query(
    `UPDATE tableau_tasks
        SET title = $3, notes = $4, unit = $5, every = $6, weekdays = $7, month_day = $8,
            start_date = $9, due_time = $10, remind_minutes = $11, email_remind_minutes = $12,
            next_due = $13, updated_at = ${PARIS_NOW}
      WHERE id = $1 AND owner_id = $2`,
    [id, userId, title, notes, rule.unit, rule.every, rule.weekdays, rule.month_day, rule.start_date,
      dueTime, remind, emailRemind, nextDue],
  );
  notify([userId], 'task');
}

async function deleteTask(userId, id) {
  const { rowCount } = await pool.query('DELETE FROM tableau_tasks WHERE id = $1 AND owner_id = $2', [id, userId]);
  if (!rowCount) throw httpError(404, 'Tâche introuvable');
  notify([userId], 'task');
}

const ruleOf = (t) => ({
  unit: t.unit, every: t.every, weekdays: t.weekdays, month_day: t.month_day, start_date: t.start_date,
});

/**
 * « Fait » : solde l'échéance en cours et passe à la suivante. Une tâche en retard
 * repart sur la première échéance APRÈS aujourd'hui (pas d'empilement) ; une tâche
 * faite en avance passe simplement à l'échéance d'après.
 */
async function completeTask(userId, id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT unit, every, weekdays, month_day, to_char(start_date, 'YYYY-MM-DD') AS start_date,
              to_char(next_due, 'YYYY-MM-DD') AS next_due
         FROM tableau_tasks WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
      [id, userId],
    );
    const t = rows[0];
    if (!t) throw httpError(404, 'Tâche introuvable');
    const today = parisToday();
    const nextDue = nextOccurrence(ruleOf(t), t.next_due > today ? t.next_due : today);
    await client.query('INSERT INTO tableau_task_completions (task_id, due_date) VALUES ($1, $2)', [id, t.next_due]);
    await client.query(
      `UPDATE tableau_tasks SET next_due = $2, updated_at = ${PARIS_NOW} WHERE id = $1`,
      [id, nextDue],
    );
    await client.query('COMMIT');
    notify([userId], 'task');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Annule le dernier « fait » : l'échéance qu'il avait soldée redevient la courante. */
async function undoTask(userId, id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT c.id, to_char(c.due_date, 'YYYY-MM-DD') AS due_date
         FROM tableau_task_completions c
         JOIN tableau_tasks t ON t.id = c.task_id
        WHERE c.task_id = $1 AND t.owner_id = $2
        ORDER BY c.done_at DESC, c.id DESC LIMIT 1
        FOR UPDATE OF t`,
      [id, userId],
    );
    if (!rows[0]) throw httpError(404, 'Rien à annuler');
    await client.query('DELETE FROM tableau_task_completions WHERE id = $1', [rows[0].id]);
    await client.query(
      `UPDATE tableau_tasks SET next_due = $2, updated_at = ${PARIS_NOW} WHERE id = $1`,
      [id, rows[0].due_date],
    );
    await client.query('COMMIT');
    notify([userId], 'task');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Ferme le rappel de l'échéance en cours (il reviendra pour la suivante). */
async function dismissReminder(userId, id) {
  await pool.query(
    'UPDATE tableau_tasks SET reminder_dismissed_for = next_due WHERE id = $1 AND owner_id = $2',
    [id, userId],
  );
  notify([userId], 'task');
}

/* ─── Tâche de fond (chaque minute) ─────────────────────── */

const EMAIL_AT = "(t.next_due + t.due_time - make_interval(mins => t.email_remind_minutes))";
const APP_URL = 'https://apps.youvape.fr/tableau/recurrentes';

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

/**
 * Rappels à l'écran arrivés à leur heure depuis le dernier passage : on prévient
 * les navigateurs ouverts tout de suite, sans attendre leur relecture de secours.
 */
async function pushDueReminders() {
  const { rows } = await pool.query(
    `SELECT DISTINCT t.owner_id
       FROM tableau_tasks t
      WHERE t.due_time IS NOT NULL AND t.remind_minutes IS NOT NULL
        AND ${REMINDER_AT} <= ${PARIS_NOW}
        AND ${REMINDER_AT} > ${PARIS_NOW} - interval '75 seconds'
        AND t.reminder_dismissed_for IS DISTINCT FROM t.next_due`,
  );
  notify(rows.map((r) => r.owner_id), 'reminder');
}

/**
 * Rappels par email : un seul par échéance (`email_sent_for`). L'échéance est
 * RÉSERVÉE avant l'envoi, pour qu'un passage qui chevauche le suivant ne double
 * pas le message ; rendue si l'envoi échoue, pour retenter à la minute suivante.
 *
 * Une échéance passée depuis plus de 15 min n'envoie plus rien : sans ça, une
 * tâche déjà en retard à l'enregistrement enverrait un email inutile.
 */
async function sendEmailReminders(sendMail) {
  const { rows } = await pool.query(
    `UPDATE tableau_tasks t
        SET email_sent_for = t.next_due
       FROM users u
      WHERE u.id = t.owner_id AND u.disabled_at IS NULL
        AND t.due_time IS NOT NULL AND t.email_remind_minutes IS NOT NULL
        AND ${EMAIL_AT} <= ${PARIS_NOW}
        AND (t.next_due + t.due_time) >= ${PARIS_NOW} - interval '15 minutes'
        AND t.email_sent_for IS DISTINCT FROM t.next_due
      RETURNING t.id, t.title, t.notes, t.unit, t.every, t.weekdays, t.month_day,
                to_char(t.next_due, 'YYYY-MM-DD') AS next_due,
                to_char(t.due_time, 'HH24:MI') AS due_time, u.email`,
  );

  for (const t of rows) {
    const [y, m, d] = t.next_due.split('-');
    const when = `le ${d}/${m}/${y} à ${t.due_time.replace(':', 'h')}`;
    const notesHtml = t.notes
      ? `<p style="margin:0 0 16px;color:#4B5563;white-space:pre-wrap">${escapeHtml(t.notes)}</p>`
      : '';
    const result = await sendMail({
      to: t.email,
      subject: `Rappel : ${t.title}`,
      text: `Rappel : ${t.title}\nPrévu ${when}.\n${t.notes ? `\n${t.notes}\n` : ''}\nVos tâches : ${APP_URL}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1F2937;max-width:560px">
        <p style="margin:0 0 6px;font-size:12px;color:#CA8A04;font-weight:bold;text-transform:uppercase">Tableau · tâche récurrente</p>
        <h2 style="margin:0 0 8px;font-size:18px">${escapeHtml(t.title)}</h2>
        <p style="margin:0 0 16px">Prévu <strong>${when}</strong>.</p>
        ${notesHtml}
        <p style="margin:0"><a href="${APP_URL}" style="color:#CA8A04;font-weight:bold">Ouvrir mes tâches</a></p>
      </div>`,
    });
    if (!result?.success) {
      console.error(`Tableau : rappel email non envoyé (tâche ${t.id}) — ${result?.error || 'erreur inconnue'}`);
      await pool.query(
        'UPDATE tableau_tasks SET email_sent_for = NULL WHERE id = $1 AND email_sent_for = $2',
        [t.id, t.next_due],
      );
    }
  }
  return rows.length;
}

/* ─── Boîte de réception (interrogée toutes les minutes) ── */

async function getInbox(userId) {
  const [incoming, answers, sent, reminders] = await Promise.all([
    pool.query(
      `SELECT t.id, t.mode, t.content, t.color, ${USER_NAME('u')} AS from_name,
              to_char(t.created_at, 'YYYY-MM-DD HH24:MI') AS created_at
         FROM tableau_note_transfers t JOIN users u ON u.id = t.from_user_id
        WHERE t.to_user_id = $1 AND t.status = 'pending'
        ORDER BY t.created_at`,
      [userId],
    ),
    pool.query(
      `SELECT t.id, t.mode, t.content, t.color, t.status, ${USER_NAME('u')} AS to_name,
              to_char(t.answered_at, 'YYYY-MM-DD HH24:MI') AS answered_at
         FROM tableau_note_transfers t JOIN users u ON u.id = t.to_user_id
        WHERE t.from_user_id = $1 AND t.status IN ('accepted', 'refused') AND t.sender_seen_at IS NULL
        ORDER BY t.answered_at`,
      [userId],
    ),
    pool.query(
      `SELECT t.id, t.mode, t.content, t.color, ${USER_NAME('u')} AS to_name,
              to_char(t.created_at, 'YYYY-MM-DD HH24:MI') AS created_at
         FROM tableau_note_transfers t JOIN users u ON u.id = t.to_user_id
        WHERE t.from_user_id = $1 AND t.status = 'pending'
        ORDER BY t.created_at`,
      [userId],
    ),
    pool.query(
      `SELECT t.id, t.title, to_char(t.next_due, 'YYYY-MM-DD') AS next_due,
              to_char(t.due_time, 'HH24:MI') AS due_time, t.remind_minutes
         FROM tableau_tasks t
        WHERE t.owner_id = $1
          AND t.due_time IS NOT NULL AND t.remind_minutes IS NOT NULL
          AND ${REMINDER_AT} <= ${PARIS_NOW}
          AND t.reminder_dismissed_for IS DISTINCT FROM t.next_due
        ORDER BY t.next_due, t.due_time`,
      [userId],
    ),
  ]);
  return {
    incoming: incoming.rows,
    answers: answers.rows,
    sent: sent.rows,
    reminders: reminders.rows,
  };
}

module.exports = {
  COLORS,
  getRecipients,
  getNotes, createNote, updateNote, deleteNote,
  sendNote, answerTransfer, cancelTransfer, markTransferSeen,
  getTasks, createTask, updateTask, deleteTask, completeTask, undoTask, dismissReminder,
  getInbox,
  pushDueReminders, sendEmailReminders,
};
