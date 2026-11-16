/**
 * Règles pures de l'envoi du suivi au site (plugin youvape-logistique,
 * route `order/ship`). Sans base ni réseau : testées par
 * tests/logistiqueShip.test.js.
 *
 * Contrat de la route : youvape-logistique/AVANT-DE-MODIFIER.md §8.
 */

const { buildTrackingUrl } = require('./trackingService');

/**
 * Libellé transporteur écrit sur la commande. Il doit être EXACTEMENT celui que
 * BMS écrit aujourd'hui (`orders.shipping_carrier`) : detectCarrier() et nos
 * stats le lisent. Le titre envoyé à BMS est déjà le bon, sauf deux, que BMS
 * traduit lui-même (mesuré sur 20 jours d'étiquettes, le 16/11/2026).
 */
const SITE_LABEL_FROM_BMS_TITLE = {
  'Mondial Relay': 'Mondial Relay - Point Relais',
  'Retrait magasin': 'Store Pickup - Entrepot',
};

/** Repli quand l'étiquette n'a pas gardé son titre BMS. */
const SITE_LABEL_BY_CARRIER = {
  mondial_relay: 'Mondial Relay - Point Relais',
  interne: 'Store Pickup - Entrepot',
  laposte: 'La poste - Courrier suivi (port payé)',
};

const siteCarrierLabel = ({ bms_ship_title: title, carrier_code: carrier }) => {
  if (title) return SITE_LABEL_FROM_BMS_TITLE[title] || title;
  return SITE_LABEL_BY_CARRIER[carrier] || carrier;
};

/** Lien de suivi complet. La lettre suivie se suit sur la même page que Colissimo. */
const TRACKING_CARRIER = { laposte: 'colissimo', colissimo: 'colissimo', chronopost: 'chronopost', mondial_relay: 'mondial_relay' };

const trackingUrlFor = ({ carrier_code: carrier, tracking_number: number, country }) =>
  buildTrackingUrl(number, TRACKING_CARRIER[carrier], country) || '';

/** Le retrait entrepôt n'a pas d'étiquette transporteur : il part en « retrait ». */
const isPickup = (label) => label.carrier_code === 'interne';

/** Identifiant de l'envoi chez le plugin : un renvoi du même colis revient « already ». */
const shipmentId = (labelId) => `label-${labelId}`;

/**
 * Ligne `order/ship` d'une étiquette. Toujours SANS mail : tant que BMS pose
 * les statuts, le plugin n'écrit que le suivi (interrupteur des statuts coupé).
 *
 * @param {object} label - ligne shipment_labels + `wp_order_id`, `country`,
 *        `created_at_tz` (Date), `replace` (une autre étiquette de la commande
 *        est déjà sur le site)
 */
const buildShipLine = (label) => {
  const pickup = isPickup(label);
  return {
    shipment_id: shipmentId(label.id),
    order_id: Number(label.wp_order_id),
    pickup,
    replace: Boolean(label.replace) && !pickup,
    carrier: label.carrier_code,
    carrier_label: siteCarrierLabel(label),
    tracking_number: label.tracking_number || '',
    tracking_url: pickup ? '' : trackingUrlFor(label),
    shipped_at: new Date(label.created_at_tz).toISOString(),
    notify_customer: false,
  };
};

/** Codes du plugin qui disent « rien n'a été fait, renvoyer » (§8). */
const RETRYABLE_CODES = ['ORDER_LOCKED', 'EXCEPTION', 'DB_ERROR', 'TIME_BUDGET'];

/** Au-delà, un échec passager devient une erreur à regarder (≈ 4 h à un passage toutes les 5 min). */
const MAX_ATTEMPTS = 48;

/**
 * Ce que devient l'étiquette après la réponse du plugin pour sa ligne.
 * @param {object} result - ligne `results[]` du plugin
 * @param {number} attempts - tentatives, celle-ci comprise
 * @returns {{ status: 'sent'|'retry'|'error', error: ?string }}
 */
const classifyResult = (result, attempts) => {
  if (result && (result.result === 'applied' || result.result === 'already')) {
    return { status: 'sent', error: result.warning ? `Écrit, avec un avertissement : ${result.warning}` : null };
  }
  const code = result?.code || 'REPONSE_INATTENDUE';
  const error = `${code} : ${result?.message || 'réponse du plugin illisible pour cette ligne'}`;
  const retryable = result?.result === 'not_processed' || RETRYABLE_CODES.includes(code);
  if (retryable && attempts < MAX_ATTEMPTS) return { status: 'retry', error };
  return { status: 'error', error };
};

/** Un seul colis par commande et par passage : le suivant partira en « remplacer » au passage d'après. */
const onePerOrder = (labels) => {
  const seen = new Set();
  return labels.filter((l) => {
    if (seen.has(l.order_number)) return false;
    seen.add(l.order_number);
    return true;
  });
};

module.exports = {
  siteCarrierLabel, trackingUrlFor, buildShipLine, classifyResult, onePerOrder, shipmentId,
  MAX_ATTEMPTS, RETRYABLE_CODES,
};
