/**
 * Adaptateur La Poste — offre Lettre Suivie.
 *
 * Premier transporteur passé derrière le contrat commun (lot 0 du chantier
 * expédition). Le comportement est celui validé en production depuis mars 2026 :
 * même payload, même offre, même poids forfaitaire, mêmes règles d'annulation.
 * Seule la provenance des réglages change — carrier_accounts au lieu des clés
 * `laposte_*` d'app_config.
 */

const { carrierHttpRequest } = require('./http');
const { sanitizeAddressField } = require('./addressFields');
const { assertAdapter } = require('./contract');
const { assertAccountComplete } = require('./accounts');

// Le tag de log reste « LaPoste » (collé) : c'est ce que dix-huit mois de logs
// de production contiennent déjà, et ce sur quoi on grep en cas d'incident.
// Le libellé « La Poste » (espacé) est celui montré à l'écran.
const LOG_TAG = 'LaPoste';
const LOG_PREFIX = `[${LOG_TAG} HTTP]`;
const CARRIER_LABEL = 'La Poste';

// Jeton OAuth2, mis en cache le temps de sa validité. La marge d'une minute
// évite d'envoyer un jeton qui expire pendant le vol.
let tokenCache = { token: null, expiresAt: 0 };

/**
 * Jeton OAuth2 du contrat, depuis le cache si possible.
 *
 * @param {object} account
 * @returns {Promise<string>}
 */
const getToken = async (account) => {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 60000) {
    return tokenCache.token;
  }

  assertAccountComplete(account, {
    credentials: ['token_url', 'client_id', 'client_secret']
  });

  const { token_url: tokenUrl, client_id: clientId, client_secret: clientSecret } = account.credentials;

  const body = `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;

  const data = await carrierHttpRequest(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  }, { logPrefix: LOG_PREFIX, carrierLabel: CARRIER_LABEL });

  tokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in * 1000)
  };

  console.log('[LaPoste] Token obtenu, expire dans', data.expires_in, 's');
  return data.access_token;
};

/** Purge le jeton après un 401 : le prochain appel en redemandera un. */
const onAuthFailure = () => {
  tokenCache = { token: null, expiresAt: 0 };
};

/**
 * Poids déclaré : forfait de 20 g, propre à la lettre suivie.
 *
 * L'offre est facturée à la tranche et tous nos envois tiennent dans la
 * première. Décision assumée, pas un raccourci — les autres transporteurs
 * déclareront le poids réel via services/orderWeightService, c'est justement
 * pour ça que le poids est une méthode de l'adaptateur et pas une constante
 * du contrôleur.
 *
 * @returns {Promise<number>} grammes
 */
const resolveWeight = async ({ account }) => {
  const configured = Number(account?.settings?.fixed_weight_g);
  return Number.isFinite(configured) && configured > 0 ? configured : 20;
};

/**
 * Construit le corps de la requête de commande d'étiquette.
 *
 * Fonction pure, isolée de l'appel réseau : c'est la pièce la plus fragile de
 * l'adaptateur — un champ mal nommé et La Poste répond 400 sans dire lequel —
 * et la seule qu'on puisse vérifier sans appeler vraiment l'API. Le banc
 * `tests/carriers.test.js` la compare au payload d'avant refactorisation.
 *
 * @param {import('./contract').CreateLabelInput} input
 * @returns {object} corps JSON attendu par POST /orders
 */
const buildLabelPayload = ({ orderNumber, receiver, account, weightGrams }) => {
  const s = account.settings;
  const sender = s.sender || {};

  // Nettoyer les champs d'adresse destinataire (entités HTML, typographie)
  const receiverName = sanitizeAddressField(receiver.name || '');
  const receiverCompany = sanitizeAddressField(receiver.company);
  const receiverAdd3 = sanitizeAddressField(receiver.address_2);
  const receiverAdd4 = sanitizeAddressField(receiver.address) || '';
  const receiverTown = sanitizeAddressField(receiver.city) || '';

  const countryCode = s.country_code || '250';

  const payload = {
    order: {
      custPurchaseOrderNumber: orderNumber,
      invoicing: {
        contractNumber: s.contract_number,
        custAccNumber: s.cust_acc_number,
        custInvoice: s.cust_invoice
      },
      offer: {
        offerCode: s.offer_code || '3125',
        masterOutputOptions: {
          visualFormatCode: s.visual_format || 'rollA'
        },
        products: [{
          productCode: s.product_code || 'K7',
          productOptions: {
            weight: weightGrams,
            deliveryTrackingFlag: true
          },
          sender: {
            email: sender.email || 'contact@youvape.fr',
            phone: sender.phone || '0499782453',
            address: {
              name1: sender.name || 'SAS EMC',
              add4: sender.address || '580 avenue de l aube rouge',
              zipcode: sender.zipcode || '34170',
              town: sender.town || 'Castelnau le lez',
              countryCode
            }
          },
          receiver: {
            email: receiver.email || '',
            phone: receiver.phone || '',
            address: {
              name1: receiverName,
              ...(receiverCompany && { add2: receiverCompany }),
              ...(receiverAdd3 && { add3: receiverAdd3 }),
              add4: receiverAdd4,
              zipcode: receiver.postcode || '',
              town: receiverTown,
              countryCode
            }
          }
        }]
      }
    }
  };

  return payload;
};

/**
 * Demande une étiquette Lettre Suivie à l'API La Poste.
 *
 * @param {import('./contract').CreateLabelInput} input
 * @returns {Promise<import('./contract').CreateLabelResult>}
 */
const createLabel = async ({ orderNumber, receiver, account, weightGrams }) => {
  assertAccountComplete(account, {
    settings: ['api_url', 'contract_number', 'cust_acc_number', 'cust_invoice']
  });

  const token = await getToken(account);
  const payload = buildLabelPayload({ orderNumber, receiver, account, weightGrams });
  const address = payload.order.offer.products[0].receiver.address;

  const jsonBody = JSON.stringify(payload);
  console.log('[LaPoste] Appel API pour commande', orderNumber, '— destinataire:',
    address.name1,
    receiver.postcode, address.town);

  const data = await carrierHttpRequest(`${account.settings.api_url}/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: jsonBody
  }, { logPrefix: LOG_PREFIX, carrierLabel: CARRIER_LABEL });

  const trackingNumber = data.order?.offer?.products?.[0]?.smartdata?.itemId || null;
  const visualOutput = data.order?.offer?.visualOutput || null;
  const carrierOrderId = data.order?.orderId || null;

  if (!visualOutput) {
    console.error('[LaPoste] Pas de visualOutput dans la réponse:', JSON.stringify(data).substring(0, 500));
    const err = new Error('Pas de PDF dans la réponse La Poste');
    err.statusCode = 500;
    throw err;
  }

  return { carrierOrderId, trackingNumber, pdfBase64: visualOutput };
};

/**
 * Fenêtre d'annulation La Poste : 7 jours glissants ET même mois civil.
 *
 * Le mois civil est la contrainte de facturation — une étiquette du 30 est
 * inannulable le 2 du mois suivant, même à trois jours d'écart.
 *
 * @param {object} label - ligne shipment_labels
 * @param {Date} [now]
 * @returns {{cancellable: boolean, reason: ?string}}
 */
const cancelWindow = (label, now = new Date()) => {
  const createdAt = new Date(label.created_at);
  const daysDiff = (now - createdAt) / (1000 * 60 * 60 * 24);
  const sameMonth = createdAt.getMonth() === now.getMonth()
    && createdAt.getFullYear() === now.getFullYear();

  if (daysDiff > 7 || !sameMonth) {
    return { cancellable: false, reason: 'Délai d\'annulation dépassé (7 jours max, même mois)' };
  }
  return { cancellable: true, reason: null };
};

/**
 * Annule l'étiquette côté La Poste.
 *
 * @param {{label: object, account: object}} input
 * @returns {Promise<object>} réponse brute de l'API
 */
const cancelLabel = async ({ label, account }) => {
  assertAccountComplete(account, { settings: ['api_url'] });

  const token = await getToken(account);
  const cancelPayload = JSON.stringify({ orderId: label.carrier_order_id });

  const data = await carrierHttpRequest(`${account.settings.api_url}/orders/cancel`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: cancelPayload
  }, { logPrefix: LOG_PREFIX, carrierLabel: CARRIER_LABEL });

  console.log('[LaPoste] Annulation demandée pour orderId:', label.carrier_order_id, 'résultat:', JSON.stringify(data).substring(0, 300));

  return data;
};

/**
 * Nom du fichier téléchargé au packing.
 *
 * `LS-<n°>.pdf` depuis la mise en service, et **AutoPrint est réglé dessus** :
 * le tiret et les deux majuscules ne sont pas un choix de style, les changer
 * ferait cesser l'impression automatique des lettres suivies.
 */
const labelFileName = (orderNumber) => `LS-${orderNumber}.pdf`;

// Champs du contrat, tels que l'écran de réglages doit les demander.
// Les libellés reprennent ceux du portail La Poste, pour qu'un responsable
// puisse recopier sans traduire.
const ACCOUNT_FIELDS = {
  credentials: [
    { key: 'token_url',     label: "URL du jeton OAuth2", placeholder: 'https://…/oauth2/token' },
    { key: 'client_id',     label: 'Client ID' },
    { key: 'client_secret', label: 'Client secret', secret: true }
  ],
  settings: [
    { key: 'api_url',         label: "URL de l'API", placeholder: 'https://apim-gw-vente.extra.laposte.fr/postage/v1' },
    { key: 'contract_number', label: 'Numéro de contrat' },
    { key: 'cust_acc_number', label: 'Numéro de compte client' },
    { key: 'cust_invoice',    label: 'Compte de facturation' },
    { key: 'offer_code',     label: 'Code offre',            group: 'Offre', placeholder: '3125' },
    { key: 'product_code',   label: 'Code produit',          group: 'Offre', placeholder: 'K7' },
    { key: 'visual_format',  label: "Format d'impression",    group: 'Offre', placeholder: 'rollA' },
    { key: 'country_code',   label: 'Code pays (numérique)',  group: 'Offre', placeholder: '250' },
    { key: 'fixed_weight_g', label: 'Poids forfaitaire (g)',  group: 'Offre', placeholder: '20' },
    { key: 'sender.name',    label: 'Raison sociale',   group: 'Expéditeur' },
    { key: 'sender.address', label: 'Adresse',          group: 'Expéditeur' },
    { key: 'sender.zipcode', label: 'Code postal',      group: 'Expéditeur' },
    { key: 'sender.town',    label: 'Ville',            group: 'Expéditeur' },
    { key: 'sender.email',   label: 'Courriel',         group: 'Expéditeur' },
    { key: 'sender.phone',   label: 'Téléphone',        group: 'Expéditeur' }
  ]
};

module.exports = assertAdapter({
  code: 'laposte',
  accountCode: 'lettre_suivie',
  methodCode: 'lettre_suivie',
  label: CARRIER_LABEL,
  logTag: LOG_TAG,
  labelFileName,
  accountFields: ACCOUNT_FIELDS,
  bmsShipmentTitle: 'La poste - Courrier suivi (port payé)',
  resolveWeight,
  createLabel,
  cancelLabel,
  cancelWindow,
  onAuthFailure,
  // Exposé pour le banc de non-régression, qui vérifie le payload sans réseau.
  buildLabelPayload
});
