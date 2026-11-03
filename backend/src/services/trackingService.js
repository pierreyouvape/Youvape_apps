const shipmentTrackingModel = require('../models/shipmentTrackingModel');
const { STATES } = require('./tracking/states');

// ─── Détection transporteur depuis le nom WooCommerce ────────────────────────
function detectCarrier(shippingCarrier) {
  if (!shippingCarrier) return null;
  const s = shippingCarrier.toLowerCase();
  if (s.includes('mondial') || s.includes('relay')) return 'mondial_relay';
  if (s.includes('chronopost') || s.includes('chrono')) return 'chronopost';
  if (s.includes('colissimo') || s.includes('lettre') || s.includes('suivie') || s.includes('poste')) return 'colissimo';
  return null;
}

// ─── URL suivi publique par transporteur ─────────────────────────────────────
// Mondial Relay : le n° d'expédition à 8 chiffres n'est unique QUE par enseigne.
// Le lien doit donc porter `ens` (code enseigne Youvape) + `exp` + `pays` —
// format vers lequel MR redirige ses propres liens permanents. Sans lui, la page
// de suivi ne trouve pas le colis et réclame le code postal du destinataire.
const MR_BRAND = process.env.MONDIAL_RELAY_BRAND_ID || 'LGYOUVAP';

function buildTrackingUrl(number, carrier, country) {
  if (!number || !carrier) return null;
  const pays = encodeURIComponent((country || 'FR').toUpperCase());
  const urls = {
    mondial_relay: `https://www.mondialrelay.fr/suivi-de-colis/?ens=${MR_BRAND}&exp=${encodeURIComponent(number)}&pays=${pays}&language=fr`,
    colissimo:     `https://www.laposte.fr/outils/suivre-vos-envois?code=${encodeURIComponent(number)}`,
    chronopost:    `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${encodeURIComponent(number)}&langue=fr`,
  };
  return urls[carrier] || null;
}

// ─── Point d'entrée principal ─────────────────────────────────────────────────
// L'état vient du suivi des colis (shipmentTrackingService), enregistré à
// chaque passage : le badge n'appelle plus aucun transporteur. Avant le
// 03/11/2026, il interrogeait un hôte La Poste mort et l'API Connect de
// Mondial Relay (création d'étiquettes seulement) : il affichait « Suivi »
// pour tous les colis, sans rien dire.
async function getTrackingStatus(number, shippingCarrier, country) {
  const carrier    = detectCarrier(shippingCarrier);
  const trackingUrl = buildTrackingUrl(number, carrier, country);

  if (!number) {
    return { state: null, label: null, trackingUrl: null, carrier: null, live: false };
  }

  const label = await shipmentTrackingModel.findByTrackingNumber(number);
  if (!label?.tracking_state) {
    return { state: null, label: 'Suivi', trackingUrl, carrier, live: false };
  }
  return {
    state: label.tracking_state,
    label: STATES[label.tracking_state],
    stateAt: label.tracking_state_at,
    trackingUrl,
    carrier,
    live: true,
  };
}

module.exports = { getTrackingStatus, detectCarrier, buildTrackingUrl };
