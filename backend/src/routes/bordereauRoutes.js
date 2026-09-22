/**
 * Bordereaux de dépôt — app « Bordereau », groupe Prépa de commande.
 *
 * **Droit `packing`, et c'est volontaire** : l'app Bordereau n'a pas de clé de
 * permission à elle. Qui prépare les colis dépose les colis — une seule case à
 * cocher dans les réglages, rien à gérer en double (décision de Pierre,
 * 21/09/2026). Le front exprime la même règle avec `permissionKey` dans
 * `AppIcons.jsx` : les deux doivent rester d'accord.
 *
 * `read` et non `write`, comme l'étiquetage au packing : les comptes des postes
 * de préparation ont la lecture, et c'est avec elle qu'ils expédient toute la
 * journée. Exiger `write` ici fermerait le bordereau à ceux-là mêmes qui le
 * produisent.
 */

const express = require('express');
const router = express.Router();
const bordereauController = require('../controllers/bordereauController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');

router.use(authMiddleware);

const checkPackingRead = checkPermission('packing', 'read');

// Les colis étiquetés depuis une date et pas encore déposés
router.get('/pending', checkPackingRead, bordereauController.listPending);

// Produire le ou les bordereaux d'un transporteur
router.post('/generate', checkPackingRead, bordereauController.generate);

// Historique — réimpression du bordereau que le chauffeur redemande
router.get('/history', checkPackingRead, bordereauController.listHistory);
router.get('/:id/labels', checkPackingRead, bordereauController.listLabels);
router.get('/:id/pdf', checkPackingRead, bordereauController.getPdf);

module.exports = router;
