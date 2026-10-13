const express = require('express');
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
router.put('/:id', write, storyController.update);
router.post('/:id/source', write, storyController.replaceSource);
router.post('/:id/uploaded', write, storyController.uploaded);
router.post('/:id/reprocess', write, storyController.reprocess);
router.post('/:id/archive', write, storyController.archive);

module.exports = router;
