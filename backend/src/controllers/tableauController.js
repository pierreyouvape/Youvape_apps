const jwt = require('jsonwebtoken');
const tableauModel = require('../models/tableauModel');
const tableauEvents = require('../services/tableauEvents');

/** Enveloppe commune : erreurs métier (statusCode) renvoyées telles quelles. */
const handle = (fn) => async (req, res) => {
  try {
    const result = await fn(req);
    res.json(result === undefined ? { success: true } : result);
  } catch (error) {
    if (!error.statusCode) console.error('Tableau :', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
};

const uid = (req) => req.user.id;
const id = (req) => Number(req.params.id);

exports.getRecipients = handle((req) => tableauModel.getRecipients(uid(req)));
exports.getInbox = handle((req) => tableauModel.getInbox(uid(req)));

exports.getNotes = handle((req) => tableauModel.getNotes(uid(req)));
exports.createNote = handle((req) => tableauModel.createNote(uid(req), req.body || {}));
exports.updateNote = handle((req) => tableauModel.updateNote(uid(req), id(req), req.body || {}));
exports.deleteNote = handle((req) => tableauModel.deleteNote(uid(req), id(req)));

exports.sendNote = handle((req) => tableauModel.sendNote(uid(req), req.body || {}));
exports.acceptTransfer = handle((req) => tableauModel.answerTransfer(uid(req), id(req), true));
exports.refuseTransfer = handle((req) => tableauModel.answerTransfer(uid(req), id(req), false));
exports.cancelTransfer = handle((req) => tableauModel.cancelTransfer(uid(req), id(req)));
exports.markTransferSeen = handle((req) => tableauModel.markTransferSeen(uid(req), id(req)));

exports.getTasks = handle((req) => tableauModel.getTasks(uid(req)));
exports.createTask = handle(async (req) => ({ id: await tableauModel.createTask(uid(req), req.body || {}) }));
exports.updateTask = handle((req) => tableauModel.updateTask(uid(req), id(req), req.body || {}));
exports.deleteTask = handle((req) => tableauModel.deleteTask(uid(req), id(req)));
exports.completeTask = handle((req) => tableauModel.completeTask(uid(req), id(req)));
exports.undoTask = handle((req) => tableauModel.undoTask(uid(req), id(req)));
exports.dismissReminder = handle((req) => tableauModel.dismissReminder(uid(req), id(req)));

/* ─── Temps réel (SSE) ──────────────────────────────────── */

/**
 * EventSource ne pose pas d'en-tête Authorization : le navigateur demande ici,
 * avec sa session, un jeton de 2 min limité au flux Tableau, passé dans l'URL
 * (même montage que le SAV, cf. savRoutes). Il ne sert qu'à OUVRIR le flux.
 */
const STREAM_SCOPE = 'tableau-stream';

exports.streamToken = (req, res) => {
  const token = jwt.sign(
    { id: req.user.id, email: req.user.email, scope: STREAM_SCOPE },
    process.env.JWT_SECRET,
    { expiresIn: '2m' },
  );
  res.json({ success: true, token });
};

exports.streamAuth = (req, res, next) => {
  try {
    const decoded = jwt.verify(String(req.query.st || ''), process.env.JWT_SECRET);
    if (decoded.scope !== STREAM_SCOPE) throw new Error('portée invalide');
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Jeton de flux manquant ou expiré' });
  }
};

/** Flux du compte connecté : un événement `change` à chaque changement le concernant. */
exports.stream = (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.flush?.();
  };
  const onChange = (data) => send('change', data);
  tableauEvents.subscribe(req.user.id, onChange);

  // Heartbeat : nginx et Cloudflare coupent un flux resté muet
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
    res.flush?.();
  }, 15000);
  send('hello', { ok: true });

  req.on('close', () => {
    clearInterval(heartbeat);
    tableauEvents.unsubscribe(req.user.id, onChange);
    res.end();
  });
};
