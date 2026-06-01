const axios = require('axios');

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
function buildTrackingUrl(number, carrier) {
  if (!number || !carrier) return null;
  const urls = {
    mondial_relay: `https://www.mondialrelay.fr/suivi-de-colis?codeMarque=LG&numeroExpedition=${encodeURIComponent(number)}&language=FR`,
    colissimo:     `https://www.laposte.fr/outils/suivre-vos-envois?code=${encodeURIComponent(number)}`,
    chronopost:    `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${encodeURIComponent(number)}&langue=fr`,
  };
  return urls[carrier] || null;
}

// ─── Mapping codes Okapi → label + couleur ───────────────────────────────────
const OKAPI_MAP = {
  PC1: { label: 'Pris en charge',        color: '#6c757d' },
  PC2: { label: 'En traitement',          color: '#0d6efd' },
  ET1: { label: 'En transit',             color: '#0d6efd' },
  ET2: { label: 'En distribution',        color: '#fd7e14' },
  LI1: { label: 'Livré ✅',              color: '#198754' },
  LI2: { label: 'Livré en relais ✅',    color: '#198754' },
  ND1: { label: 'Non distribuable ⚠️',   color: '#dc3545' },
  RE1: { label: 'Retourné ⚠️',           color: '#dc3545' },
};

// ─── Tracking Okapi (Colissimo + Chronopost) ─────────────────────────────────
async function trackOkapi(number, carrier, trackingUrl) {
  const apiKey = process.env.OKAPI_API_KEY;
  if (!apiKey) {
    return { label: 'Suivi', color: '#135E84', trackingUrl, live: false };
  }

  try {
    const res = await axios.get(
      `https://api.okapi.laposte.fr/suivi/v2/idships/${encodeURIComponent(number)}`,
      {
        headers: { 'X-Okapi-Key': apiKey, Accept: 'application/json' },
        timeout: 5000,
      }
    );

    const shipment = res.data?.shipment;
    const events   = shipment?.event || [];
    const last     = events[0];

    if (!last) {
      return { label: 'Suivi', color: '#135E84', trackingUrl, live: false };
    }

    const code    = last.code;
    const mapped  = OKAPI_MAP[code];
    const label   = mapped?.label || last.label || code;
    const color   = mapped?.color || '#135E84';

    return { label, color, trackingUrl, live: true };
  } catch (err) {
    console.warn(`[Tracking Okapi] Erreur pour ${number}:`, err.message);
    return { label: 'Suivi', color: '#135E84', trackingUrl, live: false };
  }
}

// ─── Mapping Mondial Relay → label + couleur ─────────────────────────────────
function parseMondialRelayStatus(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('livr') || s.includes('remis'))     return { label: 'Livré ✅',        color: '#198754' };
  if (s.includes('transit') || s.includes('cours'))  return { label: 'En transit',       color: '#0d6efd' };
  if (s.includes('distribu'))                         return { label: 'En distribution',  color: '#fd7e14' };
  if (s.includes('anomalie') || s.includes('retour')) return { label: 'Anomalie ⚠️',      color: '#dc3545' };
  if (s.includes('pris') || s.includes('accept'))    return { label: 'Pris en charge',    color: '#6c757d' };
  return { label: status || 'Suivi', color: '#135E84' };
}

// ─── Tracking Mondial Relay ───────────────────────────────────────────────────
async function trackMondialRelay(number, trackingUrl) {
  const brandId  = process.env.MONDIAL_RELAY_BRAND_ID;
  const login    = process.env.MONDIAL_RELAY_LOGIN;
  const password = process.env.MONDIAL_RELAY_PASSWORD;

  if (!brandId || !login || !password) {
    return { label: 'Suivi', color: '#135E84', trackingUrl, live: false };
  }

  try {
    const res = await axios.get(
      `https://connect-api.mondialrelay.com/api/Shipment/${encodeURIComponent(number)}`,
      {
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64'),
          'X-Brand-Id': brandId,
          Accept: 'application/json',
        },
        timeout: 5000,
      }
    );

    const data = res.data;
    // L'API renvoie StatusLabel ou Status
    const statusLabel = data?.StatusLabel || data?.Status || '';
    const { label, color } = parseMondialRelayStatus(statusLabel);

    return { label, color, trackingUrl, live: true };
  } catch (err) {
    console.warn(`[Tracking Mondial Relay] Erreur pour ${number}:`, err.message);
    return { label: 'Suivi', color: '#135E84', trackingUrl, live: false };
  }
}

// ─── Point d'entrée principal ─────────────────────────────────────────────────
async function getTrackingStatus(number, shippingCarrier) {
  const carrier    = detectCarrier(shippingCarrier);
  const trackingUrl = buildTrackingUrl(number, carrier);

  if (!number) {
    return { label: null, color: null, trackingUrl: null, carrier: null, live: false };
  }

  if (carrier === 'mondial_relay') {
    const result = await trackMondialRelay(number, trackingUrl);
    return { ...result, carrier };
  }

  if (carrier === 'colissimo' || carrier === 'chronopost') {
    const result = await trackOkapi(number, carrier, trackingUrl);
    return { ...result, carrier };
  }

  // Transporteur non reconnu — juste l'URL si possible
  return { label: 'Suivi', color: '#135E84', trackingUrl, carrier, live: false };
}

module.exports = { getTrackingStatus, detectCarrier, buildTrackingUrl };
