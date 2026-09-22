const employeeModel = require('../models/employeeModel');

const parseId = (v) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const fail = (res, error, label) => {
  console.error(`❌ [Employés] ${label}:`, error);
  res.status(500).json({ error: error.message || 'Erreur serveur' });
};

module.exports = {

  list: async (req, res) => {
    try {
      res.json({ success: true, data: await employeeModel.list() });
    } catch (error) { fail(res, error, 'list'); }
  },

  /** Comptes app, pour proposer un rattachement à la création. */
  listUsers: async (req, res) => {
    try {
      res.json({ success: true, data: await employeeModel.listUsers() });
    } catch (error) { fail(res, error, 'listUsers'); }
  },

  create: async (req, res) => {
    try {
      const firstName = String(req.body?.first_name ?? '').trim();
      const lastName = String(req.body?.last_name ?? '').trim();
      if (!firstName || !lastName) {
        return res.status(400).json({ error: 'Prénom et nom sont obligatoires' });
      }
      const employee = await employeeModel.create({
        firstName,
        lastName,
        userId: parseId(req.body?.user_id),
        active: req.body?.active,
      });
      res.status(201).json({ success: true, data: employee });
    } catch (error) {
      // Un compte app ne peut être rattaché qu'à un seul salarié.
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ce compte est déjà rattaché à un salarié' });
      }
      fail(res, error, 'create');
    }
  },

  update: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Identifiant invalide' });

      const body = req.body || {};
      // `active` n'est volontairement PAS modifiable ici : un départ passe par
      // /deactivate, qui coupe aussi l'accès. Deux chemins laisseraient des
      // fiches archivées dont le compte reste grand ouvert.
      const employee = await employeeModel.update(id, {
        firstName: body.first_name,
        lastName: body.last_name,
        userId: body.user_id === undefined ? undefined : parseId(body.user_id),
      });
      if (!employee) return res.status(404).json({ error: 'Salarié introuvable' });
      res.json({ success: true, data: employee });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ce compte est déjà rattaché à un salarié' });
      }
      fail(res, error, 'update');
    }
  },

  /**
   * Attribution du code-barre. Un salarié qui en a déjà un est refusé en 409 :
   * le seul cas où l'on voudrait « régénérer » est une erreur de saisie du nom,
   * et l'étiquette déjà imprimée resterait valide de toute façon.
   */
  generateBarcode: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Identifiant invalide' });

      const { error, employee } = await employeeModel.generateBarcode(id);
      if (error === 'NOT_FOUND') return res.status(404).json({ error: 'Salarié introuvable' });
      if (error === 'ALREADY_HAS_BARCODE') {
        return res.status(409).json({ error: 'Ce salarié a déjà un code-barre' });
      }
      if (error) return res.status(500).json({ error: 'Génération impossible' });

      res.json({ success: true, data: employee });
    } catch (error) { fail(res, error, 'generateBarcode'); }
  },

  /** Comptes app rattachés à aucun salarié (à rattacher, ou restes d'un départ). */
  orphanAccounts: async (req, res) => {
    try {
      res.json({ success: true, data: await employeeModel.listOrphanAccounts() });
    } catch (error) { fail(res, error, 'orphanAccounts'); }
  },

  /** Ce qu'un départ entraînerait — lu par l'écran de confirmation. */
  deactivationImpact: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Identifiant invalide' });

      const impact = await employeeModel.deactivationImpact(id);
      if (!impact) return res.status(404).json({ error: 'Salarié introuvable' });
      res.json({ success: true, data: impact });
    } catch (error) { fail(res, error, 'deactivationImpact'); }
  },

  /**
   * Départ : fiche archivée, compte app désactivé, droits effacés.
   * `keep_account = true` archive la fiche sans toucher au compte (fiche en
   * double, compte partagé rattaché par erreur…).
   */
  deactivate: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Identifiant invalide' });

      const result = await employeeModel.deactivate(id, req.body?.keep_account === true);
      if (result.error === 'NOT_FOUND') return res.status(404).json({ error: 'Salarié introuvable' });
      if (result.error === 'SUPER_ADMIN') {
        return res.status(403).json({
          error: "Le super administrateur ne peut pas perdre son accès depuis cet écran",
        });
      }
      res.json({ success: true, data: result });
    } catch (error) { fail(res, error, 'deactivate'); }
  },

  /** Retour d'un salarié : fiche et connexion réactivées (droits à redonner). */
  reactivate: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Identifiant invalide' });

      const result = await employeeModel.reactivate(id);
      if (result.error === 'NOT_FOUND') return res.status(404).json({ error: 'Salarié introuvable' });
      res.json({ success: true, data: result });
    } catch (error) { fail(res, error, 'reactivate'); }
  },
};
