/**
 * Stats boutiques — voir models/boutiqueStatsModel pour les règles de calcul.
 *
 * Droit `stats-boutiques` : Lecture = Conseiller, Écriture = Responsable.
 * Une boutique n'est visible que si l'utilisateur a aussi son droit boutique
 * (`boutique-mtp` / `boutique-cast`) : un conseiller de Castelnau ne voit pas
 * Montpellier.
 */

const boutiqueStatsModel = require('../models/boutiqueStatsModel');
const userPermissionsModel = require('../models/userPermissionsModel');
const { WAREHOUSES, resolveWarehouse } = require('../config/nextore');

/** Niveau et boutiques de l'utilisateur ; level nul = aucun accès. */
async function access(user) {
  if (userPermissionsModel.isSuperAdmin(user.email)) {
    return { level: 'responsable', shops: WAREHOUSES };
  }
  const perms = await userPermissionsModel.getUserPermissions(user.id);
  const p = perms['stats-boutiques'] || {};
  const level = p.write ? 'responsable' : p.read ? 'conseiller' : null;
  const shops = WAREHOUSES.filter((w) => perms[w.permKey]?.read);
  return { level, shops };
}

const fail = (res, error, where) => {
  if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
  console.error(`[BoutiqueStats] Erreur ${where} :`, error.message);
  return res.status(500).json({ error: 'Erreur serveur' });
};

/** GET /access — niveau + boutiques accessibles (pour le sélecteur). */
const getAccess = async (req, res) => {
  try {
    const { level, shops } = await access(req.user);
    if (!level) return res.status(403).json({ error: 'Accès refusé : droit « Stats boutiques » requis' });
    res.json({ level, shops: shops.map(({ slug, name }) => ({ slug, name })) });
  } catch (error) {
    fail(res, error, 'getAccess');
  }
};

/** GET /:shop?from&to — classements de la boutique sur la période. */
const getRankings = async (req, res) => {
  try {
    const { level, shops } = await access(req.user);
    if (!level) return res.status(403).json({ error: 'Accès refusé : droit « Stats boutiques » requis' });
    const wh = resolveWarehouse(req.params.shop);
    if (!wh || !shops.some((s) => s.id === wh.id)) {
      return res.status(403).json({ error: "Accès refusé : vous n'avez pas accès à cette boutique" });
    }
    const data = await boutiqueStatsModel.getRankings(wh.id, req.query.from, req.query.to, level === 'responsable');
    res.json({ level, ...data });
  } catch (error) {
    fail(res, error, 'getRankings');
  }
};

module.exports = { getAccess, getRankings };
