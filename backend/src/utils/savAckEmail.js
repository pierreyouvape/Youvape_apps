const mailgunService = require('../services/mailgunService');
const emailTemplateService = require('../services/emailTemplateService');

/**
 * Accusé de réception envoyé au client à l'ouverture d'une demande.
 *
 * Partagé par tous les points d'entrée qui créent un ticket à la demande du
 * client : webhook Gravity Forms et formulaire public de l'espace client.
 * Volontairement "fire-and-forget" — un échec d'envoi ne doit jamais faire
 * échouer la création du ticket.
 *
 * @param {object}  params
 * @param {number}  params.ticketId
 * @param {string}  params.email        destinataire
 * @param {string}  params.customerName
 * @param {string}  params.subject      objet du mail (= sujet du ticket)
 */
async function sendAckEmail({ ticketId, email, customerName, subject }) {
  try {
    if (!email) return;
    // Jamais d'accusé vers notre propre adresse SAV : évite une auto-boucle si
    // un mail système rebondit sur la boîte du service client.
    const from = (process.env.MAILGUN_FROM || '').toLowerCase();
    if (from && email.toLowerCase() === from) return;

    const html = emailTemplateService.renderAccuse({
      customer_name: customerName || '',
      subject:       subject || '',
      ticket_id:     ticketId,
    });
    const result = await mailgunService.sendAcknowledgement({
      to: email, subject: subject || 'Votre demande', ticketId, bodyHtml: html,
    });
    if (!result.success) {
      console.warn(`[SAV] Accusé réception non envoyé (ticket #${ticketId}):`, result.error);
    }
  } catch (e) {
    console.warn(`[SAV] Accusé réception échoué (ticket #${ticketId}):`, e.message);
  }
}

module.exports = { sendAckEmail };
