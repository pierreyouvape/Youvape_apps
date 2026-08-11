const pool = require('../config/database');
const { sendAlert } = require('../services/alertService');

/**
 * Met de côté un message entrant qui n'a pas pu être traité, et alerte l'équipe.
 *
 * Raison d'être : le stockage Mailgun est désactivé côté domaine, donc un
 * message perdu ici est perdu définitivement. On conserve au moins de quoi
 * rappeler le client — expéditeur, sujet, identifiant — même quand le contenu,
 * lui, n'est pas récupérable.
 *
 * ⚠️ Ne jette jamais : appelé depuis des chemins de rattrapage, une erreur ici
 * masquerait l'erreur d'origine.
 *
 * @param {object} params
 * @param {object} params.payload      corps de la requête, tel qu'on l'a
 * @param {string} params.error        message d'erreur
 * @param {string} params.sender
 * @param {string} params.subject
 * @param {string} params.messageId
 * @param {string} params.alertTitle   objet du mail d'alerte
 * @param {string} params.alertDetail  lignes de contexte supplémentaires
 */
async function recordInboundFailure({
  payload = {}, error, sender = null, subject = null, messageId = null,
  alertTitle = 'Email SAV non traité', alertDetail = '',
}) {
  try {
    await pool.query(
      `INSERT INTO sav_inbound_failures (sender, subject, message_id, payload, error)
       VALUES ($1, $2, $3, $4, $5)`,
      [sender, subject, messageId, JSON.stringify(payload || {}), error]
    );
  } catch (dbErr) {
    console.error('❌ [SAV Inbound] Échec sauvegarde du message raté:', dbErr.message);
  }

  sendAlert(
    alertTitle,
    `Un message entrant n'a pas pu être traité et a été mis de côté.\n\n`
    + `Expéditeur : ${sender || '(inconnu)'}\n`
    + `Sujet : ${subject || '(inconnu)'}\n`
    + `Identifiant : ${messageId || '(inconnu)'}\n`
    + `Erreur : ${error}\n`
    + (alertDetail ? `\n${alertDetail}\n` : '')
    + `\nLe contexte est conservé en base (table sav_inbound_failures) pour retraitement manuel.`
  ).catch(() => {});
}

module.exports = { recordInboundFailure };
