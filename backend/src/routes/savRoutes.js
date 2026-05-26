const express = require('express');
const router = express.Router();
const savController = require('../controllers/savController');

router.get('/', savController.getAll);
router.post('/', savController.create);
router.get('/order/:order_id', savController.getByOrderId);
router.get('/customer/:customer_id', savController.getByCustomerId);
router.get('/zendesk/:zendesk_ticket_id', savController.getByZendeskId);
router.put('/:id/status', savController.updateStatus);

module.exports = router;
