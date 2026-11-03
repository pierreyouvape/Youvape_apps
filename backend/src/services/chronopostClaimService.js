/**
 * Réclamations Chronopost — le contrôle de 16 h.
 *
 * Chaque jour (lundi → samedi, cronService), pour les colis Chrono 13, Chrono
 * Relais et Chrono Express déposés sur un bordereau :
 *   1. jour dû (services/claims/chronopostClaims.dueDay : lendemain ouvré, J+3
 *      pour Express, fériés sautés, samedi si l'option a été prise) ;
 *   2. le jour dû passé 16 h, relecture du suivi EN DIRECT (Chronopost publie
 *      parfois une livraison avec retard), puis décision : RT, PC ou rien ;
 *   3. un fichier d'import pour le « Service Client en ligne », envoyé à
 *      contact@youvape.fr — on l'importe à la main chez Chronopost ;
 *   4. une note PRIVÉE dans le ticket SAV de la commande (créé s'il n'existe
 *      pas). Jamais de mail au client.
 *
 * Un colis n'est réclamé qu'une fois. Un passage manqué est rattrapé au suivant :
 * la décision ne regarde que les évènements d'avant 16 h le jour dû.
 */

const claimModel = require('../models/carrierClaimModel');
const trackingModel = require('../models/shipmentTrackingModel');
const savModel = require('../models/savModel');
const { createTicket, CONTACT_EMAIL } = require('../models/pickingPackingModel');
const { trackLabel } = require('./shipmentTrackingService');
const { sendMail } = require('./alertService');
const rules = require('./claims/chronopostClaims');
const { addDays } = require('../utils/frenchHolidays');
const { FINAL_STATES } = require('./tracking/states');

const LOG_TAG = 'Réclamations Chronopost';
const AGENT = 'Réclamations transporteur';

/** Le statut SAV que prend un ticket rouvert pour une réclamation. */
const WAITING_CARRIER = 'en_attente_réponse_transporteur';
/** Statuts remis en « Attente réponse transporteur » ; les autres ne bougent pas. */
const REOPEN_FROM = ['terminé', 'en_attente_réponse_client'];

/** On remonte assez loin pour un Express déposé avant un long week-end. */
const LOOKBACK_DAYS = 10;

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const todayParis = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now);

/**
 * Les réclamations à faire maintenant, sans rien écrire.
 *
 * @param {{now?: Date, live?: boolean, since?: string}} [opts]
 *   live : relire le suivi chez Chronopost avant de décider (le contrôle réel) ;
 *   since : premier jour dû retenu (défaut : app_config.chronopost_claims_since).
 */
const findClaims = async ({ now = new Date(), live = true, since = null } = {}) => {
  const from = since || await claimModel.getSince();
  if (!from) return [];

  const labels = await claimModel.candidates(addDays(from, -LOOKBACK_DAYS));
  const due = labels
    .map(l => ({ ...l, dueDay: rules.dueDay(l.deposit_day, l.method_code) }))
    .filter(l => l.dueDay && l.dueDay >= from && rules.checkInstant(l.dueDay) <= now);

  // Relecture en direct pour les seuls colis dus aujourd'hui et pas encore
  // livrés : pour les échéances passées, le suivi ordinaire a déjà tout reçu.
  const today = todayParis(now);
  const stateOf = live ? await trackingModel.loadStateOf() : null;
  const claims = [];
  for (const label of due) {
    if (live && label.dueDay === today && !FINAL_STATES.includes(label.tracking_state)) {
      await trackLabel(label, stateOf);
    }
    const events = await trackingModel.eventsForLabel(label.id);
    const states = new Map(events.map(e => [e.event_key, e.state]));
    const { object, lastEvent } = rules.decide(label, events, (k) => states.get(k) || null, label.dueDay);
    if (!object) continue;

    const order = object === 'PC' ? await claimModel.loadOrder(label.order_number) : null;
    claims.push({
      labelId: label.id,
      orderNumber: label.order_number,
      trackingNumber: label.tracking_number,
      methodCode: label.method_code,
      object,
      family: object === 'PC' ? rules.FAMILY : null,
      content: order?.items || null,
      comment: rules.buildComment({
        object, label, depositDay: label.deposit_day, bordereauNumber: label.bordereau_number,
        day: label.dueDay, lastEvent,
      }),
      depositDay: label.deposit_day,
      dueDay: label.dueDay,
    });
  }
  return claims;
};

// ── Ticket SAV ──────────────────────────────────────────────────────────────

const noteFor = (claim) => {
  const product = rules.PRODUCTS[rules.parseMethod(claim.method_code).code];
  return `<p><strong>Réclamation Chronopost préparée automatiquement</strong> — `
    + `${escapeHtml(claim.object_code)} ${escapeHtml(rules.OBJECTS[claim.object_code] || '')}.</p>`
    + `<ul><li>Colis : ${escapeHtml(claim.tracking_number)}${product ? ` (${escapeHtml(product.label)})` : ''}</li>`
    + `<li>Déposé le ${escapeHtml(rules.frDay(fmtDay(claim.deposit_day)))}, dû le ${escapeHtml(rules.frDay(fmtDay(claim.due_day)))}</li></ul>`
    + `<p>Commentaire envoyé à Chronopost : « ${escapeHtml(claim.comment)} »</p>`
    + `<p>Le fichier du jour est à importer dans le Service Client en ligne Chronopost (Import de tickets). `
    + `Le n° de ticket Chronopost sera ajouté ici quand le compte-rendu d'import aura été collé dans `
    + `l'Historique d'expédition → Réclamations.</p>`;
};

const fmtDay = (d) => (d instanceof Date
  ? new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(d)
  : String(d).slice(0, 10));

/** Le ticket de la commande : le plus récent, hors fusionnés et spams. */
const findTicket = async (orderNumber) => {
  const pool = require('../config/database');
  const { rows: [row] } = await pool.query(
    `SELECT id, sav_status FROM sav_tickets
      WHERE order_id = $1 AND merged_into_id IS NULL AND COALESCE(is_spam, false) = false
      ORDER BY created_at DESC LIMIT 1`,
    [String(orderNumber)]
  );
  return row || null;
};

/**
 * Note privée dans le ticket de la commande, créé au besoin en « Attente
 * réponse transporteur ». Un ticket Résolu ou en attente du client y repasse ;
 * Nouveau, Ouvert, Réponse client et les autres statuts ne bougent pas.
 */
const notifySav = async (claim) => {
  try {
    const note = noteFor(claim);
    let ticket = await findTicket(claim.order_number);
    if (ticket) {
      await savModel.addMessage(ticket.id, { from: AGENT, body: note, is_agent: true, is_private: true, attachments: [] });
      if (REOPEN_FROM.includes(ticket.sav_status)) await savModel.updateStatus(ticket.id, WAITING_CARRIER);
    } else {
      const order = await claimModel.loadOrder(claim.order_number);
      if (!order) throw new Error(`commande ${claim.order_number} introuvable`);
      const subject = claim.object_code === 'PC'
        ? `Colis non pris en charge par Chronopost : ${claim.tracking_number}`
        : `Retard Chronopost : colis ${claim.tracking_number}`;
      ticket = await createTicket(order, subject, note, AGENT);
      await savModel.updateStatus(ticket.id, WAITING_CARRIER);
    }
    await claimModel.setSavResult(claim.id, ticket.id, null);
    return ticket.id;
  } catch (err) {
    console.error(`[${LOG_TAG}] Note SAV non posée pour ${claim.tracking_number} :`, err.message);
    await claimModel.setSavResult(claim.id, null, err.message.slice(0, 500));
    return null;
  }
};

// ── Mail ────────────────────────────────────────────────────────────────────

const mailBatch = async (batch, claims) => {
  const day = rules.frDay(todayParis(new Date(batch.created_at)));
  const rows = claims.map(c => `<tr><td>${escapeHtml(c.order_number)}</td><td>${escapeHtml(c.tracking_number)}</td>`
    + `<td>${escapeHtml(c.object_code)}</td><td>${escapeHtml(c.comment)}</td></tr>`).join('');
  const html = `<p>${claims.length} colis Chronopost à réclamer (contrôle du ${escapeHtml(day)}, 16 h).</p>`
    + `<p>Fichier joint à importer dans le Service Client en ligne Chronopost : onglet « Import de tickets », `
    + `« Choisir un fichier ». Collez ensuite le compte-rendu affiché par Chronopost dans l'app `
    + `(Historique d'expédition → Réclamations) pour noter les n° de ticket.</p>`
    + `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-size:13px">`
    + `<tr><th>Commande</th><th>Colis</th><th>Objet</th><th>Commentaire</th></tr>${rows}</table>`;
  const text = `${claims.length} colis Chronopost à réclamer (contrôle du ${day}). Fichier joint à importer `
    + `dans le Service Client en ligne Chronopost (Import de tickets).`;
  const result = await sendMail({
    to: CONTACT_EMAIL,
    subject: `Réclamations Chronopost du ${day} : ${claims.length} colis`,
    html, text,
    attachments: [{ filename: batch.file_name, content: batch.csv_data, contentType: 'text/csv; charset=utf-8' }],
  });
  await claimModel.markMailed(batch.id, result.success ? null : (result.error || 'Envoi refusé'));
  return result.success;
};

// ── Passage ─────────────────────────────────────────────────────────────────

let running = false;

/**
 * Le contrôle : décide, enregistre le fichier, l'envoie, pose les notes SAV.
 * Retente aussi les notes SAV restées en échec.
 *
 * @param {{userId?: number, now?: Date}} [opts]
 */
const run = async ({ userId = null, now = new Date() } = {}) => {
  if (running) return { skipped: true };
  running = true;
  try {
    const found = await findClaims({ now, live: true });
    let batch = null;
    let mailed = false;
    let notes = 0;

    if (found.length) {
      const fileName = `reclamations-chronopost-${todayParis(now)}-${Date.now().toString(36)}.csv`;
      const csv = rules.buildCsv(found);
      const saved = await claimModel.createBatch({ carrierCode: 'chronopost', fileName, csv, claims: found, userId });
      batch = saved.batch;
      mailed = await mailBatch(batch, saved.claims);
      for (const c of saved.claims) {
        const method = found.find(f => f.labelId === c.label_id)?.methodCode;
        if (await notifySav({ ...c, method_code: method })) notes++;
      }
    }

    for (const c of await claimModel.pendingSav()) {
      if (c.batch_id === batch?.id) continue;
      if (await notifySav(c)) notes++;
    }

    console.log(`[${LOG_TAG}] ${found.length} colis réclamé(s)${batch ? `, fichier ${batch.file_name}` : ''}`
      + `${batch && !mailed ? ' (mail NON envoyé)' : ''}, ${notes} note(s) SAV`);
    return { claims: found.length, batchId: batch?.id || null, mailed, notes };
  } finally {
    running = false;
  }
};

/**
 * Compte-rendu d'import collé dans l'app : n° de ticket (ou refus) par colis,
 * reporté en note privée dans le ticket SAV.
 */
const applyImportReport = async (batchId, text, userId) => {
  const parsed = rules.parseImportReport(text);
  if (!parsed.length) {
    const err = new Error('Aucune ligne reconnue : collez le compte-rendu tel qu\'affiché par Chronopost '
      + '(« Ligne 1 XW…FR : Ticket créé avec le numéro … »).');
    err.statusCode = 400;
    throw err;
  }
  const claims = await claimModel.claimsOfBatch(batchId);
  const byTracking = new Map(claims.map(c => [c.tracking_number.toUpperCase(), c]));
  let matched = 0;
  const unknown = [];
  for (const r of parsed) {
    const claim = byTracking.get(r.trackingNumber);
    if (!claim) { unknown.push(r.trackingNumber); continue; }
    matched++;
    if (claim.carrier_ticket === r.ticket && !r.error) continue;
    await claimModel.setCarrierResult(claim.id, r.ticket, r.error);
    if (claim.sav_ticket_id) {
      const body = r.ticket
        ? `<p>Ticket Chronopost n° <strong>${escapeHtml(r.ticket)}</strong> créé pour le colis ${escapeHtml(claim.tracking_number)}.</p>`
        : `<p>Chronopost a refusé la réclamation du colis ${escapeHtml(claim.tracking_number)} : ${escapeHtml(r.error)}</p>`;
      await savModel.addMessage(claim.sav_ticket_id, { from: AGENT, body, is_agent: true, is_private: true, attachments: [] })
        .catch(e => console.warn(`[${LOG_TAG}] Note SAV du ticket Chronopost non posée :`, e.message));
    }
  }
  if (matched) await claimModel.markImported(batchId, userId);
  return { lines: parsed.length, matched, unknown };
};

module.exports = { findClaims, run, applyImportReport, notifySav, todayParis, REOPEN_FROM, WAITING_CARRIER };
