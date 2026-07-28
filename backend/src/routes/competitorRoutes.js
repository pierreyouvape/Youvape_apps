const express = require('express');
const router = express.Router();
const c = require('../controllers/competitorController');

// Config & tableau de bord
router.get('/config', c.getConfig);
router.put('/config', c.updateConfig);
router.get('/dashboard', c.dashboard);
router.post('/run', c.runNow);
router.get('/run/status', c.runStatus);

router.post('/discover', c.discover);
router.post('/backfill-lpv', c.backfillLpv);
router.get('/suggestions', c.listSuggestions);
router.post('/suggestions/:id/validate', c.validateSuggestion);
router.put('/suggestions/:id', c.updateSuggestion);
router.delete('/suggestions/:id', c.deleteSuggestion);

// Mapping (CRUD)
router.get('/', c.listProducts);
router.post('/', c.createProduct);
router.get('/:id/history', c.history);
router.put('/:id', c.updateProduct);
router.delete('/:id', c.deleteProduct);

module.exports = router;
