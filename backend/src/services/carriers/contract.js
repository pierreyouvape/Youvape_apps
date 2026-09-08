/**
 * Contrat commun aux adaptateurs transporteurs.
 *
 * Chaque transporteur a sa propre API — SOAP chez Mondial Relay, REST chez
 * Colissimo, OAuth2 + JSON chez La Poste — mais le packing pose toujours la
 * même question : « fabrique-moi l'étiquette de cette commande ». Le contrat
 * décrit cette question et la forme de la réponse ; tout ce qui est propre au
 * transporteur reste derrière.
 *
 * Ce qui est délibérément DANS le contrat, parce que ça diffère d'un
 * transporteur à l'autre :
 *   - le poids déclaré (forfait 20 g en lettre suivie, poids réel ailleurs) ;
 *   - le libellé de suivi envoyé à BMS ;
 *   - la fenêtre d'annulation (7 jours et même mois chez La Poste) ;
 *   - le nom affiché dans les messages d'erreur du packing.
 *
 * Ce qui est délibérément DEHORS, parce que c'est identique partout et que
 * dupliquer ces règles par transporteur, c'est se garantir qu'elles divergent :
 *   le contrôle de doublon, l'enregistrement en base, la confirmation BMS,
 *   l'alerte mail en cas d'échec, le tamponnage du numéro sur le PDF. Tout ça
 *   vit dans `controllers/shipmentController` et `models/shipmentLabelModel`.
 *
 * @typedef {object} Receiver
 * @property {string}  name      - nom du destinataire
 * @property {?string} company   - société, le cas échéant
 * @property {string}  address   - ligne d'adresse principale
 * @property {?string} address_2 - complément d'adresse
 * @property {string}  postcode
 * @property {string}  city
 * @property {?string} phone
 * @property {?string} email
 *
 * @typedef {object} CreateLabelInput
 * @property {string}   orderNumber - référence imprimée sur l'étiquette
 * @property {Receiver} receiver
 * @property {object}   account     - contrat, cf. services/carriers/accounts
 * @property {number}   weightGrams - poids déclaré, issu de resolveWeight
 *
 * @typedef {object} CreateLabelResult
 * @property {?string} carrierOrderId - identifiant de commande chez le transporteur,
 *                                      celui qui permettra l'annulation
 * @property {?string} trackingNumber - numéro de suivi
 * @property {string}  pdfBase64      - étiquette brute, AVANT tamponnage
 *
 * @typedef {object} CarrierAdapter
 * @property {string} code        - code transporteur (`shipping_carriers.code`)
 * @property {string} accountCode - contrat par défaut dans carrier_accounts
 * @property {string} methodCode  - offre / mode de livraison
 * @property {string} label       - nom affiché à l'écran (« La Poste »)
 * @property {string} logTag      - préfixe de log, sans crochets (« LaPoste »)
 * @property {(orderNumber: string|number) => string} labelFileName
 *           Nom du fichier PDF téléchargé au packing. **AutoPrint choisit
 *           l'imprimante d'après ce nom** : ce n'est pas une valeur cosmétique,
 *           la changer casse l'impression automatique. Chaque transporteur a sa
 *           convention, séparateur compris — c'est pour ça que c'est une méthode
 *           et pas un préfixe commun.
 * @property {string} bmsShipmentTitle - libellé de suivi attendu par BMS
 * @property {(input: {pool: object, orderNumber: string|number, account: object}) => Promise<number>} resolveWeight
 *           Poids à déclarer, en grammes.
 * @property {(input: CreateLabelInput) => Promise<CreateLabelResult>} createLabel
 * @property {(input: {label: object, account: object}) => Promise<object>} cancelLabel
 *           Annule côté transporteur. Renvoie la réponse brute, transmise telle
 *           quelle à l'appelant pour le débogage.
 * @property {(label: object, now?: Date) => {cancellable: boolean, reason: ?string}} cancelWindow
 *           Règle d'annulation du transporteur, appliquée AVANT l'appel API.
 * @property {() => void} [onAuthFailure] - appelé sur 401, pour purger un cache de jeton.
 * @property {{credentials: Field[], settings: Field[]}} [accountFields]
 *           Description des champs du contrat, pour que l'écran de réglages
 *           génère son formulaire. Sans elle, un transporteur ne peut être
 *           configuré qu'en base — ce qu'on veut justement éviter.
 *           Un `Field` = `{key, label, secret?, placeholder?, group?}` ; `key`
 *           accepte un chemin pointé (`sender.city`). `secret: true` signifie
 *           que la valeur ne redescend JAMAIS vers le navigateur : le champ
 *           s'affiche vide et n'est écrit que si on saisit quelque chose.
 * @property {boolean} [requiresAccount=true] - à false, l'adaptateur n'a pas de
 *           contrat dans carrier_accounts : ni identifiants ni réglages à charger.
 *           C'est le cas du retrait magasin, qui n'appelle aucune API.
 * @property {boolean} [confirmsShipmentInBms=true] - à false, aucune confirmation
 *           d'expédition n'est envoyée à BMS. Le retrait magasin n'est pas une
 *           expédition : la confirmer ferait mentir les stats de transport.
 */

const REQUIRED_PROPS = [
  'code', 'accountCode', 'methodCode', 'label', 'logTag', 'bmsShipmentTitle'
];
const REQUIRED_METHODS = [
  'resolveWeight', 'createLabel', 'cancelLabel', 'cancelWindow', 'labelFileName'
];

/**
 * Vérifie qu'un adaptateur respecte le contrat, au chargement du module.
 *
 * Échouer au démarrage plutôt qu'au premier colis : une méthode oubliée dans un
 * nouvel adaptateur doit casser le serveur en développement, pas l'expédition
 * un vendredi soir.
 *
 * @param {CarrierAdapter} adapter
 * @returns {CarrierAdapter} l'adaptateur, pour permettre l'enchaînement
 */
const assertAdapter = (adapter) => {
  const name = adapter && adapter.code ? adapter.code : '(sans code)';

  for (const prop of REQUIRED_PROPS) {
    if (typeof adapter?.[prop] !== 'string' || !adapter[prop]) {
      throw new Error(`Adaptateur transporteur « ${name} » : propriété « ${prop} » manquante`);
    }
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter?.[method] !== 'function') {
      throw new Error(`Adaptateur transporteur « ${name} » : méthode « ${method}() » manquante`);
    }
  }

  return adapter;
};

module.exports = { assertAdapter };
