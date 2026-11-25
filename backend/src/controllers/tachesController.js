const tachesModel = require('../models/tachesModel');
const tachesSlack = require('../services/tachesSlack');

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
exports.getBoard = handle((req) => tachesModel.getBoard({
  done: req.query.done === '1',
  archived: req.query.archived === '1',
}));
exports.getMine = handle((req) => tachesModel.getMine(uid(req)));
exports.getTask = handle((req) => tachesModel.getTask(id(req)));
exports.createTask = handle((req) => tachesModel.createTask(uid(req), body(req)));
exports.updateTask = handle((req) => tachesModel.updateTask(uid(req), id(req), body(req)));
exports.deleteTask = handle((req) => tachesModel.deleteTask(id(req)));

exports.addStep = handle((req) => tachesModel.addStep(uid(req), id(req), body(req)));
exports.updateStep = handle((req) => tachesModel.updateStep(uid(req), id(req), body(req)));
exports.moveStep = handle((req) => tachesModel.moveStep(uid(req), id(req), body(req).direction));
exports.deleteStep = handle((req) => tachesModel.deleteStep(uid(req), id(req)));

exports.addComment = handle((req) => tachesModel.addComment(uid(req), id(req), body(req)));
exports.deleteComment = handle((req) => tachesModel.deleteComment(uid(req), id(req)));

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
