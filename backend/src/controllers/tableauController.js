const tableauModel = require('../models/tableauModel');

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
