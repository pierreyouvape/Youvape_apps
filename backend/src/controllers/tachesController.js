const tachesModel = require('../models/tachesModel');
const tachesSlack = require('../services/tachesSlack');
const userPermissionsModel = require('../models/userPermissionsModel');

/** Enveloppe commune : erreurs métier (statusCode) renvoyées telles quelles. */
const handle = (fn) => async (req, res) => {
  try {
    const result = await fn(req);
    res.json(result === undefined ? { success: true } : result);
  } catch (error) {
    if (!error.statusCode) console.error('Tâches :', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
};

const uid = (req) => req.user.id;
const id = (req) => Number(req.params.id);
const body = (req) => req.body || {};

exports.getMembers = handle(() => tachesModel.getMembers());
exports.getLabels = handle(() => tachesModel.getLabels());
exports.getBoards = handle(() => tachesModel.getBoards());
exports.getViews = handle(() => tachesModel.getViews());
exports.createView = handle((req) => tachesModel.saveView(uid(req), null, body(req)));
exports.updateView = handle((req) => tachesModel.saveView(uid(req), id(req), body(req)));
exports.deleteView = handle(async (req) => tachesModel.deleteView(uid(req), id(req), {
  canWrite: userPermissionsModel.isSuperAdmin(req.user.email)
    || await userPermissionsModel.hasPermission(uid(req), 'taches', 'write'),
}));
exports.setLayout = handle((req) => tachesModel.setLayout(id(req), body(req)));
exports.createColumn = handle((req) => tachesModel.createColumn(id(req), body(req)));
exports.updateColumn = handle((req) => tachesModel.updateColumn(id(req), body(req)));
exports.deleteColumn = handle((req) => tachesModel.deleteColumn(id(req)));
exports.setValue = handle((req) => tachesModel.setValue(uid(req), id(req), Number(req.params.columnId), body(req).value));
exports.createBoard = handle((req) => tachesModel.createBoard(body(req)));
exports.updateBoard = handle((req) => tachesModel.updateBoard(id(req), body(req)));
exports.deleteBoard = handle((req) => tachesModel.deleteBoard(id(req)));
exports.createGroup = handle((req) => tachesModel.createGroup(id(req), body(req)));
exports.updateGroup = handle((req) => tachesModel.updateGroup(id(req), body(req)));
exports.deleteGroup = handle((req) => tachesModel.deleteGroup(id(req)));

exports.getBoard = handle((req) => tachesModel.getBoard({
  boardId: Number(req.query.board) || null,
  archived: req.query.archived === '1',
}));
exports.search = handle((req) => tachesModel.search(req.query.q));
exports.getMine = handle((req) => tachesModel.getMine(uid(req)));
exports.getTask = handle((req) => tachesModel.getTask(id(req)));
exports.createTask = handle((req) => tachesModel.createTask(uid(req), body(req)));
exports.updateTask = handle((req) => tachesModel.updateTask(uid(req), id(req), body(req)));
exports.deleteTask = handle((req) => tachesModel.deleteTask(id(req)));
// Supprimer en masse demande l'écriture ; archiver / déplacer, non.
exports.bulk = handle(async (req) => tachesModel.bulk(uid(req), body(req), {
  canDelete: userPermissionsModel.isSuperAdmin(req.user.email)
    || await userPermissionsModel.hasPermission(uid(req), 'taches', 'write'),
}));

exports.addStep = handle((req) => tachesModel.addStep(uid(req), id(req), body(req)));
exports.updateStep = handle((req) => tachesModel.updateStep(uid(req), id(req), body(req)));
exports.moveStep = handle((req) => tachesModel.moveStep(uid(req), id(req), body(req).direction));
exports.deleteStep = handle((req) => tachesModel.deleteStep(uid(req), id(req)));

exports.addComment = handle((req) => tachesModel.addComment(uid(req), id(req), body(req)));
exports.deleteComment = handle((req) => tachesModel.deleteComment(uid(req), id(req)));

exports.getNotifications = handle((req) => tachesModel.getNotifications(uid(req), {
  tab: req.query.tab, unread: req.query.unread === '1', q: req.query.q,
}));
exports.countNotifications = handle(async (req) => ({ unread: await tachesModel.countUnread(uid(req)) }));
exports.markNotification = handle((req) => tachesModel.markNotification(uid(req), id(req), body(req).read !== false));
exports.markAllNotifications = handle((req) => tachesModel.markAllNotifications(uid(req)));
exports.reorderTasks = handle((req) => tachesModel.reorderTasks(uid(req), body(req)));
exports.reorderSteps = handle((req) => tachesModel.reorderSteps(uid(req), id(req), body(req)));

exports.getTemplates = handle(() => tachesModel.getTemplates());
exports.createTemplate = handle((req) => tachesModel.saveTemplate(null, body(req)));
exports.updateTemplate = handle((req) => tachesModel.saveTemplate(id(req), body(req)));
exports.deleteTemplate = handle((req) => tachesModel.deleteTemplate(id(req)));

exports.getSlack = handle(() => tachesSlack.getPublicConfig());
exports.saveSlack = handle((req) => tachesSlack.saveConfig(body(req)));
exports.testSlack = handle(async (req) => {
  const r = await tachesSlack.sendTest(req.user.name || req.user.email);
  if (!r.ok) {
    const e = new Error(r.error);
    e.statusCode = 502;
    throw e;
  }
  return r;
});
