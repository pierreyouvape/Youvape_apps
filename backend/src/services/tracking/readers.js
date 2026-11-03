/**
 * Lecteurs de suivi : un par source, tous rendent la même chose.
 *
 *   { events: [{event_key, label, location, detail, occurred_at: Date}], notFound, message }
 *
 * `notFound` : le transporteur ne connaît pas (encore) le numéro — ce n'est pas
 * une panne. Une panne (réseau, réponse illisible, clé refusée) lève une erreur.
 *
 * Les fonctions `parse*` sont pures et testées sur des réponses réelles
 * (tests/fixtures/tracking/), relevées les 02 et 03/11/2026.
 *
 * Particularités relevées :
 *   - La Poste : les codes sont communs à Colissimo et à la Lettre suivie ; un
 *     numéro inconnu répond 400 (« pas valide »), pas 404.
 *   - Chronopost : codes complétés par des espaces (`D  `) ; un numéro inconnu
 *     répond errorCode 0 sans évènement.
 *   - Mondial Relay : AUCUN code par évènement, seulement un libellé coupé à
 *     30 caractères (« PRISE EN CHARGE PAR LE TRANSPO ») : c'est le libellé qui
 *     sert de clé. Dates `jj/mm/aa` + heure, en heure de Paris. Le statut global
 *     (STAT 80/81/82) ne distingue pas un retour d'un colis en route : on ne
 *     s'en sert pas pour l'état.
 */

const axios = require('axios');
const crypto = require('crypto');

const LAPOSTE_URL = 'https://api.laposte.fr/suivi/v2/idships';
const CHRONOPOST_URL = 'https://ws.chronopost.fr/tracking-cxf/TrackingServiceWS/trackSkybillV2';
const MONDIAL_RELAY_URL = 'https://api.mondialrelay.com/WebService.asmx';
const TIMEOUT_MS = 15000;

// ── XML ──────────────────────────────────────────────────────────────────────

const decode = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, '&');

/** Contenu de toutes les balises `tag` (préfixe d'espace de noms toléré). */
const tags = (xml, tag) => {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(String(xml || '')))) out.push(m[1]);
  return out;
};
const tag = (xml, name) => {
  const v = tags(xml, name)[0];
  return v === undefined ? null : decode(v).trim();
};

/** « jj/mm/aa » + « hh:mm », heure de Paris → Date. */
const parisDate = (jjmmaa, hhmm) => {
  const d = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(jjmmaa || '');
  const h = /^(\d{2}):(\d{2})$/.exec(hhmm || '00:00');
  if (!d || !h) return null;
  const asUtc = Date.UTC(2000 + Number(d[3]), Number(d[2]) - 1, Number(d[1]), Number(h[1]), Number(h[2]));
  // Décalage de Paris à cet instant : on lit l'heure de Paris de l'instant pris
  // comme UTC, l'écart donne l'offset (+1 h l'hiver, +2 h l'été).
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(asUtc));
  const g = (t) => Number(parts.find(p => p.type === t).value);
  const parisAsUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
  return new Date(asUtc - (parisAsUtc - asUtc));
};

// ── La Poste (Colissimo, Lettre suivie) ──────────────────────────────────────

/** @param {number} status @param {object} body */
const parseLaPoste = (status, body) => {
  if (status === 400 || status === 404) {
    return { events: [], notFound: true, message: body?.returnMessage || `Numéro inconnu de La Poste (HTTP ${status})` };
  }
  if (status !== 200 || !body || typeof body !== 'object' || !body.shipment) {
    throw new Error(`La Poste : réponse inattendue (HTTP ${status}) ${JSON.stringify(body).slice(0, 200)}`);
  }
  const events = (body.shipment.event || [])
    .filter(e => e.code && e.date)
    .map(e => ({
      event_key: String(e.code).trim(),
      label: e.label || null,
      location: null,
      detail: null,
      occurred_at: new Date(e.date),
    }));
  return { events, notFound: false, message: null };
};

const fetchLaPoste = async (number) => {
  const apiKey = process.env.OKAPI_API_KEY;
  if (!apiKey) throw new Error('Clé OKAPI_API_KEY absente');
  const res = await axios.get(`${LAPOSTE_URL}/${encodeURIComponent(number)}`, {
    params: { lang: 'fr_FR' },
    headers: { 'X-Okapi-Key': apiKey, Accept: 'application/json' },
    timeout: TIMEOUT_MS,
    validateStatus: () => true,
  });
  return parseLaPoste(res.status, res.data);
};

// ── Chronopost (Chronopost, 2Shop) ───────────────────────────────────────────

/** Les compléments qui disent POURQUOI (motif d'un retour, raison d'un échec). */
const CHRONO_DETAIL = ['Motif', 'Raison'];

const parseChronopost = (status, xml) => {
  const errorCode = tag(xml, 'errorCode');
  if (status !== 200 || errorCode === null) {
    throw new Error(`Chronopost : réponse inattendue (HTTP ${status}) ${String(xml).slice(0, 200)}`);
  }
  if (errorCode !== '0') {
    return { events: [], notFound: true, message: `Chronopost : code d'erreur ${errorCode}` };
  }
  const events = tags(xml, 'events')
    .map((e) => {
      const infos = tags(e, 'infoCompList').map(i => [tag(i, 'name'), tag(i, 'value')]);
      const detail = [...new Set(infos.filter(([n, v]) => CHRONO_DETAIL.includes(n) && v).map(([, v]) => v))];
      return {
        event_key: tag(e, 'code') || '',
        label: tag(e, 'eventLabel'),
        location: tag(e, 'officeLabel') || null,
        detail: detail.length ? detail.join(' — ') : null,
        occurred_at: new Date(tag(e, 'eventDate')),
      };
    })
    .filter(e => e.event_key && !Number.isNaN(e.occurred_at.getTime()));
  return { events, notFound: events.length === 0, message: events.length ? null : 'Aucun évènement chez Chronopost' };
};

const fetchChronopost = async (number) => {
  const res = await axios.get(CHRONOPOST_URL, {
    params: { language: 'fr_FR', skybillNumber: number },
    timeout: TIMEOUT_MS,
    responseType: 'text',
    validateStatus: () => true,
  });
  return parseChronopost(res.status, res.data);
};

// ── Mondial Relay (WSI2) ─────────────────────────────────────────────────────

/** STAT de WSI2 qui portent un suivi : 80 enregistré, 81 en cours, 82 livré, 83 anomalie, 0 vu sur des colis en route. */
const MR_STAT_OK = ['0', '00', '80', '81', '82', '83'];
const MR_STAT_NOT_FOUND = ['94'];

const parseMondialRelay = (status, xml) => {
  const stat = tag(xml, 'STAT');
  if (status !== 200 || stat === null) {
    throw new Error(`Mondial Relay : réponse inattendue (HTTP ${status}) ${String(xml).slice(0, 200)}`);
  }
  if (MR_STAT_NOT_FOUND.includes(stat)) {
    return { events: [], notFound: true, message: 'Colis inconnu de Mondial Relay (STAT 94)' };
  }
  if (!MR_STAT_OK.includes(stat)) {
    throw new Error(`Mondial Relay : STAT ${stat}`);
  }
  const events = tags(xml, 'ret_WSI2_sub_TracingColisDetaille')
    .map(e => ({
      event_key: tag(e, 'Libelle') || '',
      label: tag(e, 'Libelle'),
      location: tag(e, 'Emplacement') || null,
      detail: null,
      occurred_at: parisDate(tag(e, 'Date'), tag(e, 'Heure')),
    }))
    .filter(e => e.event_key && e.occurred_at);
  return { events, notFound: events.length === 0, message: events.length ? null : 'Aucun évènement chez Mondial Relay' };
};

/** Signature WSI2 : MD5 en majuscules des paramètres puis de la clé privée. */
const mondialRelaySecurity = (enseigne, expedition, langue, privateKey) =>
  crypto.createHash('md5').update(`${enseigne}${expedition}${langue}${privateKey}`).digest('hex').toUpperCase();

const fetchMondialRelay = async (number, { enseigne, privateKey }) => {
  if (!enseigne || !privateKey) {
    throw new Error('Clé privée WSI2 absente du contrat Mondial Relay (Paramètres du packing → Contrats API)');
  }
  const langue = 'FR';
  const xml = '<?xml version="1.0" encoding="utf-8"?>'
    + '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>'
    + '<WSI2_TracingColisDetaille xmlns="http://www.mondialrelay.fr/webservice/">'
    + `<Enseigne>${enseigne}</Enseigne><Expedition>${number}</Expedition><Langue>${langue}</Langue>`
    + `<Security>${mondialRelaySecurity(enseigne, number, langue, privateKey)}</Security>`
    + '</WSI2_TracingColisDetaille></soap:Body></soap:Envelope>';
  const res = await axios.post(MONDIAL_RELAY_URL, xml, {
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '"http://www.mondialrelay.fr/webservice/WSI2_TracingColisDetaille"',
    },
    timeout: TIMEOUT_MS,
    responseType: 'text',
    validateStatus: () => true,
  });
  return parseMondialRelay(res.status, res.data);
};

// ── Aiguillage ───────────────────────────────────────────────────────────────

/** Transporteur de l'étiquette → source de suivi. Absent = pas de suivi (retrait magasin). */
const SOURCE_BY_CARRIER = {
  colissimo: 'laposte',
  laposte: 'laposte',
  chronopost: 'chronopost',
  mondial_relay: 'mondial_relay',
};

module.exports = {
  SOURCE_BY_CARRIER,
  parseLaPoste, parseChronopost, parseMondialRelay, parisDate, mondialRelaySecurity,
  fetchLaPoste, fetchChronopost, fetchMondialRelay,
};
