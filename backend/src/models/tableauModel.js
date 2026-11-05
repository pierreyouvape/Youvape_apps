const pool = require('../config/database');
const userPermissionsModel = require('./userPermissionsModel');
const { normalizeRule, nextOccurrence, parisToday, addDays } = require('../services/tableauRecurrence');
const { notify } = require('../services/tableauEvents');
const media = require('../utils/tableauMedia');

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

/*
 * Post-its PARTAGÉS (tableau_note_shares) : un seul post-it, visible sur le
 * tableau du propriétaire et de chaque participant qui a accepté. Le contenu
 * (texte, images, PDF) et la couleur sont communs ; la place sur le tableau
 * (x, y, taille, plan) est propre à chacun — celle du propriétaire sur
 * tableau_notes, celle d'un participant sur sa ligne de partage. Le rappel reste
 * au propriétaire. `s` = la ligne de partage du compte qui lit (NULL s'il est
 * propriétaire).
 */
const MINE = '(n.owner_id = $1)';
const NOTE_COLUMNS = `n.id, n.kind, n.content, n.color, n.owner_id,
  COALESCE(s.x, n.x) AS x, COALESCE(s.y, n.y) AS y,
  COALESCE(s.width, n.width) AS width, COALESCE(s.height, n.height) AS height, COALESCE(s.z, n.z) AS z,
  n.image_file, ${MINE} AS is_owner, ${USER_NAME('ow')} AS owner_name,
  CASE WHEN ${MINE} THEN to_char(n.remind_at, 'YYYY-MM-DD HH24:MI') END AS remind_at,
  ${MINE} AND n.remind_screen AS remind_screen, ${MINE} AND n.remind_email AS remind_email,
  (${MINE} AND n.remind_at IS NOT NULL AND n.remind_screen AND n.remind_at <= ${PARIS_NOW}) AS remind_due,
  ${USER_NAME('rf')} AS received_from_name,
  COALESCE((SELECT json_agg(json_build_object('id', su.id, 'name', ${USER_NAME('su')},
                                              'pending', sh.accepted_at IS NULL) ORDER BY sh.created_at)
              FROM tableau_note_shares sh JOIN users su ON su.id = sh.user_id
             WHERE sh.note_id = n.id), '[]') AS shared_with`;

const NOTE_FROM = `tableau_notes n
  LEFT JOIN tableau_note_shares s ON s.note_id = n.id AND s.user_id = $1 AND s.accepted_at IS NOT NULL
  LEFT JOIN users rf ON rf.id = n.received_from
  JOIN users ow ON ow.id = n.owner_id`;
const VISIBLE = `(n.owner_id = $1 OR s.user_id IS NOT NULL) AND NOT n.in_transit`;

/**
 * kind = 'note' : post-it, `content` en HTML (images comprises).
 * kind = 'image' : image posée seule, `image_file`.
 * Les liens d'images sont signés à chaque lecture.
 */
const toClient = ({ image_file: file, ...n }) => ({
  ...n,
  content: media.signHtml(media.asHtml(n.content)),
  image_url: media.signedUrl(file),
});

async function getNotes(userId) {
  const { rows } = await pool.query(
    `SELECT ${NOTE_COLUMNS} FROM ${NOTE_FROM}
      WHERE ${VISIBLE}
      ORDER BY COALESCE(s.z, n.z), n.id`,
    [userId],
  );
  return rows.map(toClient);
}

async function getNote(userId, id) {
  const { rows } = await pool.query(
    `SELECT ${NOTE_COLUMNS} FROM ${NOTE_FROM}
      WHERE n.id = $2 AND ${VISIBLE}`,
    [userId, id],
  );
  if (!rows[0]) throw httpError(404, 'Post-it introuvable');
  return toClient(rows[0]);
}

/**
 * Accès d'un compte à un post-it : 'owner', 'member' (partage accepté) ou 404.
 * Renvoie aussi la liste de tous les participants (propriétaire compris), pour
 * les prévenir d'un changement.
 */
async function noteAccess(client, userId, id, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT n.id, n.kind, n.content, n.color, n.owner_id, n.width, n.height,
            (n.owner_id = $2) AS is_owner,
            EXISTS (SELECT 1 FROM tableau_note_shares s
                     WHERE s.note_id = n.id AND s.user_id = $2 AND s.accepted_at IS NOT NULL) AS is_member
       FROM tableau_notes n
      WHERE n.id = $1 AND NOT n.in_transit${lock ? ' FOR UPDATE OF n' : ''}`,
    [id, userId],
  );
  const note = rows[0];
  if (!note || (!note.is_owner && !note.is_member)) throw httpError(404, 'Post-it introuvable');
  const shares = await client.query('SELECT user_id, accepted_at FROM tableau_note_shares WHERE note_id = $1', [id]);
  note.shares = shares.rows;
  note.participants = [note.owner_id, ...shares.rows.filter((r) => r.accepted_at).map((r) => r.user_id)];
  return note;
}

/** Prévient les AUTRES participants d'un post-it partagé : leur tableau se relit. */
const notifyOthers = (participants, userId) =>
  notify(participants.filter((p) => Number(p) !== Number(userId)), 'notes');

/** Plan au-dessus de tous les post-its du compte (les siens et ceux partagés avec lui). */
async function topZ(client, userId) {
  const { rows } = await client.query(
    `SELECT GREATEST(
              (SELECT COALESCE(MAX(z), 0) FROM tableau_notes WHERE owner_id = $1),
              (SELECT COALESCE(MAX(z), 0) FROM tableau_note_shares WHERE user_id = $1)) + 1 AS z`,
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
    [userId, media.stripSignatures(String(input.content || '')), color, clampInt(input.x, 0, 20000), clampInt(input.y, 0, 20000), z],
  );
  return getNote(userId, rows[0].id);
}

/** Image collée seule sur le tableau (taille d'affichage calculée par le navigateur). */
async function createImage(userId, file, input) {
  const filename = await media.saveImage(file);
  const z = await topZ(pool, userId);
  const { rows } = await pool.query(
    `INSERT INTO tableau_notes (owner_id, kind, image_file, x, y, width, height, z)
     VALUES ($1, 'image', $2, $3, $4, $5, $6, $7) RETURNING id`,
    [userId, filename, clampInt(input.x, 0, 20000), clampInt(input.y, 0, 20000),
      clampInt(input.width, 40, 2000), clampInt(input.height, 40, 2000), z],
  );
  return getNote(userId, rows[0].id);
}

/** Image ou PDF inséré dans le texte d'un post-it : l'éditeur reçoit son lien signé. */
async function uploadMedia(file) {
  const { filename, kind } = await media.saveMedia(file);
  // multer lit le nom en latin1 : « Reçu.pdf » arriverait en « ReÃ§u.pdf »
  const name = Buffer.from(file.originalname || '', 'latin1').toString('utf8').replace(/[<>"]/g, '').slice(0, 200);
  return { url: media.signedUrl(filename), kind, name: name || (kind === 'pdf' ? 'document.pdf' : kind === 'file' ? 'fichier' : '') };
}

/**
 * Mise à jour partielle : seuls les champs fournis sont écrits. Contenu et
 * couleur sont communs à tous les participants d'un post-it partagé (prévenus
 * aussitôt) ; la place est propre à chacun.
 */
async function updateNote(userId, id, input) {
  const note = await noteAccess(pool, userId, id);
  const shared = [];
  const layout = [];
  const params = [id];
  const set = (list, col, val) => { params.push(val); list.push(`${col} = $${params.length}`); };

  if (input.content !== undefined) set(shared, 'content', media.stripSignatures(input.content));
  if (input.color !== undefined) {
    if (!COLORS.includes(input.color)) throw httpError(400, 'Couleur inconnue');
    set(shared, 'color', input.color);
  }
  if (input.x !== undefined) set(layout, 'x', clampInt(input.x, 0, 20000));
  if (input.y !== undefined) set(layout, 'y', clampInt(input.y, 0, 20000));
  if (input.width !== undefined) set(layout, 'width', clampInt(input.width, 40, 2000));
  if (input.height !== undefined) set(layout, 'height', clampInt(input.height, 40, 2000));
  if (input.z !== undefined) set(layout, 'z', clampInt(input.z, 0, 1000000));

  const noteSets = note.is_owner ? [...shared, ...layout] : shared;
  if (noteSets.length) {
    await pool.query(
      `UPDATE tableau_notes SET ${noteSets.join(', ')}, updated_at = ${PARIS_NOW} WHERE id = $1`,
      params,
    );
  }
  if (!note.is_owner && layout.length) {
    params.push(userId);
    await pool.query(
      `UPDATE tableau_note_shares SET ${layout.join(', ')} WHERE note_id = $1 AND user_id = $${params.length}`,
      params,
    );
  }
  if (shared.length) notifyOthers(note.participants, userId);
  return getNote(userId, id);
}

/**
 * Rappel unique d'un post-it : { remind_at: 'YYYY-MM-DD HH:MM', screen, email }.
 * Personnel : il ne suit pas le post-it envoyé ou copié.
 */
async function setNoteReminder(userId, id, input) {
  const at = String(input.remind_at || '').replace('T', ' ');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(at)) throw httpError(400, 'Date et heure du rappel invalides');
  const screen = input.screen === true;
  const email = input.email === true;
  if (!screen && !email) throw httpError(400, 'Choisissez une notification, un email, ou les deux');
  const { rows } = await pool.query(
    `UPDATE tableau_notes
        SET remind_at = $3::timestamp, remind_screen = $4, remind_email = $5, remind_email_sent = false
      WHERE id = $1 AND owner_id = $2 AND kind = 'note' AND NOT in_transit
      RETURNING ($3::timestamp > ${PARIS_NOW}) AS future`,
    [id, userId, at, screen, email],
  );
  if (!rows[0]) throw httpError(404, 'Post-it introuvable');
  if (!rows[0].future) {
    await clearNoteReminder(userId, id);
    throw httpError(400, 'Cette date est déjà passée');
  }
  notify([userId], 'reminder');
  return getNote(userId, id);
}

/** Retire le rappel — c'est aussi le « OK » d'un rappel arrivé à son heure. */
async function clearNoteReminder(userId, id) {
  await pool.query(
    `UPDATE tableau_notes SET remind_at = NULL, remind_email_sent = false
      WHERE id = $1 AND owner_id = $2`,
    [id, userId],
  );
  notify([userId], 'reminder');
  return getNote(userId, id);
}

/**
 * Propriétaire : supprime le post-it, de tous les tableaux s'il est partagé.
 * Participant : le retire seulement de son tableau (il quitte le partage).
 */
async function deleteNote(userId, id) {
  const note = await noteAccess(pool, userId, id);
  if (!note.is_owner) {
    await pool.query('DELETE FROM tableau_note_shares WHERE note_id = $1 AND user_id = $2', [id, userId]);
    notifyOthers(note.participants, userId);
    return;
  }
  const { rows } = await pool.query(
    `DELETE FROM tableau_notes WHERE id = $1 AND owner_id = $2 AND NOT in_transit
     RETURNING content, image_file`,
    [id, userId],
  );
  if (!rows[0]) throw httpError(404, 'Post-it introuvable');
  media.removeFiles([rows[0].image_file, ...media.htmlFiles(rows[0].content)]);
  // Partage en attente compris : la proposition disparaît de sa boîte
  notify(note.shares.map((r) => r.user_id), 'notes');
}

/* ─── Partage ───────────────────────────────────────────── */

/**
 * Propose un post-it en partage. Le propriétaire comme un participant peuvent
 * inviter ; le destinataire accepte ou refuse depuis sa boîte de réception.
 */
async function shareNote(userId, id, toUserId) {
  const to = Number(toUserId);
  const recipients = await getRecipients(userId);
  if (!recipients.some((r) => r.id === to)) throw httpError(400, 'Destinataire inconnu ou sans accès à l\'app Tableau');
  const note = await noteAccess(pool, userId, id);
  if (note.kind !== 'note') throw httpError(400, 'Seuls les post-its se partagent');
  if (note.owner_id === to || note.shares.some((r) => r.user_id === to)) {
    throw httpError(400, 'Ce post-it est déjà partagé avec cette personne');
  }
  await pool.query(
    `INSERT INTO tableau_note_shares (note_id, user_id, shared_by, width, height)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
    [id, to, userId, note.width, note.height],
  );
  notify([to, ...note.participants], 'notes');
  return getNote(userId, id);
}

/** Accepter un partage : le post-it se pose en haut à gauche, au premier plan. */
async function acceptShare(userId, id) {
  const z = await topZ(pool, userId);
  const { rowCount } = await pool.query(
    `UPDATE tableau_note_shares SET accepted_at = ${PARIS_NOW}, x = 40, y = 40, z = $3
      WHERE note_id = $1 AND user_id = $2 AND accepted_at IS NULL`,
    [id, userId, z],
  );
  if (!rowCount) throw httpError(404, 'Partage introuvable, déjà traité ou annulé');
  const note = await noteAccess(pool, userId, id);
  notify(note.participants, 'notes');
}

/** Refuser un partage en attente. */
async function refuseShare(userId, id) {
  const { rows } = await pool.query(
    `DELETE FROM tableau_note_shares s USING tableau_notes n
      WHERE s.note_id = $1 AND s.user_id = $2 AND s.accepted_at IS NULL AND n.id = s.note_id
      RETURNING n.owner_id`,
    [id, userId],
  );
  if (!rows[0]) throw httpError(404, 'Partage introuvable, déjà traité ou annulé');
  const others = await pool.query(
    'SELECT user_id FROM tableau_note_shares WHERE note_id = $1 AND accepted_at IS NOT NULL',
    [id],
  );
  notify([userId, rows[0].owner_id, ...others.rows.map((r) => r.user_id)], 'notes');
}

/** Le propriétaire retire quelqu'un du partage (ou annule une proposition). */
async function unshareNote(userId, id, memberId) {
  const note = await noteAccess(pool, userId, id);
  if (!note.is_owner) throw httpError(403, 'Seul le propriétaire du post-it peut retirer quelqu\'un');
  const { rowCount } = await pool.query(
    'DELETE FROM tableau_note_shares WHERE note_id = $1 AND user_id = $2',
    [id, Number(memberId)],
  );
  if (!rowCount) throw httpError(404, 'Cette personne n\'a pas ce post-it');
  notify([...note.participants, Number(memberId)], 'notes');
  return getNote(userId, id);
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
    // Un participant peut en envoyer une copie ; seul le propriétaire le déplace,
    // et jamais tant qu'il est partagé (il quitterait le tableau des autres).
    const note = await noteAccess(client, userId, noteId, { lock: true });
    if (note.kind !== 'note') throw httpError(400, 'Seuls les post-its s\'envoient');
    if (mode === 'move' && !note.is_owner) throw httpError(403, 'Seul le propriétaire peut envoyer ce post-it');
    if (mode === 'move' && note.shares.length) {
      throw httpError(400, 'Post-it partagé : retirez le partage, ou envoyez une copie');
    }
    // Copie : ses propres exemplaires des images, dès l'envoi — l'original peut
    // être modifié ou supprimé avant la réponse.
    const content = mode === 'copy' ? media.copyHtmlImages(note.content).html : note.content;

    if (mode === 'move') {
      await client.query('UPDATE tableau_notes SET in_transit = true WHERE id = $1', [note.id]);
    }
    await client.query(
      `INSERT INTO tableau_note_transfers (note_id, mode, from_user_id, to_user_id, content, color)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [note.id, mode, userId, Number(toUserId), content, note.color],
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
                  remind_at = NULL, remind_email_sent = false,
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
    if (!accept && t.mode === 'copy') media.removeFiles(media.htmlFiles(t.content));
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
        RETURNING note_id, mode, to_user_id, content`,
      [transferId, userId],
    );
    if (!rows[0]) throw httpError(404, 'Envoi introuvable ou déjà traité');
    if (rows[0].mode === 'move' && rows[0].note_id) {
      await client.query('UPDATE tableau_notes SET in_transit = false WHERE id = $1', [rows[0].note_id]);
    }
    await client.query('COMMIT');
    if (rows[0].mode === 'copy') media.removeFiles(media.htmlFiles(rows[0].content));
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

/* ─── Nettoyage des images (chaque nuit) ────────────────── */

/** Supprime les fichiers que plus aucun post-it ni envoi en attente n'utilise. */
async function sweepMedia() {
  const [notes, transfers] = await Promise.all([
    pool.query('SELECT content, image_file FROM tableau_notes'),
    pool.query("SELECT content FROM tableau_note_transfers WHERE status = 'pending'"),
  ]);
  const referenced = new Set();
  notes.rows.forEach((n) => {
    if (n.image_file) referenced.add(n.image_file);
    media.htmlFiles(n.content).forEach((f) => referenced.add(f));
  });
  transfers.rows.forEach((t) => media.htmlFiles(t.content).forEach((f) => referenced.add(f)));
  return media.sweep(referenced);
}

/* ─── Tâche de fond (chaque minute) ─────────────────────── */

const EMAIL_AT = "(t.next_due + t.due_time - make_interval(mins => t.email_remind_minutes))";
const APP_URL = 'https://apps.youvape.fr/tableau/recurrentes';
const BOARD_URL = 'https://apps.youvape.fr/tableau/epingle';

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
        AND t.reminder_dismissed_for IS DISTINCT FROM t.next_due
     UNION
     SELECT n.owner_id
       FROM tableau_notes n
      WHERE n.remind_at IS NOT NULL AND n.remind_screen AND NOT n.in_transit
        AND n.remind_at <= ${PARIS_NOW}
        AND n.remind_at > ${PARIS_NOW} - interval '75 seconds'`,
  );
  notify(rows.map((r) => r.owner_id), 'reminder');
}

/** Texte d'un post-it (HTML) pour un email : sans balises, images et PDF comptés. */
function plainText(html) {
  const images = (String(html || '').match(/<img\b/g) || []).length;
  const pdfs = (String(html || '').match(/<div\b[^>]*data-type="pdf"/g) || []).length;
  const files = (String(html || '').match(/<div\b[^>]*data-type="file"/g) || []).length;
  const text = String(html || '')
    .replace(/<br\s*\/?>|<\/(p|li)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, images, pdfs, files };
}

/**
 * Rappels email des post-its : un seul envoi, réservé avant l'envoi et rendu en
 * cas d'échec. Un rappel email seul disparaît du post-it une fois parti ; avec
 * notification, il reste jusqu'au « OK ». Rattrapage limité à 12 h (backend
 * arrêté au moment voulu), au-delà l'email n'a plus de sens.
 */
async function sendNoteEmailReminders(sendMail) {
  const { rows } = await pool.query(
    `UPDATE tableau_notes n
        SET remind_email_sent = true
       FROM users u
      WHERE u.id = n.owner_id AND u.disabled_at IS NULL
        AND n.remind_at IS NOT NULL AND n.remind_email AND NOT n.remind_email_sent AND NOT n.in_transit
        AND n.remind_at <= ${PARIS_NOW}
        AND n.remind_at >= ${PARIS_NOW} - interval '12 hours'
      RETURNING n.id, n.owner_id, n.content, n.remind_screen,
                to_char(n.remind_at, 'DD/MM/YYYY à HH24"h"MI') AS at_label, u.email`,
  );
  for (const n of rows) {
    const { text, images, pdfs, files } = plainText(n.content);
    const imgs = [
      images ? `${images} image${images > 1 ? 's' : ''}` : '',
      pdfs ? `${pdfs} PDF` : '',
      files ? `${files} fichier${files > 1 ? 's' : ''}` : '',
    ].filter(Boolean).join(', ').replace(/^(.+)$/, '($1)');
    const firstLine = (text.split('\n')[0] || 'Post-it').slice(0, 70);
    const result = await sendMail({
      to: n.email,
      subject: `Rappel : ${firstLine}`,
      text: `Rappel programmé le ${n.at_label}.\n\n${text}${imgs ? `\n${imgs}` : ''}\n\nVotre tableau : ${BOARD_URL}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1F2937;max-width:560px">
        <p style="margin:0 0 6px;font-size:12px;color:#CA8A04;font-weight:bold;text-transform:uppercase">Tableau · rappel de post-it</p>
        <p style="margin:0 0 12px;color:#6B7280">Programmé le ${n.at_label}.</p>
        <div style="background:#FEF3C7;border-radius:6px;padding:12px 14px;margin:0 0 16px;white-space:pre-wrap">${escapeHtml(text) || '(post-it sans texte)'}${imgs ? `<br><em style="color:#6B7280">${imgs}</em>` : ''}</div>
        <p style="margin:0"><a href="${BOARD_URL}" style="color:#CA8A04;font-weight:bold">Ouvrir mon tableau</a></p>
      </div>`,
    });
    if (!result?.success) {
      console.error(`Tableau : rappel email de post-it non envoyé (${n.id}) — ${result?.error || 'erreur inconnue'}`);
      await pool.query('UPDATE tableau_notes SET remind_email_sent = false WHERE id = $1', [n.id]);
    } else if (!n.remind_screen) {
      await pool.query('UPDATE tableau_notes SET remind_at = NULL WHERE id = $1', [n.id]);
      notify([n.owner_id], 'reminder');
    }
  }
  return rows.length;
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
  const [incoming, answers, sent, reminders, noteReminders, shares] = await Promise.all([
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
    pool.query(
      `SELECT n.id, n.content, n.color, to_char(n.remind_at, 'YYYY-MM-DD HH24:MI') AS remind_at
         FROM tableau_notes n
        WHERE n.owner_id = $1 AND n.remind_at IS NOT NULL AND n.remind_screen AND NOT n.in_transit
          AND n.remind_at <= ${PARIS_NOW}
        ORDER BY n.remind_at`,
      [userId],
    ),
    pool.query(
      `SELECT n.id AS note_id, n.content, n.color, ${USER_NAME('u')} AS from_name, ${USER_NAME('ow')} AS owner_name,
              to_char(s.created_at, 'YYYY-MM-DD HH24:MI') AS created_at
         FROM tableau_note_shares s
         JOIN tableau_notes n ON n.id = s.note_id AND NOT n.in_transit
         JOIN users ow ON ow.id = n.owner_id
         LEFT JOIN users u ON u.id = s.shared_by
        WHERE s.user_id = $1 AND s.accepted_at IS NULL
        ORDER BY s.created_at`,
      [userId],
    ),
  ]);
  return {
    incoming: incoming.rows,
    answers: answers.rows,
    sent: sent.rows,
    reminders: reminders.rows,
    noteReminders: noteReminders.rows,
    shares: shares.rows,
  };
}

module.exports = {
  COLORS,
  getRecipients,
  getNotes, createNote, createImage, uploadMedia, updateNote, deleteNote, sweepMedia,
  shareNote, acceptShare, refuseShare, unshareNote,
  setNoteReminder, clearNoteReminder,
  sendNote, answerTransfer, cancelTransfer, markTransferSeen,
  getTasks, createTask, updateTask, deleteTask, completeTask, undoTask, dismissReminder,
  getInbox,
  pushDueReminders, sendEmailReminders, sendNoteEmailReminders,
};
