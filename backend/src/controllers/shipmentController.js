/**
 * Étiquetage d'expédition — partie commune à tous les transporteurs.
 *
 * Ce contrôleur ne sait rien d'aucune API transporteur. Il tient la chaîne qui
 * ne doit pas varier d'un transporteur à l'autre :
 *   chargement de la commande → contrôle de doublon → appel de l'adaptateur →
 *   tamponnage du numéro sur le PDF → enregistrement → confirmation BMS.
 *
 * Le transporteur est choisi par la route (`makeCarrierHandlers('laposte')`),
 * ce qui rend les lots suivants du chantier expédition additifs : un adaptateur,
 * une ligne dans le registre, un fichier de routes. Rien à retoucher ici.
 *
 * Compatibilité : les réponses gardent les noms de champs de l'API La Poste
 * d'origine (`trackingId`) pour que le packing ne change pas en même temps que
 * le backend.
 */

const pool = require('../config/database');
const shipmentLabelModel = require('../models/shipmentLabelModel');
const shippingMethodMapModel = require('../models/shippingMethodMapModel');
const bmsShipmentConfirmService = require('../services/bmsShipmentConfirmService');
const { getAdapter } = require('../services/carriers');
const { getAccount } = require('../services/carriers/accounts');
const { stampOrderNumber } = require('../services/carriers/labelPdf');
const { buildUserMessage } = require('../services/carriers/errors');
const { customsDocumentFileName } = require('../services/carriers/contract');

/**
 * Cœur de la génération : appel du transporteur, tamponnage du n° de commande
 * sur le PDF, enregistrement en base. Partagé par la génération automatique
 * (fin de packing) et l'expédition manuelle. Ne fait ni contrôle de doublon ni
 * confirmation BMS — c'est à l'appelant de décider.
 *
 * @param {object} input
 * @param {import('../services/carriers/contract').CarrierAdapter} input.adapter
 * @param {string|number} input.orderNumber
 * @param {import('../services/carriers/contract').Receiver} input.receiver
 * @param {?number} input.packedBy
 * @param {?number} [input.weightGrams] - poids imposé, en grammes ; à défaut,
 *        celui de l'adaptateur (resolveWeight)
 * @param {function({adapter: object, trackingNumber: ?string}): boolean} [input.expectsBmsConfirmation]
 *        Dit si l'appelant confirmera l'expédition dans BMS juste après. C'est
 *        ce qui décide si l'étiquette part en 'pending' — donc si la reprise
 *        automatique a le droit de la rejouer. Par défaut non : une étiquette
 *        dont personne n'attend de confirmation ne doit jamais être rejouée.
 * @returns {Promise<{labelId: number, carrierOrderId: ?string, trackingNumber: ?string, pdfBase64: string,
 *                    cn23Base64: ?string, bmsShipmentTitle: ?string, weightGrams: number}>}
 */
const createShipmentLabel = async ({
  adapter, orderNumber, receiver, packedBy, accountCode, options = {},
  weightGrams: declaredWeight = null,
  expectsBmsConfirmation = () => false
}) => {
  // Avant de dépenser une étiquette : s'assurer qu'on saura l'enregistrer — CN23
  // comprise quand le transporteur peut en rendre une.
  await shipmentLabelModel.assertSchemaReady({ cn23: adapter.producesCustomsDocuments === true });

  // Le retrait magasin n'appelle aucune API : il n'a ni identifiants ni réglages.
  const resolvedAccountCode = accountCode || adapter.accountCode;
  const account = adapter.requiresAccount === false
    ? { carrierCode: adapter.code, accountCode: resolvedAccountCode, credentials: {}, settings: {} }
    : await getAccount(adapter.code, resolvedAccountCode);

  // Un poids saisi (expédition manuelle) prime : la référence n'est pas
  // forcément une commande, et même quand elle l'est, le colis renvoyé n'a pas
  // toujours le contenu d'origine.
  const weightGrams = declaredWeight != null
    ? declaredWeight
    : await adapter.resolveWeight({ pool, orderNumber, account, options });

  const {
    carrierOrderId, trackingNumber, pdfBase64: rawPdf,
    cn23Base64 = null, methodCode = null, bmsShipmentTitle = null
  } = await adapter.createLabel({
    orderNumber,
    receiver,
    account,
    weightGrams,
    options,
    pool
  });

  // Le numéro de commande imprimé en bas à gauche : c'est lui qui rattache
  // l'étiquette au carton une fois la pile mélangée.
  const pdfBase64 = await stampOrderNumber(rawPdf, orderNumber);

  console.log(`[${adapter.logTag}] Étiquette générée — orderId:`, carrierOrderId, 'tracking:', trackingNumber);

  const label = await shipmentLabelModel.insert({
    carrierCode: adapter.code,
    accountCode: resolvedAccountCode,
    // Le code produit réellement employé quand l'adaptateur le connaît (DOM, COM,
    // HD…) : c'est lui qui dira, plus tard, ce qui a été facturé.
    methodCode: methodCode || options.deliveryMode || adapter.methodCode,
    orderNumber,
    trackingNumber,
    carrierOrderId,
    weightGrams,
    packedBy,
    pdfBase64,
    cn23Base64,
    bmsShipStatus: expectsBmsConfirmation({ adapter, trackingNumber }) ? 'pending' : 'skipped',
    // Exactement le libellé que la confirmation va envoyer : c'est lui que la
    // reprise renverra, pour ne pas étiqueter un point de retrait Colissimo en
    // « Domicile sans signature ».
    bmsShipTitle: bmsShipmentTitle || adapter.bmsShipmentTitle
  });

  return { labelId: label.id, carrierOrderId, trackingNumber, pdfBase64, cn23Base64, bmsShipmentTitle, weightGrams };
};

/**
 * Confirme l'expédition dans BMS. Volontairement non bloquant : l'étiquette est
 * déjà achetée et imprimée, refuser la réponse au packing parce que BMS tousse
 * ne ferait qu'immobiliser le colis.
 *
 * L'échec n'est plus un mail et rien d'autre : il est écrit sur l'étiquette,
 * repris toutes les 15 min par le cron, et affiché dans l'écran des étiquettes
 * (cf. services/bmsShipmentConfirmService).
 *
 * @param {object} adapter
 * @param {?number} labelId - l'étiquette à marquer ; c'est elle qui rend
 *        l'échec rattrapable
 * @param {string|number} orderNumber
 * @param {?string} trackingNumber
 * @param {?string} title - Colissimo rend un libellé par étiquette (domicile,
 *        signature, point de retrait) ; les autres s'en tiennent au leur.
 */
const confirmShipmentInBms = (adapter, labelId, orderNumber, trackingNumber, title = null) =>
  bmsShipmentConfirmService.confirmNow({
    labelId,
    orderNumber,
    trackingNumber,
    title: title || adapter.bmsShipmentTitle
  });

/**
 * Charge la commande et son point relais.
 *
 * `relay_point` n'est renseigné que depuis le 07/09/2026 : les commandes
 * antérieures n'en ont pas, et un transporteur en point de retrait ne peut pas
 * étiqueter sans. L'adaptateur le signalera explicitement plutôt que d'envoyer
 * une requête vouée à l'échec.
 *
 * Le point saisi à la main dans la fiche commande (`relay_point_manual`) prime
 * sur celui de WooCommerce : c'est le seul moyen d'en donner un à une commande
 * créée au back-office. Il est lu via `to_jsonb` sans nommer la colonne, pour
 * que le packing continue de tourner si la migration n'est pas encore passée ;
 * le NULLIF écarte le `null` JSON que rend une colonne présente mais vide.
 */
const loadOrderForLabel = async (orderNumber) => {
  const { rows } = await pool.query(`
    SELECT
      wp_order_id, shipping_method,
      shipping_first_name, shipping_last_name, shipping_company,
      shipping_address_1, shipping_address_2,
      shipping_city, shipping_postcode, shipping_country,
      shipping_phone, billing_phone, billing_email, order_total,
      COALESCE(NULLIF(to_jsonb(o) -> 'relay_point_manual', 'null'::jsonb), o.relay_point) AS relay_point
    FROM orders o
    WHERE wp_order_id = $1
  `, [orderNumber]);
  return rows[0] || null;
};

/** Destinataire, dans la forme attendue par le contrat transporteur. */
const receiverFromOrder = (order) => ({
  name: `${order.shipping_first_name || ''} ${order.shipping_last_name || ''}`.trim(),
  first_name: order.shipping_first_name,
  last_name: order.shipping_last_name,
  company: order.shipping_company,
  address: order.shipping_address_1,
  address_2: order.shipping_address_2,
  postcode: order.shipping_postcode,
  city: order.shipping_city,
  country: order.shipping_country,
  phone: order.shipping_phone,
  // Champ À PART, pas un repli de `phone` : les payloads La Poste et Mondial
  // Relay restent identiques au caractère près. Colissimo en a besoin — il exige
  // un mobile en point de retrait, et `shipping_phone` est vide sur 100 % des
  // commandes Bpost (0 sur 977 en 90 jours), `billing_phone` jamais.
  billing_phone: order.billing_phone,
  email: order.billing_email
});

/**
 * Génération d'étiquette pilotée par la correspondance des dénominations.
 *
 * À la différence des handlers par transporteur, celui-ci ne sait pas d'avance à
 * qui il parle : c'est `shipping_method_carrier_map` qui tranche, et **elle seule**.
 * Une dénomination inconnue renvoie 422 avec de quoi afficher au préparateur un
 * message utile — le nom exact à faire mapper par un responsable — au lieu de
 * fabriquer une étiquette chez le mauvais transporteur.
 *
 * @param {object} req.params.orderNumber
 */
const generateForOrder = async (req, res) => {
  const { orderNumber } = req.params;
  let adapter = null;

  try {
    const order = await loadOrderForLabel(orderNumber);
    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    const mapping = await shippingMethodMapModel.resolve(order.shipping_method);

    // Dénomination jamais mappée : on refuse, et on dit quoi faire.
    if (mapping.status === 'unknown') {
      return res.status(422).json({
        error: 'Mode de livraison non reconnu',
        reason: 'unknown_shipping_method',
        denomination: order.shipping_method,
        orderNumber,
        userMessage: `Le mode de livraison « ${order.shipping_method || '(vide)'} » n'est associé à aucun transporteur. `
          + `Demandez à un responsable de l'ajouter dans les réglages avant d'expédier cette commande.`
      });
    }

    // Dénomination connue, volontairement sans étiquette.
    if (mapping.status === 'no_label') {
      return res.status(200).json({
        success: true,
        noLabel: true,
        denomination: mapping.denomination,
        orderNumber,
        userMessage: `« ${mapping.denomination} » ne génère pas d'étiquette.`
      });
    }

    adapter = getAdapter(mapping.carrierCode);

    // Une commande = un colis.
    const existing = await shipmentLabelModel.findActiveByOrderNumber(orderNumber);
    if (existing) {
      return res.status(409).json({
        error: 'Une étiquette active existe déjà pour cette commande',
        trackingId: existing.tracking_number,
        labelId: existing.id,
        createdAt: existing.created_at,
        carrier: existing.carrier_code
      });
    }

    const { labelId, carrierOrderId, trackingNumber, pdfBase64, cn23Base64, bmsShipmentTitle, weightGrams } = await createShipmentLabel({
      adapter,
      orderNumber,
      accountCode: mapping.accountCode,
      receiver: receiverFromOrder(order),
      packedBy: req.user?.id || null,
      options: {
        deliveryMode: mapping.deliveryMode,
        relayPoint: order.relay_point || null,
        shippingMethod: order.shipping_method,
        // Interrupteur « Livraison samedi » du packing (Chronopost). Absent,
        // l'adaptateur applique sa règle par défaut : oui le vendredi.
        saturdayDelivery: typeof req.body?.saturdayDelivery === 'boolean' ? req.body.saturdayDelivery : undefined
      },
      // Même condition que la confirmation ci-dessous, et pour la même raison :
      // elle porte sur l'adaptateur, pas sur la présence d'un numéro de suivi.
      expectsBmsConfirmation: () => adapter.confirmsShipmentInBms !== false
    });

    // Toute étiquette émise sort du stock : BMS doit le savoir, y compris pour
    // un retrait magasin, qui n'a pourtant aucun numéro de suivi. La condition
    // porte sur l'adaptateur, pas sur la présence d'un numéro.
    if (adapter.confirmsShipmentInBms !== false) {
      await confirmShipmentInBms(adapter, labelId, orderNumber, trackingNumber, bmsShipmentTitle);
    }

    res.json({
      success: true,
      carrier: adapter.code,
      carrierLabel: adapter.label,
      orderId: carrierOrderId,
      trackingId: trackingNumber,
      weightGrams,
      pdfBase64,
      // AutoPrint choisit l'imprimante d'après le NOM du fichier téléchargé.
      // C'est donc l'adaptateur qui le décide, pas l'écran : chaque
      // transporteur a sa convention, séparateur compris.
      fileName: adapter.labelFileName(orderNumber),
      // Déclaration douanière : un second fichier, pour une autre imprimante.
      cn23Base64: cn23Base64 || null,
      cn23FileName: cn23Base64 ? customsDocumentFileName(orderNumber) : null,
      orderNumber
    });

  } catch (error) {
    const tag = adapter ? adapter.logTag : 'Expedition';
    console.error(`[${tag}] Erreur generateForOrder ${orderNumber}:`, error.message);

    if (error.statusCode === 401 && adapter && typeof adapter.onAuthFailure === 'function') {
      adapter.onAuthFailure();
    }

    res.status(error.statusCode || 500).json({
      error: adapter ? `Erreur génération étiquette ${adapter.label}` : 'Erreur génération étiquette',
      // Un adaptateur qui sait expliquer le problème en français le dit
      // lui-même : son message prime sur la traduction générique des pannes
      // d'API, qui ne connaît que les timeouts et les 5xx.
      userMessage: error.userMessage
        || (adapter ? buildUserMessage(error, adapter.label) : null),
      details: error.body || error.message
    });
  }
};

// ── Expédition manuelle ─────────────────────────────────────────────────────

/** Clé d'un service : transporteur, contrat et mode, comme dans la correspondance. */
const manualServiceKey = (carrierCode, accountCode, deliveryMode) =>
  [carrierCode, accountCode || '', deliveryMode || ''].join('|');

/**
 * Services proposés à l'expédition manuelle : les triplets transporteur ×
 * contrat × mode de la correspondance active, dédoublonnés.
 *
 * On ne propose que ce que la correspondance désigne déjà : c'est elle qui dit
 * quel contrat et quel mode sont en service. Un choix libre de transporteur et
 * de contrat permettrait d'émettre sur un contrat de test ou un mode que
 * personne n'a validé.
 *
 * @returns {Promise<object[]>}
 */
const listManualServices = async () => {
  const rows = await shippingMethodMapModel.listActive();
  const services = new Map();

  for (const row of rows) {
    if (!row.carrier_code) continue;
    let adapter;
    try { adapter = getAdapter(row.carrier_code); } catch (e) { continue; }

    const key = manualServiceKey(row.carrier_code, row.account_code, row.delivery_mode);
    if (!services.has(key)) {
      const mode = (adapter.deliveryModes || []).find(m => m.code === row.delivery_mode);
      services.set(key, {
        key,
        carrierCode: adapter.code,
        carrierLabel: adapter.label,
        accountCode: row.account_code,
        deliveryMode: row.delivery_mode || null,
        modeLabel: mode ? mode.label : null,
        requiresRelayPoint: typeof adapter.requiresRelayPoint === 'function'
          && adapter.requiresRelayPoint(row.delivery_mode),
        relayNetworkLabel: adapter.relayNetworkLabel || adapter.label,
        fixedWeight: adapter.fixedWeight === true,
        saturdayEligible: typeof adapter.supportsSaturdayDelivery === 'function'
          && adapter.supportsSaturdayDelivery(row.delivery_mode),
        denominations: []
      });
    }
    services.get(key).denominations.push(row.denomination);
  }

  return [...services.values()].sort((a, b) =>
    a.carrierLabel.localeCompare(b.carrierLabel, 'fr')
    || String(a.modeLabel || a.denominations[0]).localeCompare(String(b.modeLabel || b.denominations[0]), 'fr'));
};

/** GET /manual-services — services proposés à l'expédition manuelle. */
const getManualServices = async (req, res) => {
  try {
    res.json({ services: await listManualServices() });
  } catch (error) {
    console.error('[Expedition] Erreur getManualServices:', error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

/**
 * POST /label-manual — étiquette à partir de champs saisis à la main
 * (réimpression après perte / annulation, envoi hors commande), chez n'importe
 * quel transporteur de la correspondance.
 *
 * Trois différences volontaires avec generateForOrder :
 *
 *  - AUCUN contrôle de doublon, et ce n'est pas un oubli : cet écran sert
 *    précisément à renvoyer une commande déjà expédiée une première fois
 *    (colis perdu, retour, geste commercial). Une commande peut donc porter
 *    plusieurs étiquettes actives, avec des numéros de suivi distincts, toutes
 *    listées et réimprimables. Ajouter ici le contrôle de doublon casserait le
 *    seul moyen de réexpédier.
 *
 *  - aucune confirmation d'expédition dans BMS : la commande y est en général
 *    déjà expédiée, un second /ship ferait sortir le stock une deuxième fois.
 *
 *  - le poids est SAISI (sauf transporteur au forfait) : la référence n'est
 *    pas forcément une commande, et le colis renvoyé n'a pas toujours le
 *    contenu d'origine. Le point relais aussi : l'écran le préremplit depuis la
 *    commande, mais c'est ce qui est envoyé qui compte.
 */
const generateManual = async (req, res) => {
  let adapter = null;

  try {
    const {
      service, orderNumber, first_name, last_name, company,
      address, address_2, postcode, city, country, phone, email,
      weightGrams, relayPoint, saturdayDelivery
    } = req.body || {};

    const ref = String(orderNumber || '').trim();
    const name = `${(first_name || '').trim()} ${(last_name || '').trim()}`.trim();
    const companyName = (company || '').trim();
    const pays = String(country || 'FR').trim().toUpperCase();

    if (!ref) {
      return res.status(400).json({ error: 'Numéro de commande obligatoire' });
    }
    if (ref.length > shipmentLabelModel.ORDER_NUMBER_MAX_LENGTH) {
      return res.status(400).json({
        error: `Numéro de commande limité à ${shipmentLabelModel.ORDER_NUMBER_MAX_LENGTH} caractères`
      });
    }
    if (!name && !companyName) {
      return res.status(400).json({ error: 'Nom ou société du destinataire obligatoire' });
    }
    if (!(address || '').trim() || !(postcode || '').trim() || !(city || '').trim()) {
      return res.status(400).json({ error: 'Adresse, code postal et ville sont obligatoires' });
    }
    if (!/^[A-Z]{2}$/.test(pays)) {
      return res.status(400).json({ error: `Pays « ${country || ''} » invalide : un code à deux lettres est attendu (FR, BE…)` });
    }

    // Le service doit exister dans la correspondance active : pas de contrat ni
    // de mode arbitraire venu du navigateur.
    const services = await listManualServices();
    const choisi = services.find(sv => sv.key === manualServiceKey(
      service?.carrierCode, service?.accountCode, service?.deliveryMode));
    if (!choisi) {
      return res.status(400).json({ error: 'Transporteur ou mode de livraison inconnu : rechargez la page' });
    }
    adapter = getAdapter(choisi.carrierCode);

    let poids = null;
    if (!choisi.fixedWeight) {
      poids = Math.round(Number(weightGrams));
      if (!Number.isFinite(poids) || poids <= 0) {
        return res.status(400).json({ error: `Poids obligatoire pour ${adapter.label} (en grammes)` });
      }
    }

    // Le point relais n'est transmis que si le mode en exige un : un point
    // resté dans le formulaire après changement de transporteur ne doit pas
    // partir chez un autre réseau.
    let point = null;
    if (choisi.requiresRelayPoint) {
      const id = String(relayPoint?.id ?? '').trim();
      point = id ? {
        ...relayPoint,
        id,
        network: relayPoint.network || adapter.code,
        country: String(relayPoint.country || pays).trim().toUpperCase()
      } : null;
    }

    const { carrierOrderId, trackingNumber, pdfBase64, cn23Base64, weightGrams: poidsDeclare } = await createShipmentLabel({
      adapter,
      orderNumber: ref,
      accountCode: choisi.accountCode,
      receiver: {
        name: name || companyName,
        first_name: (first_name || '').trim() || null,
        last_name: (last_name || '').trim() || null,
        // si aucun nom saisi, la société sert de nom : ne pas la répéter
        company: name ? (companyName || null) : null,
        address: address.trim(),
        address_2: (address_2 || '').trim() || null,
        postcode: postcode.trim(),
        city: city.trim(),
        country: pays,
        phone: (phone || '').trim(),
        // Colissimo cherche le mobile ici en point de retrait (cf. receiverFromOrder).
        billing_phone: (phone || '').trim(),
        email: (email || '').trim()
      },
      packedBy: req.user?.id || null,
      weightGrams: poids,
      options: {
        deliveryMode: choisi.deliveryMode,
        relayPoint: point,
        shippingMethod: choisi.denominations[0],
        saturdayDelivery: choisi.saturdayEligible && typeof saturdayDelivery === 'boolean'
          ? saturdayDelivery : undefined
      }
    });

    console.log(`[${adapter.logTag}] Étiquette MANUELLE pour`, ref, '— tracking:', trackingNumber, '— pas de confirmation BMS');

    res.json({
      success: true,
      manual: true,
      carrier: adapter.code,
      carrierLabel: adapter.label,
      orderId: carrierOrderId,
      trackingId: trackingNumber,
      weightGrams: poidsDeclare,
      pdfBase64,
      // Nom de fichier du transporteur : c'est lui qui choisit l'imprimante AutoPrint.
      fileName: adapter.labelFileName(ref),
      cn23Base64: cn23Base64 || null,
      cn23FileName: cn23Base64 ? customsDocumentFileName(ref) : null,
      orderNumber: ref
    });

  } catch (error) {
    const tag = adapter ? adapter.logTag : 'Expedition';
    console.error(`[${tag}] Erreur generateManual:`, error.message);

    if (error.statusCode === 401 && adapter && typeof adapter.onAuthFailure === 'function') {
      adapter.onAuthFailure();
    }

    res.status(error.statusCode || 500).json({
      error: adapter ? `Erreur génération étiquette ${adapter.label}` : 'Erreur génération étiquette',
      userMessage: error.userMessage
        || (adapter ? buildUserMessage(error, adapter.label) : null),
      details: error.body || error.message
    });
  }
};

/**
 * Fabrique les handlers HTTP d'un transporteur.
 *
 * @param {string} carrierCode - code dans le registre (services/carriers)
 */
const makeCarrierHandlers = (carrierCode) => {
  const adapter = getAdapter(carrierCode);

  /** Réponse d'erreur de la génération. */
  const respondLabelError = (res, error, context) => {
    console.error(`[${adapter.logTag}] Erreur ${context}:`, error.message);

    // Si token expiré, invalider le cache
    if (error.statusCode === 401 && typeof adapter.onAuthFailure === 'function') {
      adapter.onAuthFailure();
    }

    res.status(error.statusCode || 500).json({
      error: `Erreur génération étiquette ${adapter.label}`,
      userMessage: buildUserMessage(error, adapter.label),
      details: error.body || error.message
    });
  };

  /** POST /label/:orderNumber — génération à la fin du packing. */
  const generateLabel = async (req, res) => {
    try {
      const { orderNumber } = req.params;

      const orderResult = await pool.query(`
        SELECT
          wp_order_id,
          shipping_first_name, shipping_last_name, shipping_company,
          shipping_address_1, shipping_address_2,
          shipping_city, shipping_postcode, shipping_country,
          shipping_phone, billing_email, order_total
        FROM orders
        WHERE wp_order_id = $1
      `, [orderNumber]);

      if (orderResult.rows.length === 0) {
        return res.status(404).json({ error: 'Commande introuvable' });
      }

      const order = orderResult.rows[0];

      // Une commande = un colis : une étiquette active suffit à bloquer, quel
      // que soit le transporteur qui l'a émise.
      const existing = await shipmentLabelModel.findActiveByOrderNumber(orderNumber);
      if (existing) {
        return res.status(409).json({
          error: 'Une étiquette active existe déjà pour cette commande',
          trackingId: existing.tracking_number,
          labelId: existing.id,
          createdAt: existing.created_at,
          carrier: existing.carrier_code
        });
      }

      const { labelId, carrierOrderId, trackingNumber, pdfBase64 } = await createShipmentLabel({
        adapter,
        orderNumber,
        receiver: {
          name: `${order.shipping_first_name || ''} ${order.shipping_last_name || ''}`.trim(),
          company: order.shipping_company,
          address: order.shipping_address_1,
          address_2: order.shipping_address_2,
          postcode: order.shipping_postcode,
          city: order.shipping_city,
          phone: order.shipping_phone,
          email: order.billing_email
        },
        packedBy: req.user?.id || null,
        // Même condition que la confirmation ci-dessous.
        expectsBmsConfirmation: ({ trackingNumber: suivi }) => Boolean(suivi)
      });

      if (trackingNumber) {
        await confirmShipmentInBms(adapter, labelId, orderNumber, trackingNumber);
      }

      res.json({
        success: true,
        orderId: carrierOrderId,
        trackingId: trackingNumber,
        pdfBase64,
        orderNumber
      });

    } catch (error) {
      respondLabelError(res, error, 'generateLabel');
    }
  };

  /**
   * POST /labels/:id/confirm-bms — rejoue la confirmation d'expédition.
   *
   * Pour l'étiquette qu'aucune reprise automatique n'a réussi à confirmer : soit
   * BMS a fini par accepter, soit l'expédition a été saisie à la main dans BMS
   * et il ne reste qu'à la classer. Le service lit BMS avant d'écrire, donc ce
   * bouton ne peut pas créer une seconde expédition, quel que soit le nombre de
   * clics.
   */
  const confirmBmsShipment = async (req, res) => {
    try {
      const resultat = await bmsShipmentConfirmService.confirmLabelById(req.params.id);
      res.json({ success: true, ...resultat });
    } catch (error) {
      console.error(`[${adapter.logTag}] Erreur confirmBmsShipment:`, error.message);
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  };

  /** POST /labels/:id/cancel */
  const cancelLabel = async (req, res) => {
    try {
      const { id } = req.params;

      const label = await shipmentLabelModel.findById(id);
      if (!label) {
        return res.status(404).json({ error: 'Étiquette introuvable' });
      }

      if (label.status !== 'active') {
        return res.status(400).json({ error: 'Étiquette déjà annulée' });
      }

      const labelAdapter = getAdapter(label.carrier_code);

      const { cancellable, reason } = labelAdapter.cancelWindow(label);
      if (!cancellable) {
        return res.status(400).json({ error: reason });
      }

      const account = await getAccount(labelAdapter.code, label.account_code);
      const data = await labelAdapter.cancelLabel({ label, account });

      await shipmentLabelModel.markCancelled(id);

      res.json({ success: true, cancelResult: data });

    } catch (error) {
      console.error(`[${adapter.logTag}] Erreur cancelLabel:`, error.message);
      res.status(error.statusCode || 500).json({
        error: 'Erreur annulation étiquette',
        details: error.body || error.message
      });
    }
  };

  /** GET /labels/:id/pdf — réimpression. */
  const getLabelPdf = async (req, res) => {
    try {
      const { id } = req.params;
      const row = await shipmentLabelModel.findPdfById(id);

      if (!row) {
        return res.status(404).json({ error: 'Étiquette introuvable' });
      }

      if (!row.pdf_data) {
        return res.status(404).json({ error: 'PDF non disponible pour cette étiquette' });
      }

      // Le nom vient du transporteur QUI A ÉMIS l'étiquette, pas de celui de la
      // route : la liste est commune à tous, et une étiquette Mondial Relay
      // réimprimée sous le nom d'une lettre suivie partirait sur la mauvaise
      // imprimante.
      let fileName = null;
      try {
        fileName = getAdapter(row.carrier_code).labelFileName(row.order_number);
      } catch (e) {
        console.warn(`[${adapter.logTag}] Étiquette ${id} : transporteur « ${row.carrier_code} » inconnu, nom de fichier par défaut`);
      }

      res.json({
        pdfBase64: row.pdf_data,
        orderNumber: row.order_number,
        fileName,
        // La CN23 se réimprime avec l'étiquette : un colis outre-mer sans elle
        // reste bloqué en douane.
        cn23Base64: row.cn23_data || null,
        cn23FileName: row.cn23_data ? customsDocumentFileName(row.order_number) : null
      });
    } catch (error) {
      console.error(`[${adapter.logTag}] Erreur getLabelPdf:`, error.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  };

  return { generateLabel, cancelLabel, getLabelPdf, confirmBmsShipment };
};

// loadOrderForLabel et receiverFromOrder sont exportés pour la répétition
// Colissimo (scripts/checkColissimoLabels.js) : elle doit lire les commandes
// EXACTEMENT comme le packing, sinon elle valide autre chose que ce qui partira.
module.exports = {
  makeCarrierHandlers, createShipmentLabel, generateForOrder, getManualServices, generateManual,
  loadOrderForLabel, receiverFromOrder
};
