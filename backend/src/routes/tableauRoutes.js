const express = require('express');
const router = express.Router();
const tableauController = require('../controllers/tableauController');
const { checkPermission } = require('../middleware/permissionMiddleware');

/*
 * App Tableau — post-its et tâches récurrentes, personnels.
 *
 * Le JWT est posé au montage dans server.js. Le droit `tableau` en LECTURE suffit
 * pour tout, écritures comprises : chacun n'écrit que dans son propre tableau
 * (toutes les requêtes sont bornées à `req.user.id`), il n'y a pas de donnée
 * commune à protéger d'un droit d'écriture.
 */
router.use(checkPermission('tableau', 'read'));

router.get('/inbox', tableauController.getInbox);
router.get('/recipients', tableauController.getRecipients);

router.get('/notes', tableauController.getNotes);
router.post('/notes', tableauController.createNote);
router.patch('/notes/:id', tableauController.updateNote);
router.delete('/notes/:id', tableauController.deleteNote);

// Envois de post-its : { note_id, to_user_id, mode: 'move' | 'copy' }
router.post('/transfers', tableauController.sendNote);
router.post('/transfers/:id/accept', tableauController.acceptTransfer);
router.post('/transfers/:id/refuse', tableauController.refuseTransfer);
router.post('/transfers/:id/cancel', tableauController.cancelTransfer);
router.post('/transfers/:id/seen', tableauController.markTransferSeen);

router.get('/tasks', tableauController.getTasks);
router.post('/tasks', tableauController.createTask);
router.put('/tasks/:id', tableauController.updateTask);
router.delete('/tasks/:id', tableauController.deleteTask);
router.post('/tasks/:id/done', tableauController.completeTask);
router.post('/tasks/:id/undo', tableauController.undoTask);
router.post('/tasks/:id/dismiss-reminder', tableauController.dismissReminder);

module.exports = router;
