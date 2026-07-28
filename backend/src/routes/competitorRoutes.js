const express = require('express');
const router = express.Router();
const c = require('../controllers/competitorController');

// Config & tableau de bord
router.get('/config', c.getConfig);
router.put('/config', c.updateConfig);
router.get('/dashboard', c.dashboard);
router.post('/run', c.runNow);

// Mapping (CRUD)
router.get('/', c.listProducts);
router.post('/', c.createProduct);
router.get('/:id/history', c.history);
router.put('/:id', c.updateProduct);
router.delete('/:id', c.deleteProduct);

module.exports = router;
