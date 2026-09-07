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
 * d'origine (`trackingId`, `tracking_id`, `laposte_order_id`) pour que le
 * packing ne change pas en même temps que le backend. Les noms neutres sont
 * ajoutés à côté ; le front basculera dessus quand la liste des étiquettes
 * deviendra multi-transporteurs.
 */

const pool = require('../config/database');
const bmsApiModel = require('../models/bmsApiModel');
const shipmentLabelModel = require('../models/shipmentLabelModel');
const shippingMethodMapModel = require('../models/shippingMethodMapModel');
const { sendAlert } = require('../services/alertService');
const { getAdapter } = require('../services/carriers');
const { getAccount } = require('../services/carriers/accounts');
const { stampOrderNumber } = require('../services/carriers/labelPdf');
const { buildUserMessage } = require('../services/carriers/errors');

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
 * @returns {Promise<{labelId: number, carrierOrderId: ?string, trackingNumber: ?string, pdfBase64: string, weightGrams: number}>}
 */
const createShipmentLabel = async ({ adapter, orderNumber, receiver, packedBy, accountCode, options = {} }) => {
  // Avant de dépenser une étiquette : s'assurer qu'on saura l'enregistrer.
  await shipmentLabelModel.assertSchemaReady();

  // Le retrait magasin n'appelle aucune API : il n'a ni identifiants ni réglages.
  const resolvedAccountCode = accountCode || adapter.accountCode;
  const account = adapter.requiresAccount === false
    ? { carrierCode: adapter.code, accountCode: resolvedAccountCode, credentials: {}, settings: {} }
    : await getAccount(adapter.code, resolvedAccountCode);

  const weightGrams = await adapter.resolveWeight({ pool, orderNumber, account, options });

  const { carrierOrderId, trackingNumber, pdfBase64: rawPdf } = await adapter.createLabel({
    orderNumber,
    receiver,
    account,
    weightGrams,
    options
  });

  // Le numéro de commande imprimé en bas à gauche : c'est lui qui rattache
  // l'étiquette au carton une fois la pile mélangée.
  const pdfBase64 = await stampOrderNumber(rawPdf, orderNumber);

  console.log(`[${adapter.logTag}] Étiquette générée — orderId:`, carrierOrderId, 'tracking:', trackingNumber);

  const label = await shipmentLabelModel.insert({
    carrierCode: adapter.code,
    accountCode: resolvedAccountCode,
    methodCode: options.deliveryMode || adapter.methodCode,
    orderNumber,
    trackingNumber,
    carrierOrderId,
    weightGrams,
    packedBy,
    pdfBase64
  });

  return { labelId: label.id, carrierOrderId, trackingNumber, pdfBase64, weightGrams };
};

/**
 * Confirme l'expédition dans BMS. Volontairement non bloquant : l'étiquette est
 * déjà achetée et imprimée, refuser la réponse au packing parce que BMS tousse
 * ne ferait qu'immobiliser le colis. L'échec part en alerte mail pour être
 * rattrapé à la main.
 */
const confirmShipmentInBms = async (adapter, orderNumber, trackingNumber) => {
  try {
    await bmsApiModel.apiCall(`/sales/order/${orderNumber}/ship?ref=true`, 'POST', {
      tracking: {
        title: adapter.bmsShipmentTitle,
        tracking_number: trackingNumber
      }
    });
    console.log('[BMS] Expédition confirmée pour commande', orderNumber, 'tracking:', trackingNumber);
  } catch (bmsError) {
    console.error('[BMS] Erreur confirmation expédition commande', orderNumber, ':', bmsError.message);
    sendAlert(
      `BUG VPS : commande N°${orderNumber} non confirmee en expedition BMS`,
      `Bonjour,\n\nL'expedition de la commande N°${orderNumber} avec le numero de suivi : ${trackingNumber} n'a pas pu etre confirmee a BMS pour la raison suivante :\n\n${bmsError.message}\n\nPensez a corriger cela.`
    );
  }
};

/**
 * Charge la commande et son point relais.
 *
 * `relay_point` n'est renseigné que depuis le 07/09/2026 : les commandes
 * antérieures n'en ont pas, et un transporteur en point de retrait ne peut pas
 * étiqueter sans. L'adaptateur le signalera explicitement plutôt que d'envoyer
 * une requête vouée à l'échec.
 */
const loadOrderForLabel = async (orderNumber) => {
  const { rows } = await pool.query(`
    SELECT
      wp_order_id, shipping_method,
      shipping_first_name, shipping_last_name, shipping_company,
      shipping_address_1, shipping_address_2,
      shipping_city, shipping_postcode, shipping_country,
      shipping_phone, billing_email, order_total, relay_point
    FROM orders
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

    const { carrierOrderId, trackingNumber, pdfBase64, weightGrams } = await createShipmentLabel({
      adapter,
      orderNumber,
      accountCode: mapping.accountCode,
      receiver: receiverFromOrder(order),
      packedBy: req.user?.id || null,
      options: {
        deliveryMode: mapping.deliveryMode,
        relayPoint: order.relay_point || null,
        shippingMethod: order.shipping_method
      }
    });

    // Le retrait magasin n'est pas une expédition : la confirmer à BMS ferait
    // mentir les statistiques de transport.
    if (trackingNumber && adapter.confirmsShipmentInBms !== false) {
      await confirmShipmentInBms(adapter, orderNumber, trackingNumber);
    }

    res.json({
      success: true,
      carrier: adapter.code,
      carrierLabel: adapter.label,
      orderId: carrierOrderId,
      trackingId: trackingNumber,
      weightGrams,
      pdfBase64,
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
      userMessage: adapter ? buildUserMessage(error, adapter.label) : null,
      details: error.body || error.message
    });
  }
};

/**
 * Fabrique les cinq handlers HTTP d'un transporteur.
 *
 * @param {string} carrierCode - code dans le registre (services/carriers)
 */
const makeCarrierHandlers = (carrierCode) => {
  const adapter = getAdapter(carrierCode);

  /** Réponse d'erreur commune aux deux modes de génération. */
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

      const { carrierOrderId, trackingNumber, pdfBase64 } = await createShipmentLabel({
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
        packedBy: req.user?.id || null
      });

      if (trackingNumber) {
        await confirmShipmentInBms(adapter, orderNumber, trackingNumber);
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
   * POST /label-manual — étiquette à partir de champs saisis à la main
   * (réimpression après perte / annulation, envoi hors commande).
   *
   * Deux différences volontaires avec generateLabel :
   *
   *  - AUCUN contrôle de doublon, et ce n'est pas un oubli : cet écran sert
   *    précisément à renvoyer une commande déjà expédiée une première fois
   *    (colis perdu, retour, geste commercial). Une commande peut donc porter
   *    plusieurs étiquettes actives, avec des numéros de suivi distincts, toutes
   *    listées et réimprimables. Ajouter ici le contrôle de doublon de
   *    generateLabel casserait le seul moyen de réexpédier.
   *
   *  - aucune confirmation d'expédition dans BMS : la commande y est en général
   *    déjà expédiée, un second /ship échouerait et déclencherait une alerte mail.
   */
  const generateManualLabel = async (req, res) => {
    try {
      const {
        orderNumber, first_name, last_name, company,
        address, address_2, postcode, city, phone, email
      } = req.body || {};

      const ref = String(orderNumber || '').trim();
      const name = `${(first_name || '').trim()} ${(last_name || '').trim()}`.trim();
      const companyName = (company || '').trim();

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

      const { carrierOrderId, trackingNumber, pdfBase64 } = await createShipmentLabel({
        adapter,
        orderNumber: ref,
        receiver: {
          name: name || companyName,
          // si aucun nom saisi, la société sert de name1 : ne pas la répéter en add2
          company: name ? (companyName || null) : null,
          address: address.trim(),
          address_2: (address_2 || '').trim() || null,
          postcode: postcode.trim(),
          city: city.trim(),
          phone: (phone || '').trim(),
          email: (email || '').trim()
        },
        packedBy: req.user?.id || null
      });

      console.log(`[${adapter.logTag}] Étiquette MANUELLE pour`, ref, '— tracking:', trackingNumber, '— pas de confirmation BMS');

      res.json({
        success: true,
        manual: true,
        orderId: carrierOrderId,
        trackingId: trackingNumber,
        pdfBase64,
        orderNumber: ref
      });

    } catch (error) {
      respondLabelError(res, error, 'generateManualLabel');
    }
  };

  /** GET /labels — les 100 dernières étiquettes. */
  const listLabels = async (req, res) => {
    try {
      const rows = await shipmentLabelModel.listRecent(100);

      const now = new Date();
      const labels = rows.map(row => {
        // La fenêtre d'annulation appartient au transporteur qui a émis
        // l'étiquette, pas à celui de la route : une lettre suivie et un
        // Colissimo listés côte à côte n'ont pas le même délai.
        //
        // Un transporteur retiré du registre ne doit pas emporter la liste
        // entière : ses étiquettes restent affichées et réimprimables, simplement
        // plus annulables depuis l'app.
        let cancellable = false;
        try {
          const rowAdapter = row.carrier_code === adapter.code
            ? adapter
            : getAdapter(row.carrier_code);
          cancellable = rowAdapter.cancelWindow(row, now).cancellable;
        } catch (e) {
          console.warn(`[${adapter.logTag}] Étiquette ${row.id} : transporteur « ${row.carrier_code} » inconnu, annulation indisponible`);
        }

        return {
          ...row,
          // Alias hérités de l'API La Poste, conservés le temps que le packing
          // passe aux noms neutres.
          tracking_id: row.tracking_number,
          laposte_order_id: row.carrier_order_id,
          cancellable: row.status === 'active' && cancellable
        };
      });

      res.json(labels);
    } catch (error) {
      console.error(`[${adapter.logTag}] Erreur listLabels:`, error.message);
      res.status(500).json({ error: 'Erreur serveur' });
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

      res.json({ pdfBase64: row.pdf_data, orderNumber: row.order_number });
    } catch (error) {
      console.error(`[${adapter.logTag}] Erreur getLabelPdf:`, error.message);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  };

  return { generateLabel, generateManualLabel, listLabels, cancelLabel, getLabelPdf };
};

module.exports = { makeCarrierHandlers, createShipmentLabel, generateForOrder };
