const express = require('express');
const router = express.Router();
const storyController = require('../controllers/storyController');
const { checkPermission } = require('../middleware/permissionMiddleware');

/*
 * App « Stories » (remplacement de Join Stories).
 * Le JWT est posé au montage dans server.js ; ici, le droit applicatif `stories`.
 */
const read = checkPermission('stories', 'read');
const write = checkPermission('stories', 'write');

router.get('/', read, storyController.list);
router.post('/', write, storyController.create);
router.get('/:id', read, storyController.get);
router.put('/:id', write, storyController.update);
router.post('/:id/source', write, storyController.replaceSource);
router.post('/:id/uploaded', write, storyController.uploaded);
router.post('/:id/reprocess', write, storyController.reprocess);
router.post('/:id/archive', write, storyController.archive);

module.exports = router;
