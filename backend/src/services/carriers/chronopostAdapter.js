/**
 * Adaptateur Chronopost — Chrono Relais, Chrono 13, 2Shop, Chrono Express.
 *
 * Contrat détaillé dans `docs/chronopost-api.md`. Il a été reconstitué depuis
 * les deux plugins présents sur le site : `wc-multishipping` 3.0.3 (actif, celui
 * qui réserve les points au checkout) et le plugin officiel `chronopost` 4.2.1
 * (inactif, mais plus complet sur la livraison du samedi). Aucun des deux n'a
 * jamais émis d'étiquette ici : c'est BMS qui le faisait jusqu'au lot 3.
 *
 * Les particularités qui expliquent la forme de ce fichier :
 *
 *   - **SOAP, document/literal**, éléments non qualifiés. Pas de bibliothèque :
 *     l'enveloppe est écrite à la main, dans l'ordre exact du schéma, et la
 *     réponse lue par balise. Le WSDL public fait foi
 *     (https://ws.chronopost.fr/shipping-cxf/ShippingServiceWS?wsdl).
 *   - **Deux appels par étiquette**, comme les deux plugins :
 *     `shippingMultiParcelWithReservationV3` crée l'envoi et rend le numéro de
 *     colis, `getReservedSkybillWithTypeAndMode` rend le PDF.
 *   - **Les erreurs arrivent en HTTP 200**, dans `return.errorCode`.
 *   - **Les identifiants voyagent dans le corps.** Jamais de log du payload.
 *   - **Deux contrats** : le 2Shop France a le sien, tout le reste passe par le
 *     contrat principal. C'est le mappage des dénominations qui choisit.
 *   - **Le code produit se calcule** mode × pays, comme chez Colissimo :
 *     « 2Shop 2 à 4 jours ouvrés » couvre la France (`5X`) ET l'Allemagne et
 *     l'Italie (`6B`) sous une seule dénomination.
 *   - **Livraison le samedi** : un interrupteur du packing, coché d'office le
 *     vendredi, décide du code service (`6`). Il ne vaut que pour Chrono 13 et
 *     Chrono Relais.
 *   - **Annulation possible** (`cancelSkybill`) tant que Chronopost n'a pas pris
 *     le colis en charge.
 */

const axios = require('axios');
const { restrictToCharset } = require('./addressFields');
const { shiftContentDown } = require('./labelPdf');
const { assertAdapter } = require('./contract');
const { assertAccountComplete } = require('./accounts');

const LOG_TAG = 'Chronopost';
const CARRIER_LABEL = 'Chronopost';

const URL_SHIPPING_DEFAUT = 'https://ws.chronopost.fr/shipping-cxf/ShippingServiceWS';
const URL_TRACKING_DEFAUT = 'https://ws.chronopost.fr/tracking-cxf/TrackingServiceWS';
const NS_SHIPPING = 'http://cxf.shipping.soap.chronopost.fr/';
const NS_TRACKING = 'http://cxf.tracking.soap.chronopost.fr/';

// ── Modes et codes produit ───────────────────────────────────────────────────

/** Les modes qu'une dénomination WooCommerce peut désigner. */
const MODES = {
  relais:   { label: 'Chrono Relais (point relais France)' },
  domicile: { label: 'Chrono 13 (domicile France avant 13 h)' },
  '2shop':  { label: '2Shop (commerce de proximité, France ou Europe)' },
  express:  { label: 'Chrono Express (international, Union européenne)' }
};

/**
 * Codes produit, avec le libellé que BMS emploie pour ces expéditions (relevé
 * dans `method_description` le 23/09/2026) : c'est lui qui part dans la
 * confirmation d'expédition.
 */
const PRODUITS = {
  '86': { bms: 'Chrono Relais FR - Livraison en point relais en France' },
  '01': { bms: 'Chrono 13 - Livraison express à domicile avant 13H' },
  '5X': { bms: 'Chrono 2 Shop Direct - 2Shop Direct' },
  '6B': { bms: 'Chrono 2 Shop Europe - 2Shop Europe' },
  '17': { bms: 'Chrono Express - Livraison express partout dans le monde' }
};

// Chrono 13 : France métropolitaine et Monaco, rattaché à la zone France.
const PAYS_DOMICILE = new Set(['FR', 'MC']);

// Chrono Express sans déclaration douanière : l'Union européenne seulement.
// Hors UE, il faudrait une facture douanière que l'app ne produit pas pour
// Chronopost — on refuse plutôt que d'envoyer un colis bloqué en douane.
const PAYS_UE = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'GR', 'HR', 'HU',
  'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'
]);

// ── Livraison le samedi ──────────────────────────────────────────────────────

// Codes `service` de l'API : 0 = normal, 6 = livraison le samedi. Relevés dans
// les deux plugins, qui les emploient pour Chrono 13 et Chrono Relais.
const SERVICE_NORMAL = '0';
const SERVICE_SAMEDI = '6';

// 2Shop Europe a ses propres codes de service, selon le poids (plugin officiel,
// `chronotoshopeurope` : 337 jusqu'à 3 kg, 338 au-delà).
const serviceDeuxShopEurope = (grammes) => (Number(grammes) <= 3000 ? '337' : '338');

// Seuls Chrono 13 et Chrono Relais se livrent le samedi — demande de Pierre du
// 23/09/2026, conforme aux deux plugins (ni 2Shop Europe ni Express).
const PRODUITS_SAMEDI = new Set(['01', '86']);

/** Jour ISO (1 = lundi … 7 = dimanche) et heure, en heure de Paris : le VPS est en UTC. */
const instantParis = (now = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).map(x => [x.type, x.value]));
  const jours = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { jour: jours[p.weekday], heure: Number(p.hour), date: `${p.year}-${p.month}-${p.day}` };
};

/**
 * La livraison le samedi est-elle demandée pour ce colis ?
 *
 * L'interrupteur du packing décide : il n'est visible que le jeudi et le
 * vendredi, coché d'office le vendredi. Quand la demande n'en porte pas —
 * appel sans l'écran de packing —, la règle par défaut s'applique : oui le
 * vendredi, non les autres jours. Un produit qui ne se livre pas le samedi
 * l'ignore.
 *
 * @param {string} productCode
 * @param {?boolean} interrupteur - `options.saturdayDelivery`
 * @param {Date} [now]
 * @returns {boolean}
 */
const livraisonSamedi = (productCode, interrupteur, now = new Date()) => {
  if (!PRODUITS_SAMEDI.has(productCode)) return false;
  if (typeof interrupteur === 'boolean') return interrupteur;
  return instantParis(now).jour === 5;
};

// ── Refus explicites ─────────────────────────────────────────────────────────

/**
 * Refus destiné au packing, avant tout appel à l'API.
 * @throws {Error & {statusCode: number, userMessage: string}}
 */
const refus = (userMessage, statusCode = 400) => {
  const err = new Error(userMessage);
  err.statusCode = statusCode;
  err.userMessage = userMessage;
  throw err;
};

// ── Destination et point relais ──────────────────────────────────────────────

/**
 * Mode, pays et code produit d'une expédition.
 *
 * En point relais et en 2Shop, le pays qui compte est celui du POINT.
 *
 * @returns {{mode: string, pays: string, productCode: string}}
 */
const resolveDestination = ({ receiver = {}, options = {}, orderNumber }) => {
  const mode = options.deliveryMode || 'relais';
  const denomination = options.shippingMethod ? `« ${options.shippingMethod} »` : 'ce mode de livraison';

  if (!MODES[mode]) {
    refus(
      `Le mode Chronopost « ${mode} » n'existe pas (attendu : ${Object.keys(MODES).join(', ')}). `
      + `Demandez à un responsable de corriger ${denomination} dans les réglages.`
    );
  }

  const parPoint = requiresRelayPoint(mode);
  const pays = String((parPoint ? options.relayPoint?.country : null) || receiver.country || '')
    .trim().toUpperCase();

  const nonPris = () => refus(
    `Commande n°${orderNumber} : ${MODES[mode].label} n'est pas pris en charge vers `
    + `« ${pays || 'pays vide'} » par l'étiquetage de l'app. Expédiez-la par un autre moyen.`
  );

  let productCode = null;
  if (mode === 'relais') productCode = pays === 'FR' ? '86' : nonPris();
  if (mode === 'domicile') productCode = PAYS_DOMICILE.has(pays) ? '01' : nonPris();
  if (mode === '2shop') productCode = pays === 'FR' ? '5X' : (PAYS_UE.has(pays) ? '6B' : nonPris());
  if (mode === 'express') productCode = PAYS_UE.has(pays) ? '17' : nonPris();

  return { mode, pays, productCode };
};

/** Relais et 2Shop passent par un point ; Chrono 13 et Express livrent à l'adresse. */
function requiresRelayPoint(mode) {
  return mode === 'relais' || mode === '2shop' || !mode;
}

// Un point Chronopost — relais comme 2Shop, France comme Europe — a un code à 5
// caractères alphanumériques (« 854AF »). Constaté sur les 862 points en base
// le 23/09/2026, sans exception.
const FORMAT_POINT = /^[0-9A-Z]{5}$/;

/**
 * Vérifie que la commande porte un point Chronopost exploitable.
 *
 * Le réseau est contrôlé : un point Mondial Relay a lui aussi un code court, et
 * l'envoyer chez Chronopost ferait partir le colis on ne sait où.
 */
const assertRelayPoint = (relayPoint, orderNumber) => {
  const id = relayPoint && relayPoint.id != null ? String(relayPoint.id).trim().toUpperCase() : '';

  if (!id) {
    refus(
      `La commande n°${orderNumber} part en point relais Chronopost, mais aucun point n'y est `
      + `enregistré. Si elle a été créée à la main, saisissez le point dans sa fiche (app Commandes) ; `
      + `sinon, rouvrez et enregistrez-la dans WooCommerce pour récupérer le point choisi par le client.`
    );
  }

  if (relayPoint.network !== 'chronopost') {
    refus(
      `Le point relais de la commande n°${orderNumber} (« ${id} ») vient du réseau `
      + `« ${relayPoint.network || 'inconnu'} », pas de Chronopost. Vérifiez le point choisi dans `
      + `WooCommerce avant d'expédier.`
    );
  }

  if (!FORMAT_POINT.test(id)) {
    refus(
      `Le point relais de la commande n°${orderNumber} (« ${id} ») n'a pas le format attendu par `
      + `Chronopost : 5 lettres ou chiffres. Vérifiez le point choisi dans WooCommerce.`
    );
  }

  const pays = relayPoint.country ? String(relayPoint.country).trim() : '';
  if (!/^[A-Za-z]{2}$/.test(pays)) {
    refus(
      `Le pays du point relais de la commande n°${orderNumber} est absent ou invalide `
      + `(« ${pays || 'vide'} »). Rouvrez et enregistrez la commande dans WooCommerce pour le récupérer.`
    );
  }
};

// ── Champs ───────────────────────────────────────────────────────────────────

// Les deux plugins passent tout par `remove_accents` : on envoie de l'ASCII.
const CHARSET = {
  texte:      /[A-Za-z0-9 '.,\/()-]/,
  codePostal: /[0-9A-Za-z -]/
};

const texte = (valeur, max) => restrictToCharset(valeur, CHARSET.texte).substring(0, max).trim();

/**
 * Téléphone au format que Chronopost imprime et à qui il envoie ses SMS.
 *
 * Un numéro français part en national (`0612345678`) : c'est la forme que le
 * plugin officiel reconnaît comme mobile. On en voit en base écrits `+33…` et
 * même `+330…` (le zéro gardé derrière l'indicatif). Un numéro étranger garde
 * son indicatif, écrit `00…` : les champs de l'API sont numériques.
 *
 * @returns {{phone: string, mobile: string}}
 */
const normaliserTelephone = (brut, pays = 'FR') => {
  let s = String(brut || '').replace(/[^0-9+]/g, '');
  if (!s) return { phone: '', mobile: '' };

  const national = s.replace(/^(?:\+|00)33(?:0)?/, '0');
  if (/^0[1-9]\d{8}$/.test(national)) {
    return { phone: national, mobile: /^0[67]/.test(national) ? national : '' };
  }

  s = s.replace(/^\+/, '00').substring(0, 17);
  // Un numéro étranger est presque toujours un portable chez nos clients, mais
  // rien ne permet de le vérifier pour tous les pays : il part aux deux champs,
  // comme le fait wc-multishipping.
  return { phone: s, mobile: pays === 'FR' ? '' : s };
};

/** Grammes → kilogrammes, 10 g minimum. */
const kilos = (grammes) => (Math.max(Number(grammes) || 0, 10) / 1000).toFixed(3);

// ── Enveloppe SOAP ───────────────────────────────────────────────────────────

/** Échappement XML. Les adresses clients contiennent & et guillemets. */
const esc = (value) => String(value ?? '').replace(/[<>&'"]/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/**
 * Sérialise une liste ordonnée de [nom, valeur]. L'ordre est celui du schéma
 * (`xs:sequence`) : c'est pour ça que ce n'est pas un objet.
 */
const champs = (paires) => paires
  .filter(([, v]) => v !== undefined && v !== null)
  .map(([k, v]) => `<${k}>${esc(v)}</${k}>`)
  .join('');

const enveloppe = (ns, operation, corps) =>
  '<?xml version="1.0" encoding="UTF-8"?>'
  + '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" '
  + `xmlns:cxf="${ns}"><soapenv:Body><cxf:${operation}>${corps}</cxf:${operation}>`
  + '</soapenv:Body></soapenv:Envelope>';

const desEchapper = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, '&');

/** Contenu de la première balise `nom` (préfixe d'espace de noms toléré), ou null. */
const balise = (xml, nom) => {
  const m = String(xml || '').match(new RegExp(`<(?:[\\w-]+:)?${nom}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${nom}>`));
  return m ? desEchapper(m[1]) : null;
};

// ── Construction de la requête ───────────────────────────────────────────────

/**
 * Expéditeur, lu dans le contrat. Chronopost distingue l'expéditeur
 * (`shipper`) du donneur d'ordre (`customer`) : chez nous c'est la même
 * entreprise, les deux blocs portent donc les mêmes valeurs.
 */
const expediteur = (settings) => {
  const s = settings.sender || {};
  const tel = normaliserTelephone(s.phone, s.country || 'FR');
  return {
    Adress1: texte(s.address, 38),
    Adress2: texte(s.address_2, 38),
    City: texte(s.city, 50),
    Civility: s.civility || 'M',
    ContactName: texte(s.contact_name || s.name, 100),
    Country: String(s.country || 'FR').toUpperCase().substring(0, 2),
    Email: String(s.email || '').substring(0, 80),
    MobilePhone: tel.mobile,
    Name: texte(s.name, 100),
    Name2: texte(s.name2, 100),
    Phone: tel.phone,
    ZipCode: restrictToCharset(s.zipcode, CHARSET.codePostal).substring(0, 9)
  };
};

/** Bloc expéditeur ou donneur d'ordre, dans l'ordre du schéma. */
const blocPartie = (prefixe, e) => champs([
  [`${prefixe}Adress1`, e.Adress1],
  [`${prefixe}Adress2`, e.Adress2],
  [`${prefixe}City`, e.City],
  [`${prefixe}Civility`, e.Civility],
  [`${prefixe}ContactName`, e.ContactName],
  [`${prefixe}Country`, e.Country],
  [`${prefixe}Email`, e.Email],
  [`${prefixe}MobilePhone`, e.MobilePhone],
  [`${prefixe}Name`, e.Name],
  [`${prefixe}Name2`, e.Name2],
  [`${prefixe}Phone`, e.Phone],
  [`${prefixe}PreAlert`, 0],
  [`${prefixe}ZipCode`, e.ZipCode]
]);

/**
 * Destinataire.
 *
 * En point relais, l'adresse est celle du POINT et le nom du point passe en
 * premier, le client en second — ce que font les deux plugins. Un point saisi
 * à la main n'a ni nom ni adresse : on retombe alors sur l'adresse de la
 * commande, et c'est le code du point (`recipientRef`) qui route le colis.
 */
const destinataire = ({ receiver, relayPoint, parPoint, pays }) => {
  const client = texte(
    [receiver.first_name, receiver.last_name].filter(Boolean).join(' ') || receiver.name, 100
  );
  const societe = texte(receiver.company, 100);
  const tel = normaliserTelephone(receiver.phone || receiver.billing_phone, pays);
  const point = parPoint ? (relayPoint || {}) : {};

  return {
    Adress1: texte(point.address || receiver.address, 38),
    Adress2: parPoint ? '' : texte(receiver.address_2, 38),
    City: texte(point.city || receiver.city, 50),
    ContactName: client,
    Country: pays,
    Email: String(receiver.email || '').substring(0, 80),
    MobilePhone: tel.mobile,
    Name: parPoint ? (texte(point.name, 100) || societe || client) : (societe || client),
    Name2: client,
    Phone: tel.phone,
    ZipCode: restrictToCharset(point.postcode || receiver.postcode, CHARSET.codePostal).substring(0, 9)
  };
};

/**
 * Corps de `shippingMultiParcelWithReservationV3`.
 *
 * Fonction pure : c'est elle que le banc vérifie, sans réseau.
 *
 * @param {import('./contract').CreateLabelInput & {now?: Date}} input
 * @returns {{xml: string, dest: object, samedi: boolean, service: string}}
 */
const buildLabelPayload = ({ orderNumber, receiver = {}, account, weightGrams, options = {}, now = new Date() }) => {
  const c = account.credentials;
  const s = account.settings;
  const dest = resolveDestination({ receiver, options, orderNumber });
  const parPoint = requiresRelayPoint(dest.mode);
  const relayPoint = options.relayPoint || null;

  const samedi = livraisonSamedi(dest.productCode, options.saturdayDelivery, now);
  const service = dest.productCode === '6B'
    ? serviceDeuxShopEurope(weightGrams)
    : (samedi ? SERVICE_SAMEDI : SERVICE_NORMAL);

  const exp = expediteur(s);
  const dst = destinataire({ receiver, relayPoint, parPoint, pays: dest.pays });
  const ref = String(orderNumber);
  const { heure } = instantParis(now);

  const corps =
    `<headerValue>${champs([
      ['accountNumber', c.account_number],
      ['idEmit', 'CHRFR'],
      ['subAccount', Number(s.sub_account) || 0]
    ])}</headerValue>`
    + `<shipperValue>${blocPartie('shipper', exp)}</shipperValue>`
    + `<customerValue>${blocPartie('customer', exp)}</customerValue>`
    + `<recipientValue>${champs([
      ['recipientAdress1', dst.Adress1],
      ['recipientAdress2', dst.Adress2],
      ['recipientCity', dst.City],
      ['recipientContactName', dst.ContactName],
      ['recipientCountry', dst.Country],
      ['recipientEmail', dst.Email],
      ['recipientMobilePhone', dst.MobilePhone],
      ['recipientName', dst.Name],
      ['recipientName2', dst.Name2],
      ['recipientPhone', dst.Phone],
      ['recipientPreAlert', 0],
      ['recipientZipCode', dst.ZipCode]
    ])}</recipientValue>`
    // En point relais, c'est `recipientRef` qui désigne le point : le colis est
    // routé sur ce code, pas sur l'adresse.
    + `<refValue>${champs([
      ['recipientRef', parPoint ? String(relayPoint.id).trim().toUpperCase() : ref],
      ['shipperRef', ref]
    ])}</refValue>`
    + `<skybillValue>${champs([
      ['bulkNumber', 1],
      ['codCurrency', 'EUR'],
      ['evtCode', 'DC'],
      ['objectType', 'MAR'],
      ['productCode', dest.productCode],
      ['service', service],
      ['shipDate', now.toISOString()],
      ['shipHour', heure],
      ['skybillRank', 1],
      ['weight', kilos(weightGrams)],
      ['weightUnit', 'KGM'],
      // Dimensions obligatoires au schéma ; les plugins envoient 1 × 1 × 1.
      ['height', 1],
      ['length', 1],
      ['width', 1]
    ])}</skybillValue>`
    + `<skybillParamsValue>${champs([['mode', s.output_format || 'THE']])}</skybillParamsValue>`
    + champs([
      ['password', c.password],
      ['numberOfParcel', 1]
    ]);

  return {
    xml: enveloppe(NS_SHIPPING, 'shippingMultiParcelWithReservationV3', corps),
    dest,
    samedi,
    service
  };
};

// ── Appels ───────────────────────────────────────────────────────────────────

/**
 * Refus d'identifiants.
 *
 * Code 3 sur le service d'expédition = compte ou mot de passe refusé (à
 * confirmer au premier vrai refus : aucun plugin ne le traite à part). Le
 * message est aussi lu, par prudence. Même règle qu'au lot 2 : on ne réessaie
 * JAMAIS un refus d'identifiants, et tout traitement par lots s'arrête net.
 */
const estRefusIdentifiantsBrut = (code, message) =>
  String(code) === '3' || /authentif|mot de passe|password/i.test(String(message || ''));

const estRefusIdentifiants = (error) => Boolean(error && error.authFailure);

/**
 * POST SOAP. Renvoie le XML de la réponse, ou lève une erreur exploitable par
 * le packing (délai, panne, faute SOAP).
 */
const appeler = async (url, xml) => {
  let res;
  try {
    res = await axios.post(url, xml, {
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
      responseType: 'text',
      timeout: 30000,
      validateStatus: () => true
    });
  } catch (e) {
    // buildUserMessage reconnaît le délai dépassé au mot « Timeout ».
    const err = new Error(e.code === 'ECONNABORTED'
      ? `Timeout : ${CARRIER_LABEL} n'a pas répondu en 30 s`
      : `${CARRIER_LABEL} injoignable : ${e.message}`);
    err.statusCode = 504;
    throw err;
  }

  const corps = String(res.data || '');
  const faute = balise(corps, 'faultstring');
  if (faute) {
    console.error(`[${LOG_TAG}] Faute SOAP (HTTP ${res.status}) :`, faute);
    const err = new Error(`Chronopost : ${faute}`);
    // Une faute SOAP arrive en HTTP 500 mais dit presque toujours qu'un champ
    // est refusé par le schéma : c'est un refus, pas une panne à réessayer.
    err.statusCode = 400;
    err.userMessage = `Chronopost refuse la requête : ${faute}`;
    err.body = { fault: faute };
    throw err;
  }

  if (res.status !== 200 || !balise(corps, 'return')) {
    const err = new Error(`Réponse Chronopost inattendue (HTTP ${res.status})`);
    err.statusCode = res.status === 200 ? 502 : res.status;
    err.nonJson = true;
    throw err;
  }

  return corps;
};

/** Lève le refus porté par `return.errorCode`, s'il y en a un. */
const leverSiErreur = (corps, contexte) => {
  const code = balise(corps, 'errorCode');
  if (code == null || String(code).trim() === '0') return;

  const message = balise(corps, 'errorMessage') || 'erreur sans message';
  console.error(`[${LOG_TAG}] Refus ${code} (${contexte}) :`, message);
  const err = new Error(`Chronopost ${code} : ${message}`);
  err.statusCode = 400;
  err.userMessage = `Chronopost refuse l'étiquette : ${message} (code ${code})`;
  err.body = { code, message };

  if (estRefusIdentifiantsBrut(code, message)) {
    err.authFailure = true;
    err.statusCode = 401;
    err.userMessage = `Chronopost refuse les identifiants du contrat (code ${code} : ${message}). `
      + `NE RÉESSAYEZ PAS : des tentatives répétées peuvent bloquer le compte, BMS compris. `
      + `Prévenez un responsable, qui doit vérifier le contrat dans les réglages.`;
  }
  throw err;
};

// ── Contrat ──────────────────────────────────────────────────────────────────

/** Poids réel de la commande, en grammes ; converti en kilogrammes dans le payload. */
const resolveWeight = async ({ pool, orderNumber }) => {
  const { computeOrderWeight } = require('../orderWeightService');
  const grams = await computeOrderWeight(pool, orderNumber);

  if (!grams || grams <= 0) {
    const err = new Error(
      `Poids introuvable ou nul pour la commande ${orderNumber} — Chronopost refuse une expédition sans poids`
    );
    err.statusCode = 400;
    throw err;
  }
  return Math.round(grams);
};

// Modes de sortie PDF de l'API : A4 avec preuve de dépôt, A4 sans, thermique
// 10x15. Le tamponnage du numéro de commande exige un PDF : un ZPL serait payé
// puis impossible à enregistrer.
const FORMATS_PDF = new Set(['PDF', 'SPD', 'THE']);

/**
 * Demande une étiquette à Chronopost.
 *
 * @param {import('./contract').CreateLabelInput} input
 * @returns {Promise<import('./contract').CreateLabelResult>}
 */
const createLabel = async ({ orderNumber, receiver, account, weightGrams, options = {} }) => {
  assertAccountComplete(account, { credentials: ['account_number', 'password'] });
  const format = account.settings.output_format || 'THE';
  if (!FORMATS_PDF.has(format)) {
    refus(
      `Contrat Chronopost : le format d'étiquette « ${format} » n'est pas un PDF. L'app ne sait `
      + `tamponner et réimprimer que du PDF (THE, PDF ou SPD).`,
      500
    );
  }

  const dest = resolveDestination({ receiver, options, orderNumber });
  if (requiresRelayPoint(dest.mode)) assertRelayPoint(options.relayPoint, orderNumber);

  const { xml, samedi, service } = buildLabelPayload({ orderNumber, receiver, account, weightGrams, options });

  console.log(`[${LOG_TAG}] Commande`, orderNumber,
    '— contrat:', account.accountCode, '| produit:', dest.productCode, '| service:', service,
    samedi ? '(SAMEDI)' : '', '| pays:', dest.pays,
    requiresRelayPoint(dest.mode) ? `| point: ${options.relayPoint.id}` : '',
    '| poids:', weightGrams, 'g');

  const url = account.settings.shipping_url || URL_SHIPPING_DEFAUT;
  const reponse = await appeler(url, xml);
  leverSiErreur(reponse, 'création');

  const reservation = balise(reponse, 'reservationNumber');
  const trackingNumber = balise(balise(reponse, 'resultParcelValue') || '', 'skybillNumber');

  if (!reservation || !trackingNumber) {
    console.error(`[${LOG_TAG}] Réponse sans réservation ou sans numéro de colis`);
    const err = new Error('Réponse Chronopost sans numéro de réservation ou sans numéro de colis');
    err.statusCode = 502;
    throw err;
  }

  // Second appel : le PDF. Le colis existe déjà chez Chronopost ; si ce second
  // appel échoue, on le dit avec le numéro, pour pouvoir l'annuler.
  let pdf;
  try {
    const pdfReponse = await appeler(url, enveloppe(NS_SHIPPING, 'getReservedSkybillWithTypeAndMode',
      champs([['reservationNumber', reservation], ['mode', format]])));
    leverSiErreur(pdfReponse, 'lecture du PDF');
    pdf = balise(pdfReponse, 'skybill');
  } catch (e) {
    e.userMessage = `Chronopost a créé le colis ${trackingNumber} mais n'a pas rendu l'étiquette `
      + `(${e.message}). Réessayer créerait un second colis : prévenez un responsable, qui l'annulera `
      + `dans l'espace Chronopost.`;
    throw e;
  }

  if (!pdf) {
    const err = new Error(`Réponse Chronopost sans étiquette pour le colis ${trackingNumber}`);
    err.statusCode = 502;
    throw err;
  }

  const decalage = Number(account.settings.label_top_offset_mm || 0);
  const pdfBase64 = await shiftContentDown(pdf.replace(/\s+/g, ''), decalage);

  return {
    carrierOrderId: reservation,
    trackingNumber,
    pdfBase64,
    // Le samedi se lit sur l'étiquette enregistrée : c'est lui qui dira, plus
    // tard, pourquoi un colis a coûté plus cher.
    methodCode: samedi ? `${dest.productCode}-SAMEDI` : dest.productCode,
    bmsShipmentTitle: PRODUITS[dest.productCode].bms
  };
};

/**
 * Chronopost annule tant qu'il n'a pas pris le colis en charge. Cette limite
 * n'est connue que de lui : on laisse tenter, et son refus est rendu tel quel.
 */
const cancelWindow = () => ({ cancellable: true, reason: null });

const REFUS_ANNULATION = {
  1: "Chronopost n'a pas pu annuler l'étiquette (erreur de leur côté). Réessayez plus tard.",
  2: "Ce colis n'appartient pas à ce contrat, ou Chronopost ne l'a pas encore enregistré. Réessayez dans quelques minutes.",
  3: 'Chronopost a déjà pris ce colis en charge : il ne peut plus être annulé.'
};

/**
 * Annule l'étiquette côté Chronopost (`cancelSkybill`).
 * @returns {Promise<{errorCode: string, statusCode: ?string}>}
 */
const cancelLabel = async ({ label, account }) => {
  assertAccountComplete(account, { credentials: ['account_number', 'password'] });

  const xml = enveloppe(NS_TRACKING, 'cancelSkybill', champs([
    ['accountNumber', account.credentials.account_number],
    ['password', account.credentials.password],
    ['language', 'fr_FR'],
    ['skybillNumber', label.tracking_number]
  ]));

  const reponse = await appeler(account.settings.tracking_url || URL_TRACKING_DEFAUT, xml);
  const code = String(balise(reponse, 'errorCode') || '').trim();

  console.log(`[${LOG_TAG}] Annulation du colis`, label.tracking_number, '— code', code);

  if (code !== '0') {
    const message = REFUS_ANNULATION[code] || `Chronopost refuse l'annulation (code ${code} : ${balise(reponse, 'errorMessage') || 'sans message'})`;
    const err = new Error(message);
    err.statusCode = 400;
    throw err;
  }

  return { errorCode: code, statusCode: balise(reponse, 'statusCode') };
};

/**
 * Nom du fichier téléchargé au packing : `chronopost_<n°>.pdf`. Les règles
 * AutoPrint des postes sont posées par Pierre (décision du 23/09/2026).
 */
const labelFileName = (orderNumber) => `chronopost_${orderNumber}.pdf`;

// Champs du contrat. Deux contrats, mêmes champs : `principal` et `2shop`.
const ACCOUNT_FIELDS = {
  credentials: [
    { key: 'account_number', label: 'N° de compte Chronopost', required: true, placeholder: '34751303' },
    { key: 'password',       label: 'Mot de passe Web Services', required: true, secret: true }
  ],
  settings: [
    { key: 'sender.name',         label: 'Raison sociale',      group: 'Expéditeur', required: true },
    { key: 'sender.name2',        label: 'Complément de nom',   group: 'Expéditeur' },
    { key: 'sender.contact_name', label: 'Contact',             group: 'Expéditeur' },
    { key: 'sender.address',      label: 'Adresse',             group: 'Expéditeur', required: true },
    { key: 'sender.address_2',    label: "Complément d'adresse", group: 'Expéditeur' },
    { key: 'sender.zipcode',      label: 'Code postal',         group: 'Expéditeur', required: true },
    { key: 'sender.city',         label: 'Ville',               group: 'Expéditeur', required: true },
    { key: 'sender.country',      label: 'Pays (2 lettres)',    group: 'Expéditeur', required: true, placeholder: 'FR' },
    { key: 'sender.civility',     label: 'Civilité (M, E, L)',  group: 'Expéditeur', placeholder: 'M' },
    { key: 'sender.email',        label: 'Courriel',            group: 'Expéditeur' },
    { key: 'sender.phone',        label: 'Téléphone',           group: 'Expéditeur' },

    // Avancés : valeurs par défaut de l'adaptateur si le champ reste vide.
    { key: 'output_format',       label: "Format d'étiquette (THE = PDF thermique 10x15, PDF, SPD)", advanced: true, placeholder: 'THE' },
    { key: 'label_top_offset_mm', label: "Décalage de l'étiquette vers le bas (mm)", advanced: true, placeholder: '0' },
    { key: 'sub_account',         label: 'Sous-compte',        advanced: true, placeholder: '0' },
    { key: 'shipping_url',        label: "URL du service d'expédition", advanced: true, perContract: true, placeholder: URL_SHIPPING_DEFAUT },
    { key: 'tracking_url',        label: "URL du service de suivi (annulation)", advanced: true, perContract: true, placeholder: URL_TRACKING_DEFAUT }
  ]
};

module.exports = assertAdapter({
  code: 'chronopost',
  accountCode: 'principal',
  methodCode: 'relais',
  label: CARRIER_LABEL,
  logTag: LOG_TAG,
  labelFileName,
  accountFields: ACCOUNT_FIELDS,
  // Libellé par défaut ; chaque étiquette rend celui de son produit.
  bmsShipmentTitle: PRODUITS['86'].bms,
  deliveryModes: Object.entries(MODES).map(([code, m]) => ({ code, label: m.label })),
  requiresRelayPoint,
  // Modes livrables le samedi : le packing n'affiche l'interrupteur que pour eux.
  supportsSaturdayDelivery: (deliveryMode) => deliveryMode === 'relais' || deliveryMode === 'domicile',
  relayNetworkLabel: 'Chronopost / 2Shop',
  // Chronopost n'émet aucun bordereau par API (le plugin officiel fabrique le
  // sien en PDF local) : l'app produit son récapitulatif, un par contrat.
  depositSlip: { kind: 'local', maxParcels: null, numberPrefix: 'CH' },
  resolveWeight,
  createLabel,
  cancelLabel,
  cancelWindow,
  // Exposés pour le banc et pour la répétition avant mise en service.
  estRefusIdentifiants,
  buildLabelPayload,
  resolveDestination,
  assertRelayPoint,
  livraisonSamedi,
  instantParis,
  normaliserTelephone,
  balise,
  PRODUITS
});
