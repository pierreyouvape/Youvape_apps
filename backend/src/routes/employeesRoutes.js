const express = require('express');
const router = express.Router();
const employeesController = require('../controllers/employeesController');
const { checkPermission, checkAdmin } = require('../middleware/permissionMiddleware');

/*
 * Gestion employé — registre des salariés et codes-barres.
 *
 * Le JWT est posé au montage dans server.js (`app.use('/api/employees',
 * authMiddleware, ...)`). Ici on ajoute le droit applicatif : `employes` en
 * lecture pour consulter et imprimer, en écriture pour créer un salarié ou
 * lui attribuer un code.
 *
 * Le départ et le retour d'un salarié demandent EN PLUS d'être administrateur :
 * ils ouvrent ou ferment l'accès d'une personne à l'app, ce qui n'est pas du
 * même ordre que corriger un nom.
 *
 * Rien ne se supprime ici : un départ désactive (droits effacés, connexion
 * refusée, jeton en cours invalidé), et l'historique d'actions reste intact.
 */
const canRead = checkPermission('employes', 'read');
const canWrite = checkPermission('employes', 'write');

router.get('/', canRead, employeesController.list);
router.get('/users', canRead, employeesController.listUsers);
router.get('/orphan-accounts', canRead, employeesController.orphanAccounts);
router.get('/:id/deactivation-impact', canWrite, employeesController.deactivationImpact);

router.post('/', canWrite, employeesController.create);
router.put('/:id', canWrite, employeesController.update);
router.post('/:id/barcode', canWrite, employeesController.generateBarcode);
router.post('/:id/deactivate', canWrite, checkAdmin, employeesController.deactivate);
router.post('/:id/reactivate', canWrite, checkAdmin, employeesController.reactivate);

module.exports = router;
