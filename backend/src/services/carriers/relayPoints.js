/**
 * Point relais saisi à la main dans la fiche commande.
 *
 * Une commande créée au back-office WooCommerce n'a pas de point relais : la
 * méta des plugins (Colissimo, Mondial Relay) ne s'édite pas depuis
 * l'administration. Constaté sur la commande Bpost 1259888 — `created_via:
 * admin`, ligne « Bpost Relais » sans méthode, aucune méta de point. Sans point,
 * le packing refuse d'étiqueter. L'équipe le saisissait jusqu'ici dans BMS ;
 * elle le saisit désormais dans la fiche commande de l'app.
 *
 * Le point saisi est stocké À PART, dans `orders.relay_point_manual`. Les deux
 * chemins de synchro écrivent `relay_point = COALESCE(<WooCommerce>, <base>)` :
 * une correction portée dans `relay_point` serait remise à la valeur
 * WooCommerce au premier changement de statut, sans que personne le voie. Une
 * colonne que la synchro ignore ne peut pas être écrasée — par construction.
 *
 * Le transporteur lit « point saisi s'il existe, sinon celui de WooCommerce »
 * (shipmentController.loadOrderForLabel).
 */

const { getAdapter, listCarrierCodes } = require('./index');

const refus = (userMessage) => {
  const err = new Error(userMessage);
  err.statusCode = 400;
  err.userMessage = userMessage;
  throw err;
};

/**
 * Réseaux pour lesquels un point peut être saisi : les transporteurs qui savent
 * contrôler un point, donc qui s'en servent.
 *
 * @returns {{code: string, label: string}[]}
 */
const relayNetworks = () => listCarrierCodes()
  .map(getAdapter)
  .filter(a => typeof a.assertRelayPoint === 'function')
  .map(a => ({ code: a.code, label: a.relayNetworkLabel || a.label }));

/**
 * Réseau dont une commande attend un point, d'après la correspondance de sa
 * dénomination — ou null si son mode de livraison n'en exige pas.
 *
 * C'est le transporteur qui sait quels modes passent par un point : tous chez
 * Mondial Relay, seulement « relais » chez Colissimo.
 *
 * @param {?string} carrierCode
 * @param {?string} deliveryMode
 * @returns {?{code: string, label: string}}
 */
const expectedNetwork = (carrierCode, deliveryMode) => {
  if (!carrierCode) return null;
  let adapter;
  try { adapter = getAdapter(carrierCode); } catch (e) { return null; }
  if (typeof adapter.requiresRelayPoint !== 'function' || !adapter.requiresRelayPoint(deliveryMode)) return null;
  return { code: adapter.code, label: adapter.relayNetworkLabel || adapter.label };
};

/**
 * Construit le point à enregistrer, contrôlé par le transporteur lui-même.
 *
 * Le contrôle est EXACTEMENT celui du packing (`assertRelayPoint` de
 * l'adaptateur) : un point accepté à la saisie ne sera jamais refusé au moment
 * d'expédier. Mieux vaut l'apprendre en tapant le numéro que colis en main.
 *
 * @param {{network: string, id: string, country: string}} saisie
 * @param {{orderNumber: string|number, enteredBy?: string, enteredById?: number, now?: Date}} contexte
 * @returns {object} le point, dans la forme de `orders.relay_point` + la trace de saisie
 * @throws {Error & {statusCode: 400, userMessage: string}}
 */
const buildManualRelayPoint = ({ network, id, country } = {}, { orderNumber, enteredBy = null, enteredById = null, now = new Date() } = {}) => {
  const reseau = String(network || '').trim();
  const reseaux = relayNetworks();
  if (!reseaux.some(r => r.code === reseau)) {
    refus(`Réseau « ${reseau || 'vide'} » inconnu : choisissez ${reseaux.map(r => r.label).join(' ou ')}.`);
  }

  const numero = String(id ?? '').trim();
  if (!numero) refus('Le numéro du point relais est obligatoire.');

  const pays = String(country || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(pays)) {
    refus(`Pays « ${country || 'vide'} » invalide : un code à deux lettres est attendu (FR, BE, LU…).`);
  }

  const point = {
    network: reseau,
    id: numero,
    country: pays,
    // Inconnus à la saisie. Les transporteurs n'en ont pas besoin : Mondial
    // Relay veut le numéro et le pays, Colissimo le numéro seul.
    name: null, address: null, postcode: null, city: null, type: null, service: null,
    entered_by: enteredBy,
    entered_by_id: enteredById,
    entered_at: now.toISOString()
  };

  getAdapter(reseau).assertRelayPoint(point, orderNumber);
  return point;
};

module.exports = { relayNetworks, expectedNetwork, buildManualRelayPoint };
