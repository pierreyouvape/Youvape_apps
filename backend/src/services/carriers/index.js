/**
 * Registre des adaptateurs transporteurs.
 *
 * Un seul endroit où déclarer un transporteur. Les lots suivants du chantier
 * expédition (Colissimo, Chronopost/2Shop) n'ajoutent qu'un fichier d'adaptateur
 * et une ligne ici — le contrôleur, le modèle et les routes n'ont pas à changer.
 *
 * Le choix de l'adaptateur pour une commande donnée ne se déduit pas : il passe
 * par `shipping_method_carrier_map`, alimentée à la main dans les réglages. Voir
 * `models/shippingMethodMapModel`.
 */

const laposteAdapter = require('./laposteAdapter');
const mondialRelayAdapter = require('./mondialRelayAdapter');
const colissimoAdapter = require('./colissimoAdapter');
const interneAdapter = require('./interneAdapter');

/** @type {Record<string, import('./contract').CarrierAdapter>} */
const ADAPTERS = {
  [laposteAdapter.code]: laposteAdapter,
  [mondialRelayAdapter.code]: mondialRelayAdapter,
  [colissimoAdapter.code]: colissimoAdapter,
  [interneAdapter.code]: interneAdapter
};

/**
 * @param {string} carrierCode
 * @returns {import('./contract').CarrierAdapter}
 * @throws {Error & {statusCode: number}} 400 si le transporteur n'est pas branché.
 */
const getAdapter = (carrierCode) => {
  const adapter = ADAPTERS[carrierCode];
  if (!adapter) {
    const err = new Error(`Transporteur « ${carrierCode} » non pris en charge pour l'étiquetage`);
    err.statusCode = 400;
    throw err;
  }
  return adapter;
};

/** @returns {string[]} codes des transporteurs sachant émettre une étiquette */
const listCarrierCodes = () => Object.keys(ADAPTERS);

module.exports = { getAdapter, listCarrierCodes };
