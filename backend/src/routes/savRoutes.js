const express = require('express');
const router = express.Router();
const savController = require('../controllers/savController');

const verifyZendeskToken = (req, res, next) => {
  const token = req.headers['x-zendesk-token'];
  if (!token || token !== process.env.ZENDESK_API_TOKEN) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  next();
};

router.get('/', verifyZendeskToken, savController.getAll);
router.post('/', verifyZendeskToken, savController.create);
router.get('/order/:order_id', verifyZendeskToken, savController.getByOrderId);
router.get('/customer/:customer_id', verifyZendeskToken, savController.getByCustomerId);
router.get('/zendesk/:zendesk_ticket_id', verifyZendeskToken, savController.getByZendeskId);
router.put('/:id/status', verifyZendeskToken, savController.updateStatus);

module.exports = router;
