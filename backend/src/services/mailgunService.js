const FormData = require('form-data');
const Mailgun = require('mailgun.js');
const crypto = require('crypto');

const mailgun = new Mailgun(FormData);
const mg = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY,
  url: process.env.MAILGUN_BASE_URL || 'https://api.mailgun.net',
});

const DOMAIN = process.env.MAILGUN_DOMAIN;
const FROM   = process.env.MAILGUN_FROM;

// Convertit un HTML de message en texte brut lisible (fallback pour les clients
// mail qui n'affichent pas le HTML). Conversion volontairement simple : les
// blocs deviennent des sauts de ligne, les balises sont retirées, les entités
// courantes décodées.
function htmlToPlainText(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const mailgunService = {

  htmlToPlainText,

  // ─── Envoyer une réponse agent au client ─────────────────────────────────
  // bodyHtml : HTML du message (éditeur riche). bodyText : fallback texte ;
  // si absent et bodyHtml fourni, il est dérivé automatiquement du HTML.
  sendReply: async ({ to, subject, ticketId, bodyText, bodyHtml, attachments }) => {
    try {
      // Le sujet contient le ticket ID pour matcher les réponses entrantes
      const fullSubject = subject.includes(`[SAV #${ticketId}]`)
        ? subject
        : `[SAV #${ticketId}] ${subject}`;

      const textFallback = bodyText || (bodyHtml ? htmlToPlainText(bodyHtml) : '');

      const messageData = {
        from: FROM,
        to: [to],
        subject: fullSubject,
        text: textFallback,
        'h:Reply-To': FROM,
      };

      if (bodyHtml) {
        messageData.html = bodyHtml;
      }

      if (Array.isArray(attachments) && attachments.length > 0) {
        messageData.attachment = attachments;
      }

      const result = await mg.messages.create(DOMAIN, messageData);
      console.log(`📧 [Mailgun] Email envoyé au client ${to} pour ticket #${ticketId}`);
      return { success: true, id: result.id };

    } catch (error) {
      console.error(`❌ [Mailgun] Erreur envoi email ticket #${ticketId}:`, error.message);
      return { success: false, error: error.message };
    }
  },

  // ─── Accusé de réception au client (auto à la création/réponse) ──────────
  // Comme sendReply, garde [SAV #N] dans le sujet pour que toute réponse du
  // client se rattache au ticket. bodyHtml = template accusé déjà enrobé.
  sendAcknowledgement: async ({ to, subject, ticketId, bodyText, bodyHtml }) => {
    try {
      const fullSubject = subject.includes(`[SAV #${ticketId}]`)
        ? subject
        : `[SAV #${ticketId}] ${subject}`;

      const messageData = {
        from: FROM,
        to: [to],
        subject: fullSubject,
        text: bodyText || (bodyHtml ? htmlToPlainText(bodyHtml) : ''),
        'h:Reply-To': FROM,
      };
      if (bodyHtml) messageData.html = bodyHtml;

      const result = await mg.messages.create(DOMAIN, messageData);
      console.log(`📧 [Mailgun] Accusé de réception envoyé à ${to} pour ticket #${ticketId}`);
      return { success: true, id: result.id };
    } catch (error) {
      console.error(`❌ [Mailgun] Erreur accusé réception ticket #${ticketId}:`, error.message);
      return { success: false, error: error.message };
    }
  },

  // ─── Notification interne (notif équipe SAV, pas envoyé au client) ──────
  // PAS de préfixe [SAV #N] dans le sujet pour ne pas être confondu avec un
  // inbound client. Permet plusieurs destinataires en CC.
  sendNotification: async ({ to, subject, bodyText, bodyHtml }) => {
    try {
      const recipients = Array.isArray(to) ? to : [to];
      if (recipients.length === 0) return { success: false, error: 'Aucun destinataire' };

      const messageData = {
        from: FROM,
        to: recipients,
        subject,
        text: bodyText,
        'h:Reply-To': FROM,
      };
      if (bodyHtml) messageData.html = bodyHtml;

      const result = await mg.messages.create(DOMAIN, messageData);
      console.log(`📧 [Mailgun] Notification interne envoyée à ${recipients.join(', ')} : ${subject}`);
      return { success: true, id: result.id };

    } catch (error) {
      console.error(`❌ [Mailgun] Erreur envoi notification : ${error.message}`);
      return { success: false, error: error.message };
    }
  },

  // ─── Vérifier la signature d'un webhook Mailgun entrant ──────────────────
  verifyWebhookSignature: (timestamp, token, signature) => {
    try {
      const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY || process.env.MAILGUN_API_KEY;
      const value = timestamp + token;
      const hash = crypto
        .createHmac('sha256', signingKey)
        .update(value)
        .digest('hex');
      return hash === signature;
    } catch (e) {
      return false;
    }
  },

  // ─── Extraire le ticket ID depuis le sujet d'un email entrant ────────────
  extractTicketIdFromSubject: (subject) => {
    if (!subject) return null;
    const match = subject.match(/\[SAV #(\d+)\]/i);
    return match ? parseInt(match[1]) : null;
  },

  // ─── Test de connexion Mailgun ────────────────────────────────────────────
  testConnection: async () => {
    try {
      await mg.domains.get(DOMAIN);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
};

module.exports = mailgunService;
