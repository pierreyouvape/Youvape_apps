/**
 * Confirmation d'expédition dans BMS, et sa reprise.
 *
 * Quand une étiquette est émise, le colis sort du stock : BMS doit enregistrer
 * l'expédition, sinon il croit détenir une marchandise qui est déjà partie.
 * L'appel est volontairement non bloquant au packing — l'étiquette est achetée
 * et imprimée, refuser la réponse n'immobiliserait qu'un carton — mais il ne
 * peut pas s'arrêter là : jusqu'au 22/09/2026 un échec ne laissait qu'un mail,
 * et une commande (1262418) est restée trois jours avec trois unités jamais
 * sorties du stock parce que ce mail n'a pas été vu.
 *
 * D'où ce service : l'échec est écrit en base (`bms_ship_status = 'pending'`),
 * un cron repasse, et l'écran des étiquettes le montre.
 *
 * ── La règle qui compte : ne jamais expédier deux fois ───────────────────────
 * Rejouer un POST /ship en aveugle créerait une seconde expédition dans BMS et
 * sortirait le stock une seconde fois. Toute reprise commence donc par LIRE la
 * commande dans BMS, et s'abstient dès que BMS n'a plus rien à expédier :
 *
 *   - notre numéro de suivi est déjà sur une expédition BMS → c'est fait, et la
 *     première tentative avait en réalité abouti (réponse perdue, pas l'appel) ;
 *   - `qty_to_ship` à 0 sans notre numéro → quelqu'un a expédié autrement (à la
 *     main dans BMS). On classe en 'manual', on n'envoie rien ;
 *   - `qty_to_ship` > 0 → là, et là seulement, on rejoue le POST.
 *
 * C'est aussi l'explication de l'erreur d'origine, « La commande ne peut pas
 * etre expediee » : BMS la renvoie quand il ne reste rien à expédier sur la
 * commande.
 */

const bmsApiModel = require('../models/bmsApiModel');
const shipmentLabelModel = require('../models/shipmentLabelModel');
const { sendAlert } = require('./alertService');

/**
 * Pause entre deux étiquettes reprises.
 *
 * BMS plafonne les appels sur une fenêtre d'environ une minute et répond « Too
 * Many Attempts » en HTTP 400 (pas 429). En marche normale la file tient dans
 * les doigts d'une main, mais après une panne BMS d'une journée elle peut
 * compter des dizaines d'étiquettes, à deux appels chacune : les envoyer d'un
 * bloc ferait échouer la reprise au moment précis où elle sert.
 */
const PAUSE_ENTRE_REPRISES_MS = 300;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Au-delà, la reprise s'arrête : l'état de la commande dans BMS a trop bougé. */
const MAX_RETRY_AGE_DAYS = 7;

/** Délai avant qu'une étiquette non confirmée entre dans la synthèse du soir. */
const STUCK_AFTER_MINUTES = 120;

/**
 * POST de confirmation. Seul endroit du code qui appelle /ship.
 *
 * `tracking_number` n'est pas obligatoire côté BMS (le champ `tracking` est même
 * déclaré nullable). Un retrait magasin n'a aucun numéro de suivi : on envoie le
 * titre seul plutôt que d'inventer un numéro qui polluerait les recherches de
 * colis.
 *
 * @param {string|number} orderNumber
 * @param {?string} trackingNumber
 * @param {string} title - libellé d'expédition BMS (Colissimo en a un par
 *        étiquette : domicile, signature, point de retrait)
 */
const postShip = (orderNumber, trackingNumber, title) =>
  bmsApiModel.apiCall(`/sales/order/${orderNumber}/ship?ref=true`, 'POST', {
    tracking: {
      title,
      ...(trackingNumber ? { tracking_number: trackingNumber } : {})
    }
  });

/**
 * Tentative immédiate, au moment de l'étiquetage. Un seul appel, sans lecture
 * préalable : au packing, chaque aller-retour d'API se paie en secondes devant
 * le préparateur, et la commande vient d'être préparée — BMS a normalement de
 * quoi expédier.
 *
 * L'échec n'interrompt rien : il est écrit en base, la reprise s'en charge.
 *
 * @param {object} input
 * @param {?number} input.labelId - étiquette à marquer ; sans elle, rien n'est
 *        rattrapable et l'échec repart en alerte immédiate
 * @param {string|number} input.orderNumber
 * @param {?string} input.trackingNumber
 * @param {string} input.title
 * @returns {Promise<boolean>} true si BMS a confirmé
 */
const confirmNow = async ({ labelId, orderNumber, trackingNumber, title }) => {
  try {
    await postShip(orderNumber, trackingNumber, title);
    console.log('[BMS] Expédition confirmée pour commande', orderNumber,
      'tracking:', trackingNumber || '(sans numéro de suivi)');
    if (labelId) await shipmentLabelModel.markBmsConfirmed(labelId);
    return true;
  } catch (bmsError) {
    console.error('[BMS] Erreur confirmation expédition commande', orderNumber, ':', bmsError.message);

    // Rien de ce qui suit n'a le droit de remonter : on est appelé APRÈS l'achat
    // de l'étiquette, et une exception ici rendrait une 500 au packing pour un
    // colis déjà étiqueté et imprimé — le préparateur le mettrait de côté alors
    // qu'il peut partir. C'est tout l'objet du « non bloquant ».
    try {
      // Sans étiquette identifiée, ou tant que la migration n'a pas tourné, rien
      // ne retiendra cet échec : on retombe sur l'alerte immédiate d'avant, qui
      // vaut mieux qu'un silence. Dans le cas normal, pas de mail ici — la
      // reprise a quinze minutes pour régler ça toute seule, et ce qui résiste
      // part dans la synthèse du soir.
      const rattrapable = Boolean(labelId) && await shipmentLabelModel.hasBmsColumns();
      if (rattrapable) {
        await shipmentLabelModel.recordBmsFailure(labelId, bmsError.message);
      } else {
        sendAlert(
          `BUG VPS : commande N°${orderNumber} non confirmee en expedition BMS`,
          `Bonjour,\n\nL'expedition de la commande N°${orderNumber} avec le numero de suivi : ${trackingNumber || '(aucun - retrait magasin)'} n'a pas pu etre confirmee a BMS pour la raison suivante :\n\n${bmsError.message}\n\nAucune reprise automatique n'est possible pour cette etiquette : regularisez la dans BMS.`
        );
      }
    } catch (interne) {
      console.error('[BMS] Impossible d\'enregistrer l\'échec de confirmation (étiquette',
        labelId, ') :', interne.message);
    }
    return false;
  }
};

/**
 * État d'expédition d'une commande vu par BMS.
 *
 * @param {string|number} orderNumber
 * @param {?string} trackingNumber - notre numéro de suivi, pour reconnaître
 *        notre propre expédition parmi celles déjà enregistrées
 * @returns {Promise<{alreadyOurs: boolean, toShip: number, shipmentCount: number}>}
 */
const readBmsShipmentState = async (orderNumber, trackingNumber) => {
  const { data } = await bmsApiModel.apiCall(
    `/sales/orders/reference/${encodeURIComponent(orderNumber)}`
  );

  const shipments = Array.isArray(data?.shipments) ? data.shipments : [];
  const suivi = trackingNumber ? String(trackingNumber).trim() : null;

  const alreadyOurs = Boolean(suivi) && shipments.some((s) =>
    (Array.isArray(s?.trackings) ? s.trackings : [])
      .some((t) => String(t || '').trim() === suivi)
  );

  const toShip = (Array.isArray(data?.items) ? data.items : [])
    .reduce((somme, item) => somme + (Number(item?.qty_to_ship) || 0), 0);

  return { alreadyOurs, toShip, shipmentCount: shipments.length };
};

/**
 * Reprise d'une étiquette, en lisant BMS d'abord (cf. règle en tête de fichier).
 *
 * @param {object} label - ligne rendue par listPendingBmsConfirmations
 * @returns {Promise<'confirmed'|'manual'|'pending'>}
 */
const retryOne = async (label) => {
  const { id, order_number: orderNumber, tracking_number: trackingNumber } = label;
  const title = titleForLabel(label);

  let etat;
  try {
    etat = await readBmsShipmentState(orderNumber, trackingNumber);
  } catch (error) {
    // Commande pas encore importée dans BMS, ou API indisponible : on ne sait
    // pas, donc on n'envoie rien. Prochain passage.
    await shipmentLabelModel.recordBmsFailure(id, `Lecture BMS impossible : ${error.message}`);
    return 'pending';
  }

  if (etat.alreadyOurs) {
    console.log(`[BMS] Reprise ${orderNumber} : expédition déjà enregistrée (${trackingNumber}), rien à envoyer`);
    await shipmentLabelModel.markBmsConfirmed(id);
    return 'confirmed';
  }

  if (etat.toShip <= 0) {
    console.log(`[BMS] Reprise ${orderNumber} : plus rien à expédier côté BMS (${etat.shipmentCount} expédition(s)), classée régularisée hors app`);
    await shipmentLabelModel.markBmsConfirmed(id, { status: 'manual' });
    return 'manual';
  }

  try {
    await postShip(orderNumber, trackingNumber, title);
    console.log(`[BMS] Reprise ${orderNumber} : expédition confirmée (tracking ${trackingNumber || 'aucun'})`);
    await shipmentLabelModel.markBmsConfirmed(id);
    return 'confirmed';
  } catch (error) {
    await shipmentLabelModel.recordBmsFailure(id, error.message);
    return 'pending';
  }
};

/**
 * Libellé d'expédition BMS à renvoyer pour une reprise.
 *
 * Celui de l'étiquette d'origine, conservé en base : Colissimo en a un par
 * produit, et le défaut du transporteur étiquetterait un point de retrait en
 * « Domicile sans signature ». Repli sur le transporteur pour les étiquettes
 * émises avant que la colonne n'existe.
 *
 * @param {object} label
 * @returns {string}
 */
const titleForLabel = (label) => {
  if (label.bms_ship_title) return label.bms_ship_title;
  try {
    const { getAdapter } = require('./carriers');
    return getAdapter(label.carrier_code).bmsShipmentTitle || label.carrier_code;
  } catch (e) {
    return label.carrier_code;
  }
};

/**
 * Cron de reprise. Best-effort : une étiquette qui échoue n'empêche pas les
 * suivantes, et rien n'est propagé à l'appelant.
 *
 * @returns {Promise<{attempted: number, confirmed: number, manual: number, pending: number}>}
 */
const retryPendingConfirmations = async () => {
  const labels = await shipmentLabelModel.listPendingBmsConfirmations({ maxAgeDays: MAX_RETRY_AGE_DAYS });
  const bilan = { attempted: labels.length, confirmed: 0, manual: 0, pending: 0 };
  if (labels.length === 0) return bilan;

  for (const [index, label] of labels.entries()) {
    if (index > 0) await pause(PAUSE_ENTRE_REPRISES_MS);
    try {
      const issue = await retryOne(label);
      bilan[issue] += 1;
    } catch (error) {
      // Filet : retryOne écrit déjà ses échecs, mais une erreur inattendue ne
      // doit pas emporter la boucle.
      console.error(`[BMS] Reprise ${label.order_number} : erreur inattendue —`, error.message);
      bilan.pending += 1;
    }
  }

  console.log(`[BMS] Reprise expéditions : ${bilan.confirmed} confirmée(s), ${bilan.manual} régularisée(s) hors app, ${bilan.pending} en attente (sur ${bilan.attempted})`);
  return bilan;
};

/** Âge en heures, arrondi, pour la synthèse. */
const ageHeures = (date) => Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 3600000));

/**
 * Synthèse du soir : UN mail listant ce qui n'est toujours pas confirmé, au lieu
 * d'un mail par échec. Un mail par colis raté se noie dans le flux — c'est
 * exactement ce qui est arrivé le 21/09/2026, deux alertes le même jour, une
 * seule traitée.
 *
 * Pas de mail quand il n'y a rien à dire.
 *
 * @returns {Promise<{stuck: number}>}
 */
const reportStuckConfirmations = async () => {
  const labels = await shipmentLabelModel.listStuckBmsConfirmations({ minAgeMinutes: STUCK_AFTER_MINUTES });
  if (labels.length === 0) return { stuck: 0 };

  const lignes = labels.map((l) => {
    const age = ageHeures(l.created_at);
    return [
      `- Commande N°${l.order_number} (${l.carrier_code})`,
      `  Suivi      : ${l.tracking_number || '(aucun - retrait magasin)'}`,
      `  Etiquette  : emise il y a ${age} h${l.packer_name ? ` par ${l.packer_name}` : ''}`,
      `  Tentatives : ${l.bms_attempts || 0}`,
      `  Erreur BMS : ${l.bms_last_error || '(aucune)'}`
    ].join('\n');
  });

  const vieilles = labels.filter((l) => ageHeures(l.created_at) >= 24).length;

  const corps = [
    'Bonjour,',
    '',
    `${labels.length} expedition(s) n'ont pas pu etre confirmees a BMS. Le colis est parti, mais BMS`,
    'croit toujours detenir la marchandise : son stock est faux tant que ce n\'est pas regularise.',
    '',
    lignes.join('\n\n'),
    '',
    'La reprise automatique repasse toutes les 15 min (9h-19h, lun-ven) et ne renvoie jamais',
    'une expedition que BMS a deja enregistree.',
    '',
    vieilles > 0
      ? `${vieilles} de ces etiquettes ont plus de 24 h : la reprise ne suffira pas, il faut les saisir a la main dans BMS,\npuis les classer depuis l'ecran Etiquettes du packing (bouton « Confirmer dans BMS »).`
      : 'Elles sont recentes : la reprise a encore toutes ses chances.',
    '',
    'Detail et reprise manuelle : application packing, ecran Etiquettes generees.'
  ].join('\n');

  await sendAlert(
    `BMS : ${labels.length} expedition(s) non confirmee(s)`,
    corps
  );

  return { stuck: labels.length };
};

/**
 * Reprise déclenchée à la main depuis l'écran des étiquettes.
 *
 * Même chemin que le cron, donc mêmes garde-fous : le bouton ne peut pas
 * fabriquer une double expédition.
 *
 * @param {number|string} labelId
 * @returns {Promise<{status: string, message: string}>}
 */
const confirmLabelById = async (labelId) => {
  const label = await shipmentLabelModel.findBmsConfirmationById(labelId);

  if (!label) {
    const err = new Error("Étiquette introuvable, ou migration de suivi BMS non appliquée");
    err.statusCode = 404;
    throw err;
  }

  if (label.bms_ship_status === 'confirmed' || label.bms_ship_status === 'manual') {
    return { status: label.bms_ship_status, message: 'Expédition déjà confirmée dans BMS.' };
  }

  if (label.bms_ship_status === 'skipped') {
    const err = new Error("Cette étiquette n'attend aucune confirmation BMS (étiquette manuelle, ou émise avant la mise en place du suivi).");
    err.statusCode = 400;
    throw err;
  }

  const issue = await retryOne(label);

  if (issue === 'confirmed') return { status: issue, message: 'Expédition confirmée dans BMS.' };
  if (issue === 'manual') return { status: issue, message: 'BMS n\'avait plus rien à expédier : la commande était déjà expédiée. Classée régularisée.' };

  const apres = await shipmentLabelModel.findBmsConfirmationById(labelId);
  const err = new Error(apres?.bms_last_error || 'BMS a refusé la confirmation.');
  err.statusCode = 502;
  throw err;
};

module.exports = {
  confirmNow,
  retryPendingConfirmations,
  reportStuckConfirmations,
  confirmLabelById,
  MAX_RETRY_AGE_DAYS,
  STUCK_AFTER_MINUTES
};
