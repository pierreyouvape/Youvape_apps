/**
 * Suivi des colis auprès des transporteurs.
 *
 * Toutes les 30 min (cronService), on interroge les colis dont le passage est
 * dû : fréquence selon l'état (states.RECHECK_HOURS), arrêt à la livraison, au
 * retour chez nous, ou 45 jours après l'étiquette.
 *
 * Ce lot ne fait que SUIVRE. Le passage de la commande en « Livrée » sur le
 * site (plugin youvape-logistique, `order/status`) viendra quand le plugin sera
 * en production : d'ici là, Vikings et BMS continuent de le faire.
 */

const trackingModel = require('../models/shipmentTrackingModel');
const { getAccount } = require('./carriers/accounts');
const readers = require('./tracking/readers');
const { nextCheckAt, RETRY_HOURS_ON_ERROR } = require('./tracking/states');

const LOG_TAG = 'Suivi colis';
const BATCH = 300;
const PAUSE_MS = 200;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const fetchFor = async (label) => {
  const source = readers.SOURCE_BY_CARRIER[label.carrier_code];
  if (source === 'laposte') return { source, res: await readers.fetchLaPoste(label.tracking_number) };
  if (source === 'chronopost') return { source, res: await readers.fetchChronopost(label.tracking_number) };
  if (source === 'mondial_relay') {
    const account = await getAccount(label.carrier_code, label.account_code);
    const res = await readers.fetchMondialRelay(label.tracking_number, {
      enseigne: account.credentials.customer_id,
      privateKey: account.credentials.wsi2_private_key,
    });
    return { source, res };
  }
  return { source: null, res: null };
};

/**
 * Interroge le transporteur pour un colis, enregistre, recalcule l'état et
 * programme le passage suivant. Une panne ne remonte pas : elle est notée sur
 * le colis et retentée une heure plus tard.
 *
 * @returns {Promise<{state: ?string, error: ?string}>}
 */
const trackLabel = async (label, stateOf = null) => {
  try {
    const { source, res } = await fetchFor(label);
    if (!source) return { state: null, error: 'Transporteur sans suivi' };

    await trackingModel.saveEvents(label.id, source, res.events);
    const computed = (await trackingModel.recompute([label.id], stateOf)).get(label.id);
    await trackingModel.recordCheck(label.id, {
      nextCheckAt: nextCheckAt(computed.state, label.created_at),
      error: res.notFound ? res.message : null,
    });
    return { state: computed.state, error: res.notFound ? res.message : null };
  } catch (err) {
    console.warn(`[${LOG_TAG}] ${label.carrier_code} ${label.tracking_number} :`, err.message);
    await trackingModel.recordCheck(label.id, {
      nextCheckAt: new Date(Date.now() + RETRY_HOURS_ON_ERROR * 3600000),
      error: err.message.slice(0, 500),
    });
    return { state: null, error: err.message };
  }
};

let running = false;

/** Un passage : les colis dus, un par un. */
const runDue = async ({ limit = BATCH } = {}) => {
  if (running) return { skipped: true };
  running = true;
  const stats = { checked: 0, errors: 0, delivered: 0, returning: 0 };
  try {
    const labels = await trackingModel.dueLabels(limit);
    const stateOf = await trackingModel.loadStateOf();
    for (const label of labels) {
      const r = await trackLabel(label, stateOf);
      stats.checked++;
      if (r.error && r.state === null) stats.errors++;
      if (r.state === 'delivered') stats.delivered++;
      if (r.state === 'returning') stats.returning++;
      await sleep(PAUSE_MS);
    }
    if (stats.checked) {
      console.log(`[${LOG_TAG}] ${stats.checked} colis interrogés — ${stats.delivered} livrés, `
        + `${stats.returning} en retour, ${stats.errors} sans réponse`);
    }
    return stats;
  } finally {
    running = false;
  }
};

/** Bouton « Actualiser » : un colis, tout de suite. */
const refreshLabel = async (labelId) => {
  const label = await trackingModel.findLabel(labelId);
  if (!label) return null;
  if (!label.tracking_number) return { state: null, error: 'Pas de numéro de suivi' };
  return trackLabel(label);
};

module.exports = { runDue, refreshLabel, trackLabel };
