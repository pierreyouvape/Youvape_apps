/**
 * Boutique › Statistiques — voir models/boutiqueStatsModel pour les règles de calcul.
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

/** Niveau et boutique de la requête, ou réponse 403 envoyée (null). */
async function shopAccess(req, res) {
  const { level, shops } = await access(req.user);
  if (!level) {
    res.status(403).json({ error: 'Accès refusé : droit « Stats boutiques » requis' });
    return null;
  }
  const wh = resolveWarehouse(req.params.shop);
  if (!wh || !shops.some((s) => s.id === wh.id)) {
    res.status(403).json({ error: "Accès refusé : vous n'avez pas accès à cette boutique" });
    return null;
  }
  return { level, wh };
}

const queryFilters = (q) => ({
  category: q.category ? String(q.category) : null,
  subcategory: q.subcategory ? String(q.subcategory) : null,
  search: q.search ? String(q.search) : null,
});

/** Liste « a,b,c » d'ids (catégories, sous-catégories), 50 au plus. */
const idList = (v) => (v ? String(v).split(',').map((x) => x.trim()).filter(Boolean).slice(0, 50) : []);

/** Produits dormants : plusieurs catégories et sous-catégories possibles. */
const dormantFilters = (q) => ({
  categories: idList(q.category),
  subcategories: idList(q.subcategory),
  search: q.search ? String(q.search) : null,
  inStock: q.in_stock === '1',
});

/** GET /:shop?from&to[&category&subcategory&search] — classements de la boutique sur la période. */
const getRankings = async (req, res) => {
  try {
    const ok = await shopAccess(req, res);
    if (!ok) return;
    const data = await boutiqueStatsModel.getRankings(ok.wh.id, req.query.from, req.query.to, ok.level === 'responsable', queryFilters(req.query));
    res.json({ level: ok.level, ...data });
  } catch (error) {
    fail(res, error, 'getRankings');
  }
};

/** GET /:shop/dormants?since[&category=a,b&subcategory=c,d&search&in_stock=1] — produits sans vente depuis `since`. */
const getDormants = async (req, res) => {
  try {
    const ok = await shopAccess(req, res);
    if (!ok) return;
    const filters = dormantFilters(req.query);
    const data = await boutiqueStatsModel.getDormants(ok.wh.id, req.query.since, ok.level === 'responsable', filters);
    res.json({ level: ok.level, ...data });
  } catch (error) {
    fail(res, error, 'getDormants');
  }
};

/** GET /:shop/dormants/export?since[&filtres][&sort&dir] — le tableau de l'écran en .xlsx. */
const exportDormants = async (req, res) => {
  try {
    const ok = await shopAccess(req, res);
    if (!ok) return;
    const filters = dormantFilters(req.query);
    const { buffer, filename } = await boutiqueStatsModel.exportDormants(
      ok.wh, req.query.since, ok.level === 'responsable', filters,
      { sort: String(req.query.sort || ''), dir: String(req.query.dir || '') }
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    fail(res, error, 'exportDormants');
  }
};

module.exports = { getRankings, getDormants, exportDormants };
