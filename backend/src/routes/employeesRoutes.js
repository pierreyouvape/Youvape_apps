const express = require('express');
const router = express.Router();
const employeesController = require('../controllers/employeesController');
const { checkPermission } = require('../middleware/permissionMiddleware');

/*
 * Gestion employé — registre des salariés et codes-barres.
 *
 * Le JWT est posé au montage dans server.js (`app.use('/api/employees',
 * authMiddleware, ...)`). Ici on ajoute le droit applicatif : `employes` en
 * lecture pour consulter et imprimer, en écriture pour créer un salarié ou
 * lui attribuer un code.
 */
const canRead = checkPermission('employes', 'read');
const canWrite = checkPermission('employes', 'write');

router.get('/', canRead, employeesController.list);
router.get('/users', canRead, employeesController.listUsers);

router.post('/', canWrite, employeesController.create);
router.put('/:id', canWrite, employeesController.update);
router.post('/:id/barcode', canWrite, employeesController.generateBarcode);
router.delete('/:id', canWrite, employeesController.remove);

module.exports = router;
