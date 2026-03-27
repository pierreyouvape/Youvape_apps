const express = require('express');
const router = express.Router();
const preferencesController = require('../controllers/preferencesController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.get('/:page', preferencesController.getPreferences);
router.put('/:page', preferencesController.savePreferences);

module.exports = router;
