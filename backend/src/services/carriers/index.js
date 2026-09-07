/**
 * Registre des adaptateurs transporteurs.
 *
 * Un seul endroit où déclarer un transporteur. Les lots suivants du chantier
 * expédition (Mondial Relay, Colissimo, Chronopost/2Shop) n'ajoutent qu'un
 * fichier d'adaptateur et une ligne ici — le contrôleur, le modèle et les
 * routes n'ont pas à changer.
 *
 * Les codes reprennent `shipping_carriers.code`, le vocabulaire déjà en place
 * pour les tarifs et le contrôle de factures.
 */

const laposteAdapter = require('./laposteAdapter');

/** @type {Record<string, import('./contract').CarrierAdapter>} */
const ADAPTERS = {
  [laposteAdapter.code]: laposteAdapter
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
