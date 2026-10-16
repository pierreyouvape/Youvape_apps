/**
 * Boutique › Coffre. Monté avec authMiddleware dans server.js ; le droit
 * `coffre-boutiques` et celui de la boutique sont vérifiés dans le contrôleur.
 */

const express = require('express');
const router = express.Router();
const coffreController = require('../controllers/coffreController');

router.get('/:shop', coffreController.getState);
router.post('/:shop/comptages', coffreController.addComptage);
router.post('/:shop/remises', coffreController.addRemise);
router.delete('/:shop/movements/:id', coffreController.deleteMovement);

module.exports = router;
