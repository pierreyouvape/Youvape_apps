/**
 * Historique d'expédition — liste des colis partis et parcours de chacun.
 *
 * Les actions sur un colis (réimprimer, annuler, confirmer BMS) ne sont pas
 * ici : l'écran appelle les routes `/api/laposte/labels/:id/*`, communes à tous
 * les transporteurs, celles que le packing utilise déjà.
 */

const shipmentHistoryModel = require('../models/shipmentHistoryModel');
const { getAdapter, listCarrierCodes } = require('../services/carriers');
const { supportsDepositSlip } = require('../services/carriers/contract');

const LOG_TAG = 'ShipmentHistory';

const INCIDENTS = {
  incomplete: 'Envoyée incomplète',
  set_aside: 'Mise de côté',
};

/** Les transporteurs qui ont un bordereau de dépôt. */
const depositCarriers = () => listCarrierCodes().filter(code => {
  try { return supportsDepositSlip(getAdapter(code)); } catch { return false; }
});

/** Même règle que la liste du packing : la fenêtre appartient au transporteur émetteur. */
const withCancel = (row, now) => {
  let cancel = { cancellable: false, reason: 'Transporteur inconnu' };
  if (row.status === 'active') {
    try { cancel = getAdapter(row.carrier_code).cancelWindow(row, now); } catch { /* transporteur retiré */ }
  } else {
    cancel = { cancellable: false, reason: 'Étiquette déjà annulée' };
  }
  return { ...row, cancellable: cancel.cancellable, cancel_reason: cancel.reason || null };
};

/**
 * Le parcours d'un colis, dans l'ordre du temps. Pur (testé) : une étape dont
 * on n'a pas la date n'apparaît pas, plutôt qu'avec une date inventée.
 */
const buildTimeline = ({ label, order, wave, incidents, bordereau }) => {
  const ev = [];
  const push = (at, kind, title, by = null, detail = null) => {
    if (at) ev.push({ at, kind, title, by, detail });
  };

  if (order) {
    push(order.paid_at || order.created_at, 'order', order.paid_at ? 'Commande payée' : 'Commande passée');
  }

  if (wave) {
    push(wave.created_at, 'wave', `Ajoutée à la vague ${wave.wave_number}`, wave.created_by_name);
    push(wave.first_printed_at, 'wave', 'Bons de préparation imprimés',
      wave.print_count === 1 ? wave.printed_by_name : null,
      wave.print_count > 1 ? `${wave.print_count} impressions, la dernière par ${wave.printed_by_name || '—'}` : null);
    push(wave.assigned_at, 'pick', 'Picking commencé au PDA', wave.assigned_to_name);
    push(wave.picked_at, 'pick', 'Picking terminé', wave.picked_by_name);
    if (!wave.active) {
      push(wave.removed_at, 'incident', 'Retirée de la vague', wave.removed_by_name, wave.removed_reason);
    }
  }

  for (const i of incidents) {
    const missing = Array.isArray(i.missing)
      ? i.missing.map(m => `${m.qty} × ${m.name}${m.sku ? ` (${m.sku})` : ''}`).join(', ')
      : null;
    push(i.created_at, 'incident', INCIDENTS[i.action] || i.action, i.created_by_name,
      [missing && `Manquant : ${missing}`, i.ticket_id && `Ticket SAV #${i.ticket_id}`].filter(Boolean).join(' — ') || null);
  }

  push(label.created_at, 'label', 'Étiquette générée', label.packer_name,
    [label.tracking_number, label.weight_g && `${label.weight_g} g`].filter(Boolean).join(' — ') || null);

  if (label.bms_ship_status === 'confirmed') {
    push(label.bms_confirmed_at, 'bms', 'Expédition confirmée dans BMS');
  }

  if (bordereau) {
    push(bordereau.created_at, 'deposit', `Déposée — bordereau ${bordereau.bordereau_number}`, bordereau.created_by_name);
  }

  push(label.cancelled_at, 'cancel', 'Étiquette annulée');

  return ev.sort((a, b) => new Date(a.at) - new Date(b.at));
};

/** GET / — ?from&to (AAAA-MM-JJ, Paris) &carrier &user &status &q &page */
const list = async (req, res) => {
  try {
    const data = await shipmentHistoryModel.list(req.query, depositCarriers());
    const now = new Date();
    res.json({ ...data, rows: data.rows.map(r => withCancel(r, now)) });
  } catch (error) {
    console.error(`[${LOG_TAG}] Erreur list :`, error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

/** GET /:id — le colis et son parcours. */
const detail = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Identifiant invalide' });

    const data = await shipmentHistoryModel.getDetail(id);
    if (!data) return res.status(404).json({ error: 'Colis introuvable' });

    res.json({
      label: withCancel(data.label, new Date()),
      wave: data.wave,
      incidents: data.incidents,
      bordereau: data.bordereau,
      otherLabels: data.otherLabels,
      timeline: buildTimeline(data),
    });
  } catch (error) {
    console.error(`[${LOG_TAG}] Erreur detail :`, error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

module.exports = { list, detail, buildTimeline };
