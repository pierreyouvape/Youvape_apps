const processModel = require('../models/processModel');
const {
  saveImage, resolveImagePath, removeProcessDir,
  signMediaUrl, signStepImages, verifyMediaSignature,
} = require('../utils/processMedia');

const parseId = (v) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** req.isAdmin est posé une fois pour toutes par le routeur. */
const actorOf = (req) => ({ id: req.user?.id || null, isAdmin: !!req.isAdmin });

/**
 * Vérifie les droits sur un process et répond à la place du contrôleur si
 * l'accès est refusé. Retourne les droits, ou null si la réponse est déjà partie.
 *
 * Un process qu'on n'a pas le droit de voir répond 404 et non 403 : un 403
 * confirmerait son existence à quelqu'un qui n'a pas à le savoir. Le 403 est
 * réservé au cas « je le vois, mais je ne peux pas le modifier ».
 */
async function guard(req, res, processId, need = 'read') {
  const rights = await processModel.resolveRights(processId, actorOf(req));
  if (!rights.exists || !rights.canRead) {
    res.status(404).json({ error: 'Process introuvable' });
    return null;
  }
  if (need === 'write' && !rights.canWrite) {
    res.status(403).json({ error: "Vous n'avez pas le droit de modifier ce process" });
    return null;
  }
  return rights;
}

/** Ajoute les droits de l'appelant et signe les URLs d'images. */
function decorate(process, rights) {
  return {
    ...process,
    steps: signStepImages(process.steps),
    my_can_write: rights.canWrite,
  };
}

module.exports = {

  /* ─── Catégories ──────────────────────────────────────────────────────── */

  listCategories: async (req, res) => {
    try {
      res.json({ success: true, data: await processModel.listCategories() });
    } catch (error) {
      console.error('❌ [Process] listCategories:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  createCategory: async (req, res) => {
    try {
      const name = (req.body?.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Nom de catégorie requis' });
      res.json({ success: true, data: await processModel.createCategory({ name, color: req.body?.color }) });
    } catch (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'Cette catégorie existe déjà' });
      console.error('❌ [Process] createCategory:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  updateCategory: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      const name = (req.body?.name || '').trim();
      if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
      if (!name) return res.status(400).json({ error: 'Nom de catégorie requis' });

      const category = await processModel.updateCategory(id, { name, color: req.body?.color });
      if (!category) return res.status(404).json({ error: 'Catégorie introuvable' });
      res.json({ success: true, data: category });
    } catch (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'Cette catégorie existe déjà' });
      console.error('❌ [Process] updateCategory:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  deleteCategory: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Identifiant invalide' });

      const category = await processModel.deleteCategory(id);
      if (!category) return res.status(404).json({ error: 'Catégorie introuvable' });
      res.json({ success: true, data: category });
    } catch (error) {
      console.error('❌ [Process] deleteCategory:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  /* ─── Process ─────────────────────────────────────────────────────────── */

  list: async (req, res) => {
    try {
      const data = await processModel.list({
        q: req.query.q,
        category_id: parseId(req.query.category_id),
        status: req.query.status,
      }, actorOf(req));
      res.json({ success: true, data });
    } catch (error) {
      console.error('❌ [Process] list:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  getOne: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Identifiant invalide' });

      const rights = await guard(req, res, id, 'read');
      if (!rights) return;

      const process = await processModel.getById(id);
      if (!process) return res.status(404).json({ error: 'Process introuvable' });
      res.json({ success: true, data: decorate(process, rights) });
    } catch (error) {
      console.error('❌ [Process] getOne:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Admin uniquement (checkAdmin dans le routeur) : créer, c'est décider qui voit.
  create: async (req, res) => {
    try {
      const title = (req.body?.title || '').trim();
      if (!title) return res.status(400).json({ error: 'Titre requis' });

      const process = await processModel.create({
        title,
        summary: req.body?.summary,
        category_id: parseId(req.body?.category_id),
        visibility: req.body?.visibility,
        access: req.body?.access,
        created_by: req.user?.id || null,
      });
      res.json({ success: true, data: process });
    } catch (error) {
      console.error('❌ [Process] create:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Un enregistrement = une nouvelle version (cf. processModel.saveContent).
  // La visibilité n'est volontairement PAS modifiable ici : elle ne fait pas
  // partie du contenu, et seul un admin y touche via /access.
  update: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Identifiant invalide' });

      const rights = await guard(req, res, id, 'write');
      if (!rights) return;

      const title = (req.body?.title || '').trim();
      if (!title) return res.status(400).json({ error: 'Titre requis' });

      const process = await processModel.saveContent(id, {
        title,
        summary: req.body?.summary,
        category_id: parseId(req.body?.category_id),
        status: req.body?.status,
        steps: req.body?.steps,
        change_note: req.body?.change_note,
        author_id: req.user?.id || null,
      });
      if (!process) return res.status(404).json({ error: 'Process introuvable' });

      res.json({ success: true, data: decorate(await processModel.getById(id), rights) });
    } catch (error) {
      console.error('❌ [Process] update:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Admin uniquement (checkAdmin dans le routeur).
  remove: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Identifiant invalide' });

      const process = await processModel.remove(id);
      if (!process) return res.status(404).json({ error: 'Process introuvable' });

      // Les lignes sont parties en CASCADE : plus aucune version ne référence
      // ces images, on peut enfin les effacer du disque.
      removeProcessDir(id);
      res.json({ success: true, data: process });
    } catch (error) {
      console.error('❌ [Process] remove:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  /* ─── Visibilité et accès nominatifs (admin uniquement) ───────────────── */

  listAccess: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Identifiant invalide' });

      const process = await processModel.getById(id);
      if (!process) return res.status(404).json({ error: 'Process introuvable' });

      res.json({
        success: true,
        data: { visibility: process.visibility, users: await processModel.listAccess(id) },
      });
    } catch (error) {
      console.error('❌ [Process] listAccess:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  updateVisibility: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Identifiant invalide' });

      const process = await processModel.setVisibility(id, req.body?.visibility);
      if (!process) return res.status(404).json({ error: 'Process introuvable' });
      res.json({ success: true, data: { visibility: process.visibility } });
    } catch (error) {
      console.error('❌ [Process] updateVisibility:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Ajoute ou met à jour l'accès d'UN utilisateur (lecture ou lecture+écriture).
  setAccess: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      const userId = parseId(req.body?.user_id ?? req.params.userId);
      if (!id || !userId) return res.status(400).json({ error: 'Identifiant invalide' });

      const process = await processModel.getById(id);
      if (!process) return res.status(404).json({ error: 'Process introuvable' });

      const access = await processModel.setAccess(id, userId, req.body?.can_write, req.user?.id || null);
      res.json({ success: true, data: access });
    } catch (error) {
      // Utilisateur inexistant : la FK part en 23503 plutôt qu'en 500 muet.
      if (error.code === '23503') return res.status(400).json({ error: 'Utilisateur introuvable' });
      console.error('❌ [Process] setAccess:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  removeAccess: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      const userId = parseId(req.params.userId);
      if (!id || !userId) return res.status(400).json({ error: 'Identifiant invalide' });

      const removed = await processModel.removeAccess(id, userId);
      if (!removed) return res.status(404).json({ error: 'Accès introuvable' });
      res.json({ success: true, data: removed });
    } catch (error) {
      console.error('❌ [Process] removeAccess:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  /* ─── Historique ──────────────────────────────────────────────────────── */

  listVersions: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
      if (!await guard(req, res, id, 'read')) return;

      res.json({ success: true, data: await processModel.listVersions(id) });
    } catch (error) {
      console.error('❌ [Process] listVersions:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  getVersion: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      const versionId = parseId(req.params.versionId);
      if (!id || !versionId) return res.status(400).json({ error: 'Identifiant invalide' });
      if (!await guard(req, res, id, 'read')) return;

      const version = await processModel.getVersion(id, versionId);
      if (!version) return res.status(404).json({ error: 'Version introuvable' });

      res.json({ success: true, data: { ...version, steps: signStepImages(version.steps) } });
    } catch (error) {
      console.error('❌ [Process] getVersion:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  restoreVersion: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      const versionId = parseId(req.params.versionId);
      if (!id || !versionId) return res.status(400).json({ error: 'Identifiant invalide' });

      const rights = await guard(req, res, id, 'write');
      if (!rights) return;

      const restored = await processModel.restoreVersion(id, versionId, req.user?.id || null);
      if (!restored) return res.status(404).json({ error: 'Version introuvable' });

      res.json({ success: true, data: decorate(await processModel.getById(id), rights) });
    } catch (error) {
      console.error('❌ [Process] restoreVersion:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  /* ─── Images ──────────────────────────────────────────────────────────── */

  uploadImage: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
      if (!req.file) return res.status(400).json({ error: 'Image requise' });
      if (!req.file.mimetype?.startsWith('image/')) {
        return res.status(400).json({ error: 'Le fichier doit être une image' });
      }
      if (!await guard(req, res, id, 'write')) return;

      const image = saveImage(id, req.file);
      // On renvoie l'URL signée pour l'aperçu immédiat. Le front peut la
      // stocker telle quelle : le modèle retire la signature à l'écriture.
      res.json({ success: true, data: { ...image, url: signMediaUrl(image.url) } });
    } catch (error) {
      console.error('❌ [Process] uploadImage:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  /**
   * Sert une image. Hors authMiddleware, car une balise <img> ne peut pas
   * porter d'en-tête Authorization : c'est la signature de l'URL (liée au
   * process, au fichier et à une expiration) qui tient lieu de contrôle.
   */
  getImage: (req, res) => {
    const { processId, filename } = req.params;
    if (!verifyMediaSignature(processId, filename, req.query.exp, req.query.sig)) {
      return res.status(403).json({ error: 'Lien expiré ou invalide' });
    }
    const resolved = resolveImagePath(processId, filename);
    if (!resolved) return res.status(404).json({ error: 'Fichier introuvable' });
    res.sendFile(resolved);
  },
};
