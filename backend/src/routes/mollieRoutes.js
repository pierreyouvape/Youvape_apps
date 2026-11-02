const express = require('express');
const router = express.Router();
const c = require('../controllers/mollieController');
const { checkPermission } = require('../middleware/permissionMiddleware');

// JWT posé au montage dans server.js ; ici le droit applicatif `mollie`.
const canRead = checkPermission('mollie', 'read');
const canWrite = checkPermission('mollie', 'write');

router.get('/contract',         canRead, c.contract);
router.get('/invoices',         canRead, c.list);
router.get('/invoices/:id',     canRead, c.detail);
router.get('/invoices/:id/pdf', canRead, c.pdf);
router.post('/upload',          canWrite, ...c.upload);
router.delete('/invoices/:id',  canWrite, c.remove);
// Frais des commandes : la simulation se lit, l'application demande l'écriture.
router.post('/apply-costs/preview', canRead, (req, res) => { req.body = { apply: false }; return c.applyCosts(req, res); });
router.post('/apply-costs',     canWrite, (req, res) => { req.body = { apply: true }; return c.applyCosts(req, res); });

module.exports = router;
