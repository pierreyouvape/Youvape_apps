/**
 * Boutique › Coffre — voir models/coffreModel pour le calcul du solde.
 *
 * Droit `coffre-boutiques` (accès simple) ET droit de la boutique
 * (`boutique-mtp` / `boutique-cast`) : l'un sans l'autre ne suffit pas.
 */

const coffreModel = require('../models/coffreModel');
const userPermissionsModel = require('../models/userPermissionsModel');
const { resolveWarehouse } = require('../config/nextore');

/** Boutique de la requête si l'utilisateur y a accès, sinon une erreur 403. */
async function shopFor(req) {
  const wh = resolveWarehouse(req.params.shop);
  if (!wh) throw Object.assign(new Error('Boutique inconnue'), { statusCode: 404 });
  if (userPermissionsModel.isSuperAdmin(req.user.email)) return wh;
  const perms = await userPermissionsModel.getUserPermissions(req.user.id);
  if (!perms['coffre-boutiques']?.read) {
    throw Object.assign(new Error('Accès refusé : droit « Coffre boutiques » requis'), { statusCode: 403 });
  }
  if (!perms[wh.permKey]?.read) {
    throw Object.assign(new Error("Accès refusé : vous n'avez pas accès à cette boutique"), { statusCode: 403 });
  }
  return wh;
}

const fail = (res, error, where) => {
  if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
  console.error(`[Coffre] Erreur ${where} :`, error.message);
  return res.status(500).json({ error: 'Erreur serveur' });
};

/** GET /:shop — solde, caisse du jour et journal. */
const getState = async (req, res) => {
  try {
    const wh = await shopFor(req);
    res.json(await coffreModel.getState(wh.id));
  } catch (error) {
    fail(res, error, 'getState');
  }
};

/** POST /:shop/comptages { denominations: { "50": 3, … }, note } */
const addComptage = async (req, res) => {
  try {
    const wh = await shopFor(req);
    const { denominations, note } = req.body || {};
    res.status(201).json(await coffreModel.addComptage(wh.id, denominations, note, req.user.id));
  } catch (error) {
    fail(res, error, 'addComptage');
  }
};

/** POST /:shop/remises { amount, at?, note } */
const addRemise = async (req, res) => {
  try {
    const wh = await shopFor(req);
    const { amount, at, note } = req.body || {};
    res.status(201).json(await coffreModel.addRemise(wh.id, amount, at, note, req.user.id));
  } catch (error) {
    fail(res, error, 'addRemise');
  }
};

/** DELETE /:shop/movements/:id */
const deleteMovement = async (req, res) => {
  try {
    const wh = await shopFor(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Identifiant invalide' });
    await coffreModel.deleteMovement(wh.id, id, req.user.id);
    res.json({ ok: true });
  } catch (error) {
    fail(res, error, 'deleteMovement');
  }
};

module.exports = { getState, addComptage, addRemise, deleteMovement };
