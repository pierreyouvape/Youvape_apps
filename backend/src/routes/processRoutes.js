const express = require('express');
const router = express.Router();
const multer = require('multer');
const processController = require('../controllers/processController');
const processModel = require('../models/processModel');
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission, checkAdmin } = require('../middleware/permissionMiddleware');
const { MAX_IMAGE_SIZE } = require('../utils/processMedia');

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE, files: 1 },
});

// ─── Images (AVANT authMiddleware) ────────────────────────────────────────────
// Une balise <img> ne peut pas porter d'en-tête Authorization : cette route
// reste ouverte, mais l'URL est signée (process + fichier + expiration), ce que
// le contrôleur vérifie. Un lien recopié cesse de fonctionner à l'expiration.
router.get('/media/:processId/:filename', processController.getImage);

// ─── Tout le reste exige le JWT ───────────────────────────────────────────────
router.use(authMiddleware);

/**
 * Porte d'entrée de l'app. Le droit `process` n'est PAS découpé en
 * lecture/écriture : l'avoir, c'est avoir l'app. Ce qu'on peut réellement faire
 * d'un process donné se décide process par process (processModel.resolveRights),
 * pas ici — d'où le seul contrôle `read`, qui vaut « a l'app ».
 */
router.use(checkPermission('process', 'read'));

/**
 * Statut admin résolu une fois par requête plutôt qu'à chaque contrôle de
 * droits : sans ça, lister 30 process ferait 30 requêtes sur `users`.
 */
router.use(async (req, res, next) => {
  try {
    req.isAdmin = await processModel.isAdmin(req.user);
    next();
  } catch (error) {
    console.error('❌ [Process] résolution du statut admin:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── Catégories — structurelles, donc réservées aux admins ────────────────────
// (avant /:id, qui capterait « categories »)
router.get('/categories',        processController.listCategories);
router.post('/categories',       checkAdmin, processController.createCategory);
router.put('/categories/:id',    checkAdmin, processController.updateCategory);
router.delete('/categories/:id', checkAdmin, processController.deleteCategory);

// ─── Process ──────────────────────────────────────────────────────────────────
// La liste est filtrée par visibilité dans la requête SQL ; le détail, la
// modification et l'historique vérifient les droits process par process.
router.get('/',       processController.list);
router.post('/',      checkAdmin, processController.create);   // créer = décider qui voit
router.get('/:id',    processController.getOne);
router.put('/:id',    processController.update);
router.delete('/:id', checkAdmin, processController.remove);

// ─── Visibilité et accès nominatifs — admin uniquement ────────────────────────
router.get('/:id/access',            checkAdmin, processController.listAccess);
router.put('/:id/visibility',        checkAdmin, processController.updateVisibility);
router.post('/:id/access',           checkAdmin, processController.setAccess);
router.put('/:id/access/:userId',    checkAdmin, processController.setAccess);
router.delete('/:id/access/:userId', checkAdmin, processController.removeAccess);

// ─── Historique ───────────────────────────────────────────────────────────────
router.get('/:id/versions',                     processController.listVersions);
router.get('/:id/versions/:versionId',          processController.getVersion);
router.post('/:id/versions/:versionId/restore', processController.restoreVersion);

// ─── Upload d'une image d'étape ───────────────────────────────────────────────
// Sans le gestionnaire d'erreur, un fichier trop lourd repartirait en 500 HTML
// (Express) et le front afficherait « erreur serveur » pour une limite de taille.
router.post(
  '/:id/images',
  (req, res, next) => {
    memoryUpload.single('image')(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        const mo = Math.round(MAX_IMAGE_SIZE / (1024 * 1024));
        return res.status(400).json({ error: `Image trop lourde (${mo} Mo maximum)` });
      }
      console.error('❌ [Process] upload:', err);
      return res.status(400).json({ error: "L'envoi de l'image a échoué" });
    });
  },
  processController.uploadImage
);

module.exports = router;
