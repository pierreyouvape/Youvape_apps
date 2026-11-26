const express = require('express');
const router = express.Router();
const c = require('../controllers/tachesController');
const { checkPermission, checkAdmin } = require('../middleware/permissionMiddleware');

/*
 * App Tâches — tâches d'équipe en étapes enchaînées (remplace Monday + Make).
 *
 * Le JWT est posé au montage dans server.js. Le droit `taches` en LECTURE suffit
 * pour travailler (créer, cocher, commenter, archiver, supprimer une étape) :
 * toute l'équipe tient le même tableau. Supprimer une tâche, modifier les
 * modèles, les tableaux et les groupes demandent l'ÉCRITURE ; les réglages
 * Slack (URL secrète du webhook) sont réservés aux admins.
 */
const read = checkPermission('taches', 'read');
const write = checkPermission('taches', 'write');

router.use(read);

router.get('/members', c.getMembers);
router.get('/labels', c.getLabels);
router.get('/board', c.getBoard);
router.get('/search', c.search);

router.get('/boards', c.getBoards);
router.post('/boards', write, c.createBoard);
router.put('/boards/:id', write, c.updateBoard);
router.delete('/boards/:id', write, c.deleteBoard);
router.post('/boards/:id/groups', write, c.createGroup);
router.put('/groups/:id', write, c.updateGroup);
router.delete('/groups/:id', write, c.deleteGroup);
router.get('/mine', c.getMine);

// Cloche : notifications de l'utilisateur connecté (bornées à req.user.id)
router.get('/notifications', c.getNotifications);
router.get('/notifications/count', c.countNotifications);
router.post('/notifications/read-all', c.markAllNotifications);
router.post('/notifications/:id/read', c.markNotification);

router.get('/templates', c.getTemplates);
router.post('/templates', write, c.createTemplate);
router.put('/templates/:id', write, c.updateTemplate);
router.delete('/templates/:id', write, c.deleteTemplate);

router.get('/slack', checkAdmin, c.getSlack);
router.put('/slack', checkAdmin, c.saveSlack);
router.post('/slack/test', checkAdmin, c.testSlack);

router.post('/tasks', c.createTask);
router.post('/tasks/bulk', c.bulk);
router.post('/tasks/reorder', c.reorderTasks);
router.get('/tasks/:id', c.getTask);
router.patch('/tasks/:id', c.updateTask);
router.delete('/tasks/:id', write, c.deleteTask);
router.post('/tasks/:id/steps', c.addStep);
router.post('/tasks/:id/comments', c.addComment);
router.post('/tasks/:id/steps/reorder', c.reorderSteps);

router.patch('/steps/:id', c.updateStep);
router.post('/steps/:id/move', c.moveStep);
router.delete('/steps/:id', c.deleteStep);

router.delete('/comments/:id', c.deleteComment);

module.exports = router;
