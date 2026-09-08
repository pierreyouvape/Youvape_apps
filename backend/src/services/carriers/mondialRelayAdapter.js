/**
 * Adaptateur Mondial Relay — API Connect (« API 2 »).
 *
 * Contrat détaillé dans `docs/mondial-relay-api.md`. Les particularités qui
 * expliquent la forme de ce fichier :
 *
 *   - **Requête en XML, réponse en JSON.** Pas de JSON en entrée, pas de XML en
 *     sortie. Les clés de réponse sont suffixées `Field` (sérialisation .NET).
 *   - **Aucune authentification HTTP** : login et mot de passe voyagent dans le
 *     corps XML. Une sonde HTTP ne peut donc pas valider des identifiants.
 *   - **Les erreurs arrivent en HTTP 200.** Le code HTTP ne dit rien ; c'est
 *     `statusListField` qu'il faut lire. Vérifié sur le sandbox : refus de
 *     produit, point relais inexistant, plan de tri absent — tous en 200.
 *   - **La réponse renvoie le mot de passe en clair.** Jamais de log brut.
 *   - **Pas d'annulation.** L'API Connect ne fait que créer.
 *   - **L'étiquette arrive en URL**, pas en base64 : on la télécharge, sinon la
 *     réimpression ne marcherait plus hors ligne.
 */

const axios = require('axios');
const { sanitizeAddressField, restrictToCharset } = require('./addressFields');
const { assertAdapter } = require('./contract');
const { assertAccountComplete } = require('./accounts');

const LOG_TAG = 'MondialRelay';
const CARRIER_LABEL = 'Mondial Relay';

/** Échappement XML. Les adresses clients contiennent & et guillemets. */
const esc = (value) => String(value ?? '').replace(/[<>&'"]/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

// Pays où le numéro suit le nom de rue. C'est la convention de tout le
// Benelux et de l'espace germanophone — « BERLARIJ 54 », pas « 54 BERLARIJ ».
// Nos points relais sont en France, Belgique et Luxembourg : la moitié de nos
// adresses relais suit donc la convention inverse de la française.
const NUMERO_APRES_RUE = new Set(['BE', 'NL', 'LU', 'DE', 'AT', 'CH']);

/**
 * Sépare le numéro de voie du nom de rue.
 *
 * Mondial Relay veut `HouseNo` et `Streetname` en deux champs, là où
 * WooCommerce n'en a qu'un. La position du numéro dépend du pays, et se
 * tromper de convention est pire que ne rien faire : « Rue du 8 Mai 1945 »
 * livrerait un numéro « 1945 » si on cherchait bêtement un nombre en fin de
 * ligne. On applique donc la règle du pays, sans repli vers l'autre.
 *
 * Quand rien ne ressemble à un numéro, `HouseNo` reste vide plutôt qu'inventé :
 * l'adresse reste complète dans `Streetname`.
 *
 * @param {string} line
 * @param {string} [countryCode] - pays du destinataire
 * @returns {{houseNo: string, streetname: string}}
 */
const splitStreet = (line, countryCode = 'FR') => {
  const s = String(line ?? '').trim();
  if (!s) return { houseNo: '', streetname: '' };

  const suffixe = '(?:\\s*(?:bis|ter|quater|[A-Za-z]))?';

  if (NUMERO_APRES_RUE.has(String(countryCode).toUpperCase())) {
    const m = s.match(new RegExp(`^(.*?)[\\s,]+(\\d{1,5}${suffixe})$`, 'i'));
    if (m) return { houseNo: m[2].replace(/\s+/g, '').substring(0, 10), streetname: m[1].trim() };
    return { houseNo: '', streetname: s };
  }

  const m = s.match(new RegExp(`^(\\d{1,5}${suffixe})\\s+(.*)$`, 'i'));
  if (!m) return { houseNo: '', streetname: s };
  return { houseNo: m[1].replace(/\s+/g, '').substring(0, 10), streetname: m[2].trim() };
};

// Jeux de caractères admis par Mondial Relay, champ par champ (schéma officiel).
// Tout ce qui en sort fait échouer la validation — y compris des caractères
// INVISIBLES que personne ne voit dans l'interface : la commande 1259134
// portait un U+202A devant le prénom, venu d'un clavier arabe, et faisait
// échouer la clé de sécurité côté BMS.
const CHARSET = {
  // Ni chiffre ni ponctuation exotique. « Lyon 3e » devient « Lyon e ».
  city:     /[A-Za-zÀ-ÖØ-öø-ÿ_'.,\s-]/,
  name:     /[A-Za-zÀ-ÖØ-öø-ÿ_'.,\s-]/,
  street:   /[0-9A-Za-zÀ-ÖØ-öø-ÿ_'.,\s-]/,
  houseNo:  /[0-9A-Z_'.,/-]/,
  postcode: /[0-9A-Za-z_'-]/
};

/**
 * Nettoie un champ pour Mondial Relay, et refuse de le vider en silence.
 *
 * Un nom entièrement hors alphabet latin — cyrillique, arabe, grec — ne laisse
 * rien après filtrage. Envoyer un champ vide ferait échouer l'appel avec un
 * message incompréhensible, ou pire, imprimerait une étiquette sans
 * destinataire. On refuse tout de suite, en nommant le champ fautif et sa
 * valeur, pour que la personne au packing sache quoi corriger.
 *
 * @throws {Error & {statusCode: number}} si le nettoyage vide un champ qui ne l'était pas
 */
const champ = (valeur, charset, nomChamp, { obligatoire = false, orderNumber } = {}) => {
  const source = String(valeur ?? '').trim();
  const propre = restrictToCharset(source, charset);

  if (obligatoire && source && !propre) {
    const err = new Error(
      `Commande ${orderNumber} : le champ « ${nomChamp} » (« ${source} ») ne contient aucun caractère `
      + `accepté par Mondial Relay. Corrigez l'adresse dans la commande avant d'expédier.`
    );
    err.statusCode = 400;
    throw err;
  }
  return propre;
};

/**
 * Applique les deux contraintes de longueur COMBINÉE du schéma Mondial Relay :
 * `Title`+`Firstname`+`Lastname` ≤ 32 et `Streetname`+`HouseNo` ≤ 40.
 *
 * C'est le piège du schéma : chaque champ passe isolément, c'est la somme qui
 * est refusée. Un nom trop long doit rétrécir plutôt que faire échouer
 * l'expédition — le colis part avec un nom tronqué, ce qui reste très
 * préférable à un colis qui ne part pas.
 */
const fitCombined = (parts, max) => {
  const out = [...parts];
  let total = out.join('').length;
  for (let i = out.length - 1; i >= 0 && total > max; i--) {
    const excess = total - max;
    const keep = Math.max(0, out[i].length - excess);
    total -= out[i].length - keep;
    out[i] = out[i].substring(0, keep).trim();
  }
  return out;
};

/**
 * Poids réel de la commande, en grammes — à la différence de la lettre suivie,
 * qui est au forfait. `Weight Unit="gr"` : l'API attend justement des grammes,
 * comme `orderWeightService`.
 */
const resolveWeight = async ({ pool, orderNumber }) => {
  const { computeOrderWeight } = require('../orderWeightService');
  const grams = await computeOrderWeight(pool, orderNumber);

  if (!grams || grams <= 0) {
    const err = new Error(
      `Poids introuvable ou nul pour la commande ${orderNumber} — Mondial Relay refuse une expédition sans poids`
    );
    err.statusCode = 400;
    throw err;
  }
  return Math.round(grams);
};

/** Bloc `<Address>` d'une personne, chaque champ ramené au jeu admis. */
const addressXml = (p, ctx = {}) => {
  const [title, firstname, lastname] = fitCombined([
    p.title || '',
    champ(p.firstname, CHARSET.name, 'prénom', ctx),
    champ(p.lastname, CHARSET.name, 'nom', ctx)
  ], 32);

  const { houseNo, streetname } = splitStreet(
    champ(p.addressLine, CHARSET.street, 'adresse', ctx),
    p.countryCode
  );
  const [street, house] = fitCombined([streetname, houseNo.toUpperCase()], 40);

  return `<Title>${esc(title)}</Title>` +
    `<Firstname>${esc(firstname)}</Firstname>` +
    `<Lastname>${esc(lastname)}</Lastname>` +
    `<Streetname>${esc(street)}</Streetname>` +
    `<HouseNo>${esc(restrictToCharset(house, CHARSET.houseNo))}</HouseNo>` +
    `<CountryCode>${esc((p.countryCode || 'FR').toUpperCase().substring(0, 2))}</CountryCode>` +
    `<PostCode>${esc(restrictToCharset(String(p.postcode || ''), CHARSET.postcode).substring(0, 10))}</PostCode>` +
    `<City>${esc(champ(p.city, CHARSET.city, 'ville', ctx).substring(0, 30))}</City>` +
    `<PhoneNo>${esc(String(p.phone || '').substring(0, 20))}</PhoneNo>` +
    `<MobileNo>${esc(String(p.mobile || '').substring(0, 20))}</MobileNo>` +
    `<Email>${esc(String(p.email || '').substring(0, 70))}</Email>`;
};

/**
 * Construit le corps XML de la demande d'étiquette.
 *
 * Fonction pure : c'est elle que le banc de non-régression vérifie, sans réseau.
 *
 * @param {import('./contract').CreateLabelInput} input
 * @returns {string} XML
 */
const buildLabelPayload = ({ orderNumber, receiver, account, weightGrams, options = {} }) => {
  const c = account.credentials;
  const s = account.settings;
  const sender = s.sender || {};

  const deliveryMode = options.deliveryMode || '24R';
  const relay = options.relayPoint || {};

  // Location = pays du point relais + son code. JAMAIS « FR » en dur : nos
  // points sont aussi en Belgique et au Luxembourg.
  const location = relay.id
    ? `${String(relay.country || 'FR').toUpperCase()}-${String(relay.id).toUpperCase()}`
    : '';

  // OrderNo n'accepte que [0-9A-Z_-], 15 max.
  const orderNo = String(orderNumber).toUpperCase().replace(/[^0-9A-Z_-]/g, '').substring(0, 15);

  return `<?xml version="1.0" encoding="utf-8"?>
<ShipmentCreationRequest xmlns="http://www.example.org/Request">
<Context><Login>${esc(c.login)}</Login><Password>${esc(c.password)}</Password>` +
    `<CustomerId>${esc(c.customer_id)}</CustomerId>` +
    `<Culture>${esc(s.culture || 'fr-FR')}</Culture>` +
    `<VersionAPI>${esc(s.version_api || '1.0')}</VersionAPI></Context>
<OutputOptions><OutputFormat>${esc(s.output_format || '10x15')}</OutputFormat>` +
    `<OutputType>${esc(s.output_type || 'PdfUrl')}</OutputType></OutputOptions>
<ShipmentsList><Shipment>` +
    `<OrderNo>${esc(orderNo)}</OrderNo>` +
    `<ParcelCount>1</ParcelCount>` +
    `<CollectionMode Mode="${esc(s.collection_mode || 'CCC')}"/>` +
    `<DeliveryMode Mode="${esc(deliveryMode)}"${location ? ` Location="${esc(location)}"` : ''}/>` +
    `<Parcels><Parcel><Content>${esc((s.parcel_content || 'Cigarette electronique').substring(0, 40))}</Content>` +
    `<Weight Value="${Number(weightGrams)}" Unit="gr"/></Parcel></Parcels>` +
    `<Sender><Address>${addressXml({ ...sender, addressLine: sender.address_line || `${sender.house_no || ''} ${sender.streetname || ''}`.trim(), countryCode: sender.country_code, postcode: sender.postcode })}</Address></Sender>` +
    `<Recipient><Address>${addressXml({
      title: receiver.title,
      firstname: receiver.first_name || receiver.name || '',
      lastname: receiver.last_name || '',
      addressLine: receiver.address || '',
      countryCode: receiver.country,
      postcode: receiver.postcode,
      city: receiver.city,
      phone: receiver.phone,
      mobile: receiver.phone,
      email: receiver.email
    }, { obligatoire: true, orderNumber })}</Address></Recipient>` +
    `</Shipment></ShipmentsList></ShipmentCreationRequest>`;
};

/**
 * Retire tout secret d'une réponse avant de la journaliser.
 * L'API renvoie `contextField.passwordField` **en clair**.
 */
const redact = (data) => {
  if (!data || typeof data !== 'object') return data;
  const copy = JSON.parse(JSON.stringify(data));
  if (copy.contextField) {
    if (copy.contextField.passwordField) copy.contextField.passwordField = '***';
    if (copy.contextField.loginField) copy.contextField.loginField = '***';
  }
  return copy;
};

/** Première erreur de `statusListField`, ou null. */
const findError = (data) => (data?.statusListField || [])
  .find(s => String(s?.levelField || '').toLowerCase().includes('error')) || null;

// Format d'un identifiant de point relais Mondial Relay : exactement 6 chiffres,
// zéros de tête compris. Constaté sur 566 commandes réelles, sans exception.
// Le contrôle attrape aussi les codes d'un AUTRE réseau posés par erreur sur une
// commande Mondial Relay — Chronopost utilise 5 caractères alphanumériques
// (« 5761X »), et on a déjà vu des Bpost Relais étiquetés réseau `mondial_relay`.
const FORMAT_POINT_RELAIS = /^[0-9]{6}$/;
const FORMAT_PAYS = /^[A-Za-z]{2}$/;

/**
 * Vérifie que la commande porte un point relais exploitable.
 *
 * Sans ce contrôle, un code absent ou mal formé part quand même chez Mondial
 * Relay, qui répond « Le plan de tri est introuvable » (10055) — un message que
 * personne au comptoir ne peut interpréter. On préfère refuser ici, en disant
 * ce qui manque et quoi faire.
 *
 * @param {?object} relayPoint - `orders.relay_point`
 * @param {string|number} orderNumber
 * @throws {Error & {statusCode: number, userMessage: string}}
 */
const assertRelayPoint = (relayPoint, orderNumber) => {
  const refus = (userMessage) => {
    const err = new Error(userMessage);
    err.statusCode = 400;
    // Message destiné au packing : il est repris tel quel à l'écran.
    err.userMessage = userMessage;
    throw err;
  };

  const id = relayPoint && relayPoint.id != null ? String(relayPoint.id).trim() : '';

  if (!relayPoint || !id) {
    refus(
      `La commande n°${orderNumber} part en Mondial Relay, mais aucun point relais n'y est `
      + `enregistré. Rouvrez et enregistrez la commande dans WooCommerce pour récupérer le point `
      + `choisi par le client, ou expédiez-la par un autre transporteur.`
    );
  }

  // Aucune tentative de rattrapage : un identifiant qui ne fait pas 6 chiffres
  // est refusé tel quel, sans qu'on essaie de le compléter ou de le tronquer.
  // On ne sait pas ce qu'il est — un code d'un autre réseau, une valeur tronquée,
  // une saisie manuelle — et chaque hypothèse de correction enverrait le colis
  // quelque part sans qu'on puisse dire où. Le zéro de tête, lui, ne se perd pas
  // en chemin : yousync convertit `pickup_id` en chaîne à la source.
  if (!FORMAT_POINT_RELAIS.test(id)) {
    refus(
      `Le point relais de la commande n°${orderNumber} (« ${id} ») n'a pas le format attendu par `
      + `Mondial Relay : 6 chiffres. Ce code vient probablement d'un autre transporteur. `
      + `Vérifiez le point de retrait de la commande dans WooCommerce.`
    );
  }

  const pays = relayPoint.country ? String(relayPoint.country).trim() : '';
  if (!FORMAT_PAYS.test(pays)) {
    refus(
      `Le pays du point relais de la commande n°${orderNumber} est absent ou invalide `
      + `(« ${pays || 'vide'} »). Mondial Relay attend un code pays à deux lettres (FR, BE, LU). `
      + `Rouvrez et enregistrez la commande dans WooCommerce pour le récupérer.`
    );
  }
};

/**
 * Demande une étiquette à Mondial Relay.
 *
 * @param {import('./contract').CreateLabelInput} input
 * @returns {Promise<import('./contract').CreateLabelResult>}
 */
const createLabel = async ({ orderNumber, receiver, account, weightGrams, options = {} }) => {
  assertAccountComplete(account, {
    credentials: ['login', 'password', 'customer_id'],
    settings: ['api_url']
  });

  assertRelayPoint(options.relayPoint, orderNumber);

  const xml = buildLabelPayload({ orderNumber, receiver, account, weightGrams, options });

  console.log(`[${LOG_TAG}] Appel API pour commande`, orderNumber,
    '— mode:', options.deliveryMode || '24R',
    '| point:', `${options.relayPoint.country}-${options.relayPoint.id}`,
    '| poids:', weightGrams, 'g');

  const res = await axios.post(account.settings.api_url, xml, {
    headers: { 'Content-Type': 'application/xml' },
    timeout: 30000,
    validateStatus: () => true
  });

  // Le code HTTP ne dit rien : Mondial Relay répond 200 y compris sur refus.
  const error = findError(res.data);
  if (error) {
    console.error(`[${LOG_TAG}] Refus ${error.codeField}:`, error.messageField);
    const err = new Error(`Mondial Relay ${error.codeField} : ${error.messageField}`);
    err.statusCode = 400;
    err.body = { code: error.codeField, message: error.messageField };
    throw err;
  }

  const shipment = res.data?.shipmentsListField?.[0];
  const trackingNumber = shipment?.shipmentNumberField || null;
  const labelUrl = shipment?.labelListField?.labelField?.outputField || null;

  if (!trackingNumber || !labelUrl) {
    console.error(`[${LOG_TAG}] Réponse inattendue:`, JSON.stringify(redact(res.data)).substring(0, 500));
    const err = new Error('Réponse Mondial Relay sans numéro d\'expédition ou sans étiquette');
    err.statusCode = 502;
    throw err;
  }

  // L'étiquette est une URL. On la télécharge : shipment_labels stocke du base64,
  // et la réimpression doit marcher même si Mondial Relay est indisponible.
  const pdf = await axios.get(labelUrl, { responseType: 'arraybuffer', timeout: 30000 });
  const pdfBase64 = Buffer.from(pdf.data).toString('base64');

  return { carrierOrderId: trackingNumber, trackingNumber, pdfBase64 };
};

/**
 * Mondial Relay ne sait pas annuler par API : Connect ne fait que créer.
 * On le dit franchement plutôt que de laisser croire à une annulation.
 */
const cancelWindow = () => ({
  cancellable: false,
  reason: "Mondial Relay ne permet pas d'annuler une étiquette par API — une étiquette non utilisée n'est pas facturée"
});

const cancelLabel = async () => {
  const err = new Error("L'API Mondial Relay ne permet pas l'annulation d'une étiquette");
  err.statusCode = 400;
  throw err;
};

/**
 * Nom du fichier téléchargé au packing : `mondialrelay_<n°>.pdf`.
 *
 * Convention propre à Mondial Relay, sur laquelle AutoPrint se règle pour
 * router vers la bonne imprimante. Elle diffère de celle de la lettre suivie
 * (`LS-<n°>.pdf`) — chaque transporteur a la sienne, et c'est justement ce qui
 * permet à AutoPrint de les distinguer.
 */
const labelFileName = (orderNumber) => `mondialrelay_${orderNumber}.pdf`;

// Champs du contrat. Les libellés reprennent ceux de l'écran « Paramétrage des
// API » de Mondial Relay (API 2 / Connect), pour qu'un responsable recopie sans
// avoir à interpréter.
const ACCOUNT_FIELDS = {
  credentials: [
    { key: 'login',       label: 'Connexion API', placeholder: 'LGYOUVAP@business-api.mondialrelay.com' },
    { key: 'password',    label: "Mot de passe API", secret: true },
    { key: 'customer_id', label: "Identification de marque (code enseigne)", placeholder: 'LGYOUVAP' }
  ],
  settings: [
    { key: 'api_url',       label: "URL de l'API", placeholder: 'https://connect-api.mondialrelay.com/api/shipment' },
    { key: 'output_format', label: "Format d'étiquette", placeholder: '10x15' },
    { key: 'sandbox',       label: 'Contrat de test (aucune expédition réelle)' },
    { key: 'sender.firstname',   label: 'Prénom / enseigne', group: 'Expéditeur' },
    { key: 'sender.lastname',    label: 'Raison sociale',    group: 'Expéditeur' },
    { key: 'sender.house_no',    label: 'N° de voie',        group: 'Expéditeur' },
    { key: 'sender.streetname',  label: 'Rue',               group: 'Expéditeur' },
    { key: 'sender.postcode',    label: 'Code postal',       group: 'Expéditeur' },
    { key: 'sender.city',        label: 'Ville',             group: 'Expéditeur' },
    { key: 'sender.country_code',label: 'Pays (2 lettres)',  group: 'Expéditeur' },
    { key: 'sender.email',       label: 'Courriel',          group: 'Expéditeur' },
    { key: 'sender.phone',       label: 'Téléphone',         group: 'Expéditeur' }
  ]
};

module.exports = assertAdapter({
  code: 'mondial_relay',
  accountCode: 'sandbox',
  methodCode: '24R',
  label: CARRIER_LABEL,
  logTag: LOG_TAG,
  labelFileName,
  accountFields: ACCOUNT_FIELDS,
  bmsShipmentTitle: 'Mondial Relay',
  resolveWeight,
  createLabel,
  cancelLabel,
  cancelWindow,
  buildLabelPayload,
  assertRelayPoint,
  redact
});
