/**
 * Adaptateur Colissimo — Web Service d'affranchissement (SLS 3.1).
 *
 * Contrat détaillé dans `docs/colissimo-api.md`. Il a été reconstitué depuis le
 * plugin Colissimo officiel installé sur le site (`colissimo-shipping-methods-
 * for-woocommerce` 2.10.0) : c'est l'implémentation de référence de La Poste,
 * même si, sur cette boutique, c'est BMS qui émettait les étiquettes jusqu'ici.
 *
 * Couvre, avec un seul contrat : Colissimo domicile avec et sans signature,
 * l'outre-mer, l'international, et les points de retrait Bpost en Belgique —
 * Bpost n'est pas une cinquième intégration, c'est le code produit `HD`.
 *
 * Les particularités qui expliquent la forme de ce fichier :
 *
 *   - **Réponse en multipart MIME**, pas en JSON : une partie `<jsonInfos>`,
 *     une partie `<label>` binaire, et une partie `<cn23>` quand la destination
 *     l'exige. D'où `parseMultipart`, qui travaille sur des octets : l'étiquette
 *     est un PDF, une conversion en chaîne la corromprait.
 *   - **Le code produit ne se lit pas dans le mappage.** « Colissimo Domicile »
 *     couvre la France (`DOM`) ET l'outre-mer (`COM`, CN23 obligatoire) sous la
 *     même dénomination. Le mappage donne le SERVICE ; le code produit se
 *     calcule service × pays, comme le fait le plugin.
 *   - **Les identifiants voyagent dans le corps** (`contractNumber`, `password`).
 *     Jamais de log du payload.
 *   - **`checkGenerateLabel`** valide une requête sans produire ni facturer
 *     d'étiquette. C'est ce que fait un contrat marqué « test » : il n'y a pas
 *     de serveur de test chez Colissimo, mais il y a ça.
 *   - **Pas d'annulation** : l'API ne fait que créer. Une étiquette non déposée
 *     n'est pas facturée.
 */

const axios = require('axios');
const { restrictToCharset } = require('./addressFields');
const { shiftContentDown } = require('./labelPdf');
const { assertAdapter } = require('./contract');
const { assertAccountComplete } = require('./accounts');

const LOG_TAG = 'Colissimo';
const CARRIER_LABEL = 'Colissimo';

// ── Services et codes produit ────────────────────────────────────────────────

/**
 * Les services qu'une dénomination WooCommerce peut désigner.
 *
 * Le libellé BMS suit le SERVICE, pas le code produit : relevé dans BMS le
 * 10/09/2026, une commande « Colissimo Domicile » vers La Réunion (code `COM`)
 * y est classée « Domicile sans signature », et « Colissimo avec Signature »
 * vers le Danemark en « Domicile avec signature ». Ce sont les trois libellés
 * que BMS emploie pour nos commandes Colissimo.
 */
const SERVICES = {
  domicile:  { label: 'Domicile sans signature', bms: 'La Poste : Colissimo - Domicile sans signature' },
  signature: { label: 'Domicile avec signature', bms: 'La Poste : Colissimo - Domicile avec signature' },
  relais:    { label: 'Point de retrait',        bms: 'La Poste : Colissimo - Point de retrait' }
};

const PRODUIT_RELAIS = 'HD';

const D = (sansSignature, avecSignature, relais, cn23) => ({ sansSignature, avecSignature, relais, cn23 });
const groupe = (pays, cap) => Object.fromEntries(pays.split(' ').map(p => [p, cap]));

/**
 * Ce que Colissimo propose par pays de destination, pour une boutique en France.
 *
 * Recopié de `resources/capabilitiesByCountryFR.json` du plugin officiel, zones
 * ZFR, Z1 à Z4, OM1 et OM2. Un pays absent n'est pas deviné : il est refusé.
 * Saint-Martin (MF) est écarté exprès, ses capacités dépendant d'un calcul
 * intra-DOM que la boutique ne fait pas.
 *
 * `null` = service indisponible vers ce pays. Exemple qui explique les
 * dénominations du site : la livraison SANS signature n'existe pas vers
 * l'Allemagne, l'Espagne ou le Danemark — d'où « Colissimo avec Signature ».
 */
const DESTINATIONS = {
  FR: D('DOM', 'DOS', true, false),
  MC: D('DOM', 'DOS', true, false),
  AD: D('DOM', 'DOS', false, true),
  BE: D('DOM', 'DOS', true, false),
  CH: D('DOM', 'DOS', false, true),
  ...groupe('DE LU NL AT ES IE IT PT CZ DK EE HU LT LV PL SE SI SK FI', D(null, 'DOS', true, false)),
  ...groupe('BG CY GR HR MT RO', D(null, 'DOS', false, false)),
  ...groupe('GB GG GI IM JE SM VA SX FO GL LI AL AM AZ BA BY DZ GE IC IS MA MD ME MK NO RS TN TR UA',
    D(null, 'DOS', false, true)),
  // Outre-mer : codes propres, et CN23 systématique.
  ...groupe('BL GF GP MQ PM RE YT NC PF TF WF', D('COM', 'CDS', false, true))
};

// Pays où la livraison avec signature peut passer par le réseau postal
// partenaire (bpost en Belgique) plutôt que par La Poste. Le site est réglé sur
// « partenaire » pour AT, BE, DE, IT et LU — c'est la valeur par défaut.
const PAYS_RESEAU_PARTENAIRE = new Set(['AT', 'BE', 'DE', 'DK', 'EE', 'ES', 'FI', 'IT', 'LU', 'NL', 'PL']);
const RESEAU_PARTENAIRE_DEFAUT = 'AT,BE,DE,IT,LU';

// Droits et taxes payés par l'expéditeur (DDP) : n'existe que pour ces
// territoires. Désactivé par défaut — c'est le client qui paie les droits.
const PAYS_FTD = new Set(['GF', 'GP', 'MQ', 'RE']);

// Décalage du contenu de l'étiquette vers le bas, en millimètres. Colissimo colle
// son contenu au bord supérieur de la page, et l'impression PDF sur l'Intermec en
// perd le haut. 8 mm validés à l'impression par Pierre le 11/09/2026 (5 et 12 mm
// essayés). Réglable dans le contrat : `label_top_offset_mm`.
const DECALAGE_HAUT_DEFAUT = 8;

// Numéros mobiles reconnus. Un mobile part aussi en `mobileNumber` : c'est le seul
// numéro que Colissimo imprime (la commande 1260104, dont le mobile n'était envoyé
// que comme fixe, est sortie avec « Téléphone : / »), et celui qui reçoit ses SMS.
//
// L'outre-mer suit la numérotation française (0690, 0692, 0694, 0696, 0639…),
// écrite aussi avec son indicatif (+590, +594, +596, +262, +508). La Polynésie et
// la Nouvelle-Calédonie ont leur propre plan : leurs numéros restent en fixe.
const MOBILES = {
  FR: /^(?:(?:\+|00)(?:33|590|594|596|262|508)|0)[67]\d{8}$/,
  BE: /^(?:\+32|0032|0)4\d{8}$/
};
const PLAN_FRANCAIS = new Set(['FR', 'GF', 'GP', 'MQ', 'RE', 'YT', 'PM', 'BL', 'MF']);
const estMobile = (telephone, pays) => {
  const regle = MOBILES[PLAN_FRANCAIS.has(pays) ? 'FR' : pays];
  return Boolean(regle && regle.test(telephone));
};

// Pays dont l'étiquette n'affiche pas `line3` : le complément d'adresse doit
// remonter en `line2`, sinon il n'apparaît pas sur le colis.
const PAYS_SANS_LINE3 = new Set(['BE', 'CH']);

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

// ── Jeux de caractères ───────────────────────────────────────────────────────

// Calqués sur ce que le plugin envoie : les noms en ASCII (`toAscii`), le reste
// en latin-1, la désignation douanière sans aucun accent (« The Colissimo API
// returns an error if there is an accent »). Un caractère hors jeu est retiré
// AVANT l'appel — c'est ce qui manque au plugin, dont la liste fermée laisse
// passer « Ω », « ° » et « ñ ».
const CHARSET = {
  nom:         /[A-Za-z0-9 '.,-]/,
  adresse:     /[0-9A-Za-zÀ-ÖØ-öø-ÿ '.,\/-]/,
  codePostal:  /[0-9A-Za-z -]/,
  description: /[A-Za-z0-9 '.,\/()%+-]/
};

// Longueur d'une ligne d'adresse chez Colissimo.
const MAX_LIGNE = 35;
// Longueur d'une désignation douanière.
const MAX_DESCRIPTION = 64;

/**
 * Coupe un texte à `max` caractères, sur une espace si possible.
 * @returns {[string, string]} [ce qui tient, le reste]
 */
const couper = (texte, max = MAX_LIGNE) => {
  const t = String(texte || '').trim();
  if (t.length <= max) return [t, ''];
  const i = t.lastIndexOf(' ', max);
  const coupe = i > 0 ? i : max;
  return [t.slice(0, coupe).trim(), t.slice(coupe).trim()];
};

/**
 * Répartit rue et complément sur `line2` et `line3`, 35 caractères chacune.
 *
 * Ce qui déborde de la rue passe en tête de `line3`, devant le complément. En
 * Belgique et en Suisse, l'étiquette n'imprime pas `line3` : le complément est
 * d'abord ramené dans `line2`, comme le fait le plugin.
 *
 * @returns {{line2: string, line3: string}}
 */
const lignesAdresse = (rue, complement, pays) => {
  let r = String(rue || '').trim();
  let c = String(complement || '').trim();
  if (PAYS_SANS_LINE3.has(pays) && c) {
    r = `${r} ${c}`.trim();
    c = '';
  }
  const [line2, debord] = couper(r);
  const [line3] = couper([debord, c].filter(Boolean).join(' '));
  return { line2, line3 };
};

/**
 * Numéro de téléphone tel que Colissimo l'attend : chiffres et « + ».
 *
 * Un mobile belge est ramené au format international `+324…`, comme le fait le
 * plugin : c'est à ce numéro que bpost envoie le SMS de mise à disposition. 976
 * des 977 commandes Bpost Relais sur 90 jours ont un mobile belge valide.
 */
const normaliserTelephone = (brut, pays) => {
  const s = String(brut || '').replace(/[^0-9+]/g, '');
  if (pays === 'BE' && /^(?:(?:\+|00)32|0)4\d{8}$/.test(s)) {
    return s.replace(/^(?:\+32|0032|0)4/, '+324');
  }
  return s;
};

/** Date de dépôt en heure de Paris. Le VPS est en UTC : à 0 h 30 à Paris, il est encore la veille. */
const dateDepot = (now = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};

/** Grammes → kilogrammes à deux décimales, 10 g minimum : c'est le plancher de l'API. */
const kilos = (grammes) => (Math.max(Number(grammes) || 0, 10) / 1000).toFixed(2);

// ── Destination, point de retrait, douane ────────────────────────────────────

/**
 * Service, pays et code produit d'une expédition.
 *
 * En point de retrait, le pays qui compte est celui du POINT : c'est là que
 * part le colis.
 *
 * @param {{receiver: object, options: object, orderNumber: string|number}} input
 * @returns {{service: string, pays: string, productCode: string, cn23: boolean}}
 * @throws refus si le service n'existe pas vers ce pays
 */
const resolveDestination = ({ receiver = {}, options = {}, orderNumber }) => {
  const service = options.deliveryMode || 'domicile';
  const denomination = options.shippingMethod ? `« ${options.shippingMethod} »` : 'ce mode de livraison';

  if (!SERVICES[service]) {
    refus(
      `Le mode Colissimo « ${service} » n'existe pas (attendu : ${Object.keys(SERVICES).join(', ')}). `
      + `Demandez à un responsable de corriger ${denomination} dans les réglages.`
    );
  }

  const relaisPays = service === 'relais' ? options.relayPoint?.country : null;
  const pays = String(relaisPays || receiver.country || '').trim().toUpperCase();
  const cap = DESTINATIONS[pays];

  if (!cap) {
    refus(
      `Commande n°${orderNumber} : Colissimo n'est pas pris en charge vers « ${pays || 'pays vide'} » `
      + `par l'étiquetage de l'app. Expédiez-la par un autre moyen.`
    );
  }

  const productCode = service === 'domicile' ? cap.sansSignature
    : service === 'signature' ? cap.avecSignature
      : (cap.relais ? PRODUIT_RELAIS : null);

  if (!productCode) {
    refus(
      `Commande n°${orderNumber} : Colissimo ne propose pas la livraison « ${SERVICES[service].label} » `
      + `vers ${pays}. Demandez à un responsable de faire passer ${denomination} sur un autre mode `
      + `dans les réglages${cap.avecSignature ? ' (« Domicile avec signature » existe vers ce pays)' : ''}.`
    );
  }

  return { service, pays, productCode, cn23: cap.cn23 };
};

// Le code d'un point Colissimo — Bpost compris — fait 6 chiffres. Constaté sur
// les 177 points Bpost en base, sans exception.
const FORMAT_POINT = /^[0-9]{6}$/;

/**
 * Vérifie que la commande porte un point de retrait Colissimo exploitable.
 *
 * Le réseau est contrôlé : un point réservé par un autre plugin a lui aussi un
 * code à 6 chiffres (Mondial Relay), et l'envoyer chez Colissimo ferait livrer
 * le colis on ne sait où. Constaté : une commande « Bpost Relais » du 05/09/2026
 * porte un point du réseau `mondial_relay`.
 */
const assertRelayPoint = (relayPoint, orderNumber) => {
  const id = relayPoint && relayPoint.id != null ? String(relayPoint.id).trim() : '';

  if (!id) {
    refus(
      `La commande n°${orderNumber} part en point de retrait Colissimo, mais aucun point n'y est `
      + `enregistré. Si elle a été créée à la main, saisissez le point dans sa fiche (app Commandes) ; `
      + `sinon, rouvrez et enregistrez-la dans WooCommerce pour récupérer le point choisi par le client.`
    );
  }

  if (relayPoint.network !== 'colissimo') {
    refus(
      `Le point de retrait de la commande n°${orderNumber} (« ${id} ») vient du réseau `
      + `« ${relayPoint.network || 'inconnu'} », pas de Colissimo. Vérifiez le point choisi dans `
      + `WooCommerce avant d'expédier.`
    );
  }

  if (!FORMAT_POINT.test(id)) {
    refus(
      `Le point de retrait de la commande n°${orderNumber} (« ${id} ») n'a pas le format attendu par `
      + `Colissimo : 6 chiffres. Vérifiez le point choisi dans WooCommerce.`
    );
  }
};

/**
 * Déclaration douanière au format Colissimo, et les champs qui l'accompagnent.
 *
 * @param {{articles: object[], shippingTotal: number}} customs - cf. services/orderCustomsService
 * @returns {{declaration: object, totalAmount: number, fields: object[]}}
 */
const buildCustoms = ({ customs, settings, orderNumber, pays }) => {
  const d = settings.customs || {};
  const manquants = ['hs_code', 'origin_country', 'category'].filter(k => !d[k]);
  if (manquants.length) {
    refus(
      `Commande n°${orderNumber} : la déclaration douanière (CN23) est obligatoire vers ${pays}, `
      + `mais le contrat Colissimo n'a pas ${manquants.map(k => `customs.${k}`).join(', ')}. `
      + `À renseigner dans les réglages, onglet « Contrats API ».`,
      500
    );
  }

  if (!customs || !customs.articles || customs.articles.length === 0) {
    refus(`Commande n°${orderNumber} : aucun article à déclarer pour la CN23.`, 500);
  }

  // L'API rejette une CN23 dont le port est gratuit. Aucune commande CN23 n'a eu
  // de port gratuit sur 180 jours, mais on le dit plutôt que de laisser
  // Colissimo répondre un code opaque.
  if (!(customs.shippingTotal > 0)) {
    refus(
      `Commande n°${orderNumber} : Colissimo refuse une déclaration douanière avec un port gratuit, `
      + `et cette commande vers ${pays} n'a aucun frais de port. Expédiez-la par un autre moyen.`
    );
  }

  const article = customs.articles.map((a) => {
    const description = restrictToCharset(a.name, CHARSET.description).substring(0, MAX_DESCRIPTION).trim();
    return {
      description: description || String(a.sku || 'Article').substring(0, MAX_DESCRIPTION),
      quantity: a.quantity,
      weight: Math.max(a.unitWeightKg || 0, 0.01).toFixed(2),
      value: String(a.unitValue),
      currency: d.currency || 'EUR',
      artref: String(a.sku || '').substring(0, 44),
      originalIdent: 'A',
      originCountry: d.origin_country,
      hsCode: String(d.hs_code)
    };
  });

  const declaration = {
    includeCustomsDeclarations: 1,
    numberOfCopies: Number(settings.cn23_copies) || 4,
    contents: {
      article,
      category: { value: Number(d.category) }
    },
    invoiceNumber: String(orderNumber)
  };

  const valeur = customs.articles.reduce((t, a) => t + a.unitValue * a.quantity, 0);
  if (pays === 'GB' && d.vat_number) declaration.comments = `N. TVA : ${d.vat_number}`;

  // EORI : envoyé seulement s'il est renseigné. Le plugin ne l'exige que pour
  // les États-Unis, hors de notre périmètre.
  const eori = pays === 'GB'
    ? [d.eori_uk_number, valeur >= 1000 ? d.eori_number : null].filter(Boolean).join(' ')
    : d.eori_number;

  const fields = [{ key: 'OUTPUT_PRINT_TYPE_CN23', value: settings.cn23_format || 'PDF_A4_300dpi' }];
  if (eori) fields.push({ key: 'EORI', value: eori });

  return { declaration, totalAmount: Math.round(customs.shippingTotal * 100), fields };
};

// ── Payload ──────────────────────────────────────────────────────────────────

/**
 * Construit le corps JSON de la demande d'étiquette.
 *
 * Fonction pure : c'est elle que le banc vérifie, sans réseau. `customs` est
 * obligatoire quand la destination exige une CN23 ; `createLabel` le charge.
 *
 * @param {import('./contract').CreateLabelInput & {customs?: object, now?: Date}} input
 * @returns {object}
 */
const buildLabelPayload = ({ orderNumber, receiver = {}, account, weightGrams, options = {}, customs = null, now = new Date() }) => {
  const c = account.credentials;
  const s = account.settings;
  const sender = s.sender || {};
  const ctx = { orderNumber };

  const { pays, productCode, cn23 } = resolveDestination({ receiver, options, orderNumber });
  const relais = productCode === PRODUIT_RELAIS;
  const point = options.relayPoint || {};

  // En point de retrait, l'adresse destinataire devient celle du POINT, son nom
  // en raison sociale — c'est ce que fait le plugin. Le nom du client reste
  // dans firstName / lastName : c'est à lui qu'on remet le colis.
  const adresse = relais && point.address
    ? { rue: point.address, complement: '', cp: point.postcode, ville: point.city, societe: point.name }
    : { rue: receiver.address, complement: receiver.address_2, cp: receiver.postcode, ville: receiver.city, societe: receiver.company };

  const firstName = restrictToCharset(receiver.first_name || '', CHARSET.nom);
  const lastName = restrictToCharset(receiver.last_name || receiver.name || '', CHARSET.nom);
  const companyName = restrictToCharset(adresse.societe || '', CHARSET.adresse).substring(0, MAX_LIGNE);

  if (!companyName && (!firstName || !lastName)) {
    const nom = `${receiver.first_name || ''} ${receiver.last_name || ''}`.trim();
    refus(
      `Commande n°${orderNumber} : Colissimo exige un prénom et un nom (ou une société), et `
      + `« ${nom || 'vide'} » n'en donne pas deux utilisables. Corrigez le nom dans la commande.`
    );
  }

  const { line2, line3 } = lignesAdresse(
    restrictToCharset(adresse.rue || '', CHARSET.adresse),
    restrictToCharset(adresse.complement || '', CHARSET.adresse),
    pays
  );
  if (!line2) refus(`Commande n°${orderNumber} : l'adresse du destinataire est vide.`);

  // Luxembourg : le code postal s'écrit sans le préfixe « L- ».
  let zipCode = restrictToCharset(String(adresse.cp || ''), CHARSET.codePostal);
  if (pays === 'LU') zipCode = zipCode.replace(/^L-?\s*/i, '');

  const telephone = normaliserTelephone(receiver.phone || receiver.billing_phone, pays);
  if (relais && !telephone) {
    refus(
      `Commande n°${orderNumber} : Colissimo exige un numéro de mobile pour une livraison en point `
      + `de retrait — c'est par SMS que le client est prévenu. La commande n'en a aucun : `
      + `ajoutez-le dans WooCommerce avant d'expédier.`
    );
  }

  const addressee = {
    companyName,
    firstName,
    lastName,
    line2,
    ...(line3 ? { line3 } : {}),
    countryCode: pays,
    city: restrictToCharset(adresse.ville || '', CHARSET.adresse),
    zipCode,
    email: String(receiver.email || '')
  };
  // En point de retrait le téléphone est un mobile, obligatoire. Ailleurs il part
  // comme fixe, et AUSSI comme mobile quand c'en est un (voir MOBILES). En
  // Belgique, le plugin le double en mobile quoi qu'il arrive.
  if (telephone) {
    if (relais) addressee.mobileNumber = telephone;
    else {
      addressee.phoneNumber = telephone;
      if (pays === 'BE' || estMobile(telephone, pays)) addressee.mobileNumber = telephone;
    }
  }

  const service = {
    productCode,
    depositDate: dateDepot(now),
    orderNumber: String(orderNumber),
    commercialName: s.commercial_name,
    // 3 = « pas de retour » : l'étiquette retour n'est pas le sujet ici.
    returnTypeChoice: 3
  };

  if (productCode === 'DOS' && PAYS_RESEAU_PARTENAIRE.has(pays)) {
    const partenaires = String(s.partner_network_countries || RESEAU_PARTENAIRE_DEFAUT)
      .split(/[\s,;]+/).map(x => x.toUpperCase());
    service.reseauPostal = partenaires.includes(pays) ? 1 : 0;
  }

  const parcel = { weight: kilos(weightGrams) };
  if (relais) {
    parcel.pickupLocationId = String(point.id);
    parcel.nonMachinable = 'false';
  }
  if (PAYS_FTD.has(pays) && (s.customs?.ftd === true || s.customs?.ftd === 'true')) {
    parcel.ftd = true;
  }

  const fields = [];
  const letter = {
    service,
    parcel,
    sender: {
      senderParcelRef: String(orderNumber),
      address: {
        companyName: sender.company_name,
        line2: sender.line2,
        countryCode: String(sender.country_code || 'FR').toUpperCase(),
        city: sender.city,
        zipCode: sender.zip_code,
        ...(sender.email ? { email: sender.email } : {}),
        ...(sender.phone ? { phoneNumber: normaliserTelephone(sender.phone, 'FR') } : {})
      }
    },
    addressee: { address: addressee }
  };

  if (cn23) {
    const douane = buildCustoms({ customs, settings: s, orderNumber, pays });
    letter.customsDeclarations = douane.declaration;
    service.totalAmount = douane.totalAmount;
    service.transportationAmount = douane.totalAmount;
    fields.push(...douane.fields);
  }

  return {
    contractNumber: c.contract_number,
    password: c.password,
    outputFormat: { x: 0, y: 0, outputPrintingType: s.output_format || 'PDF_10x15_300dpi' },
    letter,
    ...(fields.length ? { fields: { field: fields } } : {})
  };
};

// ── Réponse ──────────────────────────────────────────────────────────────────

const lireJson = (texte) => {
  try { return JSON.parse(texte); } catch (e) { return null; }
};

/**
 * Découpe la réponse multipart de Colissimo en ses parties.
 *
 * Travaille sur des OCTETS du début à la fin : l'étiquette est un PDF binaire,
 * et le moindre passage par une chaîne UTF-8 la corromprait sans erreur visible
 * — un PDF qui ne s'ouvre pas au packing, pas une exception dans les logs.
 *
 * @param {Buffer|string} body
 * @param {string} [contentType] - en-tête de la réponse, qui porte la frontière
 * @returns {{jsonInfos?: ?object, label?: Buffer, cn23?: Buffer}} parties indexées
 *          par leur Content-ID, chevrons retirés
 */
const parseMultipart = (body, contentType = '') => {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body || '', 'latin1');

  let frontiere = (/boundary="?([^";]+)"?/i.exec(contentType) || [])[1] || null;
  if (!frontiere) {
    // Repli : la première ligne qui commence par « -- » porte la frontière. Le
    // corps peut s'ouvrir sur un saut de ligne. Lecture en latin1 : un octet pour
    // un caractère, rien n'est converti.
    const m = /(?:^|\r\n)--([^\r\n-][^\r\n]*)\r\n/.exec(buf.slice(0, 2000).toString('latin1'));
    if (m) frontiere = m[1].trim();
  }

  // Corps mono-partie : du JSON seul, typiquement une erreur d'authentification.
  if (!frontiere) return { jsonInfos: lireJson(buf.toString('utf8')) };

  const delim = Buffer.from(`--${frontiere}`, 'latin1');
  const parts = {};
  let pos = buf.indexOf(delim);

  while (pos !== -1) {
    const debut = pos + delim.length;
    if (buf.slice(debut, debut + 2).toString('latin1') === '--') break; // « --frontière-- » : fin

    const suivant = buf.indexOf(delim, debut);
    let part = buf.slice(debut, suivant === -1 ? buf.length : suivant);
    if (part.slice(0, 2).toString('latin1') === '\r\n') part = part.slice(2);
    if (part.slice(-2).toString('latin1') === '\r\n') part = part.slice(0, -2);

    const sep = part.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const entetes = {};
      for (const ligne of part.slice(0, sep).toString('latin1').split('\r\n')) {
        const i = ligne.indexOf(':');
        if (i > 0) entetes[ligne.slice(0, i).trim().toLowerCase()] = ligne.slice(i + 1).trim();
      }
      const id = (entetes['content-id'] || '').replace(/^<|>$/g, '');
      const contenu = part.slice(sep + 4);
      if (id) parts[id] = id === 'jsonInfos' ? lireJson(contenu.toString('utf8')) : contenu;
    }

    pos = suivant;
  }

  return parts;
};

/** Premier message d'erreur de `jsonInfos`, ou null. Un succès porte l'id 0. */
const trouverErreur = (info) => {
  const m = info?.messages?.[0];
  return m && String(m.id) !== '0' ? m : null;
};

/**
 * POST vers l'API, réponse découpée.
 * @returns {Promise<{status: number, parts: object}>}
 */
const appeler = async (account, action, payload) => {
  const base = String(account.settings.api_url).replace(/\/+$/, '');
  let res;
  try {
    res = await axios.post(`${base}/${action}`, JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json' },
      responseType: 'arraybuffer',
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

  const parts = parseMultipart(Buffer.from(res.data || []), res.headers?.['content-type'] || '');
  const erreur = trouverErreur(parts.jsonInfos);

  if (erreur) {
    console.error(`[${LOG_TAG}] Refus ${erreur.id} :`, erreur.messageContent);
    const err = new Error(`Colissimo ${erreur.id} : ${erreur.messageContent}`);
    // Un refus métier (adresse, code postal, poids…) est rendu tel quel au
    // préparateur : il sait mieux qu'un message générique ce qu'il faut corriger.
    err.statusCode = res.status >= 500 ? res.status : 400;
    err.userMessage = `Colissimo refuse l'étiquette : ${erreur.messageContent} (code ${erreur.id})`;
    err.body = { code: erreur.id, message: erreur.messageContent };
    throw err;
  }

  if (res.status !== 200 || !parts.jsonInfos) {
    const err = new Error(`Réponse Colissimo inattendue (HTTP ${res.status})`);
    err.statusCode = res.status === 200 ? 502 : res.status;
    err.nonJson = !parts.jsonInfos;
    throw err;
  }

  return { status: res.status, parts };
};

// ── Contrat ──────────────────────────────────────────────────────────────────

/**
 * Poids réel de la commande, en grammes. Converti en kilogrammes au dernier
 * moment, dans le payload : tout le reste de l'app raisonne en grammes.
 */
const resolveWeight = async ({ pool, orderNumber }) => {
  const { computeOrderWeight } = require('../orderWeightService');
  const grams = await computeOrderWeight(pool, orderNumber);

  if (!grams || grams <= 0) {
    const err = new Error(
      `Poids introuvable ou nul pour la commande ${orderNumber} — Colissimo refuse une expédition sans poids`
    );
    err.statusCode = 400;
    throw err;
  }
  return Math.round(grams);
};

/**
 * Vérifie ce qui ferait perdre une étiquette APRÈS l'avoir achetée.
 *
 * Le tamponnage du numéro de commande exige un PDF : une étiquette ZPL serait
 * payée puis impossible à enregistrer. On le refuse avant l'appel.
 */
const assertFormatsPdf = (settings) => {
  for (const [cle, valeur] of [['output_format', settings.output_format], ['cn23_format', settings.cn23_format]]) {
    if (valeur && !/^PDF_/.test(valeur)) {
      refus(
        `Contrat Colissimo : « ${cle} » vaut « ${valeur} », mais l'app ne sait tamponner et `
        + `réimprimer que du PDF. Choisissez un format « PDF_… » dans les réglages.`,
        500
      );
    }
  }
};

/**
 * Prépare la requête : contrôles, douane, payload.
 * @returns {Promise<{payload: object, dest: object}>}
 */
const preparer = async ({ orderNumber, receiver, account, weightGrams, options = {}, pool }) => {
  assertAccountComplete(account, {
    credentials: ['contract_number', 'password'],
    settings: ['api_url', 'commercial_name']
  });
  assertFormatsPdf(account.settings);

  const dest = resolveDestination({ receiver, options, orderNumber });
  if (dest.productCode === PRODUIT_RELAIS) assertRelayPoint(options.relayPoint, orderNumber);

  let customs = null;
  if (dest.cn23) {
    if (!pool) refus(`Commande n°${orderNumber} : la CN23 exige l'accès aux lignes de commande.`, 500);
    const { loadOrderCustoms, customsArticles } = require('../orderCustomsService');
    const donnees = await loadOrderCustoms(pool, orderNumber);
    if (!donnees) refus(`Commande n°${orderNumber} introuvable pour la CN23.`, 404);
    customs = {
      articles: customsArticles(donnees.lines, {
        minUnitValue: Number(account.settings.customs?.min_unit_value) || 1
      }),
      shippingTotal: donnees.shippingTotal
    };
  }

  const payload = buildLabelPayload({ orderNumber, receiver, account, weightGrams, options, customs });

  console.log(`[${LOG_TAG}] Commande`, orderNumber,
    '— produit:', dest.productCode, '| pays:', dest.pays,
    dest.productCode === PRODUIT_RELAIS ? `| point: ${options.relayPoint.id}` : '',
    '| poids:', weightGrams, 'g', dest.cn23 ? '| CN23' : '');

  return { payload, dest };
};

/**
 * Fait valider une requête par Colissimo SANS produire d'étiquette ni rien
 * facturer (`checkGenerateLabel`). Sert la répétition avant mise en service.
 *
 * @returns {Promise<{valid: true, productCode: string, cn23: boolean, messages: object[]}>}
 * @throws le refus de Colissimo, avec son code et son message
 */
const validateLabel = async (input) => {
  const { payload, dest } = await preparer(input);
  const { parts } = await appeler(input.account, 'checkGenerateLabel', payload);
  return { valid: true, productCode: dest.productCode, cn23: dest.cn23, messages: parts.jsonInfos.messages || [] };
};

/**
 * Demande une étiquette à Colissimo.
 *
 * Sur un contrat marqué « test », la requête est seulement VALIDÉE : Colissimo
 * n'a pas de serveur de test, et un contrat de test qui émettrait de vraies
 * étiquettes ne protégerait de rien.
 *
 * @param {import('./contract').CreateLabelInput} input
 * @returns {Promise<import('./contract').CreateLabelResult>}
 */
const createLabel = async (input) => {
  const { account, orderNumber } = input;
  const sandbox = account.settings.sandbox === true || account.settings.sandbox === 'true';

  if (sandbox) {
    await validateLabel(input);
    refus(
      `Contrat Colissimo de TEST : la requête de la commande n°${orderNumber} est VALIDE pour Colissimo, `
      + `mais aucune étiquette n'est produite en mode test. Faites passer la dénomination sur le `
      + `contrat de production pour expédier.`
    );
  }

  const { payload, dest } = await preparer(input);
  const { parts } = await appeler(account, 'generateLabel', payload);

  const trackingNumber = parts.jsonInfos?.labelV31Response?.parcelNumber || null;
  const label = parts.label;

  if (!trackingNumber || !label || label.length === 0) {
    console.error(`[${LOG_TAG}] Réponse sans numéro ou sans étiquette — parties reçues :`, Object.keys(parts).join(', '));
    const err = new Error('Réponse Colissimo sans numéro de colis ou sans étiquette');
    err.statusCode = 502;
    throw err;
  }

  if (dest.cn23 && !(parts.cn23 && parts.cn23.length)) {
    // L'étiquette est achetée : on la garde, mais on le dit fort — un colis
    // outre-mer sans CN23 se fait bloquer en douane.
    console.error(`[${LOG_TAG}] ⚠️ Commande ${orderNumber} : CN23 attendue mais absente de la réponse`);
  }

  // Le contenu est décalé vers le bas AVANT le tampon du numéro de commande, qui
  // reste ainsi en bas à gauche, dans la zone vide.
  const decalage = Number(account.settings.label_top_offset_mm ?? DECALAGE_HAUT_DEFAUT);
  const pdfBase64 = await shiftContentDown(label.toString('base64'), decalage);

  return {
    carrierOrderId: trackingNumber,
    trackingNumber,
    pdfBase64,
    cn23Base64: parts.cn23 && parts.cn23.length ? parts.cn23.toString('base64') : null,
    methodCode: dest.productCode,
    bmsShipmentTitle: SERVICES[dest.service].bms
  };
};

/** L'API Colissimo ne sait pas annuler : elle ne fait que créer. */
const cancelWindow = () => ({
  cancellable: false,
  reason: "Colissimo ne permet pas d'annuler une étiquette par API — une étiquette non déposée n'est pas facturée"
});

const cancelLabel = async () => {
  const err = new Error("L'API Colissimo ne permet pas l'annulation d'une étiquette");
  err.statusCode = 400;
  throw err;
};

/**
 * Nom du fichier téléchargé au packing : `colissimo_<n°>.pdf`.
 *
 * AutoPrint a déjà la règle `colissimo_*` → Intermec PC43d. La CN23, elle, part
 * sous `customs_document_<n°>.pdf` vers la Brother A4 (cf. contract.js).
 */
const labelFileName = (orderNumber) => `colissimo_${orderNumber}.pdf`;

// Champs du contrat. Les libellés reprennent ceux du plugin Colissimo, pour
// qu'un responsable retrouve ses repères.
const ACCOUNT_FIELDS = {
  credentials: [
    { key: 'contract_number', label: 'Identifiant Web Services (n° de contrat)', required: true, placeholder: '906524' },
    { key: 'password',        label: 'Mot de passe Web Services', required: true, secret: true }
  ],
  settings: [
    { key: 'api_url',         label: "URL de l'API", required: true, perContract: true, placeholder: 'https://ws.colissimo.fr/sls-ws/SlsServiceWSRest/3.1' },
    { key: 'sandbox',         label: "Contrat de test — Colissimo valide la requête sans produire d'étiquette", type: 'boolean' },
    { key: 'commercial_name', label: 'Nom commercial (annoncé au client par bpost / Colissimo)', required: true, placeholder: 'EMC' },

    { key: 'sender.company_name', label: 'Raison sociale',    group: 'Expéditeur', required: true },
    { key: 'sender.line2',        label: 'Adresse',           group: 'Expéditeur', required: true },
    { key: 'sender.zip_code',     label: 'Code postal',       group: 'Expéditeur', required: true },
    { key: 'sender.city',         label: 'Ville',             group: 'Expéditeur', required: true },
    { key: 'sender.country_code', label: 'Pays (2 lettres)',  group: 'Expéditeur', required: true, placeholder: 'FR' },
    { key: 'sender.email',        label: 'Courriel',          group: 'Expéditeur' },
    { key: 'sender.phone',        label: 'Téléphone',         group: 'Expéditeur' },

    { key: 'customs.hs_code',        label: 'Code SH (tout le catalogue)',      group: 'Douane (CN23)', required: true, placeholder: '85437070' },
    { key: 'customs.origin_country', label: "Pays d'origine (2 lettres)",       group: 'Douane (CN23)', required: true, placeholder: 'FR' },
    { key: 'customs.category',       label: 'Catégorie (3 = envoi commercial)', group: 'Douane (CN23)', required: true, placeholder: '3' },
    { key: 'customs.eori_number',    label: 'Numéro EORI',                      group: 'Douane (CN23)' },
    { key: 'customs.eori_uk_number', label: 'Numéro EORI Royaume-Uni',          group: 'Douane (CN23)' },
    { key: 'customs.vat_number',     label: 'N° de TVA (Royaume-Uni)',          group: 'Douane (CN23)' },
    { key: 'customs.ftd',            label: "Droits payés par l'expéditeur (DDP) vers GF, GP, MQ, RE", group: 'Douane (CN23)', type: 'boolean' },

    // Avancés : valeurs par défaut de l'adaptateur si le champ reste vide.
    { key: 'output_format',             label: "Format d'étiquette (PDF obligatoire)", advanced: true, placeholder: 'PDF_10x15_300dpi' },
    { key: 'label_top_offset_mm',       label: "Décalage de l'étiquette vers le bas (mm)", advanced: true, placeholder: String(DECALAGE_HAUT_DEFAUT) },
    { key: 'cn23_format',               label: 'Format de la CN23 (PDF obligatoire)',  advanced: true, placeholder: 'PDF_A4_300dpi' },
    { key: 'cn23_copies',               label: 'Exemplaires de CN23',                   advanced: true, placeholder: '4' },
    { key: 'partner_network_countries', label: 'Pays livrés par le réseau partenaire (bpost…)', advanced: true, placeholder: RESEAU_PARTENAIRE_DEFAUT },
    { key: 'customs.currency',          label: 'Devise déclarée',                       advanced: true, placeholder: 'EUR' },
    { key: 'customs.min_unit_value',    label: "Valeur déclarée d'un article offert",   advanced: true, placeholder: '1' }
  ]
};

module.exports = assertAdapter({
  code: 'colissimo',
  accountCode: 'production',
  methodCode: 'domicile',
  label: CARRIER_LABEL,
  logTag: LOG_TAG,
  labelFileName,
  accountFields: ACCOUNT_FIELDS,
  // Libellé par défaut ; chaque étiquette rend le sien, selon son service.
  bmsShipmentTitle: SERVICES.domicile.bms,
  deliveryModes: Object.entries(SERVICES).map(([code, s]) => ({ code, label: s.label })),
  // Seul le mode « relais » passe par un point — Bpost en Belgique.
  requiresRelayPoint: (deliveryMode) => deliveryMode === 'relais',
  relayNetworkLabel: 'Colissimo / Bpost',
  // La CN23 est stockée à part : l'enregistrement exige la colonne cn23_data.
  producesCustomsDocuments: true,
  resolveWeight,
  createLabel,
  cancelLabel,
  cancelWindow,
  // Exposés pour le banc et pour la répétition avant mise en service.
  validateLabel,
  buildLabelPayload,
  resolveDestination,
  assertRelayPoint,
  parseMultipart,
  lignesAdresse,
  normaliserTelephone,
  dateDepot,
  DESTINATIONS
});
