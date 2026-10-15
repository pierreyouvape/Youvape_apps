const express = require('express');
const multer = require('multer');
const router = express.Router();
const storyController = require('../controllers/storyController');
const widgetController = require('../controllers/storyWidgetController');
const { checkPermission } = require('../middleware/permissionMiddleware');

/*
 * App « Stories » (remplacement de Join Stories).
 * Le JWT est posé au montage dans server.js ; ici, le droit applicatif `stories`.
 */
const read = checkPermission('stories', 'read');
const write = checkPermission('stories', 'write');

// Miniature envoyée : une image, 15 Mo au plus, gardée en mémoire le temps du traitement.
const coverUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
const coverFile = (req, res, next) => coverUpload.single('image')(req, res, (err) => {
  if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image trop lourde (15 Mo maximum)' : err.message });
  return next();
});

// Widgets, recherche produits et publication : AVANT /:id, sinon « widgets »
// serait pris pour l'identifiant d'une story.
router.get('/widgets', read, widgetController.list);
router.post('/widgets', write, widgetController.create);
router.get('/widgets/:id', read, widgetController.get);
router.put('/widgets/:id', write, widgetController.update);
router.delete('/widgets/:id', write, widgetController.remove);
router.put('/widgets/:id/stories', write, widgetController.setStories);
router.post('/widgets/:id/placements', write, widgetController.addPlacement);
router.delete('/widgets/:id/placements/:placementId', write, widgetController.removePlacement);
router.get('/products/search', read, widgetController.searchProducts);
router.post('/publish', write, widgetController.publish);

// Stories (vidéos)
router.get('/', read, storyController.list);
router.post('/', write, storyController.create);
router.get('/:id', read, storyController.get);
router.get('/:id/stats', read, storyController.stats);
router.put('/:id', write, storyController.update);
router.post('/:id/source', write, storyController.replaceSource);
router.post('/:id/uploaded', write, storyController.uploaded);
router.post('/:id/reprocess', write, storyController.reprocess);
router.post('/:id/cover', write, coverFile, storyController.cover);
router.post('/:id/archive', write, storyController.archive);

module.exports = router;
