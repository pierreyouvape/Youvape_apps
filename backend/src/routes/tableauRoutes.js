const express = require('express');
const router = express.Router();
const tableauController = require('../controllers/tableauController');
const multer = require('multer');
const { checkPermission } = require('../middleware/permissionMiddleware');
const { MAX_IMAGE_SIZE } = require('../utils/tableauMedia');

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE, files: 1 },
});

// Sans ce gestionnaire, une image trop lourde repartirait en 500 HTML
const uploadImage = (req, res, next) => {
  memoryUpload.single('image')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: `Image trop lourde (${Math.round(MAX_IMAGE_SIZE / 1048576)} Mo maximum)` });
    }
    console.error('[Tableau] upload :', err);
    return res.status(400).json({ error: "L'envoi de l'image a échoué" });
  });
};

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
// Jeton d'ouverture du flux temps réel (le flux lui-même est monté dans server.js)
router.post('/stream-token', tableauController.streamToken);
router.get('/recipients', tableauController.getRecipients);

router.get('/notes', tableauController.getNotes);
router.post('/notes', tableauController.createNote);
// Image collée seule sur le tableau (multipart : image + x, y, width, height)
router.post('/notes/image', uploadImage, tableauController.createImage);
// Image insérée dans le texte d'un post-it : renvoie son lien signé
router.post('/media', uploadImage, tableauController.uploadMedia);
router.patch('/notes/:id', tableauController.updateNote);
router.delete('/notes/:id', tableauController.deleteNote);
// Rappel unique d'un post-it : { remind_at, screen, email } ; DELETE = retirer, ou « OK »
router.put('/notes/:id/reminder', tableauController.setNoteReminder);
router.delete('/notes/:id/reminder', tableauController.clearNoteReminder);

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
