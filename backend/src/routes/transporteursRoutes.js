const express = require('express');
const router = express.Router();
const transporteursController = require('../controllers/transporteursController');

router.get('/totals', transporteursController.getTotals);

module.exports = router;
